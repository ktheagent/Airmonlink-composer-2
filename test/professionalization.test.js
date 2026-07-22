const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/music-theory');
const model = require('../src/core/score-model');
const lyrics = require('../src/core/lyrics');
const solfa = require('../src/core/solfa');
const formats = require('../src/core/formats');
const airscore = require('../src/core/airscore');

test('pickup measure uses its true capacity and shifts later measure starts', () => {
  const score = model.createScore({ template: 'lead', measures: 3, timeSignature: '4/4', pickupBeats: 1 });
  assert.equal(model.measureBounds(score, 0).capacity, 1);
  assert.equal(model.measureStartBeat(score, 1), 1);
  assert.equal(model.totalBeats(score), 9);
});

test('lyric objects receive stable attachment metadata', () => {
  const score = model.createScore({ template: 'lead' });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1 });
  model.setLyric(score, part.id, note.id, 'Praise', { verse: 2, lineType: 'chorus', syllabic: 'begin' });
  const lyric = note.lyrics.find(item => item.verse === 2);
  assert.match(lyric.id, /^lyric-/);
  assert.equal(lyric.noteId, note.id);
  assert.equal(lyric.partId, part.id);
  assert.equal(lyric.voiceId, 1);
  assert.equal(lyric.lineType, 'chorus');
});

test('lyrics paragraph parser handles hyphens and melismas', () => {
  const tokens = lyrics.tokenizeLyrics('Hal-le-lu-jah _ praise');
  assert.equal(tokens[0].text, 'Hal');
  assert.equal(tokens[0].syllabic, 'begin');
  assert.ok(tokens.some(item => item.melisma));
});

test('lyrics preview and commit attach words to consecutive notes', () => {
  const score = model.createScore({ template: 'lead' });
  const part = score.parts[0];
  [60, 62, 64].forEach((midi, index) => model.addNote(score, part.id, { midi, start: index, duration: 1 }));
  const preview = lyrics.previewAssignments(score, 'Sing with joy', { partIds: [part.id], voice: 1 });
  assert.equal(preview.overflow, 0);
  assert.equal(lyrics.applyAssignments(score, preview, { verse: 1 }), 3);
  assert.deepEqual(part.events.filter(event => event.type === 'note').map(event => event.lyric), ['Sing', 'with', 'joy']);
});

test('lyric search and replace works across verses', () => {
  const score = model.createScore({ template: 'lead' });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1, lyrics: [{ verse: 1, text: 'King' }, { verse: 2, text: 'King of love' }] });
  assert.equal(lyrics.searchReplace(score, 'King', 'Lord'), 2);
  assert.deepEqual(note.lyrics.map(item => item.text), ['Lord', 'Lord of love']);
});

test('sol-fa edit updates the same staff note bidirectionally', () => {
  const score = model.createScore({ template: 'lead', key: 'C' });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1, lyric: 'Do' });
  const originalId = note.id;
  const pitch = solfa.updateEventFromSolfa(score, part.id, note.id, 'fi');
  assert.equal(pitch, 'F#4');
  assert.equal(note.id, originalId);
  assert.equal(note.midi, 66);
  assert.equal(note.lyric, 'Do');
  assert.equal(solfa.eventToSolfa(note, score, part).syllable, 'fi');
});

test('modern teaching mode uses full syllables', () => {
  const score = model.createScore({ template: 'lead', key: 'C' });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { midi: 67, start: 0, duration: 1 });
  assert.equal(solfa.eventToSolfa(note, score, part, { notationMode: 'modern' }).syllable, 'sol');
});

test('MXL export contains a recoverable MusicXML score', async () => {
  const score = model.createScore({ template: 'lead', title: 'Compressed Exchange' });
  model.addNote(score, score.parts[0].id, { midi: 60, start: 0, duration: 1, lyric: 'La' });
  const mxl = formats.createMxl(score);
  assert.equal(String.fromCharCode(...mxl.slice(0, 2)), 'PK');
  const xml = await formats.extractMxlXml(mxl);
  assert.match(xml, /<work-title>Compressed Exchange<\/work-title>/);
  assert.match(xml, /<text>La<\/text>/);
});

test('airscore detects corruption rather than silently opening damaged data', () => {
  const score = model.createScore({ template: 'lead', title: 'Safe' });
  const payload = JSON.parse(airscore.serialize(score));
  payload.score.metadata.title = 'Tampered';
  assert.throws(() => airscore.deserialize(payload), /checksum/i);
});
