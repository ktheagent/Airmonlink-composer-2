const test = require('node:test');
const assert = require('node:assert/strict');
const workspace = require('../src/core/workspace-state');

test('legacy right dock state migrates to an unobstructed score canvas', () => {
  const migrated = workspace.migrateStored({ composition: true, inspector: true, activeRight: 'composition', rightWidth: 700, floating: { composition: true } });
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.composition, false);
  assert.equal(migrated.inspector, false);
  assert.equal(migrated.activeRight, null);
  assert.equal(migrated.rightCollapsed, true);
  assert.deepEqual(migrated.floating, { composition: false, inspector: false, tonic: false });
});

test('current panel state survives migration and remains safely clamped', () => {
  const current = workspace.migrateStored({ schemaVersion: 2, composition: true, activeRight: 'composition', rightWidth: 340 });
  const result = workspace.layout(current, { width: 1440, height: 900 });
  assert.equal(result.rightVisible, true);
  assert.equal(result.state.rightWidth, 340);
});
