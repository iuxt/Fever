import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const scratch = await mkdtemp(path.join(tmpdir(), 'fever-tabs-'));
const folder = path.join(scratch, 'vault'), data = path.join(scratch, 'data');
await mkdir(folder); await mkdir(data);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
 app = await electron.launch({ ...(process.env.FEVER_EXECUTABLE ? { executablePath: process.env.FEVER_EXECUTABLE } : {}), args: [...(process.env.FEVER_EXECUTABLE ? [] : ['.']), `--fever-data=${data}`], env });
 const page = await app.firstWindow();
 const errors = []; page.on('pageerror', error => errors.push(error.message));
 await expect(page.getByRole('heading', { name: 'Fever', exact: true })).toBeVisible();
 const closeMenu = await app.evaluate(({ Menu }) => {
  const item = Menu.getApplicationMenu().getMenuItemById('close-tab');
  return { accelerator: item.accelerator, label: item.label };
 });
 expect(closeMenu).toEqual({ accelerator: 'CommandOrControl+W', label: '关闭标签页' });
 const shortcut = () => app.evaluate(({ BrowserWindow }) => {
  const window = BrowserWindow.getAllWindows()[0]; window.focus();
  const modifiers = [process.platform === 'darwin' ? 'meta' : 'control'];
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'W', modifiers });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'W', modifiers });
 });
 await shortcut();
 expect(page.isClosed()).toBe(false);
 await app.evaluate(({ dialog }, vaultPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [vaultPath] }); }, folder);
 await page.getByRole('button', { name: '选择笔记库文件夹' }).click();
 await expect(page.getByRole('heading', { name: '欢迎使用 Fever' })).toBeVisible();
 await page.getByRole('button', { name: '新建笔记', exact: true }).first().click();
 await page.getByLabel('笔记标题').fill('快捷键测试');
 await page.getByRole('button', { name: '创建笔记' }).click();
 await expect(page.locator('.tab')).toHaveCount(2);
 await page.getByTitle('Markdown 源码与预览').click();
 await page.locator('.cm-content').fill('# 快捷键关闭前的修改');
 await shortcut();
 await expect(page.locator('.tab')).toHaveCount(1);
 await expect(page.locator('.tab.current')).toContainText('欢迎使用 Fever');
 expect(page.isClosed()).toBe(false);
 const manifest = JSON.parse(await readFile(path.join(folder, 'fever.json'), 'utf8'));
 const note = manifest.notes.find(note => note.title === '快捷键测试');
 expect(await readFile(path.join(folder, 'notes', note.filename), 'utf8')).toContain('快捷键关闭前的修改');
 await expect(page.getByTitle('关闭标签', { exact: true })).toBeEnabled();
 await shortcut();
 await expect(page.locator('.tab')).toHaveCount(0);
 await shortcut();
 expect(page.isClosed()).toBe(false);
 await page.locator('.folder-row').filter({ hasText: '收件箱' }).click();
 await page.locator('.note-row').filter({ hasText: '快捷键测试' }).click();
 await expect(page.locator('.cm-content')).toContainText('快捷键关闭前的修改');
 await app.evaluate(({ Menu, BrowserWindow }) => Menu.getApplicationMenu().getMenuItemById('close-tab').click(undefined, BrowserWindow.getAllWindows()[0]));
 await expect(page.locator('.tab')).toHaveCount(0);
 expect(page.isClosed()).toBe(false);
 expect(errors).toEqual([]);
 console.log('PASS: native close-tab accelerator/menu, save before close, last tab and empty workspace');
} finally { await app?.close(); await rm(scratch, { recursive: true, force: true }); }
