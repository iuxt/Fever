import { test, expect } from '@playwright/test';

test('deleting saves pending edits and restores the original note after reload', async ({ page }) => {
 const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
 await page.goto('/');
 await page.getByRole('button', { name: '新建笔记', exact: true }).first().click();
 await page.getByLabel('笔记标题').fill('保留未提交正文');
 await page.getByLabel('所属分类').fill('测试/原分类');
 await page.getByRole('button', { name: '创建笔记', exact: true }).click();
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await page.locator('.cm-content').fill('# 删除前的最新内容\n\n尚未提交的修改。');
 await page.getByTitle('更多笔记操作').click();
 await page.getByRole('button', { name: '删除笔记', exact: true }).click();
 await expect(page.getByRole('dialog')).toContainText('正文、图片和原分类会保留');
 await page.getByRole('dialog').getByRole('button', { name: '删除笔记', exact: true }).click();
 await expect(page.locator('.toast')).toContainText('已移入回收站');
 const original = await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('fever-demo-v1')!);
  const note = state.manifest.trash[0];
  return { note, content: state.contents[note.id] };
 });
 expect(original.content).toContain('尚未提交的修改。');
 expect(original.note.category).toBe('测试/原分类');
 await page.getByPlaceholder('搜索你的笔记…').fill('保留未提交正文');
 await expect(page.locator('.note-tree .note-row')).toHaveCount(0);
 await page.reload();
 await page.getByRole('button', { name: /^回收站/ }).click();
 await expect(page.getByRole('dialog')).toContainText('保留未提交正文');
 await expect(page.getByRole('dialog')).toContainText('测试/原分类');
 await page.screenshot({ path: 'test-results/trash.png' });
 await page.getByRole('button', { name: '恢复：保留未提交正文', exact: true }).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.locator('.note-row.selected')).toHaveText('保留未提交正文');
 await expect(page.locator('.wysiwyg-content')).toContainText('尚未提交的修改。');
 const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).manifest);
 expect(restored.trash).toEqual([]);
 expect(restored.notes.find((note: { id: string }) => note.id === original.note.id)).toEqual(original.note);
 await page.reload();
 await expect(page.locator('.wysiwyg-content')).toContainText('尚未提交的修改。');
 await page.getByRole('button', { name: /^回收站/ }).click();
 await expect(page.getByRole('dialog')).toContainText('回收站是空的');
 expect(errors).toEqual([]);
});

test('drawing notes keep their complete scene in the trash', async ({ page }) => {
 await page.addInitScript(() => {
  const note = { id: 'drawing-test', title: '可恢复绘图', filename: 'drawing-test.excalidraw', category: '绘图', createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z' };
  if (!localStorage.getItem('fever-demo-v1')) localStorage.setItem('fever-demo-v1', JSON.stringify({ manifest: { version: 1, categories: ['绘图'], notes: [note] }, contents: { [note.id]: JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: { embedded: { dataURL: 'preserved-image-data' } } }) }, versions: {}, images: {}, dirty: [], settings: {} }));
 });
 await page.goto('/');
 await page.locator('.folder-row').click();
 await page.locator('.note-row').click({ button: 'right' });
 await page.getByRole('menuitem', { name: '删除笔记', exact: true }).click();
 await page.getByRole('button', { name: '删除笔记', exact: true }).click();
 await page.reload();
 await page.getByRole('button', { name: /^回收站/ }).click();
 await expect(page.locator('.trash-item')).toContainText('可恢复绘图');
 expect(await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('fever-demo-v1')!);
  return JSON.parse(state.contents[state.manifest.trash[0].id]).files.embedded.dataURL;
 })).toBe('preserved-image-data');
});
