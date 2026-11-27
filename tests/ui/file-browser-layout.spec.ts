import { test, expect, type Page } from '@playwright/test';

const layoutSwitch = (page: Page) => page.getByRole('switch', { name: '单栏文件浏览' });
const folder = (page: Page, path: string) => page.locator(`.folder-row[title="${path}"]`);
const treeNote = (page: Page, title: string) => page.getByLabel('文件树').getByRole('button', { name: title, exact: true });

test('switches between a separate note list and an expandable tree without closing the note', async ({ page }) => {
 await page.goto('/');
 await expect(page.locator('.file-list-panel')).toBeVisible();
 await page.locator('.note-card[title="Fever 产品构想"]').click();
 const currentNote = page.locator('.tab.current');
 await expect(currentNote).toContainText('Fever 产品构想');

 await page.getByTitle('设置', { exact: true }).click();
 await expect(layoutSwitch(page)).toHaveAttribute('aria-checked', 'false');
 await layoutSwitch(page).click();
 await expect(page.locator('.file-list-panel')).toHaveCount(0);
 await page.getByRole('button', { name: '保存设置' }).click();
 const product = treeNote(page, 'Fever 产品构想');
 await expect(product).toHaveAttribute('aria-current', 'page');
 const parent = (await folder(page, '项目/Fever').boundingBox())!;
 const child = (await product.boundingBox())!;
 const folderRow = (await folder(page, '项目/Fever').locator('..').boundingBox())!;
 expect(child.y).toBeGreaterThan(parent.y);
 expect(child.x).toBeGreaterThan(folderRow.x + 12);
 await folder(page, '项目/Fever').click();
 await expect(product).toHaveCount(0);
 await expect(currentNote).toContainText('Fever 产品构想');
 await folder(page, '项目/Fever').click();
 await expect(product).toBeVisible();

 await page.reload();
 await expect(product).toHaveAttribute('aria-current', 'page');
 await page.getByTitle('设置', { exact: true }).click();
 await expect(layoutSwitch(page)).toHaveAttribute('aria-checked', 'true');
 await layoutSwitch(page).click();
 await page.getByRole('button', { name: '保存设置' }).click();
 await expect(page.locator('.file-list-panel .note-card[title="Fever 产品构想"]')).toHaveAttribute('aria-current', 'page');
 await expect(page.locator('.sidebar .note-row')).toHaveCount(0);
});

test('single-column search and trash share the sidebar and mobile can return to the editor', async ({ page }) => {
 await page.setViewportSize({ width: 390, height: 760 });
 await page.goto('/');
 await page.getByTitle('设置', { exact: true }).click();
 await layoutSwitch(page).click();
 await page.getByRole('button', { name: '保存设置' }).click();

 const sidebar = page.getByLabel('文件浏览栏');
 await expect(sidebar).toBeVisible();
 expect((await sidebar.boundingBox())!.width).toBe(390);
 await sidebar.getByRole('button', { name: /^回收站/ }).click();
 await expect(sidebar.getByText('回收站是空的')).toBeVisible();
 await sidebar.getByRole('button', { name: /^全部笔记/ }).click();
 await page.getByRole('textbox', { name: '搜索笔记' }).fill('Markdown 语法指南');
 await sidebar.locator('.note-card[title="Markdown 语法指南"]').click();
 await expect(page.locator('.wysiwyg-content h1')).toHaveText('Markdown 语法指南');
 await expect(sidebar).toBeHidden();
 await page.getByTitle('切换侧栏').click();
 await page.getByTitle('清空搜索').click();
 await expect(treeNote(page, 'Markdown 语法指南')).toHaveAttribute('aria-current', 'page');
 await page.getByTitle('返回编辑区').click();
 await expect(page.locator('.wysiwyg-content h1')).toBeVisible();
});

test('files can be dragged between folders and uncategorized files appear at the root', async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('fever-single-column', 'true'));
 await page.goto('/');
 await folder(page, '开始使用').click();
 const note = treeNote(page, 'Markdown 语法指南');
 await note.dragTo(folder(page, '阅读'));
 await expect(folder(page, '阅读')).toHaveAttribute('aria-pressed', 'true');
 await folder(page, '阅读').click();
 await expect(note).toHaveCount(0);
 await folder(page, '阅读').click();
 await note.click({ button: 'right' });
 await page.getByRole('menuitem', { name: '重命名 / 移动笔记' }).click();
 await page.getByRole('button', { name: '选择分类：笔记库根目录', exact: true }).click();
 await page.getByRole('button', { name: '保存更改', exact: true }).click();
 await expect(note.locator('..')).toHaveCSS('padding-left', '0px');
 await folder(page, '阅读').click();
 await expect(note).toBeVisible();
});
