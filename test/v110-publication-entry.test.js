const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/core/score-model');
const formats = require('../src/core/formats');
const airscore = require('../src/core/airscore');

test('lyric verse number remains metadata and never contaminates lyric text', () => {
  const score = model.createScore({ template: 'lead', measures: 2 });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1, voice: 1 });
  model.setLyric(score, part.id, note.id, 'Praise', { verse: 2, syllabic: 'single' });
  const lyric = note.lyrics.find(item => item.verse === 2);
  assert.equal(lyric.text, 'Praise');
  assert.equal(lyric.verse, 2);
  assert.equal(note.lyrics.some(item => /(^2|2$)/.test(item.text)), false);
});

test('independent lyric verses survive airscore and MusicXML round trips', () => {
  const score = model.createScore({ template: 'lead', measures: 2 });
  const part = score.parts[0];
  const note = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1, voice: 1 });
  model.setLyric(score, part.id, note.id, 'Praise', { verse: 1 });
  model.setLyric(score, part.id, note.id, 'Worship', { verse: 2 });
  const reopened = airscore.deserialize(airscore.serialize(score));
  const lyrics = reopened.parts[0].events.find(item => item.id === note.id).lyrics;
  assert.deepEqual(lyrics.map(item => [item.verse, item.text]), [[1, 'Praise'], [2, 'Worship']]);
  const xml = formats.exportMusicXML(score);
  assert.match(xml, /<lyric number="2"[^>]*>[\s\S]*?<text>Worship<\/text>/);
  assert.doesNotMatch(xml, /<text>2Worship<\/text>|<text>Worship2<\/text>/);
});

test('compatible notes at one onset normalize into a semantic chord', () => {
  const score = model.createScore({ template: 'lead', measures: 2 });
  const part = score.parts[0];
  const root = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1, voice: 1 });
  const third = model.addChordTone(score, part.id, root.id, 64);
  const members = model.chordMembers(score, third.id);
  assert.equal(members.length, 2);
  assert.equal(new Set(members.map(item => item.start)).size, 1);
  assert.equal(new Set(members.map(item => item.duration)).size, 1);
  assert.ok(members.every(item => item.chordId));
});
