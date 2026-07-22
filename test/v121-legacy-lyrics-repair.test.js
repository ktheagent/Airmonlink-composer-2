const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/core/score-model');
const lyrics = require('../src/core/lyrics');

function addLyricNote(score, part, midi, start, verse, text) {
  const note = model.addNote(score, part.id, {
    midi,
    start,
    duration: 1,
    voice: 1,
    allowChord: false
  });
  model.setLyric(score, part.id, note.id, text, { verse, lineType: 'verse' });
  return note;
}

test('legacy verse suffix repair removes repeated defective suffixes without changing verse metadata', () => {
  const score = model.createScore({ template: 'lead', measures: 2, autoFillRests: false });
  const part = score.parts[0];
  const notes = [
    addLyricNote(score, part, 60, 0, 2, 'Amazing2'),
    addLyricNote(score, part, 62, 1, 2, 'grace2'),
    addLyricNote(score, part, 64, 2, 2, 'how2'),
    addLyricNote(score, part, 65, 3, 2, 'sweet2')
  ];

  const preview = lyrics.repairLegacyVerseSuffixes(score, { dryRun: true });
  assert.equal(preview.candidates, 4);
  assert.equal(preview.changed, 0);
  assert.equal(notes[0].lyrics[0].text, 'Amazing2');

  const result = lyrics.repairLegacyVerseSuffixes(score);
  assert.equal(result.changed, 4);
  assert.deepEqual(notes.map(note => note.lyrics[0].text), ['Amazing', 'grace', 'how', 'sweet']);
  assert.deepEqual(notes.map(note => note.lyrics[0].verse), [2, 2, 2, 2]);
  assert.deepEqual(notes.map(note => note.lyric), ['Amazing', 'grace', 'how', 'sweet']);
});

test('legacy verse suffix repair leaves isolated legitimate numeric lyrics untouched', () => {
  const score = model.createScore({ template: 'lead', measures: 2, autoFillRests: false });
  const part = score.parts[0];
  const note = addLyricNote(score, part, 60, 0, 3, 'Psalm 23');

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
  for (const event of part.events) {
    assert.equal(event.lyrics.find(item => item.verse === 2).text.endsWith('2'), false);
    assert.equal(event.lyrics.find(item => item.verse === 3).text.endsWith('3'), true);
  }
});

test('airscore migration invokes the lyric repair module for pre-v9 projects', () => {
  const airscore = require('../src/core/airscore');
  const score = model.createScore({ template: 'lead', measures: 2, autoFillRests: false });
  const part = score.parts[0];
  ['Amazing1', 'grace1', 'how1'].forEach((text, index) => {
    const note = model.addNote(score, part.id, { midi: 60 + index, start: index, duration: 1, voice: 1 });
    model.setLyric(score, part.id, note.id, text, { verse: 1, lineType: 'verse' });
  });
  const payload = {
    signature: 'AIRM-Score',
    version: 8,
    schema: 'airscore-v9',
    checksumAlgorithm: 'fnv1a32',
    checksum: airscore.checksum(JSON.stringify(score)),
    score
  };

  const reopened = airscore.deserialize(payload);
  const lyricTexts = reopened.parts[0].events
    .filter(event => event.type === 'note')
    .map(event => event.lyrics[0].text);
  assert.deepEqual(lyricTexts, ['Amazing', 'grace', 'how']);
  assert.ok(reopened.parts[0].events.every(event => event.type !== 'note' || event.lyrics[0].verse === 1));
});

