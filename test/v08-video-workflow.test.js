const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/core/music-theory');
const model = require('../src/core/score-model');
const lyrics = require('../src/core/lyrics');
const airscore = require('../src/core/airscore');

test('new score defaults preserve rapid lyric entry and layer-colour editing preferences', () => {
  const score = model.createScore({ template: 'piano', title: 'Video Workflow' });
  assert.equal(score.formatVersion, 9);
  assert.equal(score.settings.lyricAutoAdvance, true);
  assert.equal(score.settings.entryLayerColors, true);
  assert.equal(score.settings.showSolfa, false);
  assert.deepEqual(score.parts[0].voiceLayers, [1, 2, 3, 4]);
});

test('lyric entry can navigate forward and backward within the same layer and staff', () => {
  const score = model.createScore({ template: 'piano', measures: 2, autoFillRests: false });
  const part = score.parts[0];
  const first = model.addNote(score, part.id, { pitch: 'C4', start: 0, duration: 1, voice: 2, staff: 'treble' });
  const second = model.addNote(score, part.id, { pitch: 'D4', start: 1, duration: 1, voice: 2, staff: 'treble' });
  model.addNote(score, part.id, { pitch: 'E3', start: 2, duration: 1, voice: 1, staff: 'bass' });
  assert.equal(lyrics.nextEligibleNote(score, part.id, first.id, { voice: 2, staff: 'treble' }).event.id, second.id);
  assert.equal(lyrics.previousEligibleNote(score, part.id, second.id, { voice: 2, staff: 'treble' }).event.id, first.id);
  assert.equal(lyrics.previousEligibleNote(score, part.id, first.id, { voice: 2, staff: 'treble' }), null);
});

test('airscore v8 migration adds video-workflow preferences without changing music', () => {
  const score = model.createScore({ template: 'lead', measures: 1, autoFillRests: false });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { pitch: 'F4', start: 0, duration: 1, voice: 3, lyric: 'Sing' });
  delete score.settings.lyricAutoAdvance;
  delete score.settings.entryLayerColors;
  score.formatVersion = 7;
  const scoreText = JSON.stringify(score);
  const payload = { signature: 'AIRM-Score', version: 6, schema: 'airscore-v7', checksum: airscore.checksum(scoreText), score };
  const reopened = airscore.deserialize(payload);
  const reopenedNote = reopened.parts[0].events.find(item => item.id === note.id);
  assert.equal(reopened.formatVersion, 9);
  assert.equal(reopened.settings.lyricAutoAdvance, true);
  assert.equal(reopened.settings.entryLayerColors, true);
  assert.equal(reopenedNote.midi, note.midi);
  assert.equal(reopenedNote.voice, 3);
  assert.equal(reopenedNote.lyrics[0].text, 'Sing');
});
