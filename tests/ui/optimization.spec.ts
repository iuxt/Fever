import { test, expect, type Page } from '@playwright/test';

async function seed(page: Page, count = 2, content = '# 笔记0\n\n原始正文') {
 await page.addInitScript(({ count, content }) => {
  const notes = Array.from({ length: count }, (_, i) => ({ id: `opt-${i}`, filename: `opt-${i}.md`, title: `笔记${i}`, category: '', createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z' }));
  localStorage.setItem('fever-note-sort', JSON.stringify({ field: 'title', direction: 'asc' }));
  localStorage.setItem('fever-demo-v1', JSON.stringify({ manifest: { version: 1, categories: [], notes }, contents: Object.fromEntries(notes.map(note => [note.id, note.id === 'opt-0' ? content : `# ${note.title}\n\n其他笔记`])), versions: {}, dirty: [], images: {}, settings: {} }));
 }, { count, content });
 await page.goto('/'); await page.locator('.note-card[title="笔记0"]').click();
 await expect(page.locator('.wysiwyg-content')).toBeVisible();
}
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).contents['opt-0'] as string);

for (const source of [false, true]) test(`${source ? 'source' : 'rich'} regex times out without blocking input and a newer query still works`, async ({ page }) => {
 await seed(page, 2, 'a'.repeat(32) + '!');
 if (source) await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await page.getByRole('button', { name: '文章内查找', exact: true }).click();
 await page.getByRole('button', { name: '使用正则表达式', exact: true }).click();
 const query = page.getByRole('textbox', { name: '查找内容' });
 await query.fill('(a+)+$');
 // This interaction must finish while the worker is still evaluating the regex.
 await page.getByRole('button', { name: '展开替换', exact: true }).click({ timeout: 800 });
 await expect(page.getByRole('textbox', { name: '替换为' })).toBeVisible();
 await expect(page.locator('.find-footer')).toContainText('正则查找超时');
 await expect(page.getByRole('button', { name: '全部替换', exact: true })).toBeDisabled();
 await query.fill('^a'); await expect(page.locator('.find-count')).toHaveText('1 / 1');
 await query.fill('(a+)+$');
 await query.press('Escape');
 const editor = page.locator(source ? '.cm-content' : '.wysiwyg-content');
 await editor.fill('继续编辑');
 await expect.poll(() => saved(page)).toContain('继续编辑');
 await expect(page.locator('.find-widget')).toHaveCount(0);
});

test('autosave preserves manual list scrolling and selecting the tab explicitly reveals the note', async ({ page }) => {
 await seed(page, 120);
 await page.locator('.wysiwyg-content').fill('触发自动保存');
 const list = page.getByLabel('文件列表', { exact: true });
 await list.evaluate(element => { element.scrollTop = 8000; });
 await expect.poll(() => saved(page)).toContain('触发自动保存');
 await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
 expect(await list.evaluate(element => element.scrollTop)).toBe(8000);
 await page.locator('.tab').getByRole('button', { name: '笔记0', exact: true }).click();
 await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0);
});

test('rich edits are serialized once per burst and manual save immediately flushes the last transaction', async ({ page }) => {
 await seed(page);
 const calls = await page.evaluate(() => {
  const editor = (document.querySelector('.wysiwyg-content') as any).editor;
  const getMarkdown = editor.getMarkdown.bind(editor);
  (window as any).serializationCalls = 0;
  editor.getMarkdown = () => { ++(window as any).serializationCalls; return getMarkdown(); };
  for (let i = 0; i < 20; i++) editor.commands.insertContent('x');
  const before = (window as any).serializationCalls;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  return before;
 });
 expect(calls).toBe(0);
 await expect.poll(() => saved(page)).toContain('x'.repeat(20));
 expect(await page.evaluate(() => (window as any).serializationCalls)).toBe(1);
});

for (const destination of ['note', 'source']) test(`leaving rich text for ${destination} flushes a transaction before its serialization timer`, async ({ page }) => {
 await seed(page);
 await page.evaluate(destination => {
  (document.querySelector('.wysiwyg-content') as any).editor.commands.insertContent('最后一次输入');
  const button = document.querySelector(destination === 'note' ? '.note-card[title="笔记1"]' : '.mode-switch button[title="Markdown 源码与预览"]') as HTMLButtonElement;
  button.click();
 }, destination);
 if (destination === 'note') await expect(page.locator('.wysiwyg-content')).toContainText('其他笔记');
 else await expect(page.locator('.cm-content')).toContainText('最后一次输入');
 await expect.poll(() => saved(page)).toContain('最后一次输入');
});

test('manual save drains edits made during an in-flight write before announcing completion', async ({ page }) => {
 await seed(page);
 await page.evaluate(async () => {
  (window as any).saveBoundary = { calls: 0, release: null, observed: null };
  // Hold a real demo save so new input arrives before that write finishes.
  const { demo } = await import('/src/demo.ts');
  const original = demo.save, status = demo.status, controls = (window as any).saveBoundary;
  demo.save = async (id: string, value: string) => {
   if (++controls.calls === 1) await new Promise<void>(resolve => { controls.release = resolve; });
   return original(id, value);
  };
  demo.status = async (...args: Parameters<typeof demo.status>) => {
   controls.observed ??= JSON.parse(localStorage.getItem('fever-demo-v1')!).contents['opt-0'];
   return status(...args);
  };
 });
 await page.locator('.wysiwyg-content').fill('first edit');
 await page.locator('.wysiwyg-content').press('ControlOrMeta+s');
 await expect.poll(() => page.evaluate(() => !!(window as any).saveBoundary.release)).toBe(true);
 await page.evaluate(() => {
  (document.querySelector('.wysiwyg-content') as any).editor.commands.insertContent(' latest edit');
  (window as any).saveBoundary.release();
 });
 await expect(page.getByText('笔记已保存', { exact: true })).toBeVisible();
 expect(await page.evaluate(() => (window as any).saveBoundary.observed)).toContain('latest edit');
 expect(await page.evaluate(() => (window as any).saveBoundary.calls)).toBe(2);
});
