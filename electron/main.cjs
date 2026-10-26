const { app, BrowserWindow, Menu, clipboard, ClipboardItem, dialog, ipcMain, protocol, net, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { VaultStore, defaults } = require('./vault.cjs');
const { exportDocument } = require('./export.cjs');
const appIcon = path.join(app.isPackaged ? path.join(process.resourcesPath, 'icons') : path.join(__dirname, '../assets/icons'), process.platform === 'win32' ? 'fever.ico' : 'fever.png');
const customData = process.argv.find(arg => arg.startsWith('--fever-data='))?.slice('--fever-data='.length);
if (customData) app.setPath('userData', path.resolve(customData));
protocol.registerSchemesAsPrivileged([{ scheme: 'fever-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const store = new VaultStore();
store.onMetadataError = message => { if (window && !window.isDestroyed()) window.webContents.send('fever:save-error', message); };
let window, preferences = {}, timer, pullTimer, reopening;
const prefsFile = () => path.join(app.getPath('userData'), 'preferences.json');
async function persistPrefs() { await fs.writeFile(prefsFile(), JSON.stringify(preferences, null, 2)); }
const intervalMinutes = value => Math.min(1440, Math.max(1, Math.round(Number(value) || 10)));
const automationSettings = (settings = {}) => ({ autoCommit: Boolean(settings.autoCommit), interval: intervalMinutes(settings.interval), autoPull: Boolean(settings.autoPull), pullInterval: intervalMinutes(settings.pullInterval) });
function schedulePull() {
  clearInterval(pullTimer);
  const settings = automationSettings(preferences.settings);
  // The renderer owns the workspace lock and pending drafts, so it decides
  // whether each scheduled pull can safely proceed.
  if (settings.autoPull) pullTimer = setInterval(() => {
    if (store.root && window && !window.isDestroyed()) window.webContents.send('fever:auto-pull');
  }, settings.pullInterval * 60000);
}
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
  ipcMain.handle('fever:flushMetadata', () => store.flushMetadata());
  ipcMain.handle('fever:preview', (_event, ...args) => store.preview(...args));
  ipcMain.handle('fever:cancelPreview', (_event, requestId) => store.cancelPreview(requestId));
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
      if (url.hostname !== 'vault' || !store.root) return new Response('Not found', { status: 404 });
      let response;
      if (url.pathname === '/revision') {
        const image = await store.revisionImage(url.searchParams.get('note'), url.searchParams.get('commit'), url.searchParams.get('src'), url.searchParams.get('wiki') === '1');
        response = new Response(image.bytes, { headers: { 'Content-Type': image.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
      } else {
        if (!/^\/images\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(png|jpe?g|gif|webp|avif)$/i.test(url.pathname)) return new Response('Not found', { status: 404 });
        response = await net.fetch(pathToFileURL(await store.safe(url.pathname.slice(1))).toString());
      }
      const headers = new Headers(response.headers);
      const origin = request.headers.get('Origin');
      if (origin === 'http://127.0.0.1:5173' || origin === 'null' || origin === 'file://') headers.set('Access-Control-Allow-Origin', origin);
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  let exporting = false;
  ipcMain.handle('fever:exportNote', async (event, document) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('无效的导出请求');
    if (exporting) throw new Error('已有导出正在进行');
    exporting = true;
    try { return await exportDocument({ BrowserWindow, dialog }, window, document); }
    finally { exporting = false; }
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
  for (const method of ['read', 'search', 'cancelSearch', 'save', 'create', 'update', 'remove', 'restoreTrash', 'category', 'moveCategory', 'removeCategory', 'image', 'completeImageImport', 'localizeImages', 'status', 'diff', 'stage', 'unstage', 'stageAll', 'unstageAll', 'discard', 'discardAll', 'openFile', 'saveFile', 'commit', 'pull', 'pullDiff', 'push', 'history', 'revision', 'revisionComparison', 'restore']) {
    ipcMain.handle(`fever:${method}`, (_event, ...args) => store[method](...args));
  }
  ipcMain.handle('fever:importNotes', async () => {
    const selection = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Markdown / Excalidraw', extensions: ['md', 'markdown', 'excalidraw'] }] });
    const result = []; if (!selection.canceled) for (const file of selection.filePaths) result.push(await store.importFile(file)); return result;
  });
  ipcMain.handle('fever:settings', async () => ({ ...defaults, ...await store.settings(), ...automationSettings(preferences.settings) }));
  ipcMain.handle('fever:configure', async (_event, settings) => { await store.configure(settings); preferences.settings = automationSettings(settings); await persistPrefs(); scheduleBackup(); schedulePull(); });
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
  window.webContents.on('will-prevent-unload', () => { metadataFlushedForQuit = false; scheduleBackup(); schedulePull(); });
  if (app.isPackaged) await window.loadFile(path.join(__dirname, '../dist/index.html')); else await window.loadURL('http://127.0.0.1:5173');
  scheduleBackup();
  schedulePull();
  window.on('closed', () => { window = null; });
}
app.whenReady().then(boot);
app.on('window-all-closed', () => { clearInterval(timer); clearInterval(pullTimer); if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!window) createWindow(); });
let metadataFlushedForQuit = false;
app.on('before-quit', event => {
  clearInterval(timer); clearInterval(pullTimer);
  if (metadataFlushedForQuit) return;
  event.preventDefault();
  store.flushMetadata().then(() => { metadataFlushedForQuit = true; app.quit(); }).catch(error => dialog.showErrorBox('保存更新时间失败', error.message));
});
