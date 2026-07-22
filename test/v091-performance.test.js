const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const model = require('../src/core/score-model');

test('cached measure timeline follows pickup and mid-score meter changes exactly', () => {
  const score = model.createScore({ template: 'lead', measures: 4, timeSignature: '4/4', pickupBeats: 1, autoFillRests: false });
  assert.deepEqual(model.measureBounds(score, 0), {
    start: 0, end: 1, capacity: 1, measureIndex: 0, timeSignature: '4/4', key: 'C'
  });
  assert.equal(model.measureBounds(score, 2).start, 5);
  model.setMeasureAttributes(score, 1, { timeSignature: '3/4' });
  assert.equal(model.measureBounds(score, 1).capacity, 3);
  assert.equal(model.measureBounds(score, 2).start, 4);
  assert.equal(model.measureIndexAt(score, 3.999), 1);
  assert.equal(model.measureIndexAt(score, 4), 2);
});

test('event lookup cache invalidates when score events change', () => {
  const score = model.createScore({ template: 'lead', measures: 2, autoFillRests: false });
  const part = score.parts[0];
  const first = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1 });
  assert.equal(model.findEvent(score, first.id).event.midi, 60);
  const second = model.addNote(score, part.id, { midi: 64, start: 1, duration: 1 });
  assert.equal(model.findEvent(score, second.id).event.midi, 64);
  model.deleteEvent(score, part.id, first.id);
  assert.equal(model.findEvent(score, first.id), null);
});

test('binary measure lookup remains responsive on the maximum 2000-measure score', () => {
  const score = model.createScore({ template: 'lead', measures: 2000, timeSignature: '4/4', autoFillRests: false });
  // Warm the derived timeline once, then exercise the same path used by caret,
  // playback and pointer placement. The generous limit catches accidental O(n)
  // scans without making the test dependent on a fast machine.
  model.measureIndexAt(score, 0);
  const started = performance.now();
  let checksum = 0;
  for (let index = 0; index < 100000; index += 1) checksum += model.measureIndexAt(score, (index * 0.319) % model.totalBeats(score));
  const elapsed = performance.now() - started;
  assert.ok(checksum > 0);
  assert.ok(elapsed < 1500, `100,000 cached lookups took ${elapsed.toFixed(1)} ms`);
});
