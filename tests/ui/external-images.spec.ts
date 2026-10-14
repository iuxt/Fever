import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page, content: string, hold = false) {
 await page.addInitScript(({ content, hold }) => {
  const note = (id: string) => ({ id, title: `Note ${id}`, filename: `${id}.md`, category: '', createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z' });
  const controls = { contents: { a: content, b: '# Note B' } as Record<string, string>, urls: [] as string[], waiting: false, release: () => {} };
  (window as any).imageControls = controls;
  window.fever = {
   desktop: true,
   current: async () => ({ path: '/test/images', name: 'images', lfs: true, manifest: { version: 1, categories: [], notes: [note('a'), note('b')] } }),
   read: async id => controls.contents[id],
   save: async (id, value) => { controls.contents[id] = value; },
   localizeImages: async urls => {
    controls.urls = urls;
    if (hold) await new Promise<void>(resolve => { controls.waiting = true; controls.release = () => { controls.waiting = false; resolve(); }; });
    return { replacements: { 'https://example.com/image.png': '../images/local.png' }, failed: urls.includes('https://example.com/broken.png') ? [{ url: 'https://example.com/broken.png', message: '下载失败（HTTP 404）' }] : [] };
   },
   status: async () => ({ branch: 'main', changes: [], ahead: 0, behind: 0, remote: '', lfs: true }),
   settings: async () => ({ autoCommit: false, interval: 10, author: '', email: '', remote: '' }),
   history: async () => [], cancelSearch: async () => {}, asset: () => '',
  } as typeof window.fever;
 }, { content, hold });
 await page.goto('/');
 await page.locator('.note-row').filter({ hasText: 'Note a' }).click();
 await expect(page.locator('.wysiwyg-content')).toBeVisible();
}

for (const mode of ['rich', 'source']) {
 test(`${mode} note menu localizes only images and keeps failed URLs`, async ({ page }) => {
  const content = '![图](https://example.com/image.png)\n\n![失败](https://example.com/broken.png)\n\n[网站](https://example.com/image.png)\n\n`![代码](https://example.com/code.png)`\n';
  await fixture(page, content);
  if (mode === 'source') await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
  await expect(page.getByTitle('外部图片转为本地文件', { exact: true })).toHaveCount(0);
  await page.getByTitle('更多笔记操作', { exact: true }).click();
  await page.getByTitle('外部图片转为本地文件', { exact: true }).click();
  await expect(page.locator('.dropdown')).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).imageControls.contents.a)).toBe(content.replace('![图](https://example.com/image.png)', '![图](../images/local.png)'));
  expect(await page.evaluate(() => (window as any).imageControls.urls)).toEqual(['https://example.com/image.png', 'https://example.com/broken.png']);
  await expect(page.locator('.toast')).toContainText('1 张失败，原链接已保留');
 });
}

test('edits made during download are retained', async ({ page }) => {
 await fixture(page, '![图](https://example.com/image.png)\n\n正文\n', true);
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await page.getByTitle('更多笔记操作', { exact: true }).click();
 const button = page.getByTitle('外部图片转为本地文件', { exact: true });
 await button.click();
 await expect(page.locator('.dropdown')).not.toBeVisible();
 await page.getByTitle('更多笔记操作', { exact: true }).click();
 await expect(button).toBeDisabled();
 await expect.poll(() => page.evaluate(() => (window as any).imageControls.waiting)).toBe(true);
 const source = page.locator('.cm-content');
 await source.fill('![图](https://example.com/image.png)\n\n下载时新增的内容');
 await page.evaluate(() => (window as any).imageControls.release());
 await expect.poll(() => page.evaluate(() => (window as any).imageControls.contents.a)).toBe('![图](../images/local.png)\n\n下载时新增的内容');
 await expect(source).toContainText('下载时新增的内容');
 await expect(button).toBeEnabled();
});

test('switching notes during download applies conversion to the original note', async ({ page }) => {
 await fixture(page, '![图](https://example.com/image.png)\n', true);
 await page.getByTitle('更多笔记操作', { exact: true }).click();
 await page.getByTitle('外部图片转为本地文件', { exact: true }).click();
 await expect.poll(() => page.evaluate(() => (window as any).imageControls.waiting)).toBe(true);
 await page.locator('.note-row').filter({ hasText: 'Note b' }).click();
 await expect(page.locator('.wysiwyg-content')).toContainText('Note B');
 await page.evaluate(() => (window as any).imageControls.release());
 await expect.poll(() => page.evaluate(() => (window as any).imageControls.contents.a)).toBe('![图](../images/local.png)\n');
 await expect(page.locator('.wysiwyg-content')).toContainText('Note B');
 expect(await page.evaluate(() => (window as any).imageControls.contents.b)).toBe('# Note B');
});

test('notes without external images do not start a download', async ({ page }) => {
 await fixture(page, '[外部网站](https://example.com/page)\n\n![本地图片](../images/local.png)\n');
 await page.getByTitle('更多笔记操作', { exact: true }).click();
 await page.getByTitle('外部图片转为本地文件', { exact: true }).click();
 await expect(page.locator('.toast')).toContainText('当前笔记没有外部图片');
 expect(await page.evaluate(() => (window as any).imageControls.urls)).toEqual([]);
});
