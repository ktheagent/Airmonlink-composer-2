const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { DocumentFileService } = require('./desktop/file-service');
const { ShutdownCoordinator, withBoundedWait } = require('./desktop/shutdown-controller');
const { findAssociatedDocumentPath } = require('./desktop/associated-file');

let mainWindow;
let documentFiles;
let shutdownCoordinator;
let shutdownFinalizing = false;
let shutdownRequestActive = false;
let shutdownLogPath = null;
let rendererDocumentState = { dirty: false, title: 'Untitled Score', filePath: null };
let rendererReady = false;
let pendingAssociatedPath = findAssociatedDocumentPath(process.argv);
const primaryInstance = app.requestSingleInstanceLock();

function logWindowsValidation(stage, details = {}) {
  const target = process.env.AIRMONLINK_VALIDATION_LOG;
  if (!target) return;
  try {
    fsSync.appendFileSync(target, `${JSON.stringify({ timestamp: new Date().toISOString(), stage, ...details })}\n`, 'utf8');
  } catch (_) {}
}

function deliverAssociatedPath(filePath) {
  if (!filePath) return;
  pendingAssociatedPath = path.resolve(filePath);
  logWindowsValidation('associated-open-queued', { filePath: pendingAssociatedPath });
  if (!mainWindow || mainWindow.isDestroyed() || !rendererReady) return;
  const nextPath = pendingAssociatedPath;
  pendingAssociatedPath = null;
  mainWindow.webContents.send('app:open-document-path', { filePath: nextPath });
  logWindowsValidation('associated-open-sent', { filePath: nextPath });
}

function focusPrimaryWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function logShutdown(stage, details = {}) {
  const record = JSON.stringify({ timestamp: new Date().toISOString(), stage, ...details });
  try {
    if (shutdownLogPath) fsSync.appendFileSync(shutdownLogPath, `${record}\n`, 'utf8');
  } catch (_) {}
  if (process.argv.includes('--dev')) console.info(`[shutdown] ${record}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 960,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#071325',
    title: 'Airmonlink Composer',
    icon: path.join(__dirname, '..', 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      const staffKeyRules = await fs.readFile(path.join(__dirname, 'ui', 'staff-key-rules.css'), 'utf8');
      await mainWindow.webContents.insertCSS(staffKeyRules);
      logWindowsValidation('staff-key-rules-loaded');
    } catch (error) {
      logWindowsValidation('staff-key-rules-load-failed', { error: error?.message || String(error) });
      throw error;
    }
    logWindowsValidation('renderer-load-finished');
  });
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('close', event => {
    if (shutdownCoordinator?.approved) {
      logShutdown('window-close-accepted');
      return;
    }
    event.preventDefault();
    logShutdown('window-close-intercepted');
    void beginShutdown('window-close');
  });
  mainWindow.on('closed', () => {
    logShutdown('window-closed');
    rendererReady = false;
    mainWindow = null;
  });
}

async function chooseSavePath({ currentPath, defaultName, filters, saveAs }) {
  if (currentPath && !saveAs) return currentPath;
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: currentPath || defaultName,
    filters: filters || [{ name: 'All Files', extensions: ['*'] }]
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
}

async function confirmClose({ title } = {}) {
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: 'Unsaved changes',
    message: `Save changes to “${title || 'Untitled Score'}” before closing?`,
    detail: 'Save closes after the score is written successfully. Discard closes without saving. Cancel returns to the score.',
    buttons: ['Save', 'Discard', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  });
  return result.response === 0 ? 'save' : result.response === 1 ? 'discard' : 'cancel';
}

async function beginShutdown(reason = 'application-quit') {
  if (shutdownFinalizing || shutdownCoordinator?.approved) return true;
  if (shutdownRequestActive) {
    logShutdown('duplicate-shutdown-request', { reason });
    return false;
  }
  shutdownRequestActive = true;
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      shutdownFinalizing = true;
      app.quit();
      return true;
    }

    let decision = 'discard';
    if (rendererDocumentState.dirty) {
      decision = await confirmClose(rendererDocumentState);
      if (decision === 'cancel') {
        logShutdown('shutdown-canceled', { reason, stage: 'unsaved-prompt' });
        return false;
      }
    }

    const response = await shutdownCoordinator.request(reason, { decision });
    if (response.status === 'canceled') {
      logShutdown('shutdown-canceled', { reason });
      return false;
    }
    if (response.status !== 'approved') {
      logShutdown('shutdown-aborted', { reason, status: response.status });
      if (mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: 'Airmonlink Composer could not close safely',
          message: 'A background component did not finish its shutdown request in time.',
          detail: 'The application has remained open to protect your score. Stop playback or close any open dialog, then try again. Diagnostic details were written to the application shutdown log.',
          buttons: ['OK'],
          noLink: true
        }).catch(() => {});
      }
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:shutdown-abort', { requestId: response.requestId || null, reason, status: response.status });
      shutdownCoordinator.reset();
      return false;
    }

    shutdownFinalizing = true;
    logShutdown('main-cleanup-start', { reason, rendererDiagnostics: response.diagnostics || null });
    const lockResult = await withBoundedWait(
      () => documentFiles?.releaseAllLocks(),
      2500,
      'document-lock-release',
      logShutdown
    );
    logShutdown('main-cleanup-complete', { lockReleaseStatus: lockResult.status });

    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
    else app.quit();
    return true;
  } finally {
    if (!shutdownFinalizing) shutdownRequestActive = false;
  }
}

function registerIpc() {
  ipcMain.handle('document:save', async (_event, payload) => {
    if (shutdownCoordinator?.pending) shutdownCoordinator.extendTimeout(300000, 'save-dialog');
    const targetPath = await chooseSavePath(payload);
    if (shutdownCoordinator?.pending) shutdownCoordinator.extendTimeout(15000, 'post-save-cleanup');
    if (!targetPath) return { canceled: true };
    if (payload.currentPath && payload.currentPath !== targetPath) await documentFiles.releaseLock(payload.currentPath);
    const result = await documentFiles.saveDocument(targetPath, payload.content, { backup: true, overrideLock: Boolean(payload.overrideLock) });
    if (payload.documentId) await documentFiles.discardRecovery(payload.documentId);
    return { canceled: false, filePath: targetPath, backupCreated: result.backupCreated };
  });

  ipcMain.handle('document:open', async (_event, { filters } = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, ...(await documentFiles.openDocument(result.filePaths[0])) };
  });

  ipcMain.handle('document:openPath', async (_event, { filePath }) => {
    if (!filePath) throw new Error('No recent file was selected.');
    return { canceled: false, ...(await documentFiles.openDocument(filePath)) };
  });

  ipcMain.handle('document:release', async (_event, { filePath } = {}) => {
    await documentFiles.releaseLock(filePath);
    return true;
  });

  ipcMain.handle('document:recent', () => documentFiles.listRecent());
  ipcMain.handle('document:autosave', (_event, payload) => documentFiles.writeRecovery(payload));
  ipcMain.handle('document:recoveryList', () => documentFiles.listRecoveries());
  ipcMain.handle('document:recoveryRead', (_event, { documentId }) => documentFiles.readRecovery(documentId));
  ipcMain.handle('document:recoveryDiscard', (_event, { documentId }) => documentFiles.discardRecovery(documentId));

  ipcMain.handle('settings:get', () => documentFiles.getSettings());
  ipcMain.handle('settings:set', (_event, patch) => documentFiles.setSettings(patch || {}));

  ipcMain.handle('app:confirm-close', (_event, payload) => confirmClose(payload));
  ipcMain.on('app:document-state', (_event, payload = {}) => {
    rendererDocumentState = {
      dirty: Boolean(payload.dirty),
      title: String(payload.title || 'Untitled Score'),
      filePath: payload.filePath || null
    };
  });
  ipcMain.on('app:request-quit', () => { void beginShutdown('file-exit'); });
  ipcMain.on('app:renderer-ready', () => {
    rendererReady = true;
    logWindowsValidation('renderer-ready');
    deliverAssociatedPath(pendingAssociatedPath);
  });
  ipcMain.on('app:associated-open-result', (_event, payload = {}) => {
    logWindowsValidation('associated-open-result', {
      filePath: payload.filePath || null,
      success: Boolean(payload.success),
      error: payload.error || null
    });
  });
  ipcMain.on('app:shutdown-response', (_event, response) => shutdownCoordinator.receive(response));

  // Exporting is intentionally separate from document Save/Save As. It always asks for a destination.
  ipcMain.handle('file:save', async (_event, { content, defaultName, filters }) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: filters || [{ name: 'All Files', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await documentFiles.atomicWrite(result.filePath, Buffer.from(content, 'base64'), { backup: false });
    return { canceled: false, filePath: result.filePath };
  });

  // Legacy open API remains for preview-compatible renderer code.
  ipcMain.handle('file:open', async (_event, { filters }) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    const data = await fs.readFile(filePath);
    return { canceled: false, filePath, content: data.toString('base64') };
  });

  ipcMain.handle('app:openExternal', (_event, url) => shell.openExternal(url));
}

if (!primaryInstance) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    deliverAssociatedPath(findAssociatedDocumentPath(argv));
    focusPrimaryWindow();
  });
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    deliverAssociatedPath(filePath);
  });

  app.whenReady().then(async () => {
  logWindowsValidation('app-ready', { version: app.getVersion(), executable: process.execPath });
  documentFiles = new DocumentFileService({ userDataPath: app.getPath('userData') });
  await documentFiles.initialize();
  shutdownLogPath = path.join(app.getPath('userData'), 'shutdown.log');
  shutdownCoordinator = new ShutdownCoordinator({
    timeoutMs: 15000,
    logger: logShutdown,
    sendRequest: payload => {
      if (!mainWindow || mainWindow.isDestroyed()) throw new Error('The main window is unavailable.');
      mainWindow.webContents.send('app:shutdown-request', payload);
    }
  });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (!shutdownFinalizing && BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  });
}

app.on('before-quit', event => {
  if (!primaryInstance || shutdownCoordinator?.approved || shutdownFinalizing) return;
  event.preventDefault();
  logShutdown('before-quit-intercepted');
  void beginShutdown('application-quit');
});

app.on('will-quit', () => logShutdown('will-quit'));
app.on('quit', (_event, exitCode) => logShutdown('quit', { exitCode }));
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
