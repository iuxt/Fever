const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function exportDocument({ BrowserWindow, dialog }, parent, document) {
 if (!document || !['pdf', 'html', 'md', 'excalidraw'].includes(document.format) || typeof document.filename !== 'string' || typeof document.content !== 'string') throw new Error('无效的导出文档');
 const { format, filename, content, pageSize = 'A4', landscape = false } = document;
 if (!['A4', 'A3', 'A5', 'Letter'].includes(pageSize) || typeof landscape !== 'boolean') throw new Error('无效的导出页面设置');
 const label = format === 'md' ? 'Markdown' : format === 'excalidraw' ? 'Excalidraw' : format.toUpperCase();
 if (!filename || /[<>:"/\\|?*\u0000-\u001f]/.test(filename) || !filename.endsWith(`.${format}`)) throw new Error('无效的导出文件名');
 const selection = await dialog.showSaveDialog(parent, {
  title: `导出 ${label}`,
  defaultPath: filename,
  filters: [{ name: label, extensions: [format] }],
 });
 if (selection.canceled || !selection.filePath) return 'canceled';
 if (format !== 'pdf') { await fs.writeFile(selection.filePath, content, 'utf8'); return 'saved'; }
 let printWindow, directory;
 try {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-export-'));
  const source = path.join(directory, 'document.html');
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'">`;
  await fs.writeFile(source, '<!DOCTYPE html>' + policy + content.replace(/^<!doctype html>\s*/i, ''), { mode: 0o600 });
  printWindow = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: {
   sandbox: true, contextIsolation: true, nodeIntegration: false,
   partition: 'fever-export',
  } });
  const sourceUrl = pathToFileURL(source).href;
  // The print renderer needs only this document and its embedded image/font data.
  printWindow.webContents.session.webRequest.onBeforeRequest((request, callback) => callback({ cancel: request.url !== sourceUrl && !request.url.startsWith('data:') }));
  printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  printWindow.webContents.on('will-navigate', event => event.preventDefault());
  await printWindow.loadFile(source);
  await printWindow.webContents.executeJavaScript(`(async () => {
   await document.fonts.ready;
   await Promise.all(Array.from(document.images).map(image => image.decode()));
  })()`);
  const pdf = await printWindow.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, pageSize, landscape, displayHeaderFooter: false });
  await fs.writeFile(selection.filePath, pdf);
  return 'saved';
 } finally {
  if (printWindow && !printWindow.isDestroyed()) {
   printWindow.webContents.session.webRequest.onBeforeRequest(null);
   printWindow.destroy();
  }
  if (directory) await fs.rm(directory, { recursive: true, force: true });
 }
}
module.exports = { exportDocument };
