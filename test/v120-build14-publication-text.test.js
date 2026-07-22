const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../src/core/score-model');
const airscore = require('../src/core/airscore');
const formats = require('../src/core/formats');

test('publication text visual layout remains separate from metadata', () => {
  const score = model.createScore({ template: 'lead', title: 'Movable title' });
  model.updatePublicationTextLayout(score, 'solfa:title', { offsetX: 28, offsetY: -9, alignment: 'right', fontSize: 30 });
  assert.equal(score.metadata.title, 'Movable title');
  assert.deepEqual(score.publicationTextLayout['solfa:title'], { offsetX: 28, offsetY: -9, alignment: 'right', fontFamily: '', fontSize: 30, fontStyle: null, fontWeight: null, visible: true });
});

test('publication text layout survives airscore save and reopen', () => {
  const score = model.createScore({ template: 'lead', composer: 'Writer' });
  model.updatePublicationTextLayout(score, 'staff:composer', { offsetX: -15, offsetY: 12, fontStyle: 'italic' });
  const reopened = airscore.deserialize(airscore.serialize(score));
  assert.equal(reopened.metadata.composer, 'Writer');
  assert.equal(reopened.publicationTextLayout['staff:composer'].offsetX, -15);
  assert.equal(reopened.publicationTextLayout['staff:composer'].offsetY, 12);
  assert.equal(reopened.publicationTextLayout['staff:composer'].fontStyle, 'italic');
});

test('unsafe publication layout keys and values are discarded or clamped', () => {
  const normalized = model.normalizePublicationTextLayout({ 'solfa:title': { offsetX: '8', fontSize: 400 }, 'bad:field': { offsetX: 99 } });
  assert.equal(normalized['solfa:title'].offsetX, 8);
  assert.equal(normalized['solfa:title'].fontSize, 96);
  assert.equal(normalized['bad:field'], undefined);
});

test('MusicXML credits preserve publication text styling and visual offsets', () => {
  const score = model.createScore({ template: 'lead', title: 'Styled', composer: 'Writer', dedication: 'For all' });
  model.updatePublicationTextLayout(score, 'staff:title', { offsetX: 12, offsetY: 8, alignment: 'left', fontFamily: 'Georgia', fontSize: 31, fontWeight: 'bold' });
  const xml = formats.exportMusicXML(score);
  assert.match(xml, /<credit-type>title<\/credit-type><credit-words[^>]*justify="left"/);
  assert.match(xml, /font-family="Georgia"/);
  assert.match(xml, /font-size="31"/);
  assert.match(xml, /font-weight="bold"/);
  assert.match(xml, /relative-x="18\.00"/);
  assert.match(xml, /relative-y="-12\.00"/);
});
