const test = require('node:test');
const assert = require('node:assert/strict');
const theory = require('../src/core/music-theory');

test('pitch conversion round-trips common notes', () => {
  assert.equal(theory.pitchToMidi('C4'), 60);
  assert.equal(theory.pitchToMidi('Bb3'), 58);
  assert.equal(theory.midiToPitch(69), 'A4');
});

test('tonic sol-fa follows the selected key', () => {
  assert.equal(theory.tonicSolfaForMidi(60, 'C'), 'd');
  assert.equal(theory.tonicSolfaForMidi(62, 'C'), 'r');
  assert.equal(theory.tonicSolfaForMidi(67, 'G'), 'd');
});

test('diatonic triads are built from the key scale', () => {
  assert.deepEqual(theory.diatonicTriad(1, 'C'), [0, 4, 7]);
  assert.deepEqual(theory.diatonicTriad(5, 'C'), [7, 11, 2]);
});
