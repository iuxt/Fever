import { test, expect, type Page } from '@playwright/test';

async function seed(page: Page, markdown = '# 查找与替换\n\nAlpha alpha alphabet\n\nalpha **beta** gamma\n\n`alpha`\n', source = false) {
 await page.addInitScript(content => {
  const note = { id: 'find-test', title: '查找测试', category: '测试', filename: 'find.md', createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z' };
  localStorage.setItem('fever-demo-v1', JSON.stringify({ manifest: { version: 1, notes: [note], categories: ['测试'] }, contents: { [note.id]: content }, versions: {}, images: {}, dirty: [], settings: { autoCommit: false, interval: 10, author: '', email: '', remote: '' } }));
 }, markdown);
 await page.goto('/');
 await page.locator('.folder-row').filter({ hasText: '测试' }).click();
 await page.locator('.note-row').filter({ hasText: '查找测试' }).click();
 await expect(page.getByRole('textbox', { name: '笔记正文' })).toBeVisible();
 if (source) await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await expect(page.locator(source ? '.cm-content' : '.wysiwyg-content')).toBeVisible();
}
async function saved(page: Page) { return page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).contents['find-test'] as string); }
async function mod(page: Page) { return page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control'); }
const editor = (page: Page, source: boolean) => page.locator(source ? '.cm-content' : '.wysiwyg-content');
const highlights = (page: Page, source: boolean) => editor(page, source).locator('.article-search-match');
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const list: string[] = []; errors.set(page, list); page.on('pageerror', error => list.push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

for (const source of [false, true]) {
 const mode = source ? 'source' : 'rich text';
 test(`${mode}: keyboard find, options, circular navigation, no mutation, and escape`, async ({ page }) => {
  await seed(page, undefined, source);
  const original = await saved(page);
  await editor(page, source).click();
  await page.keyboard.press(`${await mod(page)}+f`);
  const input = page.getByRole('textbox', { name: '查找内容' });
  await expect(input).toBeFocused();
  await input.fill('alpha');
  await expect(highlights(page, source)).toHaveCount(5);
  await expect(page.locator('.find-count')).toHaveText('1 / 5');
  await input.press('Shift+Enter');
  await expect(page.locator('.find-count')).toHaveText('5 / 5');
  await input.press('Enter');
  await expect(page.locator('.find-count')).toHaveText('1 / 5');
  await page.getByRole('button', { name: '区分大小写', exact: true }).click();
  await expect(highlights(page, source)).toHaveCount(4);
  await page.getByRole('button', { name: '全词匹配', exact: true }).click();
  await expect(highlights(page, source)).toHaveCount(3);
  await input.fill('no matching text');
  await expect(page.locator('.find-count')).toHaveText('无结果');
  await expect(page.getByRole('button', { name: '下一个匹配项' })).toBeDisabled();
  await input.press('Escape');
  await expect(page.getByRole('region', { name: '文章内查找和替换' })).toHaveCount(0);
  await expect(editor(page, source)).toBeFocused();
  expect(await saved(page)).toBe(original);
 });
 test(`${mode}: replace current and all, undo in one step, regex groups and errors`, async ({ page }) => {
  await seed(page, undefined, source);
  await editor(page, source).click();
  const modifier = await mod(page);
  await page.keyboard.press(modifier === 'Meta' ? 'Meta+Alt+f' : 'Control+h');
  const query = page.getByRole('textbox', { name: '查找内容' });
  const replacement = page.getByRole('textbox', { name: '替换为' });
  await expect(replacement).toBeVisible();
  await query.fill('alpha');
  await page.getByRole('button', { name: '全词匹配', exact: true }).click();
  await replacement.fill('delta');
  await page.getByRole('button', { name: '替换当前匹配项' }).click();
  await expect(page.locator('.find-count')).toHaveText('1 / 3');
  await expect.poll(() => saved(page)).toContain('delta alpha alphabet');
  await page.getByRole('button', { name: '全部替换', exact: true }).click();
  await expect(page.locator('.find-count')).toHaveText('无结果');
  await query.press('Escape');
  await page.keyboard.press(`${modifier}+z`);
  await expect.poll(() => saved(page)).toContain('delta alpha alphabet');
  await expect.poll(() => saved(page)).toContain('`alpha`');
  await page.getByRole('button', { name: '文章内查找', exact: true }).click();
  await page.getByRole('button', { name: '全词匹配', exact: true }).click();
  await page.getByRole('button', { name: '使用正则表达式', exact: true }).click();
  await query.fill('[');
  await expect(page.getByRole('status').filter({ hasText: '正则表达式无效' })).toBeVisible();
  await expect(page.getByRole('button', { name: '全部替换', exact: true })).toBeDisabled();
  await query.fill('(alpha) (beta)');
  await replacement.fill('$2 $1');
  // Rich text searches across inline formatting boundaries too.
  if (!source) {
   await expect(page.locator('.find-count')).toHaveText('1 / 1');
   await page.getByRole('button', { name: '替换当前匹配项' }).click();
   await expect(editor(page, source)).toContainText('beta alpha gamma');
  } else {
   await query.fill('(alpha)(bet)');
   await page.getByRole('button', { name: '替换当前匹配项' }).click();
   await expect.poll(() => saved(page)).toContain('bet alpha');
  }
 });
 test(`${mode}: selected text prefill, scoped replacements, live updates and mode cleanup`, async ({ page }) => {
  await seed(page, 'outside apple\n\napple apple\n\noutside apple\n', source);
  await editor(page, source).click();
  await page.keyboard.press(`${await mod(page)}+Home`);
  if (source) {
   await page.locator('.cm-line').filter({ hasText: 'apple apple' }).click();
   await page.keyboard.press('Home');
   await page.keyboard.press('Shift+End');
  } else {
   await editor(page, source).evaluate(node => {
    const paragraph = node.querySelectorAll('p')[1];
    const range = document.createRange(); range.selectNodeContents(paragraph);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
   });
  }
  await page.getByRole('button', { name: '文章内查找', exact: true }).click();
  const query = page.getByRole('textbox', { name: '查找内容' });
  await expect(query).toHaveValue('apple apple');
  await query.fill('apple');
  await page.getByRole('button', { name: '在选区中查找', exact: true }).click();
  await expect(page.locator('.find-count')).toHaveText('1 / 2');
  await page.getByRole('button', { name: '展开替换', exact: true }).click();
  await page.getByRole('textbox', { name: '替换为' }).fill('pear');
  await page.getByRole('button', { name: '全部替换', exact: true }).click();
  await expect.poll(() => saved(page)).toContain('outside apple\n\npear pear\n\noutside apple');
  await query.press('Escape');
  await page.getByTitle(source ? '编辑模式 · ⌘ E' : 'Markdown 源码与预览', { exact: true }).click();
  await page.getByRole('button', { name: '文章内查找', exact: true }).click();
  await page.getByRole('textbox', { name: '查找内容' }).fill('pear');
  await expect(page.locator('.find-count')).toHaveText('1 / 2');
 });
}

test('rich text preserves marks and atoms, handles long scrolling and both themes', async ({ page }) => {
 await seed(page, '# Search\n\n**apple** and ![apple](missing.png) and *apple*\n\n' + Array.from({ length: 80 }, (_, i) => `Paragraph ${i}\n\n`).join('') + 'last apple\n');
 await page.getByRole('button', { name: '文章内查找', exact: true }).click();
 await page.getByRole('textbox', { name: '查找内容' }).fill('apple');
 await expect(highlights(page, false)).toHaveCount(3);
 await page.getByRole('button', { name: '展开替换', exact: true }).click();
 await page.getByRole('textbox', { name: '替换为' }).fill('pear');
 await page.getByRole('button', { name: '全部替换', exact: true }).click();
 await expect.poll(() => saved(page)).toContain('**pear**');
 await expect.poll(() => saved(page)).toContain('*pear*');
 await expect.poll(() => saved(page)).toContain('![apple](missing.png)');
 await page.getByRole('textbox', { name: '查找内容' }).fill('pear');
 await page.getByRole('button', { name: '上一个匹配项' }).click();
 const mark = page.locator('.article-search-match.current');
 await expect(mark).toHaveText('pear');
 const position = await mark.boundingBox(), widget = await page.locator('.find-widget').boundingBox();
 expect(position!.y).toBeGreaterThan(widget!.y + widget!.height);
 await page.screenshot({ path: 'test-results/article-find-light.png' });
 await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
 await page.screenshot({ path: 'test-results/article-find-dark.png' });
});

for (const source of [false, true]) {
 test(`${source ? 'source' : 'rich text'}: search tracks edits, supports zero-width regex and ignores settings shortcuts`, async ({ page }) => {
  await seed(page, 'apple apple\n', source);
  await page.getByRole('button', { name: '文章内查找', exact: true }).click();
  const query = page.getByRole('textbox', { name: '查找内容' });
  await query.fill('apple');
  await expect(page.locator('.find-count')).toHaveText('1 / 2');
  await editor(page, source).fill('apple apple apple');
  await expect(page.locator('.find-count')).toContainText('/ 3');
  await page.getByRole('button', { name: '使用正则表达式', exact: true }).click();
  await query.fill('^');
  await expect(page.locator('.find-count')).toHaveText('1 / 1');
  await expect(editor(page, source).locator('.search-caret')).toHaveCount(1);
  await page.getByRole('button', { name: '展开替换', exact: true }).click();
  await page.getByRole('textbox', { name: '替换为' }).fill('prefix ');
  await page.getByRole('button', { name: '全部替换', exact: true }).click();
  await expect.poll(() => saved(page)).toContain('prefix apple apple apple');
  await page.getByTitle('设置', { exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('远程仓库（origin）').focus();
  await page.keyboard.press(`${await mod(page)}+f`);
  await expect(page.getByLabel('远程仓库（origin）')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(query).toBeVisible();
  await query.press('Escape');
  await expect(query).toHaveCount(0);
 });
}
