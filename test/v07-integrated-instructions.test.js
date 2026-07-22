const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/music-theory');
const model = require('../src/core/score-model');
const editing = require('../src/core/editing');
const solfa = require('../src/core/solfa');
const airscore = require('../src/core/airscore');
const { SelectionModel } = require('../src/core/selection');

function authored(part, type = null) {
  return part.events.filter(event => event.generatedBy !== 'gap-fill' && (!type || event.type === type));
}

test('new scores prefer a clean staff-only workspace and preserve editable publication metadata', () => {
  const score = model.createScore({
    template: 'lead', title: 'Publication Test', subtitle: 'A Song', composer: 'Composer Name',
    supportingText: 'Dedicated to the choir · Accra 2026'
  });
  assert.equal(score.settings.showSolfa, false);
  assert.equal(score.settings.solfaShowVoiceLabels, false);
  assert.equal(score.metadata.title, 'Publication Test');
  assert.equal(score.metadata.subtitle, 'A Song');
  assert.equal(score.metadata.supportingText, 'Dedicated to the choir · Accra 2026');
  const reopened = airscore.deserialize(airscore.serialize(score));
  assert.equal(reopened.metadata.supportingText, score.metadata.supportingText);
  assert.equal(reopened.settings.showSolfa, false);
});

test('selected notes copy to another independent layer with lyrics and spanners', () => {
  const score = model.createScore({ template: 'lead', measures: 2, autoFillRests: true });
  const part = score.parts[0];
  const one = model.addNote(score, part.id, { pitch: 'C4', start: 0, duration: 1, voice: 1, lyric: 'Sing' });
  const two = model.addNote(score, part.id, { pitch: 'C4', start: 1, duration: 1, voice: 1 });
  model.addSlur(score, one.id, two.id);
  const selection = new SelectionModel().selectEvents([one.id, two.id]);
  const copied = editing.copySelectionToLayer(score, selection, 3, { conflictMode: 'replace-conflicts', includeLyrics: true, includeMarkings: true });
  assert.equal(copied.length, 2);
  assert.deepEqual(copied.map(({ event }) => event.voice), [3, 3]);
  assert.equal(copied[0].event.lyrics[0].text, 'Sing');
  assert.ok(score.spanners.some(item => item.type === 'slur' && item.startEventId === copied[0].event.id && item.endEventId === copied[1].event.id));
  assert.equal(model.layerCapacity(score, part, 0, 1).authoredNoteCount, 2);
  assert.equal(model.layerCapacity(score, part, 0, 3).authoredNoteCount, 2);
});

test('copy-to-layer can replace conflicts without altering the source layer', () => {
  const score = model.createScore({ template: 'lead', measures: 1, autoFillRests: true });
  const part = score.parts[0];
  const source = model.addNote(score, part.id, { pitch: 'E4', start: 0, duration: 2, voice: 1 });
  model.addNote(score, part.id, { pitch: 'G4', start: 0, duration: 2, voice: 2 });
  const selection = new SelectionModel().selectEvent(source.id);
  const copied = editing.copySelectionToLayer(score, selection, 2, { conflictMode: 'replace-conflicts' });
  assert.equal(copied.length, 1);
  assert.equal(authored(part, 'note').filter(event => event.voice === 1)[0].midi, 64);
  const destination = authored(part, 'note').filter(event => event.voice === 2);
  assert.equal(destination.length, 1);
  assert.equal(destination[0].midi, 64);
});

test('paste-and-replace supports all, pitch-only and rhythm-only operations', () => {
  const score = model.createScore({ template: 'lead', measures: 4, autoFillRests: false });
  const part = score.parts[0];
  const s1 = model.addNote(score, part.id, { pitch: 'C4', start: 0, duration: .5, voice: 1 });
  const s2 = model.addNote(score, part.id, { pitch: 'E4', start: .5, duration: 1.5, voice: 1 });
  const sourceSelection = new SelectionModel().selectEvents([s1.id, s2.id]);
  const clipboard = editing.makeClipboard(score, sourceSelection);

  const d1 = model.addNote(score, part.id, { pitch: 'G4', start: 4, duration: 1, voice: 2 });
  const d2 = model.addNote(score, part.id, { pitch: 'A4', start: 5, duration: 1, voice: 2 });
  const destination = new SelectionModel().selectEvents([d1.id, d2.id]);
  const pitchOnly = editing.replaceRange(score, destination, clipboard, { contentMode: 'pitch-only' });
  assert.deepEqual(pitchOnly.map(({ event }) => event.start), [4, 5]);
  assert.deepEqual(pitchOnly.map(({ event }) => event.duration), [1, 1]);
  assert.deepEqual(pitchOnly.map(({ event }) => event.midi), [60, 64]);

  const r1 = model.addNote(score, part.id, { pitch: 'G4', start: 8, duration: 1, voice: 3 });
  const r2 = model.addNote(score, part.id, { pitch: 'A4', start: 9, duration: 1, voice: 3 });
  const rhythmDestination = new SelectionModel().selectEvents([r1.id, r2.id]);
  const rhythmOnly = editing.replaceRange(score, rhythmDestination, clipboard, { contentMode: 'rhythm-only' });
  assert.deepEqual(rhythmOnly.map(({ event }) => event.duration), [.5, 1.5]);
  assert.deepEqual(rhythmOnly.map(({ event }) => event.midi), [67, 69]);
});

test('tonic-solfa text omits staff and internal layer names by default', () => {
  const score = model.createScore({ template: 'satb', measures: 1, autoFillRests: false });
  model.addNote(score, score.parts[0].id, { pitch: 'C4', start: 0, duration: 1, voice: 1, lyric: 'Word' });
  let text = solfa.scoreToSolfaText(score);
  assert.doesNotMatch(text, /treble-L|bass-L|Staff 1|Layer 1/);
  score.settings.solfaShowVoiceLabels = true;
  text = solfa.scoreToSolfaText(score);
  assert.match(text, /\nS\n/);
});

test('layout spacing changes never alter musical playback data', () => {
  const score = model.createScore({ template: 'piano', measures: 2, autoFillRests: false });
  const part = score.parts[0];
  model.addNote(score, part.id, { pitch: 'C4', start: 0, duration: 1, voice: 1, staff: 'treble' });
  model.addNote(score, part.id, { pitch: 'C3', start: 0, duration: 2, voice: 2, staff: 'bass' });
  const before = authored(part).map(event => ({ id: event.id, midi: event.midi, start: event.start, duration: event.duration, voice: event.voice, staff: event.staff }));
  Object.assign(score.settings, { staffGap: 118, partGap: 76, systemGap: 124 });
  const after = authored(part).map(event => ({ id: event.id, midi: event.midi, start: event.start, duration: event.duration, voice: event.voice, staff: event.staff }));
  assert.deepEqual(after, before);
});

test('airscore v8 migrates older projects to optional overlay, editable headers and rapid lyrics', () => {
  const oldScore = model.createScore({ template: 'lead' });
  delete oldScore.settings.solfaShowVoiceLabels;
  delete oldScore.metadata.supportingText;
  const scoreText = JSON.stringify(oldScore);
  const payload = {
    signature: 'AIRM-Score', version: 5, schema: 'airscore-v6', checksum: airscore.checksum(scoreText), score: oldScore
  };
  const reopened = airscore.deserialize(payload);
  assert.equal(reopened.formatVersion, 9);
  assert.equal(typeof reopened.settings.solfaShowVoiceLabels, 'boolean');
  assert.equal(reopened.metadata.supportingText, '');
  assert.equal(reopened.settings.lyricAutoAdvance, true);
  assert.equal(reopened.settings.entryLayerColors, true);
});


test('tonic-solfa lyrics preserve syllable hyphens, melisma underscores and elision marks', () => {
  const score = model.createScore({ template: 'lead', measures: 1, autoFillRests: false });
  const part = score.parts[0];
  model.addNote(score, part.id, { pitch: 'C4', start: 0, duration: 1, voice: 1, lyrics: [{ verse: 1, text: 'A', syllabic: 'begin' }] });
  model.addNote(score, part.id, { pitch: 'D4', start: 1, duration: 1, voice: 1, lyrics: [{ verse: 1, text: 'men', melisma: true }] });
  model.addNote(score, part.id, { pitch: 'E4', start: 2, duration: 1, voice: 1, lyrics: [{ verse: 1, text: 'ev', elision: true }] });
  const text = solfa.scoreToSolfaText(score);
  assert.match(text, /A-/);
  assert.match(text, /men_/);
  assert.match(text, /ev‿/);
});
