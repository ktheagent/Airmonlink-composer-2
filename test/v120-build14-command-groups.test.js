const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../src/ui/app.js'), 'utf8');

test('Build 14 defines every required functional tool group', () => {
  const required = ['FILE AND PROJECT','SELECTION AND CLIPBOARD','NOTE ENTRY','PITCH AND TONALITY','RHYTHM AND MEASURES','VOICES AND LAYERS','ARTICULATIONS AND EXPRESSION','TIES SLURS AND SPANNERS','LYRICS AND TEXT','HARMONY AND CHORDS','STAFF AND INSTRUMENTS','TONIC SOLFA','LAYOUT AND PAGES','PLAYBACK','IMPORT AND EXPORT','ACCESSIBILITY AND VIEW'];
  required.forEach(group => assert.match(source, new RegExp(`\\['${group.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}'`)));
});

test('generated group commands are backed by registered command handlers', () => {
  const catalogBlock = source.match(/const commandCatalog = \[([\s\S]*?)\n  \];/)[1];
  const groupBlock = source.match(/const functionalGroupDefinitions = \[([\s\S]*?)\n  \];/)[1];
  const actionBlock = source.match(/const actions = \{([\s\S]*?)\n    \};/)[1];
  const catalog = [...catalogBlock.matchAll(/\['([^']+)'\s*,/g)].map(match => match[1]);
  const grouped = new Set([...groupBlock.matchAll(/\['[^']+',\s*\[([^\]]*)\]\]/g)].flatMap(match => [...match[1].matchAll(/'([A-Za-z][A-Za-z0-9]+)'/g)].map(item => item[1])));
  const missingFromGroups = [...new Set(catalog)].filter(command => !grouped.has(command));
  assert.deepEqual(missingFromGroups, []);
  for (const command of grouped) assert.match(actionBlock, new RegExp(`(?:^|[,\\s])${command}(?:\\s*:|\\s*[,}])`), `${command} needs an executeCommand handler`);
});
