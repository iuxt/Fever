const { contextBridge, ipcRenderer } = require('electron');
const call = method => (...args) => ipcRenderer.invoke(`fever:${method}`, ...args);
contextBridge.exposeInMainWorld('fever', {
  desktop: true,
  platform: process.platform,
  onCloseTab: callback => { const listener = () => callback(); ipcRenderer.on('fever:close-tab', listener); return () => ipcRenderer.removeListener('fever:close-tab', listener); },
  readClipboard: call('readClipboard'),
  writeClipboard: call('writeClipboard'),
  exportNote: call('exportNote'),
  onBackupError: callback => { const listener = (_event, message) => callback(message); ipcRenderer.on('fever:backup-error', listener); return () => ipcRenderer.removeListener('fever:backup-error', listener); },
  onAutoPull: callback => { const listener = () => callback(); ipcRenderer.on('fever:auto-pull', listener); return () => ipcRenderer.removeListener('fever:auto-pull', listener); },
  ...Object.fromEntries(['current', 'open', 'read', 'search', 'cancelSearch', 'save', 'create', 'update', 'remove', 'restoreTrash', 'category', 'removeCategory', 'importNotes', 'image', 'completeImageImport', 'localizeImages', 'status', 'diff', 'stage', 'unstage', 'stageAll', 'unstageAll', 'discard', 'discardAll', 'openFile', 'saveFile', 'commit', 'pull', 'push', 'history', 'revision', 'revisionComparison', 'restore', 'settings', 'configure'].map(method => [method, call(method)])),
  asset: (src, revision) => {
    // Remote URLs have no Git blob and retain their original URL in historical Markdown.
    if (/^https?:\/\//i.test(src)) return src;
    if (revision) return `fever-asset://vault/revision?${new URLSearchParams({ note: revision.id, commit: revision.hash, src, ...(revision.wiki ? { wiki: '1' } : {}) })}`;
    return /^\.\.\/images\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(png|jpe?g|gif|webp|avif)$/i.test(src) ? `fever-asset://vault/${src.slice(3)}` : '';
  },
});
