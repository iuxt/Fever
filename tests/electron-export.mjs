import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { VaultStore } = require('../electron/vault.cjs');
const scratch = await mkdtemp(path.join(tmpdir(), 'fever-export-test-'));
const vaultPath = path.join(scratch, 'vault'), data = path.join(scratch, 'data');
await mkdir(vaultPath); await mkdir(data);
const store = new VaultStore();
await store.open(vaultPath);
const note = await store.create('中文导出测试', '测试');
const image = await store.image([...Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N3IAAAAASUVORK5CYII=', 'base64')], 'pixel.png', note.id);
const drawing = await store.create('嵌入绘图', '测试', 'excalidraw');
await store.save(drawing.id, JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id: 'rectangle', type: 'rectangle', x: 0, y: 0, width: 180, height: 90 }], appState: { viewBackgroundColor: '#ffffff' }, files: {} }));
const content = '# 中文导出测试\n\n中文正文与 **粗体**。\n\n- [x] 已完成\n\n| 项目 | 数量 |\n| --- | --- |\n| 中文笔记 | 2 |\n\n```js\nconst answer = 42;\n```\n\n![本地图片](' + image + ')\n\n![嵌入绘图](../drawings/' + drawing.filename + ')\n\n' + Array.from({ length: 32 }, (_, index) => `第 ${index + 1} 段：这是用来检查分页的中文内容。导出应保持可读的段落、行距和页边距。\n\n`).join('');
await store.save(note.id, content);
await writeFile(path.join(data, 'preferences.json'), JSON.stringify({ vault: vaultPath }));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
 app = await electron.launch({ args: ['.', `--fever-data=${data}`], env });
 const page = await app.firstWindow();
 if (process.env.FEVER_EXPORT_FILE) {
  await expect(page.locator('.note-row').filter({ hasText: '中文导出测试' })).toBeVisible();
  await app.evaluate(({ BrowserWindow }, file) => BrowserWindow.getAllWindows()[0].loadFile(file), path.resolve('dist/index.html'));
 }
 const errors = []; page.on('pageerror', error => errors.push(error.message));
 page.on('console', message => { if (message.type() === 'error') console.log(message.text()); });
 await page.locator('.note-row').filter({ hasText: '中文导出测试' }).click();
 await expect(page.locator('.wysiwyg-content')).toBeVisible();
 const exportTo = async (format, file) => {
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => file ? ({ canceled: false, filePath: file }) : ({ canceled: true }); }, file);
  await page.getByTitle('更多笔记操作', { exact: true }).click();
  await page.getByRole('button', { name: '导出…', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: '文件格式' }).click();
  await dialog.getByRole('option', { name: new RegExp(`^${format} `) }).click();
  if (format === 'PDF') {
   await dialog.getByRole('combobox', { name: '纸张大小' }).click();
   await dialog.getByRole('option', { name: /^A5/ }).click();
   await dialog.getByRole('combobox', { name: '页面方向' }).click();
   await dialog.getByRole('option', { name: '横向', exact: true }).click();
  }
  await dialog.getByRole('button', { name: '导出', exact: true }).click();
  if (file) await expect(page.locator('.toast')).toContainText(`已导出 ${format}`, { timeout: 20000 });
  else {
   await expect(page.locator('.toast')).toHaveCount(0);
   await dialog.getByRole('button', { name: '取消', exact: true }).click();
  }
 };
 await exportTo('Markdown', null);
 await exportTo('Markdown', path.join(scratch, 'note.md'));
 assert.equal(await readFile(path.join(scratch, 'note.md'), 'utf8'), content);
 await exportTo('HTML', path.join(scratch, 'note.html'));
 const html = await readFile(path.join(scratch, 'note.html'), 'utf8');
 assert.match(html, /data:image\/png;base64,/);
 assert.match(html, /data:image\/svg\+xml;base64,/);
 await exportTo('PDF', path.join(scratch, 'note.pdf'));
 const pdf = await readFile(path.join(scratch, 'note.pdf'));
 assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
 assert.ok(pdf.length > 5000);
 const mediaBox = pdf.toString('latin1').match(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/);
 assert.ok(mediaBox, 'PDF should have a page size');
 assert.ok(Math.abs(Number(mediaBox[1]) - 595.28) < 2 && Math.abs(Number(mediaBox[2]) - 419.53) < 2, 'PDF should use A5 landscape');
 assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
 // A failed write must surface an error and leave later exports available.
 await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, path.join(scratch, 'missing', 'note.pdf'));
 await page.getByTitle('更多笔记操作', { exact: true }).click();
 await page.getByRole('button', { name: '导出…', exact: true }).click();
 await page.getByRole('dialog').getByRole('button', { name: '导出', exact: true }).click();
 await expect(page.locator('.toast.error')).toContainText('导出失败', { timeout: 20000 });
 assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
 const output = path.resolve('test-results'); await mkdir(output, { recursive: true });
 await writeFile(path.join(output, 'export-desktop.pdf'), pdf);
 await writeFile(path.join(output, 'export-desktop.html'), html);
 assert.deepEqual(errors, []);
 console.log('Desktop export passed: PDF/HTML/Markdown, images, drawing, cancellation, write errors and print window cleanup.');
 console.log(`PDF size: ${(await stat(path.join(output, 'export-desktop.pdf'))).size} bytes`);
} finally { await app?.close(); await rm(scratch, { recursive: true, force: true }); }
