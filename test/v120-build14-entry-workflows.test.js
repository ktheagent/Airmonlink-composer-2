const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/core/score-model');
const editing = require('../src/core/editing');
const midi = require('../src/core/midi-input');
const formats = require('../src/core/formats');
const lyrics = require('../src/core/lyrics');
const solfa = require('../src/core/solfa');
const airscore = require('../src/core/airscore');

test('compatible automatic entry creates one semantic chord and rejects duplicate pitches', () => {
  const score = model.createScore({ template: 'lead', measures: 2, autoFillRests: false });
  const part = score.parts[0];
  const root = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1, voice: 1, allowChord: true });
  const third = model.addNote(score, part.id, { midi: 64, start: 0, duration: 1, voice: 1, allowChord: true });
  const duplicate = model.addNote(score, part.id, { midi: 64, start: 0, duration: 1, voice: 1, allowChord: true });
  assert.equal(duplicate.id, third.id);
  assert.equal(model.chordMembers(score, root.id).length, 2);
  assert.equal(new Set(model.chordMembers(score, root.id).map(note => note.chordId)).size, 1);
});

test('MIDI notes at one held onset automatically form a semantic chord', () => {
  const score = model.createScore({ template: 'lead', measures: 2, autoFillRests: false });
  const input = new midi.StepTimeMidiInput(score, { partId: score.parts[0].id, duration: 1, cursor: 0 });
  const root = input.noteOn(60)[0];
  input.noteOn(64); input.noteOn(67);
  const chord = model.chordMembers(score, root.id);
  assert.deepEqual(chord.map(note => note.midi), [60, 64, 67]);
  assert.equal(new Set(chord.map(note => note.chordId)).size, 1);
  input.noteOff(60); input.noteOff(64); input.noteOff(67);
  assert.equal(input.cursor, 1);
});

test('pasted simultaneous notes normalize to one chord and round-trip through MusicXML', () => {
  const source = model.createScore({ template: 'lead', measures: 2, autoFillRests: false });
  const part = source.parts[0];
  const a = model.addNote(source, part.id, { midi: 60, start: 0, duration: 1, allowChord: true });
  const b = model.addNote(source, part.id, { midi: 64, start: 0, duration: 1, allowChord: true });
  const clipboard = editing.makeClipboard(source, [a.id, b.id]);
  const target = model.createScore({ template: 'lead', measures: 2, autoFillRests: false });
  const created = editing.pasteClipboard(target, clipboard, { partId: target.parts[0].id, start: 0 });
  const chord = model.chordMembers(target, created[0].event.id);
  assert.equal(chord.length, 2);
  const xml = formats.exportMusicXML(target);
  assert.match(xml, /<chord\/>/);
  assert.equal((xml.match(/<note>/g) || []).length >= 2, true);
});

test('verse selection remains metadata through paste, copy, replace, save and export', () => {
  const score = model.createScore({ template: 'lead', measures: 2, autoFillRests: false });
  const part = score.parts[0];
  for (let beat = 0; beat < 4; beat += 1) model.addNote(score, part.id, { midi: 60 + beat, start: beat, duration: 1 });
  const preview = lyrics.previewAssignments(score, 'Á-mẹn _ glory!', { partIds: [part.id], voice: 1 });
  lyrics.applyAssignments(score, preview, { verse: 12 });
  const verse12 = part.events.flatMap(event => event.lyrics || []).filter(lyric => lyric.verse === 12);
  assert.ok(verse12.length >= 2);
  assert.equal(verse12.some(lyric => /^12|12$/.test(lyric.text)), false);
  lyrics.copyVerse(score, 12, 3, { partIds: [part.id] });
  lyrics.searchReplace(score, 'glory', 'worship', { verse: 3 });
  const reopened = airscore.deserialize(airscore.serialize(score));
  const all = reopened.parts[0].events.flatMap(event => event.lyrics || []);
  assert.equal(all.filter(lyric => lyric.verse === 12).some(lyric => /^12|12$/.test(lyric.text)), false);
  assert.ok(all.some(lyric => lyric.verse === 3 && lyric.text === 'worship!'));
  const xml = formats.exportMusicXML(reopened);
  assert.match(xml, /<lyric number="12"/);
  assert.doesNotMatch(xml, /<text>12|12<\/text>/);
  const text = solfa.scoreToSolfaText(reopened);
  assert.match(text, /Verse 12:/);
  assert.doesNotMatch(text, /Verse 12:\s+12/);
});

test('verse number changes do not mutate existing lyric strings', () => {
  const score = model.createScore({ template: 'lead', autoFillRests: false });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1 });
  model.setLyric(score, part.id, note.id, 'Exact text 2', { verse: 2 });
  model.setLyric(score, part.id, note.id, 'Exact text 24', { verse: 24 });
  assert.deepEqual(note.lyrics.map(item => [item.verse, item.text]), [[2, 'Exact text 2'], [24, 'Exact text 24']]);
});
