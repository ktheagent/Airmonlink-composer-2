const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
require('../src/core/music-theory');
const model = require('../src/core/score-model');
const { HistoryManager } = require('../src/core/history');
const { SelectionModel, idsInRect } = require('../src/core/selection');
const editing = require('../src/core/editing');
const { DocumentFileService } = require('../src/desktop/file-service');

test('transaction history stores structural patches and restores edits', () => {
  const score = model.createScore({ template: 'lead', measures: 2 });
  const history = new HistoryManager(20);
  history.snapshot(score, 'Initial');
  history.snapshot(score, 'Checkpoint');
  const note = model.addNote(score, score.parts[0].id, { midi: 60, start: 0, duration: 1 });
  history.snapshot(score, 'Add note');
  assert.equal(history.canUndo, true);
  assert.ok(history.estimatedBytes < JSON.stringify(score).length * 3);
  const undone = history.undo(score);
  assert.equal(undone.parts[0].events.some(event => event.id === note.id), false);
  const redone = history.redo(undone);
  assert.equal(redone.parts[0].events.some(event => event.id === note.id), true);
});

test('selection supports additive events and marquee geometry', () => {
  const selection = new SelectionModel();
  selection.selectEvent('a').selectEvent('b', { additive: true });
  assert.deepEqual([...selection.eventIds].sort(), ['a', 'b']);
  selection.selectEvent('a', { toggle: true, additive: true });
  assert.deepEqual([...selection.eventIds], ['b']);
  assert.deepEqual(idsInRect([
    { id: 'one', box: { x1: 10, y1: 10, x2: 20, y2: 20 } },
    { id: 'two', box: { x1: 40, y1: 40, x2: 50, y2: 50 } }
  ], { x1: 5, y1: 5, x2: 25, y2: 25 }), ['one']);
});

test('copy paste transpose and delete operate on a multi-event selection', () => {
  const score = model.createScore({ template: 'lead', measures: 4 });
  const part = score.parts[0];
  const one = model.addNote(score, part.id, { midi: 60, start: 0, duration: 1 });
  const two = model.addNote(score, part.id, { midi: 64, start: 1, duration: 1 });
  const selection = new SelectionModel();
  selection.selectEvents([one.id, two.id]);
  const clipboard = editing.makeClipboard(score, selection);
  const pasted = editing.pasteClipboard(score, clipboard, { start: 4, partId: part.id, voice: 2 });
  assert.equal(pasted.length, 2);
  const pastedSelection = new SelectionModel();
  pastedSelection.selectEvents(pasted.map(item => item.event.id));
  assert.equal(editing.transposeSelection(score, pastedSelection, 2), 2);
  assert.deepEqual(pasted.map(item => item.event.midi), [62, 66]);
  assert.equal(editing.deleteSelection(score, pastedSelection), 2);
  assert.equal(part.events.filter(event => event.type === 'note').length, 2);
});

test('a note crossing a barline is split into tied segments', () => {
  const score = model.createScore({ template: 'lead', measures: 3, timeSignature: '4/4' });
  const part = score.parts[0];
  const notes = editing.addNoteAcrossBarlines(score, part.id, { midi: 60, start: 3, duration: 3, voice: 1 });
  assert.equal(notes.length, 2);
  assert.deepEqual(notes.map(note => [note.start, note.duration, note.tieStop, note.tieStart]), [
    [3, 1, false, true],
    [4, 2, true, false]
  ]);
  assert.equal(notes[0].tieGroupId, notes[1].tieGroupId);
});

test('desktop file service saves atomically, backs up, locks, tracks recent files and recovers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'airmon-file-service-'));
  const service = new DocumentFileService({ userDataPath: root, hostname: 'host-a', processId: process.pid, now: (() => {
    let index = 0;
    return () => new Date(Date.UTC(2026, 6, 19, 10, 0, index++));
  })() });
  await service.initialize();
  const documentPath = path.join(root, 'works', 'Hymn.airscore');
  await service.saveDocument(documentPath, Buffer.from('first').toString('base64'));
  await service.saveDocument(documentPath, Buffer.from('second').toString('base64'));
  assert.equal(await fs.readFile(documentPath, 'utf8'), 'second');
  const backups = await fs.readdir(path.join(root, 'backups'));
  assert.equal(backups.length, 1);
  const opened = await service.openDocument(documentPath);
  assert.equal(opened.readOnly, false);
  const other = new DocumentFileService({ userDataPath: root, hostname: 'remote-host', processId: process.pid + 1000 });
  await other.initialize();
  const lock = await other.inspectLock(documentPath);
  assert.equal(lock.locked, true);
  const recent = await service.listRecent();
  assert.equal(recent[0].filePath, documentPath);
  await service.writeRecovery({ documentId: 'score-1', title: 'Hymn', originalPath: documentPath, content: '{"recovered":true}' });
  assert.equal((await service.listRecoveries()).length, 1);
  assert.equal((await service.readRecovery('score-1')).title, 'Hymn');
  await service.discardRecovery('score-1');
  assert.equal((await service.listRecoveries()).length, 0);
  await service.releaseAllLocks();
  await fs.rm(root, { recursive: true, force: true });
});

test('current airscore schema keeps application workspace settings outside score content', () => {
  const airscore = require('../src/core/airscore');
  const score = model.createScore({ template: 'lead' });
  score.settings.workspace = 'advanced';
  const payload = JSON.parse(airscore.serialize(score));
  assert.equal(payload.version, 9);
  assert.equal(payload.schema, 'airscore-v10');
  assert.equal(payload.score.settings.workspace, undefined);
  const reopened = airscore.deserialize(payload);
  assert.equal(reopened.formatVersion, 9);
  assert.equal(reopened.settings.workspace, undefined);
});
