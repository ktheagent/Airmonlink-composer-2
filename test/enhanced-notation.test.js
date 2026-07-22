const test = require('node:test');
const assert = require('node:assert/strict');
const theory = require('../src/core/music-theory');
const model = require('../src/core/score-model');
const solfa = require('../src/core/solfa');
const harmony = require('../src/core/harmony');

const durations = [8, 6, 4, 3, 2, 1.5, 1, .75, .5, .375, .25, .125, .0625];

test('all supported note and rest durations are represented', () => {
  assert.deepEqual(model.DURATIONS.map(item => item.value), durations);
  assert.equal(theory.noteTypeFromBeats(8), 'breve');
  assert.equal(theory.noteTypeFromBeats(4), 'whole');
  assert.equal(theory.noteTypeFromBeats(2), 'half');
  assert.equal(theory.noteTypeFromBeats(1), 'quarter');
  assert.equal(theory.noteTypeFromBeats(.5), 'eighth');
  assert.equal(theory.noteTypeFromBeats(.25), '16th');
  assert.equal(theory.noteTypeFromBeats(.125), '32nd');
  assert.equal(theory.noteTypeFromBeats(.0625), '64th');
  assert.equal(theory.flagCount(.0625), 4);
});

test('time signatures calculate exact measure capacity', () => {
  const cases = {
    '4/4': 4, '3/4': 3, '2/2': 4, '3/2': 6,
    '6/8': 3, '9/8': 4.5, '12/8': 6,
    '5/4': 5, '5/8': 2.5, '7/8': 3.5,
    '11/8': 5.5, '15/8': 7.5, '7/16': 1.75
  };
  for (const [signature, expected] of Object.entries(cases)) {
    assert.equal(model.timeSignatureInfo(signature).measureQuarterBeats, expected, signature);
  }
});

test('measure validation prevents a duration from crossing a barline', () => {
  const score = model.createScore({ template: 'lead', timeSignature: '6/8', measures: 2 });
  const part = score.parts[0];
  assert.equal(model.canPlaceEvent(score, part.id, { type: 'note', start: 0, duration: 3, voice: 1 }).ok, true);
  const invalid = model.canPlaceEvent(score, part.id, { type: 'note', start: 2.5, duration: 1, voice: 1 });
  assert.equal(invalid.ok, false);
  assert.match(invalid.reason, /does not fit in bar 1/);
});

test('chromatic tonic sol-fa uses syllables and never accidental symbols', () => {
  const cases = {
    'C#4': 'di', 'Db4': 'ra', 'D#4': 'ri', 'Eb4': 'me',
    'F#4': 'fi', 'Gb4': 'se', 'G#4': 'si', 'Ab4': 'le',
    'A#4': 'li', 'Bb4': 'te'
  };
  for (const [pitch, expected] of Object.entries(cases)) {
    const actual = theory.tonicSolfaForPitch(pitch, 'C');
    assert.equal(actual.replace(/[',]/g, ''), expected, pitch);
    assert.doesNotMatch(actual, /[#♯b♭]/);
  }
});

test('written staff pitch, sounding pitch and sol-fa stay synchronized', () => {
  const score = model.createScore({ template: 'satb', key: 'G', measures: 2 });
  const tenor = score.parts.find(part => part.harmonyRole === 'tenor');
  const event = model.addNote(score, tenor.id, { writtenPitch: 'F#4', start: 0, duration: .5 });
  assert.equal(event.midi, theory.pitchToMidi('F#3'));
  assert.equal(theory.writtenPitchForEvent(event, tenor, 'G', true), 'F#4');
  assert.equal(solfa.eventToSolfa(event, score, tenor).syllable.replace(/[',]/g, ''), 't');
  assert.equal(solfa.verifyScoreSolfa(score).length, 0);

  model.updateEvent(score, tenor.id, event.id, { writtenPitch: 'G4' });
  assert.equal(event.midi, theory.pitchToMidi('G3'));
  assert.equal(solfa.eventToSolfa(event, score, tenor).syllable.replace(/[',]/g, ''), 'd');
});

test('grand staff assigns notes to the correct clef without changing pitch', () => {
  const score = model.createScore({ template: 'piano', key: 'C', measures: 2 });
  const piano = score.parts[0];
  const low = model.addNote(score, piano.id, { midi: 48, start: 0, duration: 1 });
  const high = model.addNote(score, piano.id, { midi: 72, start: 1, duration: 1 });
  assert.equal(low.staff, 'bass');
  assert.equal(high.staff, 'treble');
  assert.equal(theory.pitchToMidi(theory.writtenPitchForEvent(low, piano, 'C', true)), 48);
  assert.equal(theory.pitchToMidi(theory.writtenPitchForEvent(high, piano, 'C', true)), 72);
});

test('selecting a new harmony replaces the complete previous arrangement', () => {
  const score = model.createScore({ template: 'satb', key: 'C', measures: 4 });
  const soprano = score.parts.find(part => part.harmonyRole === 'soprano');
  [60, 62, 64, 65].forEach((midi, index) => model.addNote(score, soprano.id, { midi, start: index, duration: 1 }));
  const alternatives = harmony.generateAlternatives(score, { sourcePartId: soprano.id, melodyVoice: 'soprano', style: 'hymn' });
  harmony.applyVariant(score, alternatives[0]);
  const firstGroup = score.arrangement.generationGroupId;
  assert.ok(score.parts.every(part => part.events.filter(event => event.type === 'note').length === 4));

  harmony.applyVariant(score, alternatives[1]);
  assert.notEqual(score.arrangement.generationGroupId, firstGroup);
  assert.ok(score.parts.every(part => part.events.filter(event => event.type === 'note').length === 4));
  assert.equal(score.chordSymbols.length, 4);
  assert.equal(score.parts.flatMap(part => part.events).some(event => event.generationGroupId === firstGroup), false);
  assert.equal(score.chordSymbols.some(chord => chord.generationGroupId === firstGroup), false);
});
