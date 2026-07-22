const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { findAssociatedDocumentPath } = require('../src/desktop/associated-file');

test('Windows association helper selects an existing airscore argument only', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'airmon-association-'));
  const scorePath = path.join(directory, 'validation.airscore');
  const textPath = path.join(directory, 'ignored.txt');
  fs.writeFileSync(scorePath, '{}');
  fs.writeFileSync(textPath, 'ignored');
  assert.equal(
    findAssociatedDocumentPath(['Airmonlink Composer.exe', '--flag', textPath, scorePath]),
    path.resolve(scorePath)
  );
  assert.equal(findAssociatedDocumentPath(['Airmonlink Composer.exe', textPath]), null);
});

test('desktop bridge and renderer preserve associated-open result evidence', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  assert.match(preload, /onOpenDocumentPath/);
  assert.match(preload, /notifyRendererReady/);
  assert.match(preload, /reportAssociatedOpenResult/);
  assert.match(main, /requestSingleInstanceLock/);
  assert.match(main, /app:renderer-ready/);
  assert.match(main, /associated-open-result/);
  assert.match(renderer, /initializeAssociatedFileOpening/);
  assert.match(renderer, /notifyRendererReady/);
  assert.match(renderer, /success: true/);
});
