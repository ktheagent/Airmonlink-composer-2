const test = require('node:test');
const assert = require('node:assert/strict');
const workspace = require('../src/core/workspace-state');
const layout = require('../src/core/layout-engine');

test('workspace state clamps unsafe restored dimensions and invalid active panels', () => {
  const state = workspace.sanitize({
    composition: false,
    inspector: true,
    tonic: false,
    activeRight: 'missing',
    rightWidth: 5000,
    pianoHeight: -20,
    floating: { inspector: true }
  }, { width: 1024, height: 700 });
  assert.equal(state.activeRight, 'inspector');
  assert.ok(state.rightWidth <= 1024 * 0.45);
  assert.equal(state.pianoHeight, 72);
  assert.equal(state.floating.inspector, true);
});

test('compact workspaces redock floating panels and auto-collapse the right dock safely', () => {
  const result = workspace.layout({
    composition: true,
    inspector: true,
    activeRight: 'inspector',
    rightCollapsed: false,
    floating: { composition: true, inspector: true, tonic: true },
    rightWidth: 900
  }, { width: 500, height: 640 });
  assert.deepEqual(result.state.floating, { composition: false, inspector: false, tonic: false });
  assert.equal(result.state.activeRight, 'inspector');
  assert.equal(result.rightVisible, true);
  assert.equal(result.effectiveRightCollapsed, true);
  assert.ok(result.state.rightWidth <= result.metrics.rightMaximum);
});

test('large workspaces retain user floating state and safe dock dimensions', () => {
  const result = workspace.layout({
    composition: true,
    inspector: true,
    tonic: true,
    activeRight: 'composition',
    floating: { composition: false, inspector: true, tonic: false },
    rightWidth: 340,
    pianoHeight: 160
  }, { width: 1600, height: 1000 });
  assert.equal(result.state.floating.inspector, true);
  assert.equal(result.effectiveRightCollapsed, false);
  assert.equal(result.state.rightWidth, 340);
  assert.equal(result.state.pianoHeight, 160);
});

test('chord notehead collision geometry alternates seconds without changing semantic pitch', () => {
  const cluster = [
    { id: 'c', step: 28 },
    { id: 'd', step: 29 },
    { id: 'e', step: 30 }
  ];
  assert.deepEqual({ ...layout.chordNoteheadOffsets(cluster, true, 7) }, { c: 0, d: 7, e: 0 });
  assert.deepEqual({ ...layout.chordNoteheadOffsets(cluster, false, 7) }, { c: 0, d: -7, e: 0 });
  assert.deepEqual(cluster.map(item => item.step), [28, 29, 30]);
});

test('simultaneous unisons in separate voices receive opposing engraving offsets', () => {
  const unison = [
    { id: 'v1', step: 30, voice: 1 },
    { id: 'v2', step: 30, voice: 2 }
  ];
  assert.equal(layout.voiceUnisonOffset(unison, 'v1', true, 3), -3);
  assert.equal(layout.voiceUnisonOffset(unison, 'v2', false, 3), 3);
});

test('accidentals in close chord positions are assigned separate columns', () => {
  const columns = layout.accidentalColumns([
    { id: 'a', step: 30, accidental: true },
    { id: 'b', step: 32, accidental: true },
    { id: 'c', step: 37, accidental: true }
  ]);
  assert.notEqual(columns.a, columns.b);
  assert.equal(columns.b, columns.c);
});
