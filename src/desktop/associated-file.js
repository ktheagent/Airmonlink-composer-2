const fs = require('node:fs');
const path = require('node:path');

const ASSOCIATED_EXTENSIONS = new Set(['.airscore']);

function findAssociatedDocumentPath(argv = process.argv, options = {}) {
  const existsSync = options.existsSync || fs.existsSync;
  for (const rawValue of Array.isArray(argv) ? argv : []) {
    const value = String(rawValue || '').trim().replace(/^"(.*)"$/, '$1');
    if (!value || value.startsWith('-')) continue;
    if (!ASSOCIATED_EXTENSIONS.has(path.extname(value).toLowerCase())) continue;
    const resolved = path.resolve(value);
    if (existsSync(resolved)) return resolved;
  }
  return null;
}

module.exports = { ASSOCIATED_EXTENSIONS, findAssociatedDocumentPath };
