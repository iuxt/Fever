import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { VaultStore } = createRequire(import.meta.url)('../electron/vault.cjs');

const root = process.cwd(), scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-resources-stress-'));
const vault = path.join(scratch, 'vault'), data = path.join(scratch, 'data');
const report = { timestamp: new Date().toISOString(), noteCount: 2000, noteBytes: 65536, stages: [] };
let app;
try {
 await fs.mkdir(path.join(vault, 'notes'), { recursive: true }); await fs.mkdir(data);
 const notes = Array.from({ length: report.noteCount }, (_,i) => ({ id: `resource-${i}`, filename: `resource-${i}.md`, title: `资源笔记 ${i}`, category: '', createdAt: '2026-10-15', updatedAt: '2026-10-15' }));
 for (const [i, note] of notes.entries()) await fs.writeFile(path.join(vault, 'notes', note.filename), i === 0 ? '# 首页\n\nbody-token\n' : 'plain note text\n'.repeat(4096));
 await fs.writeFile(path.join(vault, 'fever.json'), JSON.stringify({ version: 1, categories: [], notes }));
 await fs.writeFile(path.join(data, 'preferences.json'), JSON.stringify({ vault }));
 const bootstrap = path.join(scratch, 'production.cjs');
 await fs.writeFile(bootstrap, `
const fs = require('node:fs/promises');
const {VaultStore} = require(${JSON.stringify(path.join(root, 'electron/vault.cjs'))});
global.resourceCounters={calls:{},readBytes:0,readFiles:0,writeBytes:0,git:0};
for (const name of ['save','search','history','status']) {
 const fn=VaultStore.prototype[name];VaultStore.prototype[name]=function(...args){global.resourceCounters.calls[name]=(global.resourceCounters.calls[name]||0)+1;return fn.apply(this,args);};
}
const git=VaultStore.prototype.git;VaultStore.prototype.git=function(...args){global.resourceCounters.git++;return git.apply(this,args);};
const open=fs.open;fs.open=async function(file,...args){const handle=await open.call(this,file,...args);if(String(file).includes('fever-resources-stress-')&&String(file).includes('/vault/notes/')&&args[0]==='r'){global.resourceCounters.readFiles++;const read=handle.read.bind(handle);handle.read=async(...args)=>{const result=await read(...args);global.resourceCounters.readBytes+=result.bytesRead;return result;};}return handle;};
const write=fs.writeFile;fs.writeFile=async function(file,value,...args){const result=await write.call(this,file,value,...args);if(String(file).includes('fever-resources-stress-')&&String(file).includes('/vault/'))global.resourceCounters.writeBytes+=typeof value==='string'?Buffer.byteLength(value):value.byteLength;return result;};
const {BrowserWindow}=require('electron');BrowserWindow.prototype.loadURL=function(){return this.loadFile(${JSON.stringify(path.join(root,'dist/index.html'))});};
require(${JSON.stringify(path.join(root,'electron/main.cjs'))});
`);
 const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
 app = await electron.launch({ args: [bootstrap, `--fever-data=${data}`], env });
 const page = await app.firstWindow(); page.setDefaultTimeout(30000);
 const errors = []; page.on('pageerror', error => errors.push(error.message));
 await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
 await page.locator('.note-row').first().click(); await expect(page.locator('.wysiwyg-content')).toBeVisible();
 async function stage(name, action) {
  await app.evaluate(() => { global.resourceCounters = { calls: {}, readBytes: 0, readFiles: 0, writeBytes: 0, git: 0 }; global.resourceCpu = process.cpuUsage(); });
  const start = performance.now(); await action();
  const result = await app.evaluate(() => ({ ...global.resourceCounters, mainCpuMs: Object.values(process.cpuUsage(global.resourceCpu)).reduce((sum, value) => sum + value, 0) / 1000 }));
  result.name = name; result.durationMs = performance.now() - start; report.stages.push(result); console.log(JSON.stringify(result)); return result;
 }
 const search = page.getByPlaceholder('搜索你的笔记…');
 await search.fill('body-token'); await expect(page.locator('.note-tree .note-row')).toHaveCount(1);
 await stage('3-autosaves-with-query', async () => {
  await page.locator('.wysiwyg-content').click(); await page.keyboard.press('ControlOrMeta+End');
  for (let i = 0; i < 3; i++) { await page.keyboard.type(` edit-${i}`); await page.waitForTimeout(1800); }
  await expect(page.locator('.saved-state')).toContainText('所有更改已保存');
 });
 const saves = report.stages.at(-1); expect(saves.calls.save).toBe(3); expect(saves.readFiles).toBe(3); expect(saves.readBytes).toBeLessThan(1024);
 await search.fill(''); await page.waitForTimeout(300);
 const invalidImport = await stage('invalid-image-batch', async () => {
  await page.evaluate(() => {
   const files = new DataTransfer(); files.items.add(new File(['png'], 'valid.png', { type: 'image/png' })); files.items.add(new File(['bad'], 'invalid.txt'));
   document.querySelector('.document-space').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: files }));
  });
  await expect(page.locator('.toast')).toContainText('支持 PNG');
 });
 expect(invalidImport.writeBytes).toBe(0);
 const imageFiles = await fs.readdir(path.join(vault, 'images'), { recursive: true }); expect(imageFiles).toEqual([]);
 const memory = () => app.evaluate(async ({ BrowserWindow, app }) => {
  const debug = BrowserWindow.getAllWindows()[0].webContents.debugger; if (!debug.isAttached()) debug.attach('1.3');
  await debug.sendCommand('HeapProfiler.collectGarbage');
  return { heap: await debug.sendCommand('Runtime.getHeapUsage'), dom: await debug.sendCommand('Memory.getDOMCounters'), rssMiB: app.getAppMetrics().reduce((sum, p) => sum + p.memory.workingSetSize / 1024, 0) };
 });
 report.beforeGit = await memory();
 await page.getByRole('button', { name: 'Git', exact: true }).click();
 await expect(page.getByRole('region', { name: '工作区变更', exact: true }).locator('.changes-count')).toHaveText('2002');
 report.visibleGitRows = await page.locator('.git-changes .change').count(); report.afterGit = await memory();
 expect(report.visibleGitRows).toBeLessThan(50); expect(report.afterGit.dom.nodes).toBeLessThan(2500);
 await page.locator('.git-changes').evaluate(element => { element.scrollTop = element.scrollHeight; });
 await expect(page.getByRole('button', { name: '查看工作区差异：资源笔记 999', exact: true })).toBeVisible();
 // Exercise the actual built worker over file://, with Git-backed historical content.
 const store = new VaultStore(); await store.open(vault); await store.configure({ author: 'Resource Test', email: 'test@example.com', remote: '' });
 await store.save(notes[0].id, '# worker old\n'); await store.commit('worker old');
 await store.save(notes[0].id, '# worker new\n'); await store.commit('worker new');
 await page.reload(); await expect(page.locator('.wysiwyg-content')).toContainText('worker new');
 await page.getByRole('button', { name: '历史', exact: true }).click(); await page.locator('.history-item').first().click();
 await expect(page.locator('.revision-diff .diff-add')).toContainText('worker new');
 await expect(page.locator('.revision-diff .diff-remove')).toContainText('worker old');
 report.productionWorker = 'passed';
 await page.getByRole('button', { name: '返回当前版本', exact: true }).click();
 await page.getByTitle('切换右侧面板').click();
 const idle = await stage('hidden-history-idle-16s', async () => page.waitForTimeout(16000));
 expect(idle.calls.history || 0).toBe(0); expect(idle.calls.status || 0).toBeLessThanOrEqual(1); expect(idle.git).toBeLessThanOrEqual(2);
 expect(errors).toEqual([]); report.passed = true;
} catch (error) { report.error = error.stack; throw error; }
finally { await fs.mkdir(path.join(root,'test-results'), { recursive: true }); await fs.writeFile(path.join(root, 'test-results/resources-after.json'), JSON.stringify(report, null, 2)); await app?.close(); await fs.rm(scratch, { recursive: true, force: true }); }
