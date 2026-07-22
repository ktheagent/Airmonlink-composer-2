const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Build 16 entry point installs publishing exposure after renderer navigation', () => {
  const root = path.join(__dirname, '..');
  const bootstrap = fs.readFileSync(path.join(root, 'src', 'release-bootstrap.js'), 'utf8');
  const exposure = fs.readFileSync(path.join(root, 'src', 'ui', 'publishing-exposure.js'), 'utf8');

  assert.match(bootstrap, /browser-window-created/);
  assert.match(bootstrap, /dom-ready/);
  assert.match(bootstrap, /did-finish-load/);
  assert.match(bootstrap, /did-navigate-in-page/);
  assert.match(bootstrap, /const BUILD = 16;/);
  assert.match(bootstrap, /AirmonPublishingExposure\?\.build === \$\{BUILD\}/);
  assert.match(bootstrap, /require\('\.\/bootstrap'\)/);

  assert.match(exposure, /Build 16 publishing active/);
  assert.match(exposure, /Dedicated PDF/);
  assert.match(exposure, /PNG Pages/);
  assert.match(exposure, /data-build-16-publish/);
  assert.match(exposure, /data-build-16-menu/);
  assert.match(exposure, /dataset\.airmonBuild = String\(BUILD\)/);
});

test('Build 16 exposure installer is idempotent and observer work is coalesced', () => {
  const exposure = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'ui', 'publishing-exposure.js'),
    'utf8'
  );

  assert.match(exposure, /grid\.querySelector\('\[data-build-16-publish\]'\)/);
  assert.match(exposure, /menu\.querySelector\('\[data-build-16-menu\]'\)/);
  assert.match(exposure, /if \(scheduled\) return/);
  assert.match(exposure, /queueMicrotask/);
  assert.doesNotMatch(exposure, /querySelectorAll\('\[data-build-16-publish\]'\).*remove/);
});
