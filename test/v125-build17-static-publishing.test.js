const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('Build 17 package uses the direct publishing bootstrap', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.main, 'src/bootstrap.js');
  assert.equal(pkg.buildNumber, '17');
  assert.equal(pkg.build.buildVersion, '1.1.0.17');
  assert.match(pkg.build.nsis.artifactName, /Build17/);
  assert.match(pkg.build.portable.artifactName, /Build17/);
});

test('Build 17 publishing UI installs visible controls without document observers', () => {
  const source = fs.readFileSync(
    path.join(root, 'src', 'ui', 'publishing-ui.js'),
    'utf8'
  );
  assert.match(source, /const BUILD = 17;/);
  assert.match(source, /Dedicated PDF/);
  assert.match(source, /PNG Pages/);
  assert.match(source, /data-publish-kind/);
  assert.match(source, /pdfControls/);
  assert.match(source, /pngControls/);
  assert.doesNotMatch(source, /MutationObserver/);
});

test('desktop bootstrap verifies controls inside the live renderer', () => {
  const source = fs.readFileSync(
    path.join(root, 'src', 'bootstrap.js'),
    'utf8'
  );
  assert.match(source, /const BUILD = 17;/);
  assert.match(source, /publishing-ui\.js/);
  assert.match(source, /publishing-ui-ready/);
  assert.match(source, /result\.pdfControls < 2/);
  assert.match(source, /result\.pngControls < 2/);
  assert.match(source, /dialog\.showMessageBox/);
  assert.doesNotMatch(source, /publishing-exposure\.js/);
});

test('Windows validator requires built renderer proof before artifact upload', () => {
  const source = fs.readFileSync(
    path.join(root, 'scripts', 'windows-release-validation.ps1'),
    'utf8'
  );
  assert.match(source, /AIRMONLINK_VALIDATION_LOG/);
  assert.match(source, /publishing-ui-ready/);
  assert.match(source, /pdfControls/);
  assert.match(source, /pngControls/);
  assert.match(source, /ExpectedBuild = 17/);
});
