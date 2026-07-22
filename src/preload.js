const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('airmonDesktop', {
  saveDocument: payload => ipcRenderer.invoke('document:save', payload),
  openDocument: payload => ipcRenderer.invoke('document:open', payload),
  openRecent: filePath => ipcRenderer.invoke('document:openPath', { filePath }),
  releaseDocument: filePath => ipcRenderer.invoke('document:release', { filePath }),
  listRecent: () => ipcRenderer.invoke('document:recent'),
  autosaveDocument: payload => ipcRenderer.invoke('document:autosave', payload),
  listRecoveries: () => ipcRenderer.invoke('document:recoveryList'),
  readRecovery: documentId => ipcRenderer.invoke('document:recoveryRead', { documentId }),
  discardRecovery: documentId => ipcRenderer.invoke('document:recoveryDiscard', { documentId }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: patch => ipcRenderer.invoke('settings:set', patch),
  saveFile: payload => ipcRenderer.invoke('file:save', payload),
  openFile: payload => ipcRenderer.invoke('file:open', payload),
  openExternal: url => ipcRenderer.invoke('app:openExternal', url),
  confirmClose: payload => ipcRenderer.invoke('app:confirm-close', payload),
  updateDocumentState: payload => ipcRenderer.send('app:document-state', payload),
  requestQuit: () => ipcRenderer.send('app:request-quit'),
  notifyRendererReady: () => ipcRenderer.send('app:renderer-ready'),
  reportAssociatedOpenResult: payload => ipcRenderer.send('app:associated-open-result', payload),
  onOpenDocumentPath: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:open-document-path', listener);
    return () => ipcRenderer.removeListener('app:open-document-path', listener);
  },
  respondToShutdown: payload => ipcRenderer.send('app:shutdown-response', payload),
  onShutdownRequest: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:shutdown-request', listener);
    return () => ipcRenderer.removeListener('app:shutdown-request', listener);
  },
  onShutdownAbort: callback => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:shutdown-abort', listener);
    return () => ipcRenderer.removeListener('app:shutdown-abort', listener);
  },
  platform: process.platform
});
