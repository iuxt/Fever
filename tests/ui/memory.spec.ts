import { test, expect } from '@playwright/test';

test('large note list renders visible summaries, scrolls to the last note, and browses nested folders', async ({ page }) => {
 await page.addInitScript(() => {
  const notes = Array.from({ length: 1200 }, (_, i) => ({ id: `large-${i}`, title: `笔记 ${String(i).padStart(4, '0')}`, category: '大库/子分类', filename: `large-${i}.md`, createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' }));
  localStorage.setItem('fever-demo-v1', JSON.stringify({ manifest: { version: 1, categories: ['大库/子分类', '空分类'], notes }, contents: Object.fromEntries(notes.map((note, i) => [note.id, `# ${note.title}\n\n正文专用编号 ${i === 1199 ? '最后一篇' : i}`])), versions: {}, images: {}, dirty: [], settings: { autoCommit: false, interval: 10, author: '', email: '', remote: '' } }));
 });
 await page.goto('/');
 await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
 await expect(page.locator('.folder-row')).toHaveCount(2);
 await expect(page.locator('.folder-toggle, .folder-toggle-spacer')).toHaveCount(0);
 await expect(page.locator('.folder-row[aria-expanded="true"]')).toHaveCount(0);
 expect(await page.locator('.note-list .note-row').count()).toBeLessThan(60);
 await expect(page.locator('.note-list .note-row').first()).toContainText('笔记 0000');
 await page.locator('.folder-row').filter({ hasText: '大库' }).click();
 await expect(page.locator('.folder-row').filter({ hasText: '子分类' })).toBeVisible();
 const collapse = page.locator('.folder-row[title="大库"]');
 await expect(collapse).toHaveAttribute('aria-expanded', 'true');
 await collapse.click();
 await expect(page.locator('.folder-row').filter({ hasText: '子分类' })).toHaveCount(0);
 await expect(page.locator('.file-list-header h2')).toHaveText('大库');
 await expect(collapse).toHaveAttribute('aria-expanded', 'false');
 await collapse.click();
 await expect(page.locator('.folder-row').filter({ hasText: '子分类' })).toBeVisible();
 expect(await page.locator('.note-list .note-row').count()).toBeLessThan(60);
 await expect(page.locator('.note-list .note-row').first()).toContainText('笔记 0000');
 await page.locator('.folder-row').filter({ hasText: '子分类' }).click();
 await expect(page.locator('.note-row').filter({ hasText: '笔记 0000' })).toBeVisible();
 await page.locator('.note-row').filter({ hasText: '笔记 0000' }).click();
 await expect(page.locator('.wysiwyg-content h1')).toHaveText('笔记 0000');
 await page.locator('.note-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
 await page.locator('.note-row').filter({ hasText: '笔记 1199' }).click();
 await expect(page.locator('.wysiwyg-content h1')).toHaveText('笔记 1199');
 expect(await page.locator('.note-tree .note-row').count()).toBeLessThan(60);
 await page.getByPlaceholder('搜索你的笔记…').fill('正文专用编号 最后一篇');
 await expect(page.locator('.note-tree .note-row')).toHaveCount(1);
 await expect(page.locator('.note-tree .note-row .note-card-title strong')).toHaveText('笔记 1199');
 await page.getByPlaceholder('搜索你的笔记…').fill('');
 await expect(page.locator('.note-row.selected .note-card-title strong')).toHaveText('笔记 1199');
 await page.locator('.tabs .tab').first().getByRole('button').first().click();
 await expect(page.locator('.note-row.selected .note-card-title strong')).toHaveText('笔记 0000');
 await page.reload();
 await expect(page.locator('.wysiwyg-content h1')).toHaveText('笔记 0000');
 await expect(page.locator('.folder-row[title="大库"]')).toHaveAttribute('aria-expanded', 'true');
 expect(await page.locator('.note-list .note-row').count()).toBeLessThan(60);
 await expect(page.locator('.note-list .note-row').first()).toContainText('笔记 0000');
});

test('file picker imports the image before its FileList is reset', async ({ page }) => {
 await page.goto('/');
 await page.locator('.folder-row').filter({ hasText: '开始使用' }).click();
 await page.locator('.note-row').filter({ hasText: '欢迎使用 Fever' }).click();
 await page.locator('input[type=file]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N3IAAAAASUVORK5CYII=', 'base64') });
 await expect(page.getByText('图片已添加到 images/')).toBeVisible();
 await expect(page.getByRole('img', { name: 'pixel.png', exact: true })).toBeVisible();
 expect(await page.getByRole('img', { name: 'pixel.png', exact: true }).evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(1);
});

test('drawing preview releases its Blob URL when the note unmounts', async ({ page }) => {
 await page.addInitScript(() => {
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  const live = new Set<string>();
  Object.assign(window, { feverPreviewUrls: live });
  URL.createObjectURL = blob => { const url = create(blob); live.add(url); return url; };
  URL.revokeObjectURL = url => { live.delete(url); revoke(url); };
 });
 await page.goto('/');
 await page.getByTitle('新建绘图', { exact: true }).click();
 await page.getByLabel('绘图标题').fill('资源释放');
 await page.getByRole('button', { name: '创建绘图', exact: true }).click();
 const canvas = page.locator('.drawing-canvas canvas.interactive');
 await expect(canvas).toBeVisible(); await canvas.click(); await page.keyboard.press('r');
 const box = (await canvas.boundingBox())!;
 await page.mouse.move(box.x + 250, box.y + 150); await page.mouse.down();
 await page.mouse.move(box.x + 450, box.y + 250, { steps: 5 }); await page.mouse.up();
 await page.getByRole('button', { name: '新建笔记', exact: true }).first().click();
 await page.getByLabel('笔记标题').fill('引用资源释放');
 await page.getByRole('button', { name: '创建笔记', exact: true }).click();
 await page.getByRole('button', { name: '插入 Excalidraw', exact: true }).click();
 await page.getByRole('button', { name: '插入绘图', exact: true }).click();
 await expect(page.locator('.drawing-preview img')).toBeVisible();
 const url = (await page.locator('.drawing-preview img').getAttribute('src'))!;
 expect(url).toMatch(/^blob:/);
 await page.locator('.folder-row').filter({ hasText: '开始使用' }).click();
 await page.locator('.note-row').filter({ hasText: '欢迎使用 Fever' }).click();
 await expect(page.locator('.wysiwyg-content h1')).toBeVisible();
 expect(await page.evaluate(url => (window as unknown as { feverPreviewUrls: Set<string> }).feverPreviewUrls.has(url), url)).toBe(false);
});
