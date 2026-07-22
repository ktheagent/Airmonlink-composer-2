const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Build 17 release validator matches the direct verified publishing bootstrap', () => {
  const root = path.join(__dirname, '..');
  const bootstrap = fs.readFileSync(path.join(root, 'src', 'bootstrap.js'), 'utf8');
  const validator = fs.readFileSync(
    path.join(root, 'scripts', 'windows-release-validation.ps1'),
    'utf8'
  );
  const pkg = require('../package.json');

  assert.equal(pkg.main, 'src/bootstrap.js');
  assert.equal(pkg.buildNumber, '17');
  assert.match(bootstrap, /const BUILD = 17;/);
  assert.match(bootstrap, /publishing-ui\.js/);
  assert.match(bootstrap, /publishing-ui-ready/);
  assert.match(bootstrap, /result\.pdfControls < 2/);
  assert.match(bootstrap, /result\.pngControls < 2/);
  assert.match(validator, /ExpectedBuild = 17/);
  assert.match(validator, /AIRM_ON?MONLINK_VALIDATION_LOG|AIRMONLINK_VALIDATION_LOG/);
  assert.match(validator, /publishing-ui-ready/);
  assert.match(validator, /pdfControls/);
  assert.match(validator, /pngControls/);
  assert.doesNotMatch(validator, /release-bootstrap\.js/);
});
