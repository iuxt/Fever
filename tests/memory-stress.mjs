import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Run against dist/file:// with real IPC and a disposable vault. No dev server needed.
const count = Number(process.env.FEVER_STRESS_NOTES || 2000);
const bytes = Number(process.env.FEVER_STRESS_NOTE_KIB || 64) * 1024;
const cycles = Number(process.env.FEVER_STRESS_CYCLES || 20);
const drawingCycles = Number(process.env.FEVER_STRESS_DRAWING_CYCLES || 8);
const appRoot = path.resolve(process.env.FEVER_STRESS_APP_ROOT || '.');
const checkLimits = process.env.FEVER_STRESS_ASSERT_LIMITS !== '0';
const output = path.resolve(process.env.FEVER_MEMORY_REPORT || 'test-results/memory.json');
const scratch = await mkdtemp(path.join(tmpdir(), 'fever-memory-'));
const folder = path.join(scratch, 'vault'), data = path.join(scratch, 'data');
const report = { timestamp: new Date().toISOString(), platform: process.platform, workload: { count, bytes, cycles, drawingCycles, imageBytes: 8 * 1024 * 1024 }, stages: [] };
let app, page, sampling = false, sampleTask;
const errors = [];
const title = i => `压力笔记 ${String(i).padStart(5, '0')}`;
async function memory(gc = false) {
 return app.evaluate(async ({ app, BrowserWindow }, gc) => {
  const debug = BrowserWindow.getAllWindows()[0].webContents.debugger;
  if (!debug.isAttached()) debug.attach('1.3');
  if (gc) await debug.sendCommand('HeapProfiler.collectGarbage');
  const heap = await debug.sendCommand('Runtime.getHeapUsage');
  const dom = await debug.sendCommand('Memory.getDOMCounters');
  const processes = app.getAppMetrics().map(p => ({ type: p.type, rssMiB: p.memory.workingSetSize / 1024 }));
  return { rendererHeapMiB: heap.usedSize / 1048576, mainHeapMiB: process.memoryUsage().heapUsed / 1048576, totalRssMiB: processes.reduce((sum, p) => sum + p.rssMiB, 0), processes, dom };
 }, gc);
}
async function stage(name, action) {
 const start = performance.now(), before = await memory(true), peak = { ...before };
 sampling = true;
 sampleTask = (async () => {
  while (sampling) {
   const sample = await memory();
   for (const key of ['rendererHeapMiB', 'mainHeapMiB', 'totalRssMiB']) peak[key] = Math.max(peak[key], sample[key]);
   await new Promise(resolve => setTimeout(resolve, 100));
  }
 })();
 try { await action(); } finally { sampling = false; await sampleTask; }
 const after = await memory(true);
 const result = { name, durationMs: Math.round(performance.now() - start), before, peak: { rendererHeapMiB: peak.rendererHeapMiB, mainHeapMiB: peak.mainHeapMiB, totalRssMiB: peak.totalRssMiB }, after };
 report.stages.push(result);
 console.log(`${name}: ${result.durationMs}ms, peak RSS ${peak.totalRssMiB.toFixed(1)} MiB, renderer heap ${peak.rendererHeapMiB.toFixed(1)} MiB, retained ${after.rendererHeapMiB.toFixed(1)} MiB, DOM ${after.dom.nodes}`);
}
try {
 await mkdir(path.join(folder, 'notes'), { recursive: true }); await mkdir(data);
 const notes = [], now = '2026-10-07T00:00:00Z';
 for (let i = 0; i < count; i++) {
  const id = `stress-${i}`, name = title(i);
  notes.push({ id, title: name, category: `压测/分类${Math.floor(i / 100)}`, filename: `${id}.md`, createdAt: now, updatedAt: now });
  const body = i === 0 ? '# 压测首页\n\n小笔记。\n' : `# ${name}\n\n` + 'Memory stress paragraph with plain text.\n\n'.repeat(Math.ceil(bytes / 42)).slice(0, bytes) + `\nsearch-token-${String(i).padStart(5, '0')}\n`;
  await writeFile(path.join(folder, 'notes', `${id}.md`), body);
 }
 notes.push({ id: 'stress-drawing', title: '压测绘图', category: '绘图', filename: 'stress-drawing.excalidraw', createdAt: now, updatedAt: now });
 await writeFile(path.join(folder, 'notes', 'stress-drawing.excalidraw'), JSON.stringify({ type: 'excalidraw', version: 2, elements: Array.from({ length: 200 }, (_, i) => ({ id: `rect-${i}`, type: 'rectangle', x: (i % 20) * 30, y: Math.floor(i / 20) * 30, width: 20, height: 20, version: 1 })), appState: {}, files: {} }));
 await writeFile(path.join(folder, 'fever.json'), JSON.stringify({ version: 1, categories: ['压测', '绘图'], notes }));
 await writeFile(path.join(data, 'preferences.json'), JSON.stringify({ vault: folder }));
 // Use the application's main process unchanged, replacing only its dev URL with dist.
 const bootstrap = path.join(scratch, 'production.cjs');
 await writeFile(bootstrap, `const { BrowserWindow } = require('electron');\nBrowserWindow.prototype.loadURL = function () { return this.loadFile(${JSON.stringify(path.join(appRoot, 'dist/index.html'))}); };\nrequire(${JSON.stringify(path.join(appRoot, 'electron/main.cjs'))});\n`);
 const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
 app = await electron.launch({ args: [bootstrap, `--fever-data=${data}`], env });
 page = await app.firstWindow(); page.setDefaultTimeout(60000);
 page.on('pageerror', error => errors.push(error.message));
 await expect(page.locator('.prose h1')).toHaveText('压测首页');
 await expect(page.locator('.sidebar-foot')).toContainText(`${count + 1} 篇笔记`);
 report.initial = await memory(true);
 report.initial.noteRows = await page.locator('.note-tree .note-row').count();
 console.log(`initial: RSS ${report.initial.totalRssMiB.toFixed(1)} MiB, heap ${report.initial.rendererHeapMiB.toFixed(1)} MiB, DOM ${report.initial.dom.nodes}`);
 const search = page.getByPlaceholder('搜索你的笔记…');
 await stage('full-text-search', async () => {
  for (const i of [Math.floor(count / 4), Math.floor(count / 2), count - 1]) {
   await search.fill(`search-token-${String(i).padStart(5, '0')}`);
   await expect(page.locator('.note-tree .note-row')).toHaveCount(1);
   await expect(page.locator('.note-tree .note-row')).toHaveText(title(i));
  }
  await search.fill(''); await page.waitForTimeout(500);
 });
 await stage('cancelled-searches', async () => {
  for (let i = 0; i < 5; i++) { await search.fill(`missing-${i}`); await page.waitForTimeout(300); }
  await search.fill(`search-token-${String(count - 1).padStart(5, '0')}`);
  await expect(page.locator('.note-tree .note-row')).toHaveCount(1);
  await expect(page.locator('.note-tree .note-row')).toHaveText(title(count - 1));
  await search.fill(''); await page.waitForTimeout(500);
 });
 await stage('editor-mount-cycles', async () => {
  for (let i = 0; i < cycles; i++) {
   await page.locator('.note-row').filter({ hasText: title(i % 3) }).click();
   await expect(page.locator('.breadcrumb-title')).toHaveText(title(i % 3));
   await page.getByTitle('编辑模式 · ⌘ E').click(); await expect(page.locator('.cm-content')).toBeVisible();
   await page.getByTitle('阅读模式', { exact: true }).click(); await expect(page.locator('.prose h1')).toBeVisible();
  }
  await page.locator('.note-row').filter({ hasText: title(0) }).click();
  await expect(page.locator('.breadcrumb-title')).toHaveText(title(0));
 });
 await stage('image-import-8MiB', async () => {
  const image = Buffer.alloc(report.workload.imageBytes);
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N3IAAAAASUVORK5CYII=', 'base64').copy(image);
  await page.evaluate(size => {
   const pixels = new Uint8Array(size);
   pixels.set(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N3IAAAAASUVORK5CYII='), char => char.charCodeAt(0)));
   const transfer = new DataTransfer(); transfer.items.add(new File([pixels], 'large.png', { type: 'image/png' }));
   document.querySelector('.document-space').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, image.length);
  await expect(page.getByText('图片已添加到 images/')).toBeVisible();
  const content = await page.evaluate(() => window.fever.read('stress-0'));
  const src = content.match(/\.\.\/images\/[a-zA-Z0-9_-]+\.png/)[0];
  const saved = await readFile(path.join(folder, src.slice(3)));
  expect(createHash('sha256').update(saved).digest('hex')).toBe(createHash('sha256').update(image).digest('hex'));
 });
 await stage('drawing-mount-cycles', async () => {
  // Metadata search brings the drawing into view even with a virtualized sidebar.
  await search.fill('压测绘图'); await page.locator('.note-row').filter({ hasText: '压测绘图' }).click(); await search.fill('');
  for (let i = 0; i < drawingCycles; i++) {
   await expect(page.locator('.drawing-preview img')).toBeVisible();
   await page.getByRole('button', { name: '编辑绘图', exact: true }).click(); await expect(page.locator('.drawing-canvas canvas.interactive')).toBeVisible();
   await page.getByTitle('阅读模式', { exact: true }).click();
  }
  await search.fill(title(0)); await page.locator('.note-row').filter({ hasText: title(0) }).click(); await search.fill('');
  await expect(page.locator('.prose h1')).toHaveText('压测首页');
 });
 await stage('warm-editor-mount-cycles', async () => {
  for (let i = 0; i < cycles; i++) {
   await page.locator('.note-row').filter({ hasText: title(i % 3) }).click();
   await expect(page.locator('.breadcrumb-title')).toHaveText(title(i % 3));
   await page.getByTitle('编辑模式 · ⌘ E').click(); await expect(page.locator('.cm-content')).toBeVisible();
   await page.getByTitle('阅读模式', { exact: true }).click(); await expect(page.locator('.prose h1')).toBeVisible();
  }
  await page.locator('.note-row').filter({ hasText: title(0) }).click();
  await expect(page.locator('.breadcrumb-title')).toHaveText(title(0));
 });
 await stage('warm-drawing-mount-cycles', async () => {
  await search.fill('压测绘图'); await page.locator('.note-row').filter({ hasText: '压测绘图' }).click(); await search.fill('');
  for (let i = 0; i < drawingCycles; i++) {
   await expect(page.locator('.drawing-preview img')).toBeVisible();
   await page.getByRole('button', { name: '编辑绘图', exact: true }).click(); await expect(page.locator('.drawing-canvas canvas.interactive')).toBeVisible();
   await page.getByTitle('阅读模式', { exact: true }).click();
  }
  await search.fill(title(0)); await page.locator('.note-row').filter({ hasText: title(0) }).click(); await search.fill('');
  await expect(page.locator('.prose h1')).toHaveText('压测首页');
 });
 await page.waitForTimeout(500);
 report.final = await memory(true);
 expect(errors).toEqual([]);
 if (checkLimits) {
  expect(report.initial.noteRows).toBeLessThan(100);
  for (const result of report.stages.filter(result => result.name.includes('search'))) expect(result.peak.rendererHeapMiB - report.initial.rendererHeapMiB).toBeLessThan(32);
  const warm = report.stages.find(result => result.name === 'warm-drawing-mount-cycles');
  expect(warm.after.rendererHeapMiB - warm.before.rendererHeapMiB).toBeLessThan(8);
 }
 report.passed = true;
} catch (error) { report.error = error.stack; throw error; }
finally {
 sampling = false; await sampleTask?.catch(() => {});
 await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n');
 await app?.close(); await rm(scratch, { recursive: true, force: true });
 console.log(`Report: ${output}`);
}
