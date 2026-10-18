import { test, expect, type Page } from '@playwright/test';

async function openNote(page: Page, content = '快捷键正文\n') {
 await page.addInitScript(content => {
  const note = { id: 'shortcuts', title: '快捷键测试', category: '测试', filename: 'shortcuts.md', createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z' };
  localStorage.setItem('fever-demo-v1', JSON.stringify({ manifest: { version: 1, notes: [note], categories: ['测试'] }, contents: { shortcuts: content }, versions: {}, images: {}, dirty: [], settings: {} }));
 }, content);
 await page.goto('/');
 await page.locator('.folder-row').filter({ hasText: '测试' }).click();
 await page.locator('.note-row').filter({ hasText: '快捷键测试' }).click();
 await expect(page.getByRole('textbox', { name: '笔记正文' })).toBeVisible();
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).contents.shortcuts as string);
const formats = [
 { key: 'b', selector: 'strong', markdown: '**快捷键正文**' },
 { key: 'i', selector: 'em', markdown: '*快捷键正文*' },
 { key: 'Shift+x', selector: 's', markdown: '~~快捷键正文~~' },
 { key: '`', selector: 'p code', markdown: '`快捷键正文`' },
 { key: 'Shift+l', selector: 'pre code', markdown: '```\n快捷键正文\n```' },
 { key: 'Shift+b', selector: 'blockquote', markdown: '> 快捷键正文' },
 { key: 'Shift+8', selector: 'ul:not([data-type]) li', markdown: '- 快捷键正文' },
 { key: 'Shift+7', selector: 'ol li', markdown: '1. 快捷键正文' },
 { key: 'Shift+9', selector: 'li:has(input[type="checkbox"])', markdown: '- [ ] 快捷键正文' },
 ...[1, 2, 3, 4, 5, 6].map(level => ({ key: String(level), selector: `h${level}`, markdown: '#'.repeat(level) + ' 快捷键正文' })),
];

for (const format of formats) {
 test(`rich text shortcut ${format.key} formats the selection, saves and toggles off`, async ({ page }) => {
  await openNote(page);
  const editor = page.getByRole('textbox', { name: '笔记正文' });
  await editor.locator('p').first().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press(`ControlOrMeta+${format.key}`);
  await expect(editor.locator(format.selector).first()).toContainText('快捷键正文');
  await expect.poll(() => saved(page)).toContain(format.markdown);
  await page.keyboard.press(`ControlOrMeta+${format.key}`);
  await expect(editor.locator(format.selector)).toHaveCount(0);
  await expect(editor).toHaveText('快捷键正文');
 });
}

test('source formatting preserves the selection, handles multiline blocks and supports undo/redo', async ({ page }) => {
 await openNote(page, 'first\nsecond');
 await page.keyboard.press('ControlOrMeta+e');
 const source = page.locator('.source-editor .cm-content');
 await source.click();
 await page.keyboard.press('ControlOrMeta+a');
 await page.keyboard.press('ControlOrMeta+Shift+l');
 await expect(source).toHaveText('```firstsecond```');
 await expect.poll(() => saved(page)).toBe('```\nfirst\nsecond\n```');
 await page.keyboard.press('ControlOrMeta+Shift+l');
 await expect.poll(() => saved(page)).toBe('first\nsecond');
 await page.keyboard.press('ControlOrMeta+z');
 await expect.poll(() => saved(page)).toBe('```\nfirst\nsecond\n```');
 await page.keyboard.press('ControlOrMeta+Shift+z');
 await expect.poll(() => saved(page)).toBe('first\nsecond');
 await page.keyboard.press('ControlOrMeta+b');
 await expect.poll(() => saved(page)).toBe('**first\nsecond**');
 await page.keyboard.press('ControlOrMeta+b');
 await expect.poll(() => saved(page)).toBe('first\nsecond');
 await page.keyboard.press('ControlOrMeta+Shift+7');
 await expect.poll(() => saved(page)).toBe('1. first\n2. second');
 await page.keyboard.press('ControlOrMeta+Shift+7');
 await expect.poll(() => saved(page)).toBe('first\nsecond');
 await page.keyboard.press('ControlOrMeta+2');
 await expect.poll(() => saved(page)).toBe('## first\n## second');
 await page.keyboard.press('ControlOrMeta+0');
 await expect.poll(() => saved(page)).toBe('first\nsecond');
});

test('source inline formatting places an empty cursor between markers', async ({ page }) => {
 await openNote(page, '正文');
 await page.keyboard.press('ControlOrMeta+e');
 await page.locator('.source-editor .cm-content').click();
 await page.keyboard.press('ControlOrMeta+End');
 await page.keyboard.press('ControlOrMeta+b');
 await page.keyboard.insertText('加粗');
 await expect.poll(() => saved(page)).toBe('正文**加粗**');
});

test('settings shortcut works from either editor, preserves drafts and blocks other app shortcuts in dialogs', async ({ page }) => {
 await openNote(page);
 const editor = page.getByRole('textbox', { name: '笔记正文' });
 await editor.locator('p').first().click();
 await page.keyboard.press('ControlOrMeta+e');
 const source = page.locator('.source-editor .cm-content');
 await expect(source).toBeVisible();
 expect(await saved(page)).toBe('快捷键正文\n');
 await source.click();
 await page.keyboard.press('ControlOrMeta+,');
 await expect(page.getByRole('heading', { name: '笔记库设置' })).toBeVisible();
 await page.getByRole('tab', { name: '快捷键', exact: true }).click();
 await expect(page.locator('.shortcut-list')).toContainText('代码块');
 expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
 await page.keyboard.press('ControlOrMeta+b');
 expect(await saved(page)).toBe('快捷键正文\n');
 await page.getByRole('tab', { name: '同步与备份', exact: true }).click();
 await page.getByLabel('用户名').fill('未保存的名字');
 await page.keyboard.press('ControlOrMeta+,');
 await page.keyboard.press('ControlOrMeta+n');
 await expect(page.getByLabel('用户名')).toHaveValue('未保存的名字');
 await expect(page.getByRole('heading', { name: '笔记库设置' })).toBeVisible();
 await page.keyboard.press('ControlOrMeta+b');
 expect(await saved(page)).toBe('快捷键正文\n');
 await page.getByRole('button', { name: '取消', exact: true }).click();
 await page.keyboard.press('ControlOrMeta+e');
 await expect(editor).toBeVisible();
 await editor.locator('p').first().click();
 await page.keyboard.press('ControlOrMeta+,');
 await expect(page.getByRole('heading', { name: '笔记库设置' })).toBeVisible();
});
