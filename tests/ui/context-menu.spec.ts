import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
 await page.addInitScript(() => {
  const notes = ['first', 'second'].map((id, i) => ({ id, title: i ? '另一篇笔记' : '当前笔记', category: '测试', filename: `${id}.md`, createdAt: '2026-10-08T00:00:00Z', updatedAt: '2026-10-08T00:00:00Z' }));
  if (!localStorage.getItem('fever-demo-v1')) localStorage.setItem('fever-demo-v1', JSON.stringify({ manifest: { version: 1, notes, categories: ['测试'] }, contents: { first: '# 标题\n\n选中正文\n\n尾段\n', second: '# 另一篇\n\n其他内容\n' }, versions: {}, images: {}, dirty: [], settings: { autoCommit: false, interval: 10, author: '', email: '', remote: '' } }));
 });
 await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
 const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
 (page as Page & { errors: string[] }).errors = errors;
 await page.goto('/');
 await page.locator('.folder-row').filter({ hasText: '测试' }).click();
 await page.locator('.note-row').filter({ hasText: '当前笔记' }).click();
 await expect(page.locator('.note-row.selected .note-card-title strong')).toHaveText('当前笔记');
});
test.afterEach(({ page }) => { expect((page as Page & { errors: string[] }).errors).toEqual([]); });

const menu = (page: Page) => page.getByRole('menu');
async function selectProse(page: Page) {
 await page.getByRole('textbox', { name: '笔记正文' }).focus();
 await page.locator('.wysiwyg-content > p').first().evaluate(p => {
  const range = document.createRange(); range.selectNodeContents(p);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
 });
 await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function editor(page: Page) {
 await page.getByTitle('编辑模式 · ⌘ E').click();
 await expect(page.getByRole('textbox', { name: '笔记正文' })).toBeVisible();
 return page.getByRole('textbox', { name: '笔记正文' });
}
async function openRichMenu(page: Page) {
 // Dispatching contextmenu preserves a selection made with the mouse.
 await page.locator('.wysiwyg-content > p').first().evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 300 })));
}

test('list actions target the clicked note while keeping the current document open', async ({ page }) => {
 const other = page.locator('.note-row').filter({ hasText: '另一篇笔记' });
 await other.click({ button: 'right' });
 await menu(page).getByRole('menuitem', { name: '复制 Markdown', exact: true }).click();
 await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('其他内容');
 await expect(page.locator('.note-row.selected .note-card-title strong')).toHaveText('当前笔记');
 await other.click({ button: 'right' });
 await menu(page).getByRole('menuitem', { name: '重命名 / 移动笔记' }).click();
 await expect(page.getByLabel('笔记标题')).toHaveValue('另一篇笔记');
 await page.getByLabel('笔记标题').fill('改名的笔记');
 await page.getByRole('button', { name: '保存更改' }).click();
 await expect(page.locator('.note-row.selected .note-card-title strong')).toHaveText('当前笔记');
 const renamed = page.locator('.note-row').filter({ hasText: '改名的笔记' });
 await renamed.click({ button: 'right' });
 await menu(page).getByRole('menuitem', { name: '删除笔记', exact: true }).click();
 await expect(page.getByRole('dialog')).toContainText('「改名的笔记」');
 await page.getByRole('button', { name: '删除笔记', exact: true }).click();
 await expect(renamed).toHaveCount(0);
 await expect(page.locator('.wysiwyg-content h1')).toHaveText('标题');
 await page.reload();
 await page.locator('.folder-row').filter({ hasText: '测试' }).click();
 await expect(page.locator('.note-row')).toHaveCount(1);
});

test('folder and blank menus create in the correct category and search rows open notes', async ({ page }) => {
 await page.locator('.folder-row').click({ button: 'right' });
 await menu(page).getByRole('menuitem', { name: '新建笔记', exact: true }).click();
 await expect(page.getByLabel('所属分类')).toHaveValue('测试');
 await page.getByRole('button', { name: '取消', exact: true }).click();
 await page.locator('.folder-row').click({ button: 'right' });
 await menu(page).getByRole('menuitem', { name: '新建子分类' }).click();
 await expect(page.getByLabel('分类名称')).toHaveValue('测试/');
 await page.getByRole('button', { name: '取消', exact: true }).click();
 await page.locator('.note-list').click({ button: 'right', position: { x: 30, y: 330 } });
 await menu(page).getByRole('menuitem', { name: '新建笔记', exact: true }).click();
 await expect(page.getByLabel('所属分类')).toHaveValue('测试');
 await page.getByRole('button', { name: '取消', exact: true }).click();
 await page.getByPlaceholder('搜索你的笔记…').fill('另一篇');
 await page.locator('.note-row').click({ button: 'right' });
 await menu(page).getByRole('menuitem', { name: '打开笔记' }).click();
 await expect(page.locator('.note-row.selected .note-card-title strong')).toHaveText('另一篇笔记');
 await expect(page.locator('.wysiwyg-content h1')).toHaveText('另一篇');
});

test('rich editor preserves selection for formatting, copying, cutting and undo', async ({ page }) => {
 const body = await editor(page);
 await selectProse(page); await body.locator('p').first().click({ button: 'right' });
 await menu(page).getByRole('menuitemcheckbox', { name: '加粗' }).click();
 await expect(body.locator('strong')).toHaveText('选中正文');
 await selectProse(page); await openRichMenu(page);
 await menu(page).getByRole('menuitem', { name: '复制', exact: true }).click();
 await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('选中正文');
 await selectProse(page); await openRichMenu(page);
 await menu(page).getByRole('menuitem', { name: '剪切', exact: true }).click();
 await expect(body).not.toContainText('选中正文');
 await openRichMenu(page);
 await menu(page).getByRole('menuitem', { name: '撤销', exact: true }).click();
 await expect(body.locator('strong')).toHaveText('选中正文');
 await openRichMenu(page);
 await menu(page).getByRole('menuitem', { name: '重做', exact: true }).click();
 await expect(body).not.toContainText('选中正文');
 await page.keyboard.press('Shift+F10');
 await menu(page).getByRole('menuitem', { name: '粘贴', exact: true }).click();
 await expect(body.locator('strong')).toHaveText('选中正文');
});

test('rich menu pastes Markdown at the cursor and saves changes', async ({ page }) => {
 const body = await editor(page);
 await selectProse(page); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
 await page.evaluate(() => navigator.clipboard.writeText('## 粘贴标题\n\n**粘贴正文**'));
 await page.keyboard.press('Shift+F10');
 await expect(menu(page).getByRole('menuitem', { name: '复制', exact: true })).toBeDisabled();
 await menu(page).getByRole('menuitem', { name: '粘贴', exact: true }).click();
 await expect(body.locator('h2')).toHaveText('粘贴标题');
 await expect(body.locator('strong')).toHaveText('粘贴正文');
 await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).contents.first)).toContain('**粘贴正文**');
});

test('source editor cuts and pastes literal text, supports history and select all', async ({ page }) => {
 await page.getByTitle('Markdown 源码与预览').click();
 const source = page.locator('.cm-content'); await source.click();
 await source.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 300 })));
 await menu(page).getByRole('menuitem', { name: '全选', exact: true }).click();
 await source.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 300 })));
 await menu(page).getByRole('menuitem', { name: '剪切', exact: true }).click();
 await expect(source.locator('.cm-placeholder')).toBeVisible();
 await page.evaluate(() => navigator.clipboard.writeText('# 新标题\n\n**字面内容**'));
 await source.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 300 })));
 await menu(page).getByRole('menuitem', { name: '粘贴', exact: true }).click();
 await expect(source).toContainText('**字面内容**');
 await source.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 300 })));
 await menu(page).getByRole('menuitem', { name: '撤销', exact: true }).click();
 await expect(source.locator('.cm-placeholder')).toBeVisible();
 await source.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 300 })));
 await menu(page).getByRole('menuitem', { name: '重做', exact: true }).click();
 await expect(source).toContainText('**字面内容**');
 await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).contents.first)).toContain('字面内容');
});

test('menus fit the viewport, support keyboard navigation, dismiss and replace each other', async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('fever-theme', 'dark'));
 const body = await editor(page);
 await body.evaluate(element => element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1438, clientY: 998 })));
 const bounds = await menu(page).boundingBox();
 expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1440);
 expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(1000);
 await page.keyboard.press('End');
 await expect(menu(page).getByRole('menuitemcheckbox', { name: '代码块', exact: true })).toBeFocused();
 await page.keyboard.press('Escape'); await expect(menu(page)).toHaveCount(0); await expect(body).toBeFocused();
 await openRichMenu(page);
 await page.locator('.note-row').first().click({ button: 'right' });
 await expect(menu(page)).toHaveCount(1);
 await expect(menu(page)).toHaveAttribute('aria-label', '笔记列表菜单');
 await page.locator('.sidebar-brand').click(); await expect(menu(page)).toHaveCount(0);
 await page.locator('.note-row').first().click({ button: 'right' });
 await page.screenshot({ path: 'test-results/context-menu-dark.png' });
 await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
 await expect(menu(page)).toHaveCount(0);
 await expect(body).toBeVisible();
});

test('source preview offers selection copy and editing entry', async ({ page }) => {
 await page.getByTitle('Markdown 源码与预览').click();
 await page.locator('.document > .prose').click({ button: 'right' });
 await expect(menu(page)).toHaveAttribute('aria-label', '笔记正文菜单');
 await menu(page).getByRole('menuitem', { name: '编辑笔记' }).click();
 await expect(page.getByRole('textbox', { name: '笔记正文' })).toBeVisible();
});

test('failed clipboard writes never delete the selected content', async ({ page }) => {
 const body = await editor(page);
 await page.evaluate(() => {
  Object.defineProperty(navigator.clipboard, 'write', { value: async () => { throw new Error('denied'); } });
  Object.defineProperty(navigator.clipboard, 'writeText', { value: async () => { throw new Error('denied'); } });
 });
 await selectProse(page); await openRichMenu(page);
 await menu(page).getByRole('menuitem', { name: '剪切', exact: true }).click();
 await expect(page.locator('.toast.error')).toContainText('复制失败');
 await expect(body).toContainText('选中正文');
});

test('table menu actions update the table at the cursor', async ({ page }) => {
 const body = await editor(page);
 await page.getByRole('button', { name: '插入表格', exact: true }).click();
 await expect(body.locator('tr')).toHaveCount(3);
 await body.locator('td').first().click();
 await page.keyboard.press('Shift+F10');
 await menu(page).getByRole('menuitem', { name: '添加行', exact: true }).click();
 await expect(body.locator('tr')).toHaveCount(4);
 await page.keyboard.press('Shift+F10');
 await menu(page).getByRole('menuitem', { name: '删除行', exact: true }).click();
 await expect(body.locator('tr')).toHaveCount(3);
});
