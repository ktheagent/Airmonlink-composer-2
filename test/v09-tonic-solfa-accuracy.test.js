const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/music-theory');
const model = require('../src/core/score-model');
const parser = require('../src/core/solfa-parser');
const solfa = require('../src/core/solfa');
const airscore = require('../src/core/airscore');

function authored(part) { return part.events.filter(event => event.generatedBy !== 'gap-fill'); }

test('version 9 scores preserve the dedicated sol-fa page settings and optional staff lane', () => {
  const score = model.createScore({ template: 'piano', measures: 2 });
  assert.equal(score.formatVersion, 9);
  assert.equal(score.settings.solfaConvention, 'airmonlink-traditional-v1');
  assert.equal(score.settings.solfaPitchSystem, 'movable-do');
  assert.equal(score.settings.solfaOverlayPosition, 'below');
  assert.equal(score.settings.solfaOverlayScope, 'entire-score');
  assert.deepEqual(score.settings.solfaStaffVisibility, {});
  assert.equal(score.settings.solfaLinkedEditing, true);
  assert.equal(score.settings.showSolfa, false);
});

test('formal symbol table documents context-sensitive comma dot dash underscore and bar meanings', () => {
  const table = parser.symbolTable('airmonlink-traditional-v1');
  const text = table.map(item => `${item.symbol} ${item.meaning} ${item.context}`).join('\n');
  assert.match(text, /Lower octave when attached before a syllable/);
  assert.match(text, /Half-pulse subdivision/);
  assert.match(text, /Extend the preceding sounding note/);
  assert.match(text, /Melisma\/continuation marker/);
  assert.match(text, /Close current measure/);
});

test('tokenizer distinguishes attached octave comma from standalone rhythmic comma', () => {
  const tokens = parser.tokenize(',d , r d\'', { convention: 'airmonlink-traditional-v1' });
  assert.equal(tokens[0].type, 'event');
  assert.equal(tokens[0].lowerMarks, ',');
  assert.equal(tokens[1].type, 'quarter-pulse');
  assert.equal(tokens[2].type, 'event');
  assert.equal(tokens[3].upperMarks, "'");
});

test('timed notes, rests, repeated attacks and bars create exact 4/4 events', () => {
  const result = parser.parsePassage('d r 0 d |', { timeSignature: '4/4', voice: 2 });
  assert.equal(result.valid, true);
  assert.equal(result.events.length, 4);
  assert.deepEqual(result.events.map(event => event.start), [0, 1, 2, 3]);
  assert.deepEqual(result.events.map(event => event.duration), [1, 1, 1, 1]);
  assert.equal(result.events[2].rest, true);
  assert.equal(result.events[1].syllable, 'r');
  assert.equal(result.events[3].syllable, 'd');
  assert.equal(result.measures[0].complete, true);
});

test('a sustain dash extends one note without creating a repeated playback attack', () => {
  const result = parser.parsePassage('d - - - |', { timeSignature: '4/4' });
  assert.equal(result.valid, true);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].duration, 4);
  assert.equal(result.events[0].continuations.length, 3);
  assert.equal(result.measures[0].complete, true);
});

test('suffix punctuation encodes duration while prefix punctuation controls onset grid', () => {
  const result = parser.parsePassage('d. r. : m , f, s, l, |', { timeSignature: '4/4', allowIncompleteMeasures: true });
  assert.deepEqual(result.events.slice(0, 2).map(event => event.duration), [.5, .5]);
  assert.equal(result.events[2].start, 2);
  assert.equal(result.events[3].duration, .25);
  assert.ok(result.events.every(event => Number.isFinite(event.start) && Number.isFinite(event.duration)));
});

test('compound 6/8 validation uses two dotted-quarter pulses', () => {
  const result = parser.parsePassage('d s |', { timeSignature: '6/8' });
  assert.equal(result.events[0].duration, 1.5);
  assert.equal(result.events[1].duration, 1.5);
  assert.equal(result.measures[0].capacity, 3);
  assert.equal(result.measures[0].complete, true);
});

test('underfill overfill and unknown symbols include exact diagnostic location', () => {
  const under = parser.parsePassage('d r |', { timeSignature: '4/4' });
  assert.ok(under.diagnostics.some(item => item.code === 'MEASURE_UNDERFILLED' && item.measure === 1));
  const over = parser.parsePassage('d - - - - |', { timeSignature: '4/4' });
  assert.ok(over.diagnostics.some(item => ['EVENT_CROSSES_MEASURE', 'MEASURE_OVERFILLED'].includes(item.code)));
  const unknown = parser.parsePassage('d @ r', { timeSignature: '4/4', allowIncompleteMeasures: true });
  const issue = unknown.diagnostics.find(item => item.code === 'UNKNOWN_SYMBOL');
  assert.equal(issue.symbol, '@');
  assert.equal(issue.source.line, 1);
  assert.equal(issue.source.column, 3);
  assert.ok(issue.suggestion);
});

test('do-based minor, la-based minor and fixed-do produce distinct correct syllables', () => {
  const cMinor = model.createScore({ template: 'lead', key: 'Cm', mode: 'minor', measures: 1, autoFillRests: false });
  const part = cMinor.parts[0];
  const tonic = model.addNote(cMinor, part.id, { pitch: 'C4', start: 0, duration: 1 });
  const third = model.addNote(cMinor, part.id, { pitch: 'Eb4', start: 1, duration: 1 });
  assert.equal(solfa.eventToSolfa(tonic, cMinor, part, { minorSystem: 'do-based' }).syllable, 'd');
  assert.equal(solfa.eventToSolfa(third, cMinor, part, { minorSystem: 'do-based' }).syllable, 'me');
  assert.equal(solfa.eventToSolfa(tonic, cMinor, part, { minorSystem: 'la-based' }).syllable, 'l');
  assert.equal(solfa.notationSyllable('C4', 'F', { pitchSystem: 'fixed-do' }), 'd');
});

test('reverse transcription preserves explicit upper and lower octaves', () => {
  assert.equal(solfa.pitchForSyllable(',d', 'C'), 'C3');
  assert.equal(solfa.pitchForSyllable('d', 'C'), 'C4');
  assert.equal(solfa.pitchForSyllable("d'", 'C'), 'C5');
  assert.equal(solfa.pitchForSyllable('l', 'Cm', { mode: 'minor', minorSystem: 'la-based' }), 'C4');
});

test('validated tonic sol-fa replaces a staff passage with structured notes and rests', () => {
  const score = model.createScore({ template: 'lead', measures: 1, timeSignature: '4/4', autoFillRests: false });
  const part = score.parts[0];
  model.addNote(score, part.id, { pitch: 'G4', start: 0, duration: 4, voice: 1 });
  const result = solfa.applySolfaPassage(score, part.id, 'd r 0 m |', { voice: 1, replace: true });
  assert.equal(result.valid, true);
  assert.equal(result.created.length, 4);
  assert.deepEqual(authored(part).map(event => event.type), ['note', 'note', 'rest', 'note']);
  assert.deepEqual(authored(part).map(event => event.start), [0, 1, 2, 3]);
  assert.deepEqual(authored(part).filter(event => event.type === 'note').map(event => event.midi), [60, 62, 64]);
  assert.equal(score.solfaLastImport.convention, 'airmonlink-traditional-v1');
});

test('airscore v9 migrates older projects without changing their structured musical events', () => {
  const score = model.createScore({ template: 'lead', measures: 1, autoFillRests: false });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { pitch: 'F4', start: 0, duration: 1, voice: 4, lyric: 'Sing' });
  delete score.settings.solfaConvention;
  delete score.settings.solfaOverlayPosition;
  score.formatVersion = 8;
  const scoreText = JSON.stringify(score);
  const payload = { signature: 'AIRM-Score', version: 7, schema: 'airscore-v8', checksum: airscore.checksum(scoreText), score };
  const reopened = airscore.deserialize(payload);
  const reopenedNote = reopened.parts[0].events.find(event => event.id === note.id);
  assert.equal(reopened.formatVersion, 9);
  assert.equal(reopened.settings.solfaConvention, 'airmonlink-traditional-v1');
  assert.equal(reopened.settings.solfaOverlayPosition, 'below');
  assert.equal(reopenedNote.midi, note.midi);
  assert.equal(reopenedNote.voice, 4);
  assert.equal(reopenedNote.lyrics[0].text, 'Sing');
  assert.ok(reopened.solfaMigrationReport.length >= 1);
});
