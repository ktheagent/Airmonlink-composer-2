const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/core/score-model');
const lyrics = require('../src/core/lyrics');

function makeLegacyScore() {
  const score = model.createScore({ template: 'lead', measures: 2, autoFillRests: false });
  const part = score.parts[0];
  ['Amazing1', 'grace1', 'how1', 'sweet1'].forEach((text, index) => {
    const note = model.addNote(score, part.id, { midi: 60 + index, start: index, duration: 1, voice: 1 });
    model.setLyric(score, part.id, note.id, text, { verse: 1, lineType: 'verse' });
  });
  return { score, part };
}

test('legacy verse suffix repair removes repeated defective suffixes without changing verse metadata', () => {
  const { score } = makeLegacyScore();
  const dry = lyrics.repairLegacyVerseSuffixes(score, { dryRun: true });
  assert.equal(dry.changed, 0);
  assert.equal(dry.candidates, 4);

  const result = lyrics.repairLegacyVerseSuffixes(score);
  assert.equal(result.changed, 4);
  const actual = score.parts[0].events.filter(event => event.type === 'note').map(event => event.lyrics[0]);
  assert.deepEqual(actual.map(item => item.text), ['Amazing', 'grace', 'how', 'sweet']);
  assert.ok(actual.every(item => item.verse === 1));
});

test('legacy verse suffix repair leaves isolated legitimate numeric lyrics untouched', () => {
  const score = model.createScore({ template: 'lead', measures: 1, autoFillRests: false });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1, voice: 1 });
  model.setLyric(score, part.id, note.id, 'Psalm 23', { verse: 1 });

  const result = lyrics.repairLegacyVerseSuffixes(score);
  assert.equal(result.changed, 0);
  assert.equal(result.candidates, 0);
  assert.equal(note.lyrics[0].text, 'Psalm 23');
});

test('legacy verse suffix repair can target one verse without modifying another', () => {
  const score = model.createScore({ template: 'lead', measures: 2, autoFillRests: false });
  const part = score.parts[0];
  for (let start = 0; start < 3; start += 1) {
    const note = model.addNote(score, part.id, { midi: 60 + start, start, duration: 1, voice: 1 });
    const verseTwoWords = ['alpha2', 'bravo2', 'charlie2'];
    const verseThreeWords = ['delta3', 'echo3', 'foxtrot3'];
    model.setLyric(score, part.id, note.id, verseTwoWords[start], { verse: 2 });
    model.setLyric(score, part.id, note.id, verseThreeWords[start], { verse: 3 });
  }

  const result = lyrics.repairLegacyVerseSuffixes(score, { verse: 2 });
  assert.equal(result.changed, 3);
  const notes = score.parts[0].events.filter(event => event.type === 'note');
  assert.deepEqual(notes.map(note => note.lyrics.find(item => item.verse === 2).text), ['alpha', 'bravo', 'charlie']);
  assert.deepEqual(notes.map(note => note.lyrics.find(item => item.verse === 3).text), ['delta3', 'echo3', 'foxtrot3']);
});
