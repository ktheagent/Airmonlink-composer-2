const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/music-theory');
const model = require('../src/core/score-model');
const solfa = require('../src/core/solfa');
const harmony = require('../src/core/harmony');

test('converts a melody to tonic sol-fa text', () => {
  const score = model.createScore({ title: 'Solfa Test', template: 'lead', key: 'C' });
  model.addNote(score, score.parts[0].id, { midi: 60, start: 0, duration: 1, lyric: 'Do' });
  model.addNote(score, score.parts[0].id, { midi: 64, start: 1, duration: 1, lyric: 'Mi' });
  const text = solfa.scoreToSolfaText(score);
  assert.match(text, /d\s*:\s*m/);
  assert.match(text, /Do Mi/);
});

test('generates three editable SATB alternatives', () => {
  const score = model.createScore({ template: 'satb', key: 'C' });
  [60, 62, 64, 65].forEach((midi, index) => model.addNote(score, score.parts[0].id, { midi, start: index, duration: 1 }));
  const alternatives = harmony.generateAlternatives(score, { sourcePartId: score.parts[0].id, melodyVoice: 'soprano', style: 'hymn' });
  assert.equal(alternatives.length, 3);
  assert.equal(alternatives[0].eventsByVoice.alto.length, 4);
  harmony.applyVariant(score, alternatives[0]);
  assert.equal(score.parts.find(p => p.instrumentKey === 'bass').events.filter(event => event.type === 'note').length, 4);
});
