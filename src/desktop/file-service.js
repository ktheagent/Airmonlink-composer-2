'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

class DocumentFileService {
  constructor(options = {}) {
    this.userDataPath = options.userDataPath || process.cwd();
    this.processId = Number(options.processId) || process.pid;
    this.hostname = options.hostname || os.hostname();
    this.now = options.now || (() => new Date());
    this.openLocks = new Set();
    this.settingsPath = path.join(this.userDataPath, 'settings.json');
    this.recentPath = path.join(this.userDataPath, 'recent-files.json');
    this.recoveryDir = path.join(this.userDataPath, 'recovery');
    this.backupDir = path.join(this.userDataPath, 'backups');
  }

  async initialize() {
    await fs.mkdir(this.userDataPath, { recursive: true });
    await fs.mkdir(this.recoveryDir, { recursive: true });
    await fs.mkdir(this.backupDir, { recursive: true });
  }

  normalizeError(error, targetPath = '') {
    const code = error?.code || 'UNKNOWN';
    const names = {
      EACCES: 'Permission denied', EPERM: 'The file is protected or currently in use',
      ENOSPC: 'The destination drive is full', EROFS: 'The destination is read-only',
      ENOENT: 'The file or folder no longer exists', EBUSY: 'The file is busy or locked by another application'
    };
    const message = names[code] || error?.message || 'Unknown file-system error';
    const wrapped = new Error(`${message}${targetPath ? `: ${targetPath}` : ''}`);
    wrapped.code = code;
    return wrapped;
  }

  async readJson(filePath, fallback) {
    try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return fallback; throw this.normalizeError(error, filePath); }
  }

  async atomicWrite(filePath, data, options = {}) {
    const directory = path.dirname(filePath);
    await fs.mkdir(directory, { recursive: true });
    const tempPath = path.join(directory, `.${path.basename(filePath)}.${this.processId}.${crypto.randomBytes(4).toString('hex')}.tmp`);
    let existed = false;
    try { await fs.access(filePath); existed = true; } catch (_) {}
    try {
      if (existed && options.backup !== false) await this.createBackup(filePath);
      const handle = await fs.open(tempPath, 'wx', 0o600);
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally { await handle.close(); }
      if (process.platform === 'win32' && existed) {
        const replacePath = `${filePath}.replace-${this.processId}`;
        try { await fs.rename(filePath, replacePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        try { await fs.rename(tempPath, filePath); }
        catch (error) { try { await fs.rename(replacePath, filePath); } catch (_) {} throw error; }
        await fs.rm(replacePath, { force: true });
      } else await fs.rename(tempPath, filePath);
      return { filePath, backupCreated: existed && options.backup !== false };
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw this.normalizeError(error, filePath);
    }
  }

  async createBackup(filePath) {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    const name = `${path.basename(filePath)}.${stamp}.bak`;
    const backupPath = path.join(this.backupDir, name);
    await fs.copyFile(filePath, backupPath);
    const entries = (await fs.readdir(this.backupDir, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.startsWith(`${path.basename(filePath)}.`)).sort((a, b) => b.name.localeCompare(a.name));
    await Promise.all(entries.slice(20).map(entry => fs.rm(path.join(this.backupDir, entry.name), { force: true })));
    return backupPath;
  }

  lockPath(filePath) { return `${filePath}.airmonlock`; }

  async inspectLock(filePath) {
    const lockPath = this.lockPath(filePath);
    try {
      const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
      if (lock.hostname === this.hostname && Number(lock.pid) === this.processId) return { locked: false, owned: true, lock };
      let active = true;
      if (lock.hostname === this.hostname && Number.isInteger(Number(lock.pid))) {
        try { process.kill(Number(lock.pid), 0); } catch (_) { active = false; }
      }
      if (!active) { await fs.rm(lockPath, { force: true }); return { locked: false, stale: true, lock }; }
      return { locked: true, owned: false, lock };
    } catch (error) {
      if (error.code === 'ENOENT') return { locked: false, owned: false };
      return { locked: true, owned: false, invalid: true, error: error.message };
    }
  }

  async acquireLock(filePath) {
    const status = await this.inspectLock(filePath);
    if (status.locked) return status;
    const lock = { pid: this.processId, hostname: this.hostname, openedAt: this.now().toISOString(), filePath };
    try {
      await fs.writeFile(this.lockPath(filePath), JSON.stringify(lock, null, 2), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code === 'EEXIST') return this.inspectLock(filePath);
      throw this.normalizeError(error, filePath);
    }
    this.openLocks.add(filePath);
    return { locked: false, owned: true, lock };
  }

  async releaseLock(filePath) {
    if (!filePath) return;
    const status = await this.inspectLock(filePath);
    if (status.owned) await fs.rm(this.lockPath(filePath), { force: true });
    this.openLocks.delete(filePath);
  }

  async releaseAllLocks() {
    await Promise.all([...this.openLocks].map(filePath => this.releaseLock(filePath).catch(() => {})));
  }

  async openDocument(filePath, options = {}) {
    let data;
    try { data = await fs.readFile(filePath); }
    catch (error) { throw this.normalizeError(error, filePath); }
    const lock = await this.acquireLock(filePath);
    const stat = await fs.stat(filePath);
    let writable = true;
    try { await fs.access(filePath, constants.W_OK); } catch (_) {
      try { await fs.access(path.dirname(filePath), 2); } catch (_) { writable = false; }
    }
    await this.addRecent(filePath);
    return {
      filePath,
      content: data.toString('base64'),
      readOnly: Boolean(lock.locked || !writable || options.readOnly),
      lock,
      modifiedAt: stat.mtime.toISOString()
    };
  }

  async saveDocument(filePath, base64Content, options = {}) {
    const lock = await this.inspectLock(filePath);
    if (lock.locked && !options.overrideLock) {
      const error = new Error(`This score is open in another Airmonlink Composer session on ${lock.lock?.hostname || 'another computer'}.`);
      error.code = 'FILE_LOCKED';
      throw error;
    }
    const buffer = Buffer.from(base64Content, 'base64');
    const result = await this.atomicWrite(filePath, buffer, { backup: options.backup !== false });
    await this.acquireLock(filePath);
    await this.addRecent(filePath);
    return result;
  }

  async addRecent(filePath) {
    const recent = await this.readJson(this.recentPath, []);
    const now = this.now().toISOString();
    const next = [{ filePath, name: path.basename(filePath), openedAt: now }, ...recent.filter(item => item.filePath !== filePath)].slice(0, 20);
    await this.atomicWrite(this.recentPath, JSON.stringify(next, null, 2), { backup: false });
    return next;
  }

  async listRecent() {
    const recent = await this.readJson(this.recentPath, []);
    const output = [];
    for (const item of recent) {
      try { const stat = await fs.stat(item.filePath); output.push({ ...item, exists: true, modifiedAt: stat.mtime.toISOString() }); }
      catch (_) { output.push({ ...item, exists: false }); }
    }
    return output;
  }

  recoveryPath(documentId) {
    const safe = String(documentId || 'untitled').replace(/[^a-zA-Z0-9_-]/g, '-');
    return path.join(this.recoveryDir, `${safe}.recovery.json`);
  }

  async writeRecovery(record) {
    const payload = {
      version: 1,
      documentId: record.documentId,
      title: record.title || 'Untitled Score',
      originalPath: record.originalPath || null,
      savedAt: this.now().toISOString(),
      content: record.content,
      baselineChecksum: record.baselineChecksum || null
    };
    await this.atomicWrite(this.recoveryPath(record.documentId), JSON.stringify(payload), { backup: false });
    return { ...payload, content: undefined };
  }

  async listRecoveries() {
    await fs.mkdir(this.recoveryDir, { recursive: true });
    const files = (await fs.readdir(this.recoveryDir)).filter(name => name.endsWith('.recovery.json'));
    const records = [];
    for (const name of files) {
      try {
        const payload = JSON.parse(await fs.readFile(path.join(this.recoveryDir, name), 'utf8'));
        records.push({ documentId: payload.documentId, title: payload.title, originalPath: payload.originalPath, savedAt: payload.savedAt, baselineChecksum: payload.baselineChecksum });
      } catch (_) {}
    }
    return records.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  }

  async readRecovery(documentId) {
    return this.readJson(this.recoveryPath(documentId), null);
  }

  async discardRecovery(documentId) {
    await fs.rm(this.recoveryPath(documentId), { force: true });
    return true;
  }

  async clearRecoveryForPath(filePath) {
    const records = await this.listRecoveries();
    await Promise.all(records.filter(record => record.originalPath === filePath).map(record => this.discardRecovery(record.documentId)));
  }

  async getSettings() { return this.readJson(this.settingsPath, {}); }

  async setSettings(patch) {
    const current = await this.getSettings();
    const next = { ...current, ...patch };
    await this.atomicWrite(this.settingsPath, JSON.stringify(next, null, 2), { backup: false });
    return next;
  }
}

module.exports = { DocumentFileService };
