import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N3IAAAAASUVORK5CYII=';
const source = '# 导出测试\n\n中文正文与 **粗体**。\n\n- [x] 已完成\n\n| 名称 | 数量 |\n| --- | --- |\n| 中文 | 2 |\n\n```js\nconst answer = 42;\n```\n\n![本地图片](../images/n/pixel.png)\n\n![嵌入绘图](../drawings/sketch.excalidraw)\n';

async function openNote(page: Page) {
 await page.addInitScript(({ source, png }) => {
  const note = (id: string, title: string, filename: string, directory?: string) => ({ id, title, filename, directory, category: '', createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z' });
  localStorage.setItem('fever-demo-v1', JSON.stringify({
   manifest: { version: 1, categories: [], notes: [note('n', '导出:/测试', 'n.md'), note('sketch', '嵌入绘图', 'sketch.excalidraw', 'drawings')] },
   contents: { n: source, sketch: JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id: 'r', type: 'rectangle', x: 0, y: 0, width: 180, height: 90 }], appState: { viewBackgroundColor: '#ffffff' }, files: {} }) },
   versions: {}, settings: { autoCommit: false, interval: 10, author: '', email: '', remote: '' }, dirty: [], images: { '../images/n/pixel.png': png },
  }));
 }, { source, png });
 await page.goto('/');
 await page.locator('.note-row').filter({ hasText: '导出:/测试' }).click();
 await expect(page.locator('.wysiwyg-content')).toBeVisible();
}

async function openExport(page: Page, format: string) {
 await page.getByTitle('更多笔记操作', { exact: true }).click();
 await expect(page.locator('.dropdown').getByRole('button', { name: /^导出/ })).toHaveCount(1);
 await page.getByRole('button', { name: '导出…', exact: true }).click();
 const dialog = page.getByRole('dialog');
 await dialog.getByRole('combobox', { name: '文件格式' }).click();
 await dialog.getByRole('option', { name: new RegExp(`^${format} `) }).click();
 return dialog;
}

async function exportDownload(page: Page, name: string) {
 const dialog = await openExport(page, name.replace('导出 ', ''));
 const downloadPromise = page.waitForEvent('download');
 await dialog.getByRole('button', { name: '导出', exact: true }).click();
 const download = await downloadPromise;
 return { filename: download.suggestedFilename(), content: await readFile((await download.path())!, 'utf8') };
}

test('HTML export embeds local images and drawing SVGs in a standalone light document', async ({ page, context }) => {
 await openNote(page);
 const result = await exportDownload(page, '导出 HTML');
 expect(result.filename).toBe('导出__测试.html');
 expect(result.content).toContain('data:image/png;base64,');
 expect(result.content).toContain('data:image/svg+xml;base64,');
 expect(result.content).not.toContain('blob:');
 expect(result.content).not.toContain('fever-asset:');
 expect(result.content).not.toContain('code-copy-button');
 expect(result.content).not.toContain('code-block-actions');
 expect(result.content).toContain('size: A4');
 const exported = await context.newPage();
 await exported.setContent(result.content);
 await expect(exported.locator('h1')).toHaveText('导出测试');
 await expect(exported.locator('table')).toContainText('中文');
 await expect(exported.locator('pre')).toContainText('const answer = 42;');
 await expect(exported.locator('input[type=checkbox]')).toBeChecked();
 expect(await exported.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
 await exported.screenshot({ path: 'test-results/export-html.png', fullPage: true });
});

test('drawing notes export to HTML with a title and embedded canvas', async ({ page }) => {
 await openNote(page);
 await page.locator('.note-row').filter({ hasText: '嵌入绘图' }).click();
 await expect(page.locator('.drawing-canvas')).toBeVisible();
 const result = await exportDownload(page, '导出 HTML');
 expect(result.filename).toBe('嵌入绘图.html');
 expect(result.content).toContain('<h1>嵌入绘图</h1>');
 expect(result.content).toContain('data:image/svg+xml;base64,');
 expect(result.content).not.toContain('编辑绘图');
});

for (const mode of ['source', 'rich']) {
 test(`Markdown export includes latest ${mode} edits without waiting for autosave`, async ({ page }) => {
  await openNote(page);
  if (mode === 'source') {
   await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
   await page.locator('.cm-content').fill(source + '\n最新编辑内容');
  } else {
   const editor = page.locator('.wysiwyg-content');
   await editor.click(); await page.keyboard.press('ControlOrMeta+End');
   await page.keyboard.press('Enter'); await page.keyboard.insertText('最新编辑内容');
  }
  const result = await exportDownload(page, '导出 Markdown');
  expect(result.filename).toBe('导出__测试.md');
  expect(result.content).toContain('最新编辑内容');
  expect(result.content).toContain('../images/n/pixel.png');
 });
}

test('failed image export reports an error and leaves the editor usable', async ({ page }) => {
 await openNote(page);
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await page.locator('.cm-content').fill('# 图片失败\n\n![缺失图片](../images/missing.png)');
 const dialog = await openExport(page, 'HTML');
 await dialog.getByRole('button', { name: '导出', exact: true }).click();
 await expect(page.locator('.toast.error')).toContainText('缺失图片');
 await expect(dialog.getByRole('button', { name: '导出', exact: true })).toBeEnabled();
 await dialog.getByRole('button', { name: '取消', exact: true }).click();
 await expect(page.locator('.cm-content')).toBeVisible();
 expect(await page.locator('[aria-hidden=true] article').count()).toBe(0);
});

test('browser PDF export prepares the full document before opening print', async ({ page }) => {
 await page.addInitScript(() => {
  (window as any).printHTML = '';
  // Browser print UI is native; inspect the document passed to it instead.
  const append = Element.prototype.append;
  Element.prototype.append = function (...nodes) {
   for (const node of nodes) if (node instanceof HTMLIFrameElement) {
    node.addEventListener('load', () => { node.contentWindow!.print = () => { (window as any).printHTML = node.contentDocument!.documentElement.outerHTML; }; });
   }
   return append.apply(this, nodes);
  };
 });
 await openNote(page);
 const dialog = await openExport(page, 'PDF');
 await dialog.screenshot({ path: 'test-results/export-dialog.png' });
 await dialog.getByRole('combobox', { name: '纸张大小' }).click();
 await dialog.getByRole('option', { name: /^A5/ }).click();
 await dialog.getByRole('combobox', { name: '页面方向' }).click();
 await dialog.getByRole('option', { name: '横向', exact: true }).click();
 await dialog.getByRole('combobox', { name: '页边距' }).click();
 await dialog.getByRole('option', { name: '10 mm', exact: true }).click();
 await dialog.getByRole('button', { name: '导出', exact: true }).click();
 await expect(page.locator('.toast')).toContainText('另存为 PDF');
 const html = await page.evaluate(() => (window as any).printHTML);
 expect(html).toContain('data:image/svg+xml;base64,');
 expect(html).toContain('size: A5 landscape; margin: 10mm;');
});


test('export dialog applies HTML settings and hides layout options for source formats', async ({ page }) => {
 await openNote(page);
 const dialog = await openExport(page, 'HTML');
 await dialog.getByRole('textbox', { name: '文件名', exact: true }).fill('自定义导出');
 await dialog.getByRole('combobox', { name: '内容宽度' }).click();
 await dialog.getByRole('option', { name: '960 px', exact: true }).click();
 await dialog.getByRole('combobox', { name: '正文字号' }).click();
 await dialog.getByRole('option', { name: '18 px', exact: true }).click();
 await dialog.getByRole('combobox', { name: '文件格式' }).click();
 await dialog.getByRole('option', { name: /^Markdown / }).click();
 await expect(dialog.getByRole('combobox', { name: '内容宽度' })).toHaveCount(0);
 await expect(dialog.getByRole('combobox', { name: '纸张大小' })).toHaveCount(0);
 await dialog.getByRole('combobox', { name: '文件格式' }).click();
 await dialog.getByRole('option', { name: /^HTML / }).click();
 const downloadPromise = page.waitForEvent('download');
 await dialog.getByRole('button', { name: '导出', exact: true }).click();
 const download = await downloadPromise;
 expect(download.suggestedFilename()).toBe('自定义导出.html');
 const html = await readFile((await download.path())!, 'utf8');
 expect(html).toContain('max-width: 960px');
 expect(html).toContain('font: 18px/1.8');
 await expect(dialog).toHaveCount(0);
});

test('drawing source export shares the dialog and cancellation restores the editor', async ({ page }) => {
 await openNote(page);
 await page.locator('.note-row').filter({ hasText: '嵌入绘图' }).click();
 await expect(page.locator('.drawing-canvas')).toBeVisible();
 const result = await exportDownload(page, '导出 Excalidraw');
 expect(result.filename).toBe('嵌入绘图.excalidraw');
 expect(JSON.parse(result.content).elements[0].type).toBe('rectangle');
 const dialog = await openExport(page, 'PDF');
 await dialog.getByRole('combobox', { name: '纸张大小' }).click();
 await page.keyboard.press('Escape');
 await expect(dialog).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(dialog).toHaveCount(0);
 await expect(page.locator('.drawing-canvas')).toBeVisible();
 await expect(page.getByTitle('更多笔记操作', { exact: true })).toBeFocused();
});
