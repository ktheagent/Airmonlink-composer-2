const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/music-theory');
const model = require('../src/core/score-model');
const solfa = require('../src/core/solfa');
const notations = require('../src/core/notations');
const playback = require('../src/core/playback');
const formats = require('../src/core/formats');
const airscore = require('../src/core/airscore');
const midiInput = require('../src/core/midi-input');

function authored(part, type = null) {
  return part.events.filter(event => event.generatedBy !== 'gap-fill' && (!type || event.type === type));
}

test('every staff exposes exactly four independent layers in 4/4', () => {
  const score = model.createScore({ template: 'lead', measures: 1, timeSignature: '4/4' });
  const part = score.parts[0];
  assert.deepEqual(part.voiceLayers, [1, 2, 3, 4]);
  for (let voice = 1; voice <= 4; voice += 1) model.addNote(score, part.id, { midi: 59 + voice, start: 0, duration: 1, voice });
  for (let voice = 1; voice <= 4; voice += 1) {
    const capacity = model.layerCapacity(score, part, 0, voice, null);
    assert.equal(capacity.authoredNoteCount, 1);
    assert.equal(capacity.authoredRestCount, 0);
    assert.equal(capacity.calculatedRestCount >= 1, true);
    assert.equal(capacity.used, 4);
    assert.equal(capacity.remaining, 0);
    assert.equal(capacity.overfilled, false);
  }
});

test('four independent layers complete a compound 6/8 measure', () => {
  const score = model.createScore({ template: 'lead', measures: 1, timeSignature: '6/8' });
  const part = score.parts[0];
  model.addNote(score, part.id, { midi: 60, start: 1, duration: .5, voice: 1 });
  model.addRest(score, part.id, { start: 0, duration: 1.5, voice: 2 });
  model.addNote(score, part.id, { midi: 64, start: 0, duration: 3, voice: 3 });
  model.addNote(score, part.id, { midi: 67, start: 2.5, duration: .5, voice: 4 });
  const report = notations.layerCapacityReport(score, part.id, 0);
  assert.equal(report.length, 4);
  report.forEach(item => {
    assert.equal(item.capacity, 3);
    assert.equal(item.used, 3);
    assert.equal(item.remaining, 0);
    assert.equal(item.overfilled, false);
  });
  assert.equal(report[1].authoredRestCount, 1);
  assert.equal(report[1].calculatedRestCount >= 1, true);
});

test('notes can occupy the same beat in all four layers without sharing capacity', () => {
  const score = model.createScore({ template: 'lead', measures: 1, autoFillRests: false });
  const part = score.parts[0];
  for (let voice = 1; voice <= 4; voice += 1) {
    assert.equal(model.canPlaceEvent(score, part.id, { type: 'note', midi: 60 + voice, start: 0, duration: 4, voice }).ok, true);
    model.addNote(score, part.id, { midi: 60 + voice, start: 0, duration: 4, voice });
  }
  assert.equal(authored(part, 'note').length, 4);
  assert.equal(new Set(authored(part, 'note').map(event => event.voice)).size, 4);
});

test('measure overfill is detected independently per layer', () => {
  const score = model.createScore({ template: 'lead', measures: 1, autoFillRests: false });
  const part = score.parts[0];
  model.addNote(score, part.id, { midi: 60, start: 0, duration: 4, voice: 1 });
  assert.equal(model.canPlaceEvent(score, part.id, { type: 'note', midi: 62, start: 3, duration: 1, voice: 1 }).ok, false);
  assert.equal(model.canPlaceEvent(score, part.id, { type: 'note', midi: 64, start: 3, duration: 1, voice: 2 }).ok, true);
});

test('pickup capacity and calculated rests are independent per layer', () => {
  const score = model.createScore({ template: 'lead', measures: 2, timeSignature: '4/4', pickupBeats: 1 });
  const part = score.parts[0];
  model.addNote(score, part.id, { midi: 60, start: 0, duration: .5, voice: 4 });
  for (let voice = 1; voice <= 4; voice += 1) assert.equal(model.layerCapacity(score, part, 0, voice).capacity, 1);
  assert.equal(model.layerCapacity(score, part, 0, 4).calculatedRestCount, 1);
  assert.equal(model.measureStartBeat(score, 1), 1);
});

test('automatic barline split creates stable tie spanner and one playback attack', () => {
  const score = model.createScore({ template: 'lead', measures: 2, autoFillRests: false });
  const part = score.parts[0];
  const pieces = require('../src/core/editing').addNoteAcrossBarlines(score, part.id, { midi: 60, start: 3, duration: 3, voice: 1 });
  assert.equal(pieces.length, 2);
  assert.equal(score.spanners.length, 1);
  assert.equal(score.spanners[0].type, 'tie');
  assert.equal(score.spanners[0].startEventId, pieces[0].id);
  assert.equal(score.spanners[0].endEventId, pieces[1].id);
  const played = playback.mergedTiedEvents(score, part);
  assert.equal(played.length, 1);
  assert.equal(played[0].duration, 3);
  assert.deepEqual(played[0].tiedEventIds, pieces.map(event => event.id));
  const xml = formats.exportMusicXML(score);
  assert.match(xml, /<tie type="start"\/>/);
  assert.match(xml, /<tie type="stop"\/>/);
});

test('slurs use stable note IDs and can be removed without deleting notes', () => {
  const score = model.createScore({ template: 'lead', measures: 1, autoFillRests: false });
  const part = score.parts[0];
  const first = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1 });
  const middle = model.addNote(score, part.id, { midi: 62, start: 1, duration: 1 });
  const last = model.addNote(score, part.id, { midi: 64, start: 2, duration: 1 });
  const slur = notations.createSlur(score, [{ part, event: first }, { part, event: middle }, { part, event: last }]);
  assert.equal(slur.startEventId, first.id);
  assert.equal(slur.endEventId, last.id);
  assert.match(formats.exportMusicXML(score), /<slur type="start"/);
  assert.equal(model.removeSpanner(score, slur.id), true);
  assert.equal(authored(part, 'note').length, 3);
  assert.equal(score.spanners.length, 0);
});

test('lyrics remain on the first tied note and appear in tonic sol-fa', () => {
  const score = model.createScore({ template: 'lead', measures: 2, autoFillRests: false, title: 'Tie Lyric' });
  const part = score.parts[0];
  const pieces = require('../src/core/editing').addNoteAcrossBarlines(score, part.id, { midi: 60, start: 3, duration: 2, lyric: 'Praise', voice: 1 });
  assert.equal(pieces[0].lyrics[0].text, 'Praise');
  assert.equal((pieces[1].lyrics || []).length, 0);
  const text = solfa.scoreToSolfaText(score);
  assert.match(text, /Praise/);
  assert.match(text, /d/);
});

test('traditional tonic sol-fa uses rhythm punctuation and no raw accidental symbols', () => {
  const score = model.createScore({ template: 'lead', measures: 1, key: 'C', autoFillRests: false });
  const part = score.parts[0];
  model.addNote(score, part.id, { midi: 61, pitch: 'C#4', start: 0, duration: .5, voice: 1 });
  model.addNote(score, part.id, { midi: 62, start: .5, duration: 1.5, voice: 1 });
  const text = solfa.scoreToSolfaText(score);
  assert.match(text, /di/);
  assert.match(text, /[,:,—]/);
  assert.doesNotMatch(text, /[#♯♭]/);
});

test('voices above four migrate to additional staves with a compatibility report', () => {
  const score = model.createScore({ template: 'lead', measures: 1, autoFillRests: false });
  const part = score.parts[0];
  part.events.push({ id: model.uid('note'), type: 'note', midi: 72, pitch: 'C5', start: 0, duration: 1, voice: 5 });
  model.normalizeScore(score);
  const migrated = authored(part, 'note')[0];
  assert.equal(migrated.voice, 1);
  assert.match(migrated.staff, /voice-overflow/);
  assert.match(score.importCompatibilityReport.converted.join(' '), /voices above Layer 4/);
});

test('MIDI step-time entry records notes and chords in the active layer', () => {
  const score = model.createScore({ template: 'lead', measures: 2, autoFillRests: false });
  const part = score.parts[0];
  const input = new midiInput.StepTimeMidiInput(score, { partId: part.id, voice: 3, duration: 1, cursor: 0 });
  input.handle([0x90, 60, 90]);
  input.handle([0x90, 64, 80]);
  input.handle([0x80, 60, 0]);
  input.handle([0x80, 64, 0]);
  assert.equal(input.cursor, 1);
  assert.equal(authored(part, 'note').length, 2);
  assert.deepEqual(authored(part, 'note').map(event => event.start), [0, 0]);
  assert.deepEqual(authored(part, 'note').map(event => event.voice), [3, 3]);
  assert.deepEqual(authored(part, 'note').map(event => [event.midi, event.velocity]).sort((a, b) => a[0] - b[0]), [[60, 90], [64, 80]]);
});

test('current airscore schema preserves four layers, spanners and traditional sol-fa settings', () => {
  const score = model.createScore({ template: 'lead', measures: 1, autoFillRests: false });
  const part = score.parts[0];
  const a = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1, voice: 4 });
  const b = model.addNote(score, part.id, { midi: 60, start: 1, duration: 1, voice: 4 });
  model.addTie(score, a.id, b.id);
  const payload = JSON.parse(airscore.serialize(score));
  assert.equal(payload.schema, 'airscore-v10');
  const reopened = airscore.deserialize(payload);
  assert.deepEqual(reopened.parts[0].voiceLayers, [1, 2, 3, 4]);
  assert.equal(reopened.spanners.length, 1);
  assert.equal(reopened.settings.solfaMode, 'traditional');
});

test('articulations are score objects preserved by MusicXML export and airscore round trip', () => {
  const score = model.createScore({ template: 'lead', measures: 1, autoFillRests: false });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1, voice: 1 });
  assert.equal(notations.setArticulation(score, [{ part, event: note }], 'staccato', true), 1);
  assert.deepEqual(note.articulations, ['staccato']);
  const xml = formats.exportMusicXML(score);
  assert.match(xml, /<articulations><staccato\/><\/articulations>/);
  const reopenedProject = airscore.deserialize(JSON.parse(airscore.serialize(score)));
  assert.deepEqual(authored(reopenedProject.parts[0], 'note')[0].articulations, ['staccato']);
});

test('professional templates initialise real groups, four layers and page settings', () => {
  const piano = model.createScore({ template: 'piano', measures: 12, pageSize: 'Letter', orientation: 'landscape', margins: 22, concertPitch: false });
  assert.equal(piano.parts.length, 1);
  assert.equal(piano.parts[0].clef, 'grand');
  assert.ok(piano.parts[0].braceGroup);
  assert.deepEqual(piano.parts[0].voiceLayers, [1, 2, 3, 4]);
  assert.equal(piano.settings.pageSize, 'Letter');
  assert.equal(piano.settings.orientation, 'landscape');
  assert.equal(piano.settings.margins, 22);
  assert.equal(piano.settings.concertPitch, false);
  assert.equal(piano.measures.length, 12);

  const choir = model.createScore({ template: 'ttbb', measures: 2 });
  assert.deepEqual(choir.parts.map(part => part.name), ['Tenor I', 'Tenor II', 'Bass I', 'Bass II']);
  choir.parts.forEach(part => {
    assert.equal(part.bracketGroup, 'choir');
    assert.deepEqual(part.voiceLayers, [1, 2, 3, 4]);
  });
});
