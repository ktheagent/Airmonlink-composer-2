const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ShutdownCoordinator, withBoundedWait } = require('../src/desktop/shutdown-controller');
const { PlaybackEngine } = require('../src/core/playback');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

test('shutdown coordinator sends one renderer request and ignores duplicate close requests', async () => {
  const sent = [];
  const coordinator = new ShutdownCoordinator({ timeoutMs: 1000, sendRequest: payload => sent.push(payload) });
  const first = coordinator.request('window-close', { decision: 'discard' });
  const second = coordinator.request('file-exit', { decision: 'discard' });
  assert.equal(first, second);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].reason, 'window-close');
  assert.equal(sent[0].decision, 'discard');
  coordinator.receive({ requestId: sent[0].requestId, status: 'approved', diagnostics: [] });
  assert.equal((await first).status, 'approved');
  assert.equal(coordinator.approved, true);
});

test('cancelled renderer shutdown leaves the application eligible for another attempt', async () => {
  const sent = [];
  const coordinator = new ShutdownCoordinator({ timeoutMs: 1000, sendRequest: payload => sent.push(payload) });
  const first = coordinator.request('window-close');
  coordinator.receive({ requestId: sent[0].requestId, status: 'canceled' });
  assert.equal((await first).status, 'canceled');
  assert.equal(coordinator.approved, false);
  const second = coordinator.request('window-close');
  assert.equal(sent.length, 2);
  coordinator.receive({ requestId: sent[1].requestId, status: 'approved' });
  assert.equal((await second).status, 'approved');
});

test('shutdown waits are bounded and report a timeout instead of hanging indefinitely', async () => {
  const started = Date.now();
  const result = await withBoundedWait(() => new Promise(() => {}), 35, 'stuck-worker');
  const elapsed = Date.now() - started;
  assert.equal(result.status, 'timeout');
  assert.ok(elapsed >= 25 && elapsed < 500, `bounded wait took ${elapsed} ms`);
});

test('save dialog can extend the coordinator timeout without losing the pending request', async () => {
  const sent = [];
  const coordinator = new ShutdownCoordinator({ timeoutMs: 30, sendRequest: payload => sent.push(payload) });
  const pending = coordinator.request('window-close', { decision: 'save' });
  coordinator.extendTimeout(250, 'save-dialog');
  await sleep(60);
  assert.ok(coordinator.pending);
  coordinator.receive({ requestId: sent[0].requestId, status: 'approved' });
  assert.equal((await pending).status, 'approved');
});

test('playback shutdown stops sounding nodes, clears timers and closes the audio context', async () => {
  const engine = new PlaybackEngine();
  let stopped = 0;
  let closed = 0;
  engine.nodes = [{ stop() { stopped += 1; } }, { stop() { stopped += 1; } }];
  engine.timer = setInterval(() => {}, 1000);
  engine.playing = true;
  engine.context = { state: 'running', async close() { closed += 1; this.state = 'closed'; } };
  engine.onPosition = () => {};
  engine.onStop = () => {};
  await engine.shutdown();
  assert.equal(stopped, 2);
  assert.equal(closed, 1);
  assert.equal(engine.timer, null);
  assert.equal(engine.playing, false);
  assert.equal(engine.context, null);
  assert.equal(engine.onPosition, null);
  assert.equal(engine.onStop, null);
});

test('Electron lifecycle wiring removes the dirty beforeunload regression and provides File Exit', () => {
  const root = path.resolve(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'src/preload.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src/ui/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src/ui/index.html'), 'utf8');
  assert.match(main, /mainWindow\.on\('close'/);
  assert.match(main, /app\.on\('before-quit'/);
  assert.match(main, /releaseAllLocks/);
  assert.match(preload, /onShutdownRequest/);
  assert.match(preload, /respondToShutdown/);
  assert.match(renderer, /state\.playback\.shutdown\(\)/);
  assert.match(renderer, /closeMidiResources/);
  assert.match(renderer, /cancelAutosaveTasks/);
  assert.match(renderer, /if \(!window\.airmonDesktop && state\.dirty/);
  assert.doesNotMatch(renderer, /beforeunload[^\n]*saveAutosave\(\)/);
  assert.match(html, /data-command="exit">Exit</);
});
