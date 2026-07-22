const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/music-theory');
const model = require('../src/core/score-model');
const formats = require('../src/core/formats');
const airscore = require('../src/core/airscore');
const { HistoryManager } = require('../src/core/history');

test('.airscore serialization preserves editable data', () => {
  const score = model.createScore({ title: 'Round Trip', template: 'lead' });
  model.addNote(score, score.parts[0].id, { midi: 67, start: 0, duration: 2, lyric: 'Joy' });
  const restored = airscore.deserialize(airscore.serialize(score));
  assert.equal(restored.metadata.title, 'Round Trip');
  assert.equal(restored.parts[0].events[0].lyric, 'Joy');
});

test('MusicXML export contains score metadata and notes', () => {
  const score = model.createScore({ title: 'Exchange', composer: 'Airmonlink', template: 'lead' });
  model.addNote(score, score.parts[0].id, { midi: 60, start: 0, duration: 1, lyric: 'La' });
  const xml = formats.exportMusicXML(score);
  assert.match(xml, /<work-title>Exchange<\/work-title>/);
  assert.match(xml, /<step>C<\/step>/);
  assert.match(xml, /<text>La<\/text>/);
  assert.match(xml, /<\/midi-instrument><\/score-part>/);
  assert.equal((xml.match(/<score-part /g) || []).length, (xml.match(/<\/score-part>/g) || []).length);
});

test('MIDI export writes a standard MIDI header', () => {
  const score = model.createScore({ template: 'lead' });
  model.addNote(score, score.parts[0].id, { midi: 60, start: 0, duration: 1 });
  const bytes = formats.exportMidi(score);
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'MThd');
  assert.ok(bytes.length > 30);
});

test('history supports undo and redo snapshots', () => {
  const score = model.createScore({ title: 'One' });
  const history = new HistoryManager(); history.snapshot(score, 'Initial');
  score.metadata.title = 'Two'; history.snapshot(score, 'Rename');
  const undone = history.undo(score); assert.equal(undone.metadata.title, 'One');
  const redone = history.redo(undone); assert.equal(redone.metadata.title, 'Two');
});
