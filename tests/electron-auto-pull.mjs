import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { VaultStore } = createRequire(import.meta.url)('../electron/vault.cjs');

const scratch = await mkdtemp(path.join(tmpdir(), 'fever-auto-pull-'));
const folder = path.join(scratch, 'vault'), data = path.join(scratch, 'data');
const remotePath = path.join(scratch, 'remote.git'), writerPath = path.join(scratch, 'writer');
const remote = 'https://fever-auto-pull.invalid/notes.git';
await mkdir(folder); await mkdir(data);
const store = new VaultStore(); await store.open(folder);
await store.configure({ author: 'Auto Pull Test', email: 'pull@example.com', remote });
// Keep all Git traffic in the temporary directory, including the desktop's pull.
await store.git(['init', '--bare', '--initial-branch=main', remotePath]);
await store.git(['config', '--local', `url.${remotePath}.insteadOf`, remote]);
await store.commit('initial'); await store.push();
await store.git(['clone', remotePath, writerPath]);
const writer = new VaultStore(); await writer.open(writerPath);
await writer.configure({ author: 'Remote Writer', email: 'writer@example.com', remote });
await writer.git(['config', '--local', `url.${remotePath}.insteadOf`, remote]);
const note = store.manifest.notes[0];
await writeFile(path.join(data, 'preferences.json'), JSON.stringify({ vault: folder }));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
 app = await electron.launch({ args: ['.', `--fever-data=${data}`], env });
 let page = await app.firstWindow();
 const errors = []; page.on('pageerror', error => errors.push(error.message));
 await expect(page.getByTitle('设置', { exact: true })).toBeVisible();
 const initial = await page.evaluate(() => window.fever.settings());
 assert.equal(initial.autoPull, false); assert.equal(initial.pullInterval, 10);
 // Capture the actual main-process timer without waiting several minutes.
 await app.evaluate(() => {
  const timers = globalThis.feverPullTimers = new Map();
  const start = globalThis.setInterval, stop = globalThis.clearInterval;
  globalThis.setInterval = (callback, milliseconds, ...args) => {
   const id = start(callback, milliseconds, ...args);
   timers.set(id, { callback, milliseconds }); return id;
  };
  globalThis.clearInterval = id => { timers.delete(id); return stop(id); };
 });
 const tick = () => app.evaluate(() => {
  const timers = [...globalThis.feverPullTimers.values()];
  if (timers.length !== 1) throw new Error(`Expected one pull timer, got ${timers.length}`);
  timers[0].callback();
 });
 const timerIntervals = () => app.evaluate(() => [...globalThis.feverPullTimers.values()].map(timer => timer.milliseconds));
 await page.getByTitle('设置', { exact: true }).click();
 await page.getByRole('tab', { name: '同步与备份', exact: true }).click();
 const toggle = page.getByRole('switch', { name: '定时自动拉取', exact: true });
 await expect(toggle).toHaveAttribute('aria-checked', 'false');
 await expect(page.getByLabel('拉取间隔（分钟）', { exact: true })).toHaveCount(0);
 await toggle.click();
 await expect(page.getByLabel('拉取间隔（分钟）', { exact: true })).toHaveValue('10');
 await page.getByLabel('拉取间隔（分钟）', { exact: true }).fill('1');
 await page.getByLabel('远程仓库（origin）', { exact: true }).fill(remote);
 await page.getByRole('button', { name: '保存设置', exact: true }).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 assert.deepEqual(await timerIntervals(), [60000]);
 assert.equal(JSON.parse(await readFile(path.join(data, 'preferences.json'), 'utf8')).settings.autoPull, true);
 await page.locator('.folder-row').filter({ hasText: '收件箱' }).click();
 await page.locator('.note-row').filter({ hasText: note.title }).click();
 await expect(page.locator('.wysiwyg-content')).toBeVisible();
 await writer.save(note.id, '# Remote update\n\nPulled automatically\n');
 await writer.commit('remote update'); await writer.push();
 await tick();
 await expect(page.locator('.wysiwyg-content')).toContainText('Pulled automatically');
 await expect(page.locator('.toast')).toContainText('1 个提交 · 2 个文件');
 assert.equal(await readFile(path.join(folder, 'notes', note.filename), 'utf8'), '# Remote update\n\nPulled automatically\n');
 await page.getByRole('button', { name: 'Git', exact: true }).click();
 const remoteChanges = page.getByRole('region', { name: '远端变更', exact: true });
 await expect(remoteChanges.locator('.changes-count')).toHaveText('2');
 await remoteChanges.getByRole('button', { name: `查看远端差异：${note.title}`, exact: true }).click();
 await expect(page.locator('.diff-editor')).toContainText('+Pulled automatically');
 await page.getByTitle(`关闭对比：notes/${note.filename}`, { exact: true }).click();
 // No new remote commit must preserve the editor and its undo history.
 const editor = await page.locator('.wysiwyg-content').elementHandle();
 await tick();
 await expect(page.locator('.app-shell')).not.toHaveAttribute('inert');
 assert.equal(await editor.evaluate(element => element.isConnected), true);
 // Uncommitted local changes are skipped quietly and never overwritten.
 await page.locator('.wysiwyg-content').fill('Local draft must survive');
 await expect(page.getByText('所有更改已保存')).toBeVisible();
 await writer.save(note.id, '# Another remote update\n'); await writer.commit('next update'); await writer.push();
 await tick();
 await expect(page.locator('.wysiwyg-content')).toContainText('Local draft must survive');
 assert.match(await readFile(path.join(folder, 'notes', note.filename), 'utf8'), /Local draft must survive/);
 await expect(page.locator('.toast.error')).toHaveCount(0);
 // Changing unsaved settings, then cancelling, must leave the active timer alone.
 await page.getByTitle('设置', { exact: true }).click();
 await page.getByRole('tab', { name: '同步与备份', exact: true }).click();
 await page.getByLabel('拉取间隔（分钟）', { exact: true }).fill('7');
 await page.getByRole('button', { name: '取消', exact: true }).click();
 assert.deepEqual(await timerIntervals(), [60000]);
 await page.getByTitle('设置', { exact: true }).click();
 await page.getByRole('tab', { name: '同步与备份', exact: true }).click();
 await expect(page.getByLabel('拉取间隔（分钟）', { exact: true })).toHaveValue('1');
 await page.getByLabel('拉取间隔（分钟）', { exact: true }).fill('3');
 await page.getByLabel('远程仓库（origin）', { exact: true }).fill(remote);
 await page.getByRole('button', { name: '保存设置', exact: true }).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 assert.deepEqual(await timerIntervals(), [180000]);
 // A full restart restores the saved switch and interval.
 await app.close();
 app = await electron.launch({ args: ['.', `--fever-data=${data}`], env });
 page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
 await expect(page.getByTitle('设置', { exact: true })).toBeVisible();
 await page.getByRole('button', { name: 'Git', exact: true }).click();
 await expect(page.getByRole('region', { name: '远端变更', exact: true }).locator('.changes-count')).toHaveText('2');
 const restored = await page.evaluate(() => window.fever.settings());
 assert.equal(restored.autoPull, true); assert.equal(restored.pullInterval, 3);
 await page.getByTitle('设置', { exact: true }).click();
 await page.getByRole('tab', { name: '同步与备份', exact: true }).click();
 await expect(page.getByRole('switch', { name: '定时自动拉取', exact: true })).toHaveAttribute('aria-checked', 'true');
 await expect(page.getByLabel('拉取间隔（分钟）', { exact: true })).toHaveValue('3');
 await page.getByRole('switch', { name: '定时自动拉取', exact: true }).click();
 await page.getByLabel('远程仓库（origin）', { exact: true }).fill(remote);
 await page.getByRole('button', { name: '保存设置', exact: true }).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 assert.equal(JSON.parse(await readFile(path.join(data, 'preferences.json'), 'utf8')).settings.autoPull, false);
 assert.deepEqual(errors, []);
 console.log('Automatic pull: settings, interval rescheduling, persistence, real Git updates and local draft protection passed.');
} finally {
 if (app) await app.close();
 await rm(scratch, { recursive: true, force: true });
}
