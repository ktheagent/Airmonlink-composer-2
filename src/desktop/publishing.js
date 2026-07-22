'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_TITLE_LENGTH = 120;
const MIN_PAGE_PX = 240;
const MAX_PAGE_PX = 8000;
const PX_PER_INCH = 96;
const PX_PER_MM = PX_PER_INCH / 25.4;

function sanitizeFileStem(value, fallback = 'Untitled-Score') {
  const normalized = String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
  const safe = normalized || fallback;
  return safe.slice(0, MAX_TITLE_LENGTH).replace(/[. ]+$/g, '') || fallback;
}

function normalizeView(value) {
  return value === 'solfa' ? 'solfa' : 'score';
}

function normalizePageDimension(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(MIN_PAGE_PX, Math.min(MAX_PAGE_PX, Math.round(number)));
}

function normalizePublishRequest(input = {}) {
  const view = normalizeView(input.view);
  const width = normalizePageDimension(input.width, view === 'solfa' ? 794 : 900);
  const height = normalizePageDimension(input.height, view === 'solfa' ? 1123 : 1165);
  const title = sanitizeFileStem(input.title);
  return {
    view,
    title,
    width,
    height,
    landscape: width > height,
    widthInches: width / PX_PER_INCH,
    heightInches: height / PX_PER_INCH,
    widthMillimetres: width / PX_PER_MM,
    heightMillimetres: height / PX_PER_MM
  };
}

function pdfFileName(request) {
  const data = normalizePublishRequest(request);
  return `${data.title}-${data.view === 'solfa' ? 'Tonic-Solfa' : 'Score'}.pdf`;
}

function pngBaseName(request) {
  const data = normalizePublishRequest(request);
  return `${data.title}-${data.view === 'solfa' ? 'Tonic-Solfa' : 'Score'}`;
}

function numberedPngPath(selectedPath, index, total) {
  const parsed = path.parse(String(selectedPath || ''));
  if (!parsed.dir || !parsed.name) throw new Error('A valid PNG destination is required.');
  const page = Math.max(1, Math.trunc(Number(index) || 1));
  const pageCount = Math.max(page, Math.trunc(Number(total) || page));
  const digits = Math.max(3, String(pageCount).length);
  const base = parsed.name.replace(/-page-\d+$/i, '');
  return path.join(parsed.dir, `${base}-page-${String(page).padStart(digits, '0')}.png`);
}

function pdfOptions(request) {
  const data = normalizePublishRequest(request);
  return {
    landscape: data.landscape,
    displayHeaderFooter: false,
    printBackground: true,
    scale: 1,
    pageSize: {
      width: data.widthInches,
      height: data.heightInches
    },
    margins: {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0
    },
    preferCSSPageSize: true
  };
}

function normalizeCaptureRect(input = {}) {
  const width = normalizePageDimension(input.width, 794);
  const height = normalizePageDimension(input.height, 1123);
  return {
    x: Math.max(0, Math.round(Number(input.x) || 0)),
    y: Math.max(0, Math.round(Number(input.y) || 0)),
    width,
    height
  };
}

function assertPngBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) throw new Error('PNG capture returned no image data.');
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error('PNG capture returned an invalid image.');
  return buffer;
}

function assertPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) throw new Error('PDF generation returned no document data.');
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('PDF generation returned an invalid document.');
  return buffer;
}

async function atomicWrite(targetPath, data) {
  const resolved = path.resolve(String(targetPath || ''));
  if (!resolved || resolved === path.parse(resolved).root) throw new Error('A valid export destination is required.');
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  const temporary = path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    await fs.writeFile(temporary, data, { flag: 'wx' });
    await fs.rm(resolved, { force: true });
    await fs.rename(temporary, resolved);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return resolved;
}

function createAtomicBatch(targetPaths) {
  if (!Array.isArray(targetPaths) || !targetPaths.length) throw new Error('At least one export page is required.');
  const transaction = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const records = targetPaths.map((targetPath, index) => {
    const target = path.resolve(String(targetPath || ''));
    if (!target || target === path.parse(target).root) throw new Error('A valid export destination is required.');
    const directory = path.dirname(target);
    return {
      target,
      directory,
      temporary: path.join(directory, `.${path.basename(target)}.${transaction}.${index}.tmp`),
      backup: path.join(directory, `.${path.basename(target)}.${transaction}.${index}.bak`),
      staged: false,
      hadOriginal: false,
      installed: false
    };
  });

  if (new Set(records.map(record => process.platform === 'win32' ? record.target.toLowerCase() : record.target)).size !== records.length) {
    throw new Error('Export pages must use unique destination paths.');
  }

  let finished = false;

  async function stage(index, data) {
    if (finished) throw new Error('The export transaction is already closed.');
    const record = records[Math.trunc(Number(index))];
    if (!record) throw new Error('The export page index is invalid.');
    if (!Buffer.isBuffer(data)) throw new Error(`Export page ${Number(index) + 1} has no binary data.`);
    await fs.mkdir(record.directory, { recursive: true });
    await fs.rm(record.temporary, { force: true }).catch(() => {});
    await fs.writeFile(record.temporary, data, { flag: 'wx' });
    record.staged = true;
    return record.target;
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
    finished = true;
  }

  async function commit() {
    if (finished) throw new Error('The export transaction is already closed.');
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
      await Promise.all(records.filter(record => record.hadOriginal).map(record => fs.rm(record.backup, { force: true })));
      finished = true;
      return records.map(record => record.target);
    } catch (error) {
      await rollback();
      throw eror;
    }
  }

  return {
    targets: records.map(record => record.target),
    stage,
    commit,
    rollback
  };
}

async function atomicWriteMany(entries) {
  if (!Array.isArray(entries) || !entries.length) throw new Error('At least one export page is required.');
  const batch = createAtomicBatch(entries.map(entry => entry?.path));
  try {
    for (let index = 0; index < entries.length; index += 1) {
      await batch.stage(index, entries[index]?.data);
    }
    return await batch.commit();
  } catch (error) {
    await batch.rollback().catch(() => {});
    throw error;
  }
}

function publishingUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch (_) {
    return null;
  }
  if (parsed.protocol !== 'airmon-publish:') return null;
  const kind = parsed.hostname;
  if (!['pdf', 'png'].includes(kind)) return null;
  return {
    kind,
    request: normalizePublishRequest({
      view: parsed.searchParams.get('view'),
      title: parsed.searchParams.get('title'),
      width: parsed.searchParams.get('width'),
      height: parsed.searchParams.get('height')
    })
  };
}

module.exports = {
  MAX_TITLE_LENGTH,
  MIN_PAGE_PX,
  MAX_PAGE_PX,
  PX_PER_INCH,
  PX_PER_MM,
  sanitizeFileStem,
  normalizeView,
  normalizePageDimension,
  normalizePublishRequest,
  pdfFileName,
  pngBaseName,
  numberedPngPath,
  pdfOptions,
  normalizeCaptureRect,
  assertPngBuffer,
  assertPdfBuffer,
  atomicWrite,
  createAtomicBatch,
  atomicWriteMany,
  publishingUrl
};
