import { test, expect } from '@playwright/test';

test('trash browses read-only notes and history with scoped search and pagination', async ({ page }) => {
 const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
 await page.addInitScript(() => {
  const note = (id: string, title: string, category: string) => ({ id, title, category, filename: `${id}.md`, createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z' });
  const trash = Array.from({ length: 25 }, (_, i) => note(`trash-${i}`, `已删除文章 ${i}`, i === 0 ? '消失的文件夹/子目录' : '归档'));
  const active = note('active', '正常文章', '工作');
  const commit = { hash: 'a'.repeat(40), author: 'Tester', date: '2026-10-12T00:00:00Z', message: '删除前的历史' };
  localStorage.setItem('fever-demo-v1', JSON.stringify({
   manifest: { version: 1, categories: ['工作'], notes: [active], trash },
   contents: { active: '# 正常文章\n\n只有正常文章包含的词', ...Object.fromEntries(trash.map(n => [n.id, `# ${n.title}\n\n${n.id === 'trash-0' ? '正文专属检索词\n\n![图片](../images/pixel.png)' : '保留的正文'}`])) },
   versions: { 'trash-0': [{ commit, content: '# 旧版本\n\n历史正文' }] },
   images: { '../images/pixel.png': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5XsAAAAASUVORK5CYII=' },
   dirty: [], settings: {},
  }));
 });
 await page.goto('/');
 await page.getByRole('button', { name: /^回收站/ }).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.locator('.trash-item')).toHaveCount(20);
 await expect(page.getByLabel('回收站分页')).toContainText('1 / 2');
 await expect(page.getByLabel('上一页', { exact: true })).toBeDisabled();
 await page.getByLabel('下一页', { exact: true }).click();
 await expect(page.locator('.trash-item')).toHaveCount(5);
 await expect(page.getByLabel('下一页', { exact: true })).toBeDisabled();
 const search = page.getByPlaceholder('搜索回收站…');
 await search.fill('正文专属检索词');
 await expect(page.locator('.trash-item')).toHaveCount(1);
 await expect(page.getByLabel('回收站分页')).toContainText('1 / 1');
 await page.locator('.trash-note').click();
 const preview = page.getByLabel('回收站笔记（只读）');
 await expect(preview).toContainText('正文专属检索词');
 await expect(preview.locator('img')).toBeVisible();
 await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
 await expect(page.getByTitle('更多笔记操作')).toHaveCount(0);
 await page.keyboard.press('Control+e');
 await expect(page.locator('.cm-content')).toHaveCount(0);
 await page.locator('.trash-note').click({ button: 'right' });
 await expect(page.getByRole('menu')).toContainText('还原到原位置');
 await expect(page.getByRole('menuitem', { name: /删除|编辑|重命名/ })).toHaveCount(0);
 await page.getByRole('menuitem', { name: '查看版本历史', exact: true }).click();
 await page.locator('.history-item').click();
 await expect(page.getByLabel('历史版本（只读）')).toContainText('历史正文');
 await expect(page.getByRole('button', { name: '恢复这个版本', exact: true })).toHaveCount(0);
 await page.getByRole('button', { name: '预览此版本', exact: true }).click();
 await expect(page.getByLabel('历史版本（只读）')).toContainText('旧版本');
 await page.getByRole('button', { name: '返回当前版本', exact: true }).click();
 await expect(preview).toContainText('正文专属检索词');
 await search.fill('只有正常文章包含的词');
 await expect(page.locator('.trash-item')).toHaveCount(0);
 await expect(page.locator('.trash-browser')).toContainText('没有找到相关笔记');
 await search.fill('消失的文件夹/子目录');
 await expect(page.locator('.trash-item')).toHaveCount(1);
 await search.fill('已删除文章 24');
 await expect(page.locator('.trash-item')).toHaveCount(1);
 await search.fill('');
 await expect(page.locator('.trash-item')).toHaveCount(20);
 await page.screenshot({ path: 'test-results/trash-browser.png' });
 await page.getByRole('button', { name: '还原到原位置', exact: true }).click();
 await expect(page.locator('.note-row.selected')).toHaveText('已删除文章 0');
 await expect(page.locator('.wysiwyg-content')).toContainText('正文专属检索词');
 await expect(page.locator('.folder-row').filter({ hasText: '消失的文件夹' })).toHaveCount(1);
 await expect(page.locator('.history-item')).toHaveCount(1);
 await page.getByRole('button', { name: /^回收站/ }).click();
 await page.getByPlaceholder('搜索回收站…').fill('正文专属检索词');
 await expect(page.locator('.trash-item')).toHaveCount(0);
 expect(errors).toEqual([]);
});

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
 await expect(page.locator('.trash-browser')).toContainText('保留未提交正文');
 await expect(page.locator('.trash-browser')).toContainText('测试/原分类');
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
 await expect(page.locator('.trash-browser')).toContainText('回收站是空的');
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
 await page.locator('.trash-note').click();
 await expect(page.getByLabel('回收站笔记（只读）')).toContainText('可恢复绘图');
 await expect(page.getByLabel('回收站笔记（只读）')).toContainText('空白画布');
 await expect(page.locator('.drawing-canvas')).toHaveCount(0);
 await expect(page.getByRole('button', { name: '编辑绘图', exact: true })).toHaveCount(0);
 expect(await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('fever-demo-v1')!);
  return JSON.parse(state.contents[state.manifest.trash[0].id]).files.embedded.dataURL;
 })).toBe('preserved-image-data');
});
