import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const scratch = await mkdtemp(path.join(tmpdir(), 'fever-v2-folders-'));
const vaultPath = path.join(scratch, 'vault'), data = path.join(scratch, 'data');
await mkdir(path.join(vaultPath, 'notes'), { recursive: true }); await mkdir(data);
await writeFile(path.join(vaultPath, 'notes', 'legacy.md'), '# 旧版笔记\n\n保留的正文\n');
await writeFile(path.join(vaultPath, 'fever.json'), JSON.stringify({ version: 1, categories: ['项目/子分类', '项目/空分类', '目标'], notes: [
 { id: 'legacy', filename: 'legacy.md', title: '旧版笔记', category: '项目/子分类', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' },
] }));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app, server, succeeded = false;
try {
 let available = false;
 try { available = (await fetch('http://127.0.0.1:5173', { signal: AbortSignal.timeout(1000) })).ok; } catch {}
 if (!available) {
  const { createServer } = await import('vite');
  server = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
  await server.listen();
 }
 app = await electron.launch({ args: ['.', `--fever-data=${data}`], env });
 const page = await app.firstWindow(), errors = [];
 page.on('pageerror', error => errors.push(error.message));
 await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, vaultPath);
 await page.getByRole('button', { name: '选择笔记库文件夹' }).click();
 const readManifest = async () => JSON.parse(await readFile(path.join(vaultPath, 'fever.json'), 'utf8'));
 const folder = name => page.locator('.folder-row').filter({ has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) });
 await expect(folder('项目')).toBeVisible();
 await expect(folder('项目')).toHaveAttribute('draggable', 'true');
 const before = await readManifest();
 expect(before.version).toBe(2); expect(before.categories).toBeUndefined();
 const parent = before.folders.find(folder => folder.name === '项目'), target = before.folders.find(folder => folder.name === '目标');
 expect(parent.id).toMatch(/^[0-9a-f-]{36}$/);
 expect(before.notes[0].category).toBeUndefined();
 await folder('项目').click(); await folder('子分类').click();
 await page.locator('.note-row').filter({ hasText: '旧版笔记' }).click();
 await folder('项目').click({ button: 'right' });
 await page.getByRole('menuitem', { name: '重命名文件夹', exact: true }).click();
 await page.getByLabel('文件夹名称', { exact: true }).fill('新项目');
 await page.getByRole('button', { name: '保存更改', exact: true }).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 const renamed = await readManifest();
 expect(renamed.notes).toEqual(before.notes);
 expect(renamed.folders).toEqual(before.folders.map(folder => folder.id === parent.id ? { ...folder, name: '新项目' } : folder));
 await expect(folder('新项目')).toHaveAttribute('draggable', 'true');
 await folder('新项目').dragTo(folder('目标'));
 await expect(folder('子分类')).toHaveAttribute('title', '目标/新项目/子分类');
 const moved = await readManifest();
 expect(moved.notes).toEqual(before.notes);
 expect(moved.folders).toEqual(renamed.folders.map(folder => folder.id === parent.id ? { ...folder, parentId: target.id } : folder));
 await expect(page.locator('.wysiwyg-content')).toContainText('保留的正文');
 await expect(folder('新项目')).toHaveAttribute('draggable', 'true');
 await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
 await page.reload();
 await expect(page.locator('.wysiwyg-content')).toContainText('保留的正文');
 expect(await readManifest()).toEqual(moved);
 expect(await readFile(path.join(vaultPath, 'notes', 'legacy.md'), 'utf8')).toBe('# 旧版笔记\n\n保留的正文\n');
 expect(errors).toEqual([]);
 succeeded = true;
 console.log('Desktop v1 migration, UUID stability, minimal rename/move changes and reload passed');
} finally { if (app) { if (succeeded) await app.close(); else app.process().kill(); } if (server) await server.close(); await rm(scratch, { recursive: true, force: true }); }
