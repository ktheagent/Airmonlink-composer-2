const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/core/score-model');
const layout = require('../src/core/layout-engine');

function cleanScore(options = {}) {
  const score = model.createScore({ template: 'lead', measures: 4, ...options });
  score.parts[0].events = [];
  model.touch(score);
  return score;
}

test('semantic chord groups share one tick duration voice and stable chord id', () => {
  const score = cleanScore();
  const part = score.parts[0];
  const root = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1, voice: 1 });
  const third = model.addChordTone(score, part.id, root.id, 64);
  const fifth = model.addChordTone(score, part.id, root.id, 67);
  const members = model.chordMembers(score, root.id);
  assert.equal(members.length, 3);
  assert.ok(members.every(note => note.chordId === root.chordId));
  assert.ok(members.every(note => note.start === 0 && note.duration === 1 && note.voice === 1));
  assert.deepEqual(members.map(note => note.midi), [60, 64, 67]);
  assert.equal(third.start, fifth.start);
});

test('one chord member can be removed without deleting the entire chord', () => {
  const score = cleanScore();
  const part = score.parts[0];
  const root = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1 });
  const third = model.addChordTone(score, part.id, root.id, 64);
  model.addChordTone(score, part.id, root.id, 67);
  assert.equal(model.removeChordTone(score, part.id, third.id), true);
  assert.deepEqual(model.chordMembers(score, root.id).map(note => note.midi), [60, 67]);
});

test('chord duration and transposition update every member as one semantic event', () => {
  const score = cleanScore();
  const part = score.parts[0];
  const root = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1 });
  model.addChordTone(score, part.id, root.id, 64);
  model.setChordDuration(score, root.id, 2);
  model.transposeChord(score, root.id, 2);
  const members = model.chordMembers(score, root.id);
  assert.deepEqual(members.map(note => note.midi), [62, 66]);
  assert.ok(members.every(note => note.duration === 2));
});

test('composition metadata and anchored text survive normalization', () => {
  const score = cleanScore({ compositionDate: '2026-07-21', source: 'Airmonlink test fixture' });
  const item = model.addAnnotation(score, { text: 'dolce', type: 'technique', scope: 'segment', start: 1, partId: score.parts[0].id, placement: 'above' });
  const reopened = model.normalizeScore(JSON.parse(JSON.stringify(score)));
  assert.equal(reopened.metadata.compositionDate, '2026-07-21');
  assert.equal(reopened.metadata.source, 'Airmonlink test fixture');
  assert.equal(reopened.annotations[0].id, item.id);
  assert.equal(reopened.annotations[0].start, 1);
  assert.equal(reopened.annotations[0].text, 'dolce');
});

test('rhythmic layout gives denser and lyric-heavy measures more space', () => {
  const score = cleanScore({ measures: 3 });
  const part = score.parts[0];
  model.addNote(score, part.id, { midi: 60, start: 0, duration: 4 });
  for (let i = 0; i < 8; i += 1) model.addNote(score, part.id, { midi: 62 + (i % 3), start: 4 + i * .5, duration: .5, allowChord: false });
  const note = part.events.find(event => Math.abs(event.start - 4) < 1e-8 && event.type === 'note');
  model.setLyric(score, part.id, note.id, 'extraordinary', { verse: 1 });
  const quiet = layout.measureContentProfile(score, 0);
  const dense = layout.measureContentProfile(score, 1);
  assert.ok(dense.minWidth > quiet.minWidth, `${dense.minWidth} should exceed ${quiet.minWidth}`);
});

test('system plan reflows complete measures and keeps rhythmic positions ordered', () => {
  const score = cleanScore({ measures: 8 });
  const part = score.parts[0];
  for (let m = 0; m < 8; m += 1) {
    const start = model.measureStartBeat(score, m);
    for (let i = 0; i < 4; i += 1) model.addNote(score, part.id, { midi: 60 + ((m + i) % 5), start: start + i, duration: 1 });
  }
  const plan = layout.buildSystemPlan(score, { staffX: 120, availableWidth: 520, maxMeasures: 4 });
  assert.ok(plan.systems.length >= 2);
  assert.deepEqual(plan.systems.flatMap(system => system.measureIndices), [0,1,2,3,4,5,6,7]);
  for (const system of plan.systems) {
    for (const frame of system.frames) {
      const bounds = model.measureBounds(score, frame.measureIndex);
      assert.ok(layout.rhythmicPosition(frame, bounds.start, 60) < layout.rhythmicPosition(frame, bounds.end - .001, 60));
    }
  }
});

test('vertical staff requirements expand for lyrics and optional tonic sol-fa', () => {
  const score = cleanScore();
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1 });
  model.setLyric(score, part.id, note.id, 'One', { verse: 1 });
  model.setLyric(score, part.id, note.id, 'Two', { verse: 2 });
  const withoutSolfa = layout.staffVerticalRequirements(score, part, null);
  score.settings.showSolfa = true;
  const withSolfa = layout.staffVerticalRequirements(score, part, null);
  assert.ok(withoutSolfa.below >= 38);
  assert.ok(withSolfa.below > withoutSolfa.below);
});

test('pickup configuration shifts later musical anchors while preserving the opening measure', () => {
  const score = cleanScore({ measures: 3, timeSignature: '4/4' });
  const part = score.parts[0];
  const pickupNote = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1 });
  const laterNote = model.addNote(score, part.id, { midi: 64, start: 4, duration: 1 });
  score.chordSymbols.push({ id: 'h1', text: 'C', start: 4, partId: part.id });
  const text = model.addAnnotation(score, { text: 'Verse', type: 'staff-text', scope: 'segment', start: 4, partId: part.id });
  const result = model.configurePickupMeasure(score, 1);
  assert.equal(result.delta, -3);
  assert.equal(score.settings.pickupBeats, 1);
  assert.equal(model.measureBounds(score, 0).capacity, 1);
  assert.equal(model.findEvent(score, pickupNote.id).event.start, 0);
  assert.equal(model.findEvent(score, laterNote.id).event.start, 1);
  assert.equal(score.chordSymbols[0].start, 1);
  assert.equal(score.annotations.find(item => item.id === text.id).start, 1);
});

test('pickup configuration rejects a duration shorter than opening authored music', () => {
  const score = cleanScore({ measures: 2, timeSignature: '4/4' });
  model.addNote(score, score.parts[0].id, { midi: 60, start: 0, duration: 2 });
  assert.throws(() => model.configurePickupMeasure(score, 1), /too short/i);
  assert.equal(score.settings.pickupBeats, 0);
});

test('removing a measure also removes or shifts anchored text and harmony safely', () => {
  const score = cleanScore({ measures: 3 });
  const part = score.parts[0];
  score.chordSymbols.push({ id: 'remove', text: 'F', start: 4, partId: part.id }, { id: 'shift', text: 'G', start: 8, partId: part.id });
  model.addAnnotation(score, { id: 'remove-text', text: 'middle', scope: 'measure', start: 4, measureIndex: 1, partId: part.id });
  model.addAnnotation(score, { id: 'shift-text', text: 'last', scope: 'segment', start: 8, measureIndex: 2, partId: part.id });
  model.removeMeasure(score, 1);
  assert.deepEqual(score.chordSymbols.map(item => [item.id, item.start]), [['shift', 4]]);
  assert.deepEqual(score.annotations.map(item => [item.id, item.start]), [['shift-text', 4]]);
});

test('interval parser and chord interval insertion support common and compound intervals', () => {
  assert.equal(require('../src/core/music-theory').intervalSemitones('m3'), 3);
  assert.equal(require('../src/core/music-theory').intervalSemitones('M3'), 4);
  assert.equal(require('../src/core/music-theory').intervalSemitones('P5'), 7);
  assert.equal(require('../src/core/music-theory').intervalSemitones('P8'), 12);
  assert.equal(require('../src/core/music-theory').intervalSemitones('M10'), 16);
  const score = cleanScore();
  const part = score.parts[0];
  const root = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1, voice: 1 });
  const above = model.addIntervalToChord(score, part.id, root.id, 'M3', 1);
  const below = model.addIntervalToChord(score, part.id, root.id, 'P5', -1);
  assert.equal(above.midi, 64);
  assert.equal(below.midi, 53);
  assert.deepEqual(model.chordMembers(score, root.id).map(note => note.midi), [53, 60, 64]);
  assert.ok(model.chordMembers(score, root.id).every(note => note.start === 0 && note.duration === 1 && note.voice === 1));
});

test('anchored text visual offsets remain separate from its musical anchor', () => {
  const score = cleanScore();
  const annotation = model.addAnnotation(score, { text: 'cantabile', start: 2, measureIndex: 0, partId: score.parts[0].id, placement: 'above' });
  model.updateAnnotation(score, annotation.id, { offsetX: 18, offsetY: -7 });
  const updated = score.annotations.find(item => item.id === annotation.id);
  assert.equal(updated.start, 2);
  assert.equal(updated.measureIndex, 0);
  assert.equal(updated.offsetX, 18);
  assert.equal(updated.offsetY, -7);
});

test('manual system and page breaks are respected by the layout plan', () => {
  const score = cleanScore({ measures: 6 });
  score.measures[2].newSystem = true;
  score.measures[4].newPage = true;
  const plan = layout.buildSystemPlan(score, { staffX: 120, availableWidth: 2000, maxMeasures: 8 });
  assert.deepEqual(plan.systems.map(system => system.measureIndices), [[0, 1], [2, 3], [4, 5]]);
  assert.equal(plan.systems[1].manualBreakBefore, true);
  assert.equal(plan.systems[1].newPage, false);
  assert.equal(plan.systems[2].manualBreakBefore, true);
  assert.equal(plan.systems[2].newPage, true);
});

test('MusicXML export preserves page settings and manual print breaks', () => {
  const formats = require('../src/core/formats');
  const score = cleanScore({ measures: 3, pageSize: 'Letter', orientation: 'landscape', margins: 18, staffGap: 72, systemGap: 84 });
  score.measures[1].newSystem = true;
  score.measures[2].newPage = true;
  const xml = formats.exportMusicXML(score);
  assert.match(xml, /<defaults><scaling>/);
  assert.match(xml, /<page-layout><page-height>/);
  assert.match(xml, /<page-margins type="both">/);
  assert.match(xml, /<staff-distance>/);
  assert.match(xml, /<system-distance>/);
  assert.match(xml, /<measure number="2"><print new-system="yes"\/>/);
  assert.match(xml, /<measure number="3"><print new-page="yes"\/>/);
});

test('measure attributes expose undoable manual system and page break semantics', () => {
  const score = cleanScore({ measures: 3 });
  model.setMeasureAttributes(score, 1, { newSystem: true });
  assert.equal(score.measures[1].newSystem, true);
  assert.equal(score.measures[1].newPage, false);
  model.setMeasureAttributes(score, 2, { newPage: true, newSystem: true });
  assert.equal(score.measures[2].newPage, true);
  assert.equal(score.measures[2].newSystem, false);
});

test('page, header and footer text remain page-anchored through timeline edits', () => {
  const score = cleanScore({ measures: 4, timeSignature: '4/4' });
  const header = model.addAnnotation(score, { id: 'header', type: 'header-text', scope: 'header', text: 'Festival Edition', pageIndex: 1, alignment: 'center' });
  const footer = model.addAnnotation(score, { id: 'footer', type: 'footer-text', scope: 'footer', text: 'Copyright', pageIndex: 0, alignment: 'right' });
  const pageText = model.addAnnotation(score, { id: 'page', type: 'page-text', scope: 'page', text: 'Page note', pageIndex: 2 });
  const musical = model.addAnnotation(score, { id: 'musical', type: 'measure-text', scope: 'measure', text: 'Verse', start: 8, measureIndex: 2 });

  model.insertMeasures(score, 1, 1);
  assert.equal(score.annotations.find(item => item.id === header.id).pageIndex, 1);
  assert.equal(score.annotations.find(item => item.id === header.id).start, 0);
  assert.equal(score.annotations.find(item => item.id === footer.id).start, 0);
  assert.equal(score.annotations.find(item => item.id === pageText.id).pageIndex, 2);
  assert.equal(score.annotations.find(item => item.id === musical.id).start, 12);

  model.configurePickupMeasure(score, 1);
  assert.equal(score.annotations.find(item => item.id === header.id).start, 0);
  assert.equal(score.annotations.find(item => item.id === footer.id).start, 0);
  assert.equal(score.annotations.find(item => item.id === pageText.id).start, 0);
  assert.equal(score.annotations.find(item => item.id === musical.id).start, 9);

  model.removeMeasure(score, 1);
  const scopes = Object.fromEntries(score.annotations.map(item => [item.id, item.scope]));
  assert.equal(scopes.header, 'header');
  assert.equal(scopes.footer, 'footer');
  assert.equal(scopes.page, 'page');
});

test('MusicXML credits preserve semantic page number for page-scoped text', () => {
  const formats = require('../src/core/formats');
  const score = cleanScore({ measures: 2 });
  model.addAnnotation(score, { type: 'header-text', scope: 'header', text: 'Second page heading', pageIndex: 1, alignment: 'center' });
  model.addAnnotation(score, { type: 'footer-text', scope: 'footer', text: 'Footer credit', pageIndex: 0, alignment: 'right' });
  const xml = formats.exportMusicXML(score);
  assert.match(xml, /<credit page="2"><credit-type>header-text<\/credit-type>/);
  assert.match(xml, /<credit page="1"><credit-type>footer-text<\/credit-type>/);
  const normalized = model.normalizeScore(JSON.parse(JSON.stringify(score)));
  const heading = normalized.annotations.find(item => item.type === 'header-text');
  const footer = normalized.annotations.find(item => item.type === 'footer-text');
  assert.equal(heading.pageIndex, 1);
  assert.equal(heading.text, 'Second page heading');
  assert.equal(footer.pageIndex, 0);
  assert.equal(footer.text, 'Footer credit');
});

test('manual staff spacing is stored separately from automatic layout and can be reset', () => {
  const score = cleanScore({ template: 'piano' });
  const part = score.parts[0];
  const beforeGap = score.settings.staffGap;
  assert.equal(model.staffManualAfter(score, part.id, 'treble'), 0);
  assert.equal(model.adjustStaffManualAfter(score, part.id, 'treble', 18), 18);
  assert.equal(model.staffManualAfter(score, part.id, 'treble'), 18);
  assert.equal(score.settings.staffGap, beforeGap);
  const reopened = model.normalizeScore(JSON.parse(JSON.stringify(score)));
  assert.equal(model.staffManualAfter(reopened, part.id, 'treble'), 18);
  model.resetManualSpacing(reopened);
  assert.equal(model.staffManualAfter(reopened, part.id, 'treble'), 0);
  assert.equal(reopened.settings.staffGap, beforeGap);
});
