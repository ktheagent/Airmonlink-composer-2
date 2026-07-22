'use strict';

const { app, BrowserWindow, dialog, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const publishing = require('./desktop/publishing');

const active = new WeakSet();

function js(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

async function rendererCall(contents, method, ...args) {
  return contents.executeJavaScript(
    `window.AirmonPublishingUI?.${method}?.(${args.map(js).join(',')})`,
    true
  );
}

async function complete(contents, result) {
  if (!contents.isDestroyed()) await rendererCall(contents, 'complete', result).catch(() => {});
}

async function exportPdf(contents, request) {
  const window = BrowserWindow.fromWebContents(contents);
  const selected = await dialog.showSaveDialog(window, {
    title: 'Export dedicated PDF',
    defaultPath: publishing.pdfFileName(request),
    buttonLabel: 'Export PDF',
    filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    properties: ['showOverwriteConfirmation']
  });
  if (selected.canceled || !selected.filePath) return complete(contents, { kind: 'pdf', canceled: true });

  await rendererCall(contents, 'beginPdf', request.view);
  try {
    const data = publishing.assertPdfBuffer(await contents.printToPDF(publishing.pdfOptions(request)));
    await publishing.atomicWrite(selected.filePath, data);
    await complete(contents, { kind: 'pdf', filePath: selected.filePath });
  } finally {
    await rendererCall(contents, 'endPublishing').catch(() => {});
  }
}

async function exportPng(contents, request) {
  const window = BrowserWindow.fromWebContents(contents);
  const selected = await dialog.showSaveDialog(window, {
    title: 'Export numbered PNG pages',
    defaultPath: `${publishing.pngBaseName(request)}-page-001.png`,
    buttonLabel: 'Export PNG Pages',
    filters: [{ name: 'PNG image', extensions: ['png'] }],
    properties: ['showOverwriteConfirmation']
  });
  if (selected.canceled || !selected.filePath) return complete(contents, { kind: 'png', canceled: true });

  const info = await rendererCall(contents, 'beginPng', request.view);
  if (!info || !Number.isInteger(info.count) || info.count < 1 || info.count > 2000) {
    throw new Error('The renderer returned an invalid page count.');
  }
  const targets = Array.from({ length: info.count }, (_, index) =>
    publishing.numberedPngPath(selected.filePath, index + 1, info.count)
  );
  const batch = publishing.createAtomicBatch(targets);
  try {
    for (let index = 0; index < info.count; index += 1) {
      const rect = publishing.normalizeCaptureRect(await rendererCall(contents, 'showPngPage', index));
      const image = await contents.capturePage(rect, { stayAwake: true });
      await batch.stage(index, publishing.assertPngBuffer(image.toPNG()));
    }
    const files = await batch.commit();
    await complete(contents, { kind: 'png', count: files.length, files });
  } catch (error) {
    await batch.rollback().catch(() => {});
    throw error;
  } finally {
    await rendererCall(contents, 'endPublishing').catch(() => {});
  }
}

async function handlePublishing(contents, parsed) {
  if (active.has(contents)) return complete(contents, { kind: parsed.kind, error: 'Another export is already running.' });
  active.add(contents);
  try {
    if (parsed.kind === 'pdf') await exportPdf(contents, parsed.request);
    else await exportPng(contents, parsed.request);
  } catch (error) {
    await complete(contents, { kind: parsed.kind, error: error?.message || String(error) });
  } finally {
    active.delete(contents);
  }
}

function attach(window) {
  const contents = window.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    const parsed = publishing.publishingUrl(url);
    if (parsed) {
      void handlePublishing(contents, parsed);
      return { action: 'deny' };
    }
    if (/^https?:/i.test(url)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  contents.on('did-finish-load', async () => {
    try {
      const source = await fs.readFile(path.join(__dirname, 'ui', 'publishing-ui.js'), 'utf8');
      await contents.executeJavaScript(source, true);
    } catch (error) {
      console.error('[publishing] UI injection failed:', error);
    }
  });
}

app.on('browser-window-created', (_event, window) => attach(window));
require('./main');
