import { test, expect, type Page } from '@playwright/test';

const folder = (page: Page, name: string) => page.locator('.folder-row').filter({ has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) });
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
 await folder(page, '项目').click(); await note(page, '父分类笔记').click();
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
 const original = await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!));
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
 const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!));
 expect(restored.manifest.notes.find((note: { id: string }) => note.id === 'child')).toEqual(original.manifest.trash.find((note: { id: string }) => note.id === 'child'));
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
