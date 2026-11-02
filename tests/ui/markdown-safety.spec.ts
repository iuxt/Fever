import { test, expect, type Page } from '@playwright/test';

async function seed(page: Page, content: string) {
 await page.addInitScript(content => {
  const note = { id: 'safety', filename: 'safety.md', title: '原文保护', category: '', createdAt: '2026-10-01', updatedAt: '2026-10-01' };
  localStorage.setItem('fever-demo-v1', JSON.stringify({ manifest: { version: 1, categories: [], notes: [note] }, contents: { safety: content }, versions: {}, dirty: [], images: {}, settings: {} }));
 }, content);
 await page.goto('/');
 await page.locator('.note-card').click();
}

for (const [name, body] of [
 ['HTML 注释', '<!-- private comment: keep this -->'],
 ['HTML 折叠块', '<details>\n<summary>Summary</summary>\n\nSecret content\n\n</details>'],
 ['脚注', 'Text[^1]\n\n[^1]: Important source'],
]) test(`${name} remains verbatim through editing and attempts to switch to rich text`, async ({ page }) => {
 const original = `# Title\n\n${body}\n`;
 await seed(page, original);
 const source = page.locator('.cm-content');
 await expect(source).toBeVisible();
 await expect(page.locator('.wysiwyg-content')).toHaveCount(0);
 await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).contents.safety)).toBe(original);
 await source.fill(original.replace('# Title', '# Updated'));
 await page.getByTitle('编辑模式 · ⌘ E').click();
 await expect(page.locator('.wysiwyg-content')).toHaveCount(0);
 await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).contents.safety)).toBe(original.replace('# Title', '# Updated'));
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await expect(source).toBeVisible();
 await page.getByTitle('编辑模式 · ⌘ E').click();
 await expect(source).toBeVisible();
 await expect(page.locator('.wysiwyg-content')).toHaveCount(0);
});

test('code examples containing HTML and footnotes still use rich text', async ({ page }) => {
 await seed(page, '# Examples\n\n```html\n<!-- comment -->\n[^1]: example\n```\n\n`<span>text</span>`\n');
 await expect(page.locator('.wysiwyg-content')).toBeVisible();
});

test('explicit rich editing of a large supported note survives reselecting the same note', async ({ page }) => {
 await seed(page, '# Large\n\n' + 'word '.repeat(40_000));
 await expect(page.locator('.cm-content')).toBeVisible();
 await page.getByTitle('编辑模式 · ⌘ E').click();
 const editor = page.locator('.wysiwyg-content');
 await expect(editor).toBeVisible();
 const element = await editor.elementHandle();
 await page.locator('.note-card').click();
 await expect(editor).toBeVisible();
 expect(await element!.evaluate(element => element.isConnected)).toBe(true);
});

test('source edits adding protected content cannot be lost by switching to rich text', async ({ page }) => {
 await seed(page, '# Original\n');
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 const content = '# Original\n\n<!-- added from source -->\n';
 await page.locator('.cm-content').fill(content);
 await page.getByTitle('编辑模式 · ⌘ E').click();
 await expect(page.locator('.wysiwyg-content')).toHaveCount(0);
 await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).contents.safety)).toBe(content);
});

test('default Git filtering displays and commits semantic whitespace exactly', async ({ page }) => {
 await page.goto('/');
 const after = '```python\nif enabled:\n    run()\n    finish()\n```\n\n- parent\n  - child\n\nfirst  \nsecond\n';
 await page.evaluate(after => {
  const state = JSON.parse(localStorage.getItem('fever-demo-v1')!);
  state.baseFiles['notes/demo-1.md'] = '```python\nif enabled:\n    run()\nfinish()\n```\n\n- parent\n- child\n\nfirst\nsecond\n';
  state.contents['demo-1'] = after;
  localStorage.setItem('fever-demo-v1', JSON.stringify(state));
 }, after);
 await page.reload();
 await page.getByRole('button', { name: 'Git', exact: true }).click();
 await expect(page.getByRole('switch', { name: '忽略空格和空行' })).toBeChecked();
 await page.getByRole('button', { name: '查看工作区差异：欢迎使用 Fever', exact: true }).click();
 await expect(page.locator('.diff-editor')).toContainText('+    finish()');
 await page.getByPlaceholder('这次记录了什么？').fill('keep semantic whitespace');
 await page.getByRole('button', { name: '提交所有笔记变更', exact: true }).click();
 await expect(page.getByText('已创建 Git 提交', { exact: true })).toBeVisible();
 const state = await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!));
 expect(state.contents['demo-1']).toBe(after);
 expect(state.baseFiles['notes/demo-1.md']).toBe(after);
});
