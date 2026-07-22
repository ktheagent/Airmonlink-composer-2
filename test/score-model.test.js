const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/music-theory');
const model = require('../src/core/score-model');

test('creates a complete SATB score', () => {
  const score = model.createScore({ title: 'Test', template: 'satb' });
  assert.equal(score.parts.length, 4);
  assert.deepEqual(score.parts.map(p => p.name), ['Soprano', 'Alto', 'Tenor', 'Bass']);
  assert.equal(score.format, 'airscore');
});

test('adds, edits and deletes notes', () => {
  const score = model.createScore({ template: 'lead' });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { pitch: 'E4', start: 0, duration: 1, lyric: 'Sing' });
  assert.equal(note.midi, 64);
  assert.equal(part.events.filter(event => event.type === 'note').length, 1);
  model.updateEvent(score, part.id, note.id, { midi: 65 });
  assert.equal(part.events.find(event => event.id === note.id).pitch, 'F4');
  assert.equal(model.deleteEvent(score, part.id, note.id), true);
  assert.equal(part.events.filter(event => event.type === 'note').length, 0);
});

test('validates instrument range', () => {
  const score = model.createScore({ template: 'satb' });
  model.addNote(score, score.parts[3].id, { midi: 90, start: 0, duration: 1 });
  assert.ok(model.validateScore(score).some(issue => issue.message.includes('outside the practical range')));
});
