import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd(), scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-optimization-desktop-'));
const vault = path.join(scratch, 'vault'), data = path.join(scratch, 'data');
const report = {}; let app;
try {
 await fs.mkdir(path.join(vault, 'notes'), { recursive: true }); await fs.mkdir(data);
 const notes = Array.from({ length: 120 }, (_, i) => ({ id: `opt-${i}`, filename: `opt-${i}.md`, title: `笔记${i}`, category: '', createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z' }));
 for (const [i, note] of notes.entries()) await fs.writeFile(path.join(vault, 'notes', note.filename), i ? '中文摘要正文\n'.repeat(32768) : 'a'.repeat(32) + '!');
 await fs.writeFile(path.join(vault, 'fever.json'), JSON.stringify({ version: 1, categories: [], notes }));
 await fs.writeFile(path.join(data, 'preferences.json'), JSON.stringify({ vault }));
 const bootstrap = path.join(scratch, 'production.cjs');
 await fs.writeFile(bootstrap, `
const fs = require('node:fs/promises');
global.optimizationCounters = { prefixReads: 0, prefixBytes: 0, active: 0, peak: 0, manifests: 0 };
const open = fs.open;
fs.open = async (...args) => {
 const handle = await open(...args);
 if (String(args[0]).includes('/notes/') && args[1] === 'r') {
  const read = handle.read.bind(handle);
  handle.read = async (...args) => {
   if (args[2] !== 32768) return read(...args);
   const c = global.optimizationCounters; ++c.active; c.peak = Math.max(c.peak, c.active); ++c.prefixReads;
   try { const result = await read(...args); c.prefixBytes += result.bytesRead; return result; } finally { --c.active; }
  };
 }
 return handle;
};
const write = fs.writeFile;
fs.writeFile = async (file, ...args) => { if (String(file).includes('/vault/.fever-')) ++global.optimizationCounters.manifests; return write(file, ...args); };
const { BrowserWindow } = require('electron');
BrowserWindow.prototype.loadURL = function() { return this.loadFile(${JSON.stringify(path.join(root, 'dist/index.html'))}); };
require(${JSON.stringify(path.join(root, 'electron/main.cjs'))});
`);
 const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
 app = await electron.launch({ args: [bootstrap, `--fever-data=${data}`], env });
 const page = await app.firstWindow(), errors = [];
 page.on('pageerror', error => errors.push(error.message));
 await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
 await page.locator('.note-card[title="笔记0"]').click();
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await page.getByRole('button', { name: '文章内查找', exact: true }).click();
 await page.getByRole('button', { name: '使用正则表达式', exact: true }).click();
 const query = page.getByRole('textbox', { name: '查找内容' });
 await query.fill('(a+)+$');
 await expect(page.locator('.find-footer')).toContainText('正则查找超时');
 await query.fill('^a'); await expect(page.locator('.find-count')).toHaveText('1 / 1');
 await query.press('Escape'); report.productionSearchWorker = 'passed';
 await page.getByTitle('编辑模式 · ⌘ E', { exact: true }).click();
 await expect(page.locator('.wysiwyg-content')).toBeVisible();
 await app.evaluate(() => { global.optimizationCounters.manifests = 0; });
 const list = page.getByLabel('文件列表', { exact: true });
 for (let i = 0; i < 3; ++i) {
  await page.locator('.wysiwyg-content').fill(`最新正文 ${i}`);
  await list.evaluate(element => { element.scrollTop = 8000; });
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
  expect(await list.evaluate(element => element.scrollTop)).toBe(8000);
 }
 expect(await fs.readFile(path.join(vault, 'notes', notes[0].filename), 'utf8')).toContain('最新正文 2');
 expect(await page.evaluate(() => window.fever.preview('opt-119', 'native-preview'))).toHaveLength(8192);
 report.beforeManualSave = await app.evaluate(() => global.optimizationCounters);
 expect(report.beforeManualSave.manifests).toBe(0);
 expect(report.beforeManualSave.peak).toBeLessThanOrEqual(4);
 expect(report.beforeManualSave.prefixBytes).toBeLessThanOrEqual(report.beforeManualSave.prefixReads * 32768);
 await page.locator('.wysiwyg-content').press('ControlOrMeta+s');
 await expect(page.getByText('笔记已保存', { exact: true })).toBeVisible();
 report.afterManualSave = await app.evaluate(() => global.optimizationCounters);
 expect(report.afterManualSave.manifests).toBe(1);
 const manifest = JSON.parse(await fs.readFile(path.join(vault, 'fever.json'), 'utf8'));
 expect(manifest.notes[0].updatedAt).not.toBe(notes[0].updatedAt);
 // Leave another journal entry for the real application quit path to drain.
 await page.locator('.wysiwyg-content').fill('退出前最后的正文');
 await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
 await app.close(); app = null;
 expect(await fs.readFile(path.join(vault, '.git', 'fever-updates.jsonl'), 'utf8')).toBe('');
 expect(await fs.readFile(path.join(vault, 'notes', notes[0].filename), 'utf8')).toContain('退出前最后的正文');
 expect(errors).toEqual([]); report.passed = true;
 console.log(JSON.stringify(report, null, 2));
} finally {
 await app?.close();
 await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
 await fs.writeFile(path.join(root, 'test-results/optimization-desktop.json'), JSON.stringify(report, null, 2));
 await fs.rm(scratch, { recursive: true, force: true });
}
