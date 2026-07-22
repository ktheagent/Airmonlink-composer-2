'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const MIN_PAGE_PX = 240;
const MAX_PAGE_PX = 8000;
const PX_PER_INCH = 96;

function sanitizeFileStem(value, fallback = 'Untitled-Score') {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  return (normalized || fallback).slice(0, 120).replace(/[. ]+$/g, '') || fallback;
}

function normalizeDimension(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(MIN_PAGE_PX, Math.min(MAX_PAGE_PX, Math.round(number)));
}

function normalizePublishRequest(input = {}) {
  const view = input.view === 'solfa' ? 'solfa' : 'score';
  const width = normalizeDimension(input.width, view === 'solfa' ? 794 : 900);
  const height = normalizeDimension(input.height, view === 'solfa' ? 1123 : 1165);
  return {
    view,
    title: sanitizeFileStem(input.title),
    width,
    height,
    landscape: width > height,
    widthInches: width / PX_PER_INCH,
    heightInches: height / PX_PER_INCH
  };
}

function pdfFileName(request) {
  const value = normalizePublishRequest(request);
  return `${value.title}-${value.view === 'solfa' ? 'Tonic-Solfa' : 'Score'}.pdf`;
}

function pngBaseName(request) {
  const value = normalizePublishRequest(request);
  return `${value.title}-${value.view === 'solfa' ? 'Tonic-Solfa' : 'Score'}`;
}

function numberedPngPath(selectedPath, index, total) {
  const parsed = path.parse(String(selectedPath || ''));
  if (!parsed.dir || !parsed.name) throw new Error('A valid PNG destination is required.');
  const page = Math.max(1, Math.trunc(Number(index) || 1));
  const count = Math.max(page, Math.trunc(Number(total) || page));
  const digits = Math.max(3, String(count).length);
  const stem = parsed.name.replace(/-page-\d+$/i, '');
  return path.join(parsed.dir, `${stem}-page-${String(page).padStart(digits, '0')}.png`);
}

function pdfOptions(request) {
  const value = normalizePublishRequest(request);
  return {
    landscape: value.landscape,
    displayHeaderFooter: false,
    printBackground: true,
    scale: 1,
    pageSize: { width: value.widthInches, height: value.heightInches },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    preferCSSPageSize: true
  };
}

function normalizeCaptureRect(input = {}) {
  return {
    x: Math.max(0, Math.round(Number(input.x) || 0)),
    y: Math.max(0, Math.round(Number(input.y) || 0)),
    width: normalizeDimension(input.width, 794),
    height: normalizeDimension(input.height, 1123)
  };
}

function assertPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) throw new Error('PDF generation returned no document data.');
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('PDF generation returned an invalid document.');
  return buffer;
}

function assertPngBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) throw new Error('PNG capture returned no image data.');
  const signature = Buffer.from([137,80,78,71,13,10,26,10]);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error('PNG capture returned an invalid image.');
  return buffer;
}

async function atomicWrite(targetPath, data) {
  const target = path.resolve(String(targetPath || ''));
  if (target === path.parse(target).root) throw new Error('A valid export destination is required.');
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.writeFile(temporary, data, { flag: 'wx' });
    await fs.rm(target, { force: true });
    await fs.rename(temporary, target);
    return target;
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function createAtomicBatch(targetPaths) {
  if (!Array.isArray(targetPaths) || !targetPaths.length) throw new Error('At least one export page is required.');
  const id = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const records = targetPaths.map((targetPath, index) => {
    const target = path.resolve(String(targetPath || ''));
    if (target === path.parse(target).root) throw new Error('A valid export destination is required.');
    const directory = path.dirname(target);
    return {
      target,
      directory,
      temporary: path.join(directory, `.${path.basename(target)}.${id}.${index}.tmp`),
      backup: path.join(directory, `.${path.basename(target)}.${id}.${index}.bak`),
      staged: false,
      hadOriginal: false,
      installed: false
    };
  });
  const normalized = records.map(record => process.platform === 'win32' ? record.target.toLowerCase() : record.target);
  if (new Set(normalized).size !== normalized.length) throw new Error('Export pages must use unique paths.');
  let closed = false;

  async function stage(index, data) {
    if (closed) throw new Error('The export transaction is closed.');
    const record = records[index];
    if (!record || !Buffer.isBuffer(data)) throw new Error('Invalid export page data.');
    await fs.mkdir(record.directory, { recursive: true });
    await fs.rm(record.temporary, { force: true }).catch(() => {});
    await fs.writeFile(record.temporary, data, { flag: 'wx' });
    record.staged = true;
  }

  async function rollback() {
    for (const record of [...records].reverse()) {
      if (record.installed) await fs.rm(record.target, { force: true }).catch(() => {});
      if (record.hadOriginal) await fs.rename(record.backup, record.target).catch(() => {});
      await fs.rm(record.temporary, { force: true }).catch(() => {});
      await fs.rm(record.backup, { force: true }).catch(() => {});
      record.installed = false;
      record.hadOriginal = false;
    }
    closed = true;
  }

  async function commit() {
    if (closed) throw new Error('The export transaction is closed.');
    if (records.some(record => !record.staged)) throw new Error('Every export page must be staged before commit.');
    try {
      for (const record of records) {
        try {
          await fs.rename(record.target, record.backup);
          record.hadOriginal = true;
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
      }
      for (const record of records) {
        await fs.rename(record.temporary, record.target);
        record.installed = true;
      }
      await Promise.all(records.map(record => fs.rm(record.backup, { force: true })));
      closed = true;
      return records.map(record => record.target);
    } catch (error) {
      await rollback();
      throw error;
    }
  }

  return { targets: records.map(record => record.target), stage, commit, rollback };
}

function publishingUrl(value) {
  const source = String(value ?? '');
  const match = /^airmon-publish:\/\/(pdf|png)(?:\?([^#]*))?$/i.exec(source);
  if (!match) return null;
  const kind = match[1].toLowerCase();
  const searchParams = new URLSearchParams(match[2] || '');
  return {
    kind,
    request: normalizePublishRequest({
      view: searchParams.get('view'),
      title: searchParams.get('title'),
      width: searchParams.get('width'),
      height: searchParams.get('height')
    })
  };
}

module.exports = {
  sanitizeFileStem,
  normalizePublishRequest,
  pdfFileName,
  pngBaseName,
  numberedPngPath,
  pdfOptions,
  normalizeCaptureRect,
  assertPdfBuffer,
  assertPngBuffer,
  atomicWrite,
  createAtomicBatch,
  publishingUrl
};
