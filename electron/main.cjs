const { app, BrowserWindow, Menu, clipboard, ClipboardItem, dialog, ipcMain, protocol, net, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { VaultStore, defaults } = require('./vault.cjs');
const appIcon = path.join(app.isPackaged ? path.join(process.resourcesPath, 'icons') : path.join(__dirname, '../assets/icons'), process.platform === 'win32' ? 'fever.ico' : 'fever.png');
const customData = process.argv.find(arg => arg.startsWith('--fever-data='))?.slice('--fever-data='.length);
if (customData) app.setPath('userData', path.resolve(customData));
protocol.registerSchemesAsPrivileged([{ scheme: 'fever-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const store = new VaultStore();
let window, preferences = {}, timer, reopening;
const prefsFile = () => path.join(app.getPath('userData'), 'preferences.json');
async function persistPrefs() { await fs.writeFile(prefsFile(), JSON.stringify(preferences, null, 2)); }
function scheduleBackup() {
  clearInterval(timer);
  const s = preferences.settings;
  if (s?.autoCommit) timer = setInterval(async () => {
    if (!store.root) return;
    try { const status = await store.status(); if (status.changes.some(c => c.path === 'fever.json' || c.path === '.gitattributes' || c.path.startsWith('notes/') || c.path.startsWith('drawings/') || c.path.startsWith('images/'))) await store.commit(`backup: ${new Date().toISOString()}`); }
    catch (e) { window?.webContents.send('fever:backup-error', e.message); }
  }, Math.max(1, Number(s.interval) || 10) * 60000);
}
async function boot() {
  if (process.platform === 'darwin') app.dock.setIcon(appIcon);
  preferences = await fs.readFile(prefsFile(), 'utf8').then(JSON.parse).catch(() => ({}));
  ipcMain.handle('fever:readClipboard', async () => {
    const items = await clipboard.read();
    let text = '', html = '';
    for (const item of items) {
      if (item.types.includes('text/plain')) text += await (await item.getType('text/plain')).text();
      if (item.types.includes('text/html')) html += await (await item.getType('text/html')).text();
    }
    return { text, html };
  });
  ipcMain.handle('fever:writeClipboard', (_event, content) => {
    if (!content || typeof content.text !== 'string' || (content.html !== undefined && typeof content.html !== 'string')) throw new Error('无效的剪贴板内容');
    return clipboard.write([new ClipboardItem({ 'text/plain': content.text, ...(content.html ? { 'text/html': content.html } : {}) })]);
  });
  protocol.handle('fever-asset', async request => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'vault' || !/^\/images\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(png|jpe?g|gif|webp|avif)$/i.test(url.pathname) || !store.root) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(await store.safe(url.pathname.slice(1))).toString());
    } catch { return new Response('Not found', { status: 404 }); }
  });
  ipcMain.handle('fever:current', async () => {
    if (reopening) return reopening;
    if (store.root && store.manifest) return store.snapshot();
    if (preferences.vault) {
      reopening = store.open(preferences.vault).catch(() => null);
      try { return await reopening; } finally { reopening = null; }
    }
    return null;
  });
  ipcMain.handle('fever:open', async () => {
    const selection = await dialog.showOpenDialog(window, { title: '选择你的 Fever 笔记库', properties: ['openDirectory', 'createDirectory'] });
    if (selection.canceled) return null;
    const vault = await store.open(selection.filePaths[0]); preferences.vault = vault.path; await persistPrefs(); return vault;
  });
  for (const method of ['read', 'search', 'cancelSearch', 'save', 'create', 'update', 'remove', 'restoreTrash', 'category', 'removeCategory', 'image', 'completeImageImport', 'localizeImages', 'status', 'diff', 'stage', 'unstage', 'stageAll', 'unstageAll', 'discard', 'discardAll', 'openFile', 'saveFile', 'commit', 'pull', 'push', 'history', 'revision', 'revisionComparison', 'restore']) {
    ipcMain.handle(`fever:${method}`, (_event, ...args) => store[method](...args));
  }
  ipcMain.handle('fever:importNotes', async () => {
    const selection = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Markdown / Excalidraw', extensions: ['md', 'markdown', 'excalidraw'] }] });
    const result = []; if (!selection.canceled) for (const file of selection.filePaths) result.push(await store.importFile(file)); return result;
  });
  ipcMain.handle('fever:settings', async () => ({ ...defaults, ...preferences.settings, ...await store.settings(), autoCommit: preferences.settings?.autoCommit || false, interval: preferences.settings?.interval || 10 }));
  ipcMain.handle('fever:configure', async (_event, settings) => { await store.configure(settings); preferences.settings = { autoCommit: Boolean(settings.autoCommit), interval: Math.min(1440, Math.max(1, Number(settings.interval) || 10)) }; await persistPrefs(); scheduleBackup(); });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: '文件', submenu: [
      { id: 'close-tab', label: '关闭标签页', accelerator: 'CommandOrControl+W', click: (_item, focusedWindow) => focusedWindow?.webContents.send('fever:close-tab') },
      { role: 'close', label: '关闭窗口', accelerator: 'CommandOrControl+Shift+W' },
      ...(process.platform === 'darwin' ? [] : [{ type: 'separator' }, { role: 'quit' }]),
    ] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    process.platform === 'darwin' ? { role: 'windowMenu' } : { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
  ]));
  await createWindow();
}
async function createWindow() {
  window = new BrowserWindow({ width: 1480, height: 950, minWidth: 960, minHeight: 680, backgroundColor: '#f8f9f5', title: 'Fever', icon: appIcon, autoHideMenuBar: true,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 16, y: 18 } } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.on('before-input-event', (event, input) => {
    const modifier = process.platform === 'darwin' ? input.meta : input.control;
    if (input.type === 'keyDown' && modifier && !input.shift && !input.alt && input.key.toLowerCase() === 'w') {
      event.preventDefault();
      if (!input.isAutoRepeat) window.webContents.send('fever:close-tab');
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => { const current = window.webContents.getURL(); if (url.split('#')[0] !== current.split('#')[0]) event.preventDefault(); });
  if (app.isPackaged) await window.loadFile(path.join(__dirname, '../dist/index.html')); else await window.loadURL('http://127.0.0.1:5173');
  scheduleBackup();
  window.on('closed', () => { window = null; });
}
app.whenReady().then(boot);
app.on('window-all-closed', () => { clearInterval(timer); if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!window) createWindow(); });
app.on('before-quit', () => clearInterval(timer));
