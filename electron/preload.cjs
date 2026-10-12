const { contextBridge, ipcRenderer } = require('electron');
const call = method => (...args) => ipcRenderer.invoke(`fever:${method}`, ...args);
contextBridge.exposeInMainWorld('fever', {
  desktop: true,
  readClipboard: call('readClipboard'),
  writeClipboard: call('writeClipboard'),
  onBackupError: callback => { const listener = (_event, message) => callback(message); ipcRenderer.on('fever:backup-error', listener); return () => ipcRenderer.removeListener('fever:backup-error', listener); },
  ...Object.fromEntries(['current', 'open', 'read', 'search', 'cancelSearch', 'save', 'create', 'update', 'remove', 'category', 'importNotes', 'image', 'status', 'diff', 'stage', 'unstage', 'discard', 'openFile', 'saveFile', 'commit', 'pull', 'push', 'history', 'revision', 'restore', 'settings', 'configure'].map(method => [method, call(method)])),
  asset: src => /^https?:\/\//i.test(src) ? src : /^\.\.\/images\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(png|jpe?g|gif|webp|avif)$/i.test(src) ? `fever-asset://vault/${src.slice(3)}` : '',
});
