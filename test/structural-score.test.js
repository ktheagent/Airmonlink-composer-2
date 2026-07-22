const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/core/score-model');
const solfa = require('../src/core/solfa');
const harmony = require('../src/core/harmony');

test('omitted rhythmic positions are completed by exact calculated rests', () => {
  const score = model.createScore({ template: 'lead', measures: 1, timeSignature: '4/4', autoFillRests: true });
  const part = score.parts[0];
  model.addNote(score, part.id, { midi: 60, start: 1, duration: 1, voice: 1 });
  model.addNote(score, part.id, { midi: 64, start: 3, duration: 1, voice: 1 });
  const rests = part.events.filter(event => event.generatedBy === 'gap-fill' && event.voice === 1).map(event => [event.start, event.duration]);
  assert.deepEqual(rests, [[0, 1], [2, 1]]);
  assert.equal(model.measureUsage(score, part, 0, 1).remaining, 2);
});

test('voice layers can occupy the same rhythmic position independently', () => {
  const score = model.createScore({ template: 'lead', measures: 1, autoFillRests: false });
  const part = score.parts[0];
  model.addNote(score, part.id, { midi: 60, start: 0, duration: 2, voice: 1 });
  assert.equal(model.canPlaceEvent(score, part.id, { type: 'note', midi: 64, start: 0, duration: 2, voice: 2 }).ok, true);
  model.addNote(score, part.id, { midi: 64, start: 0, duration: 2, voice: 2 });
  assert.equal(model.canPlaceEvent(score, part.id, { type: 'note', midi: 65, start: 1, duration: 1, voice: 1 }).ok, false);
  assert.deepEqual(part.voiceLayers, [1, 2, 3, 4]);
});

test('inserting a measure shifts later notes without losing their layer or lyrics', () => {
  const score = model.createScore({ template: 'lead', measures: 2, autoFillRests: false });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { midi: 67, start: 4, duration: 1, voice: 2, lyric: 'Glory' });
  model.insertMeasures(score, 1, 1);
  assert.equal(score.measures.length, 3);
  assert.equal(note.start, 8);
  assert.equal(note.voice, 2);
  assert.equal(note.lyric, 'Glory');
});

test('a mid-score meter change moves later material to the new bar boundary', () => {
  const score = model.createScore({ template: 'lead', measures: 2, autoFillRests: false });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { midi: 67, start: 4, duration: 1 });
  model.setMeasureAttributes(score, 0, { timeSignature: '3/4' });
  assert.equal(note.start, 3);
  assert.equal(model.measureBounds(score, 1).start, 3);
});

test('repeat counts and first/second endings create the correct playback order', () => {
  const score = model.createScore({ template: 'lead', measures: 4, autoFillRests: false });
  model.setMeasureAttributes(score, 0, { repeatStart: true });
  model.setMeasureAttributes(score, 1, { repeatEnd: true, repeatTimes: 2, endings: [1] });
  model.setMeasureAttributes(score, 2, { endings: [2] });
  assert.deepEqual(model.playbackMeasureOrder(score).map(item => item.measureIndex), [0, 1, 0, 2, 3]);
});

test('multiple lyric verses remain attached to the note and appear in tonic sol-fa', () => {
  const score = model.createScore({ title: 'Hymn', composer: 'Airmonlink', template: 'lead', key: 'G', measures: 1 });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { writtenPitch: 'G4', start: 0, duration: 1, lyric: 'Praise', lyricVerse: 1 });
  model.setLyric(score, part.id, note.id, 'Sing', { verse: 2, syllabic: 'single' });
  const text = solfa.scoreToSolfaText(score);
  assert.match(text, /Key is G/);
  assert.match(text, /Praise/);
  assert.match(text, /Sing/);
  assert.deepEqual(note.lyrics.map(item => item.verse), [1, 2]);
});

test('harmony can be applied as independent layers on the selected staff', () => {
  const score = model.createScore({ template: 'piano', key: 'C', measures: 2, autoFillRests: false });
  const piano = score.parts[0];
  [72, 74, 76, 77].forEach((midi, index) => model.addNote(score, piano.id, { midi, start: index, duration: 1, staff: 'treble', voice: 1 }));
  const variants = harmony.generateAlternatives(score, { sourcePartId: piano.id, sourceVoice: 1, sourceStaff: 'treble', melodyVoice: 'soprano', destination: 'same-layers' });
  harmony.applyVariant(score, variants[0], { destination: 'same-layers' });
  const generated = piano.events.filter(event => event.generatedBy === 'harmony');
  assert.equal(generated.length, 12);
  assert.ok(generated.every(event => event.staff === 'treble'));
  assert.ok(new Set(generated.map(event => event.voice)).size >= 3);
});
