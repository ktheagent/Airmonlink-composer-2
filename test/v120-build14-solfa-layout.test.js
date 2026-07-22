const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/core/score-model');
const layout = require('../src/core/solfa-layout');

function longLead(measures = 40, options = {}) {
  const score = model.createScore({ template: 'lead', measures, autoFillRests: false, ...options });
  const part = score.parts[0];
  for (let measure = 0; measure < measures; measure += 1) {
    const start = model.measureBounds(score, measure).start;
    for (let beat = 0; beat < 4; beat += 1) {
      const note = model.addNote(score, part.id, { midi: 60 + ((measure + beat) % 7), start: start + beat, duration: 1, voice: 1 });
      model.setLyric(score, part.id, note.id, `word-${measure + 1}-${beat + 1}`, { verse: 1 });
    }
  }
  return score;
}

test('solfa pagination creates physical pages and never splits a system', () => {
  const score = longLead(160);
  const plan = layout.paginate(score);
  assert.ok(plan.pages.length >= 5);
  const flattened = plan.pages.flatMap(page => page.systems.flatMap(system => system.measureIndices));
  assert.deepEqual(flattened, score.measures.map((_, index) => index));
  assert.equal(new Set(flattened).size, score.measures.length);
  assert.ok(plan.pages.every(page => page.systems.length > 0));
});

test('manual page breaks begin a new tonic-solfa page', () => {
  const score = longLead(12);
  score.measures[6].newPage = true;
  const plan = layout.paginate(score, { horizontalBudget: 100 });
  const page = plan.pages.find(item => item.systems[0].measureIndices[0] === 6);
  assert.ok(page);
  assert.equal(page.context.measure, 7);
});

test('four lyric verses increase system and page requirements', () => {
  const one = longLead(16);
  const four = longLead(16);
  for (const note of four.parts[0].events.filter(event => event.type === 'note')) {
    for (let verse = 2; verse <= 4; verse += 1) model.setLyric(four, four.parts[0].id, note.id, `verse-${verse}`, { verse });
  }
  const onePlan = layout.paginate(one);
  const fourPlan = layout.paginate(four);
  assert.ok(fourPlan.systems[0].estimatedHeight > onePlan.systems[0].estimatedHeight);
  assert.ok(fourPlan.pages.length >= onePlan.pages.length);
});

test('SATB with four complete lyric verses paginates without page overflow', () => {
  const score = model.createScore({ template: 'satb', measures: 24, autoFillRests: false });
  score.parts.forEach((part, partIndex) => {
    for (let measure = 0; measure < score.measures.length; measure += 1) {
      const start = model.measureBounds(score, measure).start;
      for (let beat = 0; beat < 4; beat += 1) {
        const note = model.addNote(score, part.id, { midi: 60 + partIndex * 3 + beat, start: start + beat, duration: 1, voice: 1 });
        for (let verse = 1; verse <= 4; verse += 1) model.setLyric(score, part.id, note.id, `part-${partIndex + 1}-verse-${verse}`, { verse });
      }
    }
  });
  const plan = layout.paginate(score);
  assert.ok(plan.pages.length > 1);
  assert.equal(plan.pages.some(page => page.overflow), false);
  assert.equal(plan.pages.flatMap(page => page.systems.flatMap(system => system.measureIndices)).length, 24);
});

test('page dimensions honor size and orientation', () => {
  const portrait = model.createScore({ template: 'lead', pageSize: 'A4', orientation: 'portrait' });
  const landscape = model.createScore({ template: 'lead', pageSize: 'A4', orientation: 'landscape' });
  const a = layout.pageDimensions(portrait), b = layout.pageDimensions(landscape);
  assert.equal(a.width, b.height);
  assert.equal(a.height, b.width);
});

test('fit modes account for both viewport dimensions and preserve manual zoom', () => {
  const page = { width: 900, height: 1165 };
  assert.equal(layout.fitScale('actual', { width: 500, height: 500 }, page), 1);
  assert.ok(layout.fitScale('width', { width: 500, height: 900 }, page) < 1);
  assert.ok(layout.fitScale('page', { width: 1200, height: 600 }, page) < layout.fitScale('width', { width: 1200, height: 600 }, page));
  assert.equal(layout.fitScale('manual', { width: 500, height: 500 }, page, .8), .8);
});
