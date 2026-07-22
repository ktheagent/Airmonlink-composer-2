const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Build 16 release validator matches the real desktop bootstrap chain', () => {
  const root = path.join(__dirname, '..');
  const bootstrap = fs.readFileSync(path.join(root, 'src', 'release-bootstrap.js'), 'utf8');
  const validator = fs.readFileSync(path.join(root, 'scripts', 'windows-release-validation.ps1'), 'utf8');
  const statement = "require('./bootstrap');";

  assert.match(bootstrap, /const BUILD = 16;/);
  assert.ok(bootstrap.includes(statement), 'release bootstrap must chain to src/bootstrap.js');
  assert.ok(
    validator.includes(`.Contains("${statement}")`),
    'Windows validator must check the exact bootstrap statement literally'
  );
  assert.doesNotMatch(
    validator,
    /require\\\('\.\.\\\/bootstrap'\)/,
    'validator must not search for the incorrect parent-directory bootstrap path'
  );
});
