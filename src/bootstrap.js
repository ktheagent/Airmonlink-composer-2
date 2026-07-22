'use strict';

const { app, BrowserWindow, dialog, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const publishing = require('./desktop/publishing');

const BUILD = 17;
const active = new WeakSet();
let uiSourcePromise;

function js(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function logValidation(stage, details = {}) {
  const target = process.env.AIRMONLINK_VALIDATION_LOG;
  if (!target) return Promise.resolve();
  const record = JSON.stringify({
    timestamp: new Date().toISOString(),
    stage,
    ...details
  });
  return fs.appendFile(target, `${record}\n`, 'utf8').catch(() => {});
}

function publishingUiSource() {
  if (!uiSourcePromise) {
    uiSourcePromise = fs.readFile(
      path.join(__dirname, 'ui', 'publishing-ui.js'),
      'utf8'
    );
  }
  return uiSourcePromise;
}

async function rendererCall(contents, method, ...args) {
  return contents.executeJavaScript(
    `window.AirmonPublishingUI?.${method}?.(${args.map(js).join(',')})`,
    true
  );
}

async function complete(contents, result) {
  if (!contents.isDestroyed()) {
    await rendererCall(contents, 'complete', result).catch(() => {});
  }
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

  if (selected.canceled || !selected.filePath) {
    return complete(contents, { kind: 'pdf', cancelled: true });
  }

  await rendererCall(contents, 'beginPdf', request.view);
  try {
    const data = publishing.assertPdfBuffer(
      await contents.printToPDF(publishing.pdfOptions(request))
    );
    await publishing.atomicWrite(selected.filePath, data);
    await complete(contents, {
      kind: 'pdf',
      filePath: selected.filePath
    });
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

  if (selected.canceled || !selected.filePath) {
    return complete(contents, { kind: 'png', cancelled: true });
  }

  const info = await rendererCall(contents, 'beginPng', request.view);
  if (
    !info ||
    !Number.isInteger(info.count) ||
    info.count < 1 ||
    info.count > 2000
  ) {
    throw new Error('The renderer returned an invalid page count.');
  }

  const targets = Array.from({ length: info.count }, (_, index) =>
    publishing.numberedPngPath(
      selected.filePath,
      index + 1,
      info.count
    )
  );
  const batch = publishing.createAtomicBatch(targets);

  try {
    for (let index = 0; index < info.count; index += 1) {
      const rect = publishing.normalizeCaptureRect(
        await rendererCall(contents, 'showPngPage', index)
      );
      const image = await contents.capturePage(rect, {
        stayAwake: true
      });
      await batch.stage(
        index,
        publishing.assertPngBuffer(image.toPNG())
      );
    }

    const files = await batch.commit();
    await complete(contents, {
      kind: 'png',
      count: files.length,
      files
    });
  } catch (error) {
    await batch.rollback().catch(() => {});
    throw error;
  } finally {
    await rendererCall(contents, 'endPublishing').catch(() => {});
  }
}

async function handlePublishing(contents, parsed) {
  if (active.has(contents)) {
    return complete(contents, {
      kind: parsed.kind,
      error: 'Another export is already running.'
    });
  }

  active.add(contents);
  try {
    if (parsed.kind === 'pdf') {
      await exportPdf(contents, parsed.request);
    } else {
      await exportPng(contents, parsed.request);
    }
  } catch (error) {
    await complete(contents, {
      kind: parsed.kind,
      error: error?.message || String(error)
    });
  } finally {
    active.delete(contents);
  }
}

async function installPublishingUi(contents) {
  if (!contents || contents.isDestroyed()) return null;

  const source = await publishingUiSource();
  await contents.executeJavaScript(source, true);
  const result = await contents.executeJavaScript(
    'window.AirmonPublishingUI?.verify?.()',
    true
  );

  if (
    !result ||
    result.build !== BUILD ||
    result.api !== true ||
    result.pdfControls < 2 ||
    result.pngControls < 2 ||
    result.badge !== true ||
    result.status !== true
  ) {
    throw new Error(
      `Build ${BUILD} publishing UI verification failed: ` +
      JSON.stringify(result)
    );
  }

  await logValidation('publishing-ui-ready', result);
  return result;
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
    }
    return { action: 'deny' };
  });

  contents.on('did-finish-load', () => {
    void installPublishingUi(contents).catch(async error => {
      console.error('[publishing] UI installation failed:', error);
      await logValidation('publishing-ui-failed', {
        build: BUILD,
        error: error?.message || String(error)
      });
      if (!window.isDestroyed()) {
        await dialog.showMessageBox(window, {
          type: 'error',
          title: 'Publishing controls failed to load',
          message:
            `Build ${BUILD} could not activate PDF and PNG publishing.`,
          detail: error?.message || String(error),
          buttons: ['OK'],
          noLink: true
        }).catch(() => {});
      }
    });
  });
}

app.on('browser-window-created', (_event, window) => attach(window));
require('./main');
