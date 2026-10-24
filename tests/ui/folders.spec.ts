import { test, expect, type Page } from '@playwright/test';
import { manifestView } from '../../electron/manifest.mjs';
const readState = async (page: Page) => { const state = await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!)); return { ...state, manifest: manifestView(state.manifest) }; };

const folder = (page: Page, name: string) => page.locator('.folder-row').filter({ has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) });
async function expandFolder(page: Page, name: string) {
 const toggle = folder(page, name).locator('..').locator('.folder-toggle');
 if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}
const note = (page: Page, title: string) => page.locator('.note-row').filter({ hasText: title });
async function deleteFolder(page: Page, name: string) {
 await folder(page, name).click({ button: 'right' });
 await page.getByRole('menuitem', { name: '删除文件夹', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
 await page.addInitScript(() => {
  if (localStorage.getItem('fever-demo-v1')) return;
  const notes = [
   { id: 'parent', title: '父分类笔记', category: '项目' },
   { id: 'child', title: '子分类笔记', category: '项目/子分类' },
   { id: 'sibling', title: '保留的笔记', category: '项目备份' },
  ].map(note => ({ ...note, filename: `${note.id}.md`, createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z' }));
  localStorage.setItem('fever-demo-v1', JSON.stringify({
   manifest: { version: 1, categories: ['项目/子分类', '项目/空子分类', '项目备份', '空文件夹'], notes },
   contents: Object.fromEntries(notes.map(note => [note.id, `# ${note.title}\n\n原正文`])),
   versions: {}, dirty: [], images: { '../images/pixel.png': 'data:image/png;base64,retained' },
   settings: { autoCommit: false, interval: 10, author: '', email: '', remote: '' },
  }));
 });
 await page.goto('/');
});

test('folder icons toggle children independently from names and article filters', async ({ page }) => {
 const project = folder(page, '项目');
 const toggle = project.locator('..').locator('.folder-toggle');
 const header = page.locator('.file-list-header h2');
 await expect(folder(page, '子分类')).toHaveCount(0);
 await project.locator('span').click();
 await expect(header).toHaveText('项目');
 await expect(page.locator('.note-card')).toHaveCount(1);
 await expect(toggle).toHaveAttribute('aria-expanded', 'false');
 await project.locator('span').click();
 await expect(toggle).toHaveAttribute('aria-expanded', 'false');
 await toggle.click();
 await expect(folder(page, '子分类')).toBeVisible();
 await expect(header).toHaveText('项目');
 await project.locator('span').click();
 await expect(toggle).toHaveAttribute('aria-expanded', 'true');
 await folder(page, '项目备份').click();
 await toggle.click();
 await expect(folder(page, '子分类')).toHaveCount(0);
 await expect(folder(page, '项目备份')).toHaveAttribute('aria-pressed', 'true');
 await expect(header).toHaveText('项目备份');
 await expect(page.locator('.note-card')).toHaveCount(1);
 const search = page.getByPlaceholder('搜索你的笔记…');
 await search.fill('父分类笔记');
 await toggle.focus(); await page.keyboard.press('Enter');
 await expect(folder(page, '子分类')).toBeVisible();
 await expect(search).toHaveValue('父分类笔记');
 await expect(header).toHaveText('搜索结果');
 await toggle.focus(); await page.keyboard.press('Space');
 await expect(folder(page, '子分类')).toHaveCount(0);
 await project.focus(); await page.keyboard.press('Enter');
 await expect(search).toHaveValue('');
 await expect(header).toHaveText('项目');
 await expect(toggle).toHaveAttribute('aria-expanded', 'false');
 await toggle.click({ button: 'right' });
 await expect(page.getByRole('menuitem', { name: '展开分类', exact: true })).toBeVisible();
 await page.keyboard.press('Escape');
 await folder(page, '空文件夹').locator('span').click();
 await expect(page.locator('.file-list-empty')).toContainText('这个文件夹还是空的');
});

test('folder lists and counts exclude child notes while all notes and search span the vault', async ({ page }) => {
 await folder(page, '项目').click();
 await expect(page.locator('.note-card-title strong')).toHaveText(['父分类笔记']);
 await expect(page.locator('.file-list-header > div > span')).toHaveText('1 篇笔记');
 await expect(folder(page, '项目').locator('small')).toHaveText('1');
 await expandFolder(page, '项目');
 await expect(page.locator('.note-card-title strong')).toHaveText(['父分类笔记']);
 await folder(page, '子分类').click();
 await expect(page.locator('.note-card-title strong')).toHaveText(['子分类笔记']);
 await expect(folder(page, '子分类').locator('small')).toHaveText('1');
 await folder(page, '空子分类').click();
 await expect(page.locator('.note-card')).toHaveCount(0);
 await expect(page.locator('.file-list-header > div > span')).toHaveText('0 篇笔记');
 await folder(page, '项目').click();
 await page.getByPlaceholder('搜索你的笔记…').fill('子分类笔记');
 await expect(page.locator('.note-card-title strong')).toHaveText(['子分类笔记']);
 await folder(page, '项目').click();
 await expect(page.locator('.note-card-title strong')).toHaveText(['父分类笔记']);
 await page.getByRole('button', { name: /^全部笔记/ }).click();
 await expect(page.locator('.note-card')).toHaveCount(3);
});

test('empty folder deletion can be cancelled and persists after reload', async ({ page }) => {
 await deleteFolder(page, '空文件夹');
 await expect(page.getByRole('dialog')).toContainText('0 篇笔记');
 await page.getByRole('button', { name: '取消', exact: true }).click();
 await expect(folder(page, '空文件夹')).toHaveCount(1);
 await deleteFolder(page, '空文件夹');
 await page.getByRole('button', { name: '删除文件夹', exact: true }).click();
 await expect(folder(page, '空文件夹')).toHaveCount(0);
 await page.reload();
 await expect(folder(page, '空文件夹')).toHaveCount(0);
 await expect(folder(page, '项目')).toHaveCount(1);
});

test('subtree deletion saves edits, closes affected tabs and restores the original category', async ({ page }) => {
 const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
 await folder(page, '项目备份').click(); await note(page, '保留的笔记').click();
 await expandFolder(page, '项目'); await folder(page, '项目').click(); await note(page, '父分类笔记').click();
 await folder(page, '子分类').click(); await note(page, '子分类笔记').click();
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await page.locator('.cm-content').fill('# 最新正文\n\n未提交内容');
 await deleteFolder(page, '项目');
 await expect(page.getByRole('dialog')).toContainText('2 篇笔记');
 await page.screenshot({ path: 'test-results/delete-folder.png' });
 await page.getByRole('button', { name: '删除文件夹', exact: true }).click();
 await expect(folder(page, '项目')).toHaveCount(0);
 await expect(page.locator('.tabs')).not.toContainText('父分类笔记');
 await expect(page.locator('.tabs')).not.toContainText('子分类笔记');
 await expect(note(page, '保留的笔记')).toHaveClass(/selected/);
 const original = await readState(page);
 expect(original.manifest.categories).toEqual(['项目备份', '空文件夹']);
 expect(original.manifest.trash.map((note: { id: string }) => note.id)).toEqual(['parent', 'child']);
 expect(original.contents.child).toContain('未提交内容');
 expect(original.images['../images/pixel.png']).toBe('data:image/png;base64,retained');
 await page.reload();
 await expect(folder(page, '项目')).toHaveCount(0);
 await page.getByRole('button', { name: /^回收站/ }).click();
 await expect(page.locator('.trash-item')).toHaveCount(2);
 await page.getByRole('button', { name: '恢复：子分类笔记', exact: true }).click();
 await expect(note(page, '子分类笔记')).toHaveClass(/selected/);
 await expect(page.locator('.wysiwyg-content')).toContainText('未提交内容');
 await expect(folder(page, '项目')).toHaveCount(1);
 await expect(folder(page, '子分类')).toHaveCount(1);
 const restored = await readState(page);
 const trashed = original.manifest.trash.find((note: { id: string }) => note.id === 'child');
 expect(restored.manifest.notes.find((note: { id: string }) => note.id === 'child')).toMatchObject({ id: trashed.id, filename: trashed.filename, category: trashed.category, updatedAt: trashed.updatedAt });
 expect(errors).toEqual([]);
});

test('deleting a different folder keeps the current note open', async ({ page }) => {
 await folder(page, '项目备份').click(); await note(page, '保留的笔记').click();
 await deleteFolder(page, '项目');
 await page.getByRole('button', { name: '删除文件夹', exact: true }).click();
 await expect(note(page, '保留的笔记')).toHaveClass(/selected/);
 await expect(page.locator('.wysiwyg-content h1')).toHaveText('保留的笔记');
 await expect(page.locator('.toast.error')).toHaveCount(0);
});

test('move dialog browses nested and empty folders, searches paths and saves only on confirmation', async ({ page }) => {
 await folder(page, '项目备份').click(); await note(page, '保留的笔记').click();
 await expandFolder(page, '项目'); await folder(page, '项目').click(); await note(page, '父分类笔记').click({ button: 'right' });
 await page.getByRole('menuitem', { name: '重命名 / 移动笔记' }).click();
 const dialog = page.getByRole('dialog');
 await expect(dialog).toBeVisible();
 expect((await dialog.boundingBox())!.width).toBeGreaterThan(560);
 await expect(page.getByRole('button', { name: '选择分类：项目', exact: true })).toHaveAttribute('aria-pressed', 'true');
 await expect(page.getByRole('button', { name: '选择分类：项目/空子分类', exact: true })).toBeVisible();
 await page.getByRole('button', { name: '选择分类：项目/空子分类', exact: true }).click();
 await expect(page.locator('.category-destination')).toContainText('项目 / 空子分类');
 await page.getByRole('button', { name: '取消', exact: true }).click();
 await expect(note(page, '父分类笔记')).toBeVisible();
 await note(page, '父分类笔记').click({ button: 'right' });
 await page.getByRole('menuitem', { name: '重命名 / 移动笔记' }).click();
 await expect(page.getByRole('button', { name: '选择分类：项目', exact: true })).toHaveAttribute('aria-pressed', 'true');
 await page.getByRole('button', { name: '收起分类：项目', exact: true }).click();
 await expect(page.getByRole('button', { name: '选择分类：项目/空子分类', exact: true })).toHaveCount(0);
 await page.getByLabel('搜索分类').fill('不存在');
 await expect(dialog).toContainText('没有找到匹配的文件夹');
 await page.getByLabel('搜索分类').fill('项目/空子分类');
 await page.getByRole('button', { name: '选择分类：项目/空子分类', exact: true }).click();
 await page.getByLabel('搜索分类').clear();
 await expect(page.getByRole('button', { name: '选择分类：项目/空子分类', exact: true })).toHaveAttribute('aria-pressed', 'true');
 await page.getByLabel('笔记标题').fill('移动后的笔记');
 await page.screenshot({ path: 'test-results/move-note-folders.png' });
 await page.getByRole('button', { name: '保存更改', exact: true }).click();
 await expect(dialog).toHaveCount(0);
 await expect(note(page, '移动后的笔记')).toBeVisible();
 await expect(page.locator('.wysiwyg-content h1')).toHaveText('保留的笔记');
 await page.getByRole('button', { name: /^全部笔记/ }).click();
 await expect(note(page, '保留的笔记')).toHaveClass(/selected/);
 await page.reload();
 const state = await readState(page);
 expect(state.manifest.notes.find((note: { id: string }) => note.id === 'parent')).toMatchObject({ title: '移动后的笔记', category: '项目/空子分类' });
 expect(state.contents.parent).toContain('原正文');
});

test('move dialog can select root and fits a small window in dark mode', async ({ page }) => {
 await page.emulateMedia({ colorScheme: 'dark' });
 await page.setViewportSize({ width: 780, height: 700 });
 await expandFolder(page, '项目'); await folder(page, '项目').click(); await note(page, '父分类笔记').click({ button: 'right' });
 await page.getByRole('menuitem', { name: '重命名 / 移动笔记' }).click();
 await page.getByRole('button', { name: '选择分类：笔记库根目录', exact: true }).click();
 await expect(page.locator('.category-destination')).toContainText('笔记库根目录');
 await expect(page.getByRole('button', { name: '保存更改', exact: true })).toBeInViewport();
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await page.screenshot({ path: 'test-results/move-note-dark.png' });
 await page.getByRole('button', { name: '保存更改', exact: true }).click();
 await expect(note(page, '父分类笔记')).toBeVisible();
 await note(page, '父分类笔记').click({ button: 'right' });
 await page.getByRole('menuitem', { name: '重命名 / 移动笔记' }).click();
 await expect(page.getByRole('button', { name: '选择分类：笔记库根目录', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

async function renameFolder(page: Page, name: string, next: string) {
 await folder(page, name).click({ button: 'right' });
 await page.getByRole('menuitem', { name: '重命名文件夹', exact: true }).click();
 await page.getByLabel('文件夹名称', { exact: true }).fill(next);
 await page.getByRole('button', { name: '保存更改', exact: true }).click();
}

test('renaming a folder preserves the selected descendant, tabs, drafts and empty subfolders', async ({ page }) => {
 await expandFolder(page, '项目'); await folder(page, '项目').click(); await folder(page, '子分类').click(); await note(page, '子分类笔记').click();
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await page.locator('.cm-content').fill('# 重命名前的未保存正文');
 await renameFolder(page, '项目', '新项目');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(folder(page, '项目')).toHaveCount(0);
 await expect(folder(page, '子分类')).toHaveAttribute('title', '新项目/子分类');
 await expect(folder(page, '子分类')).toHaveAttribute('aria-pressed', 'true');
 await expect(folder(page, '空子分类')).toHaveAttribute('title', '新项目/空子分类');
 await expect(page.locator('.cm-content')).toContainText('未保存正文');
 await expect(page.locator('.tabs')).toContainText('子分类笔记');
 await expect(page.locator('.breadcrumbs')).toContainText('新项目');
 await expect(folder(page, '项目备份')).toHaveCount(1);
 await page.reload();
 await expect(folder(page, '新项目')).toBeVisible();
 const state = await readState(page);
 expect(state.manifest.notes.find((note: { id: string }) => note.id === 'child').category).toBe('新项目/子分类');
 expect(state.contents.child).toContain('未保存正文');
});

test('folder renaming supports cancellation, empty folders and rejects names and collisions', async ({ page }) => {
 await folder(page, '空文件夹').click({ button: 'right' });
 await page.getByRole('menuitem', { name: '重命名文件夹', exact: true }).click();
 await page.getByLabel('文件夹名称', { exact: true }).fill('取消的名称');
 await page.getByRole('button', { name: '取消', exact: true }).click();
 await expect(folder(page, '空文件夹')).toBeVisible();
 await renameFolder(page, '空文件夹', '项目');
 await expect(page.locator('.toast.error')).toContainText('同名文件夹');
 await expect(page.getByRole('dialog')).toBeVisible();
 await page.getByLabel('文件夹名称', { exact: true }).fill('无效/名字');
 await page.getByRole('button', { name: '保存更改', exact: true }).click();
 await expect(page.locator('.toast.error')).toContainText('不含 /');
 await page.getByLabel('文件夹名称', { exact: true }).fill('新空文件夹');
 await page.getByRole('button', { name: '保存更改', exact: true }).click();
 await expect(folder(page, '新空文件夹')).toBeVisible();
 await page.reload();
 await expect(folder(page, '新空文件夹')).toBeVisible();
});

test('dragging folders moves the entire subtree into a collapsed folder and back to root', async ({ page }) => {
 await expandFolder(page, '项目'); await folder(page, '项目').click(); await folder(page, '子分类').click(); await note(page, '子分类笔记').click();
 await folder(page, '项目').dragTo(folder(page, '项目备份'));
 await expect(folder(page, '项目')).toHaveAttribute('title', '项目备份/项目');
 await expect(folder(page, '子分类')).toHaveAttribute('title', '项目备份/项目/子分类');
 await expect(folder(page, '子分类')).toHaveAttribute('aria-pressed', 'true');
 await expect(note(page, '子分类笔记')).toHaveClass(/selected/);
 await expect(folder(page, '项目')).toHaveAttribute('draggable', 'true');
 const source = await folder(page, '项目').boundingBox();
 await page.mouse.move(source!.x + 55, source!.y + source!.height / 2);
 await page.mouse.down();
 await page.mouse.move(source!.x + 70, source!.y + 12, { steps: 5 });
 const root = page.locator('.folder-root-drop');
 await expect(root).toBeVisible();
 await root.hover();
 const target = await root.boundingBox();
 await page.mouse.move(target!.x + target!.width / 2 + 2, target!.y + target!.height / 2);
 await expect(root).toHaveClass(/folder-drop-target/);
 await page.screenshot({ path: 'test-results/folder-drag-root.png' });
 await page.mouse.up();
 await expect(folder(page, '项目')).toHaveAttribute('title', '项目');
 await expect(folder(page, '子分类')).toHaveAttribute('title', '项目/子分类');
 await expect(folder(page, '项目备份')).toBeVisible();
 await page.reload();
 const state = await readState(page);
 expect(state.manifest.categories).toContain('项目/空子分类');
 expect(state.manifest.notes.find((note: { id: string }) => note.id === 'child').category).toBe('项目/子分类');
});

test('dragging into self or descendants is ignored and destination collisions leave both trees intact', async ({ page }) => {
 await expandFolder(page, '项目'); await folder(page, '项目').click();
 const before = await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).manifest);
 await folder(page, '项目').dragTo(folder(page, '子分类'));
 expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).manifest)).toEqual(before);
 await page.getByTitle('新建分类', { exact: true }).click();
 await page.getByLabel('分类名称').fill('项目备份/项目');
 await page.getByRole('button', { name: '创建分类', exact: true }).click();
 await page.getByRole('dialog').waitFor({ state: 'hidden' });
 await page.locator('.folder-row[title="项目"]').dragTo(page.locator('.folder-row[title="项目备份"]'));
 await expect(page.locator('.toast.error')).toContainText('同名文件夹');
 await expect(page.locator('.folder-row[title="项目"]')).toBeVisible();
 await expect(page.locator('.folder-row[title="项目备份/项目"]')).toBeVisible();
 const state = await readState(page);
 expect(state.manifest.notes.find((note: { id: string }) => note.id === 'parent').category).toBe('项目');
});

test('v1 migration persists UUID references and folder edits change only one folder record', async ({ page }) => {
 const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).manifest);
 const before = await stored();
 expect(before.version).toBe(2);
 expect(before.categories).toBeUndefined();
 for (const entry of before.folders) expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
 for (const entry of before.notes) { expect(entry.category).toBeUndefined(); expect(entry.folderId).toBeTruthy(); }
 const parent = before.folders.find((entry: { name: string }) => entry.name === '项目');
 await renameFolder(page, '项目', '重命名项目');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 const renamed = await stored();
 expect(renamed.notes).toEqual(before.notes);
 expect(renamed.folders).toEqual(before.folders.map((entry: { id: string }) => entry.id === parent.id ? { ...entry, name: '重命名项目' } : entry));
 await expect(folder(page, '重命名项目')).toHaveAttribute('draggable', 'true');
 await folder(page, '重命名项目').dragTo(folder(page, '项目备份'));
 await expect(folder(page, '重命名项目')).toHaveAttribute('title', '项目备份/重命名项目');
 const moved = await stored();
 const target = before.folders.find((entry: { name: string }) => entry.name === '项目备份');
 expect(moved.notes).toEqual(before.notes);
 expect(moved.folders).toEqual(renamed.folders.map((entry: { id: string }) => entry.id === parent.id ? { ...entry, parentId: target.id } : entry));
 await page.reload();
 expect(await stored()).toEqual(moved);
});

test('dragging folder edges reorders roots and children and persists their subtree order', async ({ page }) => {
 const before = await readState(page);
 await expandFolder(page, '项目'); await folder(page, '项目').click();
 await folder(page, '项目').dragTo(folder(page, '空文件夹'), { targetPosition: { x: 60, y: 31 } });
 await expect(folder(page, '项目')).toHaveAttribute('draggable', 'true');
 await expect.poll(() => page.locator('.folder-row').evaluateAll(rows => rows.map(row => row.getAttribute('title')))).toEqual(['项目备份', '空文件夹', '项目', '项目/子分类', '项目/空子分类']);
 await folder(page, '空子分类').dragTo(folder(page, '子分类'), { targetPosition: { x: 60, y: 3 } });
 await expect.poll(() => page.locator('.folder-row').evaluateAll(rows => rows.map(row => row.getAttribute('title')))).toEqual(['项目备份', '空文件夹', '项目', '项目/空子分类', '项目/子分类']);
 await page.reload();
 await expect.poll(async () => (await readState(page)).manifest.categories).toEqual(['项目备份', '空文件夹', '项目', '项目/空子分类', '项目/子分类']);
 const after = await readState(page);
 expect(after.manifest.notes).toEqual(before.manifest.notes);
 expect(after.manifest.folders.map((entry: { id: string }) => entry.id).sort()).toEqual(before.manifest.folders.map((entry: { id: string }) => entry.id).sort());
});

test('dragging a folder beside a folder under another parent moves and orders the entire subtree', async ({ page }) => {
 await expandFolder(page, '项目'); await folder(page, '项目').click();
 await folder(page, '空文件夹').dragTo(folder(page, '子分类'), { targetPosition: { x: 60, y: 3 } });
 await expect(folder(page, '空文件夹')).toHaveAttribute('title', '项目/空文件夹');
 await expect.poll(async () => (await readState(page)).manifest.categories).toEqual(['项目', '项目/空文件夹', '项目/子分类', '项目/空子分类', '项目备份']);
 await page.reload();
 await expandFolder(page, '项目'); await folder(page, '项目').click();
 await expect(folder(page, '空文件夹')).toHaveAttribute('title', '项目/空文件夹');
});

test('dragging the active note into an empty folder saves drafts and preserves the editor and tabs', async ({ page }) => {
 await expandFolder(page, '项目'); await folder(page, '项目').click(); await note(page, '父分类笔记').click();
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await page.locator('.cm-content').fill('# 拖动前的未保存正文');
 await expect(note(page, '父分类笔记')).toHaveAttribute('draggable', 'true');
 await note(page, '父分类笔记').dragTo(folder(page, '空文件夹'));
 await expect(folder(page, '空文件夹')).toHaveAttribute('aria-pressed', 'true');
 await expect(note(page, '父分类笔记')).toHaveClass(/selected/);
 await expect(page.locator('.cm-content')).toContainText('拖动前的未保存正文');
 await expect(page.locator('.tabs')).toContainText('父分类笔记');
 await expect(page.locator('.breadcrumbs')).toContainText('空文件夹');
 const moved = await readState(page);
 expect(moved.manifest.notes.find((entry: { id: string }) => entry.id === 'parent')).toMatchObject({ category: '空文件夹', filename: 'parent.md' });
 expect(moved.contents.parent).toContain('拖动前的未保存正文');
 await page.reload();
 await expect(folder(page, '空文件夹')).toHaveAttribute('aria-pressed', 'true');
 await expect(page.locator('.wysiwyg-content')).toContainText('拖动前的未保存正文');
});

test('dragging a search result into a collapsed folder expands it and can target an empty child without changing the open note', async ({ page }) => {
 await folder(page, '项目备份').click(); await note(page, '保留的笔记').click();
 await page.getByPlaceholder('搜索你的笔记…').fill('父分类笔记');
 const card = note(page, '父分类笔记'), bounds = (await card.boundingBox())!;
 await page.mouse.move(bounds.x + 50, bounds.y + 30); await page.mouse.down();
 await page.mouse.move(bounds.x + 65, bounds.y + 40, { steps: 5 });
 await folder(page, '项目').hover();
 const parent = (await folder(page, '项目').boundingBox())!;
 await page.mouse.move(parent.x + 60, parent.y + parent.height / 2);
 await expect(folder(page, '空子分类')).toBeVisible();
 await folder(page, '空子分类').hover();
 const child = (await folder(page, '空子分类').boundingBox())!;
 await page.mouse.move(child.x + 62, child.y + child.height / 2);
 await expect(folder(page, '空子分类').locator('..')).toHaveClass(/folder-drop-target/);
 await page.screenshot({ path: 'test-results/note-drag-folder.png' });
 await page.mouse.up();
 await expect(folder(page, '空子分类')).toHaveAttribute('aria-pressed', 'true');
 await expect(page.getByPlaceholder('搜索你的笔记…')).toHaveValue('');
 await expect(page.locator('.wysiwyg-content h1')).toHaveText('保留的笔记');
 expect((await readState(page)).manifest.notes.find((entry: { id: string }) => entry.id === 'parent').category).toBe('项目/空子分类');
});

test('note dragging to its current folder is ignored, cancellation clears feedback and root drop removes its category', async ({ page }) => {
 await expandFolder(page, '项目'); await folder(page, '项目').click();
 const before = (await readState(page)).manifest;
 await note(page, '父分类笔记').dragTo(folder(page, '项目'));
 expect((await readState(page)).manifest).toEqual(before);
 const card = (await note(page, '父分类笔记').boundingBox())!;
 await page.mouse.move(card.x + 50, card.y + 30); await page.mouse.down();
 await page.mouse.move(card.x + 65, card.y + 40, { steps: 5 });
 await expect(page.locator('.folder-root-drop')).toBeVisible();
 await page.keyboard.press('Escape'); await page.mouse.up();
 await expect(page.locator('.folder-root-drop')).toHaveCount(0);
 expect((await readState(page)).manifest).toEqual(before);
 await page.mouse.move(card.x + 50, card.y + 30); await page.mouse.down();
 await page.mouse.move(card.x + 65, card.y + 40, { steps: 5 });
 const root = page.locator('.folder-root-drop');
 await expect(root).toHaveText('拖到此处移至未分类');
 await root.hover();
 const target = (await root.boundingBox())!;
 await page.mouse.move(target.x + target.width / 2 + 2, target.y + target.height / 2);
 await expect(root).toHaveClass(/folder-drop-target/); await page.mouse.up();
 await expect(page.locator('.file-list-header h2')).toHaveText('未分类');
 await expect(note(page, '父分类笔记')).toBeVisible();
 await page.reload();
 expect((await readState(page)).manifest.notes.find((entry: { id: string }) => entry.id === 'parent')).toMatchObject({ category: '', folderId: null });
});
