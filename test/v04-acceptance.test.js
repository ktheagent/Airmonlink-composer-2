const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/music-theory');
const model = require('../src/core/score-model');
const lyrics = require('../src/core/lyrics');
const solfa = require('../src/core/solfa');
const formats = require('../src/core/formats');
const airscore = require('../src/core/airscore');
const playback = require('../src/core/playback');

test('each lyric verse preserves an independent visual offset', () => {
  const score = model.createScore({ template: 'lead' });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1 });
  model.setLyric(score, part.id, note.id, 'Praise', { verse: 1, offsetX: 8, offsetY: 3 });
  model.setLyric(score, part.id, note.id, 'Worship', { verse: 2, offsetX: -6, offsetY: 14 });
  assert.deepEqual(note.lyrics.map(item => [item.verse, item.offsetX, item.offsetY]), [[1, 8, 3], [2, -6, 14]]);
  lyrics.resetPosition(score, part.id, note.id, 1);
  assert.deepEqual(note.lyrics.map(item => [item.verse, item.offsetX, item.offsetY]), [[1, 0, 0], [2, -6, 14]]);
});

test('lyric IDs and offsets survive note movement, measure insertion and airscore reopen', () => {
  const score = model.createScore({ template: 'lead', measures: 3 });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { midi: 64, start: 4, duration: 1 });
  model.setLyric(score, part.id, note.id, 'Glory', { verse: 1, offsetX: 11, offsetY: -2 });
  const lyricId = note.lyrics[0].id;
  model.updateEvent(score, part.id, note.id, { start: 5, writtenPitch: 'F4' });
  model.insertMeasures(score, 0, 1);
  const reopened = airscore.deserialize(airscore.serialize(score));
  const restored = reopened.parts[0].events.find(event => event.id === note.id);
  assert.equal(restored.lyrics[0].id, lyricId);
  assert.equal(restored.lyrics[0].noteId, note.id);
  assert.equal(restored.lyrics[0].offsetX, 11);
  assert.equal(restored.lyrics[0].offsetY, -2);
  assert.equal(restored.start, 9);
});

test('four lyric verses remain aligned in tonic sol-fa output', () => {
  const score = model.createScore({ template: 'lead', key: 'C' });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1 });
  ['One', 'Two', 'Three', 'Four'].forEach((text, index) => model.setLyric(score, part.id, note.id, text, { verse: index + 1 }));
  const text = solfa.scoreToSolfaText(score);
  for (let verse = 1; verse <= 4; verse += 1) assert.match(text, new RegExp(`Verse ${verse}:`));
  assert.equal(lyrics.lyricCount(score), 4);
});

test('traditional sol-fa handles difficult major and minor keys without raw accidentals', () => {
  for (const [key, midi] of [['F#', 66], ['Ebm', 63]]) {
    const score = model.createScore({ template: 'lead', key });
    const part = score.parts[0];
    const tonic = model.addNote(score, part.id, { midi, start: 0, duration: 1 });
    const chromatic = model.addNote(score, part.id, { midi: midi + 1, start: 1, duration: 1 });
    assert.equal(solfa.eventToSolfa(tonic, score, part).syllable, 'd');
    const syllable = solfa.eventToSolfa(chromatic, score, part).syllable;
    assert.doesNotMatch(syllable, /[#♯b♭]/);
  }
});

test('mid-score key changes recalculate tonic sol-fa from the active measure', () => {
  const score = model.createScore({ template: 'lead', key: 'C', measures: 3 });
  const part = score.parts[0];
  model.setMeasureAttributes(score, 1, { key: 'G' });
  const before = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1 });
  const after = model.addNote(score, part.id, { midi: 67, start: model.measureStartBeat(score, 1), duration: 1 });
  assert.equal(solfa.eventToSolfa(before, score, part).syllable, 'd');
  assert.equal(solfa.eventToSolfa(after, score, part).syllable, 'd');
});

test('playback loop range maps precisely to notated beats', () => {
  const score = model.createScore({ template: 'lead', measures: 4, timeSignature: '4/4' });
  const segments = playback.buildPlaybackSegments(score);
  const range = playback.playbackRange(score, segments, 4, { start: 4, end: 10 });
  assert.equal(range.startPlayBeat, 4);
  assert.equal(range.endPlayBeat, 10);
  assert.equal(range.end - range.start, 6);
});

test('playback loop range respects a pickup measure', () => {
  const score = model.createScore({ template: 'lead', measures: 3, timeSignature: '4/4', pickupBeats: 1 });
  const segments = playback.buildPlaybackSegments(score);
  assert.deepEqual(segments.map(segment => segment.capacity), [1, 4, 4]);
  const range = playback.playbackRange(score, segments, 1, { start: 1, end: 5 });
  assert.equal(range.startPlayBeat, 1);
  assert.equal(range.endPlayBeat, 5);
});

test('MusicXML export includes grace, tuplet, slur and transposition information', () => {
  const score = model.createScore({ template: 'lead' });
  const part = score.parts[0];
  part.transpose = 2;
  model.addNote(score, part.id, {
    midi: 62, start: 0, duration: 0.5, grace: true,
    tuplet: { actual: 3, normal: 2 }, slurStart: true, articulations: ['staccato']
  });
  const xml = formats.exportMusicXML(score);
  assert.match(xml, /<transpose>/);
  assert.match(xml, /<chromatic>-2<\/chromatic>/);
  assert.match(xml, /<grace\/>/);
  assert.match(xml, /<time-modification>/);
  assert.match(xml, /<slur type="start"/);
  assert.match(xml, /<staccato\/>/);
});
