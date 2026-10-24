import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page, content: string, count = 1) {
 await page.addInitScript(({ content, count }) => {
  if (localStorage.getItem('fever-demo-v1')) return;
  const notes = Array.from({ length: count }, (_, i) => ({ id: `audit-${i}`, title: `审查笔记 ${i}`, category: '', filename: `audit-${i}.md`, createdAt: '2026-10-01', updatedAt: '2026-10-01' }));
  localStorage.setItem('fever-demo-v1', JSON.stringify({ manifest: { version: 1, categories: [], notes }, contents: Object.fromEntries(notes.map(n => [n.id, content])), versions: {}, dirty: [], images: {}, settings: {} }));
 }, { content, count });
 await page.goto('/');
 await page.locator('.note-card').first().click();
}

test('reselecting the current note and tab preserves rich-text undo history', async ({ page }) => {
 await fixture(page, '原始正文\n');
 const editor = page.getByRole('textbox', { name: '笔记正文', exact: true });
 await editor.fill('修改后的正文');
 await expect(page.getByText('所有更改已保存')).toBeVisible();
 await page.locator('.note-card.selected').click();
 await page.locator('.tab.current > button').first().click();
 await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled();
 await page.getByRole('button', { name: '撤销', exact: true }).click();
 await expect(editor).toHaveText('原始正文');
});

test('outline scrolls to the final heading and targets formatted and duplicate titles in both modes', async ({ page }) => {
 const content = '# 起点\n\n```sh\n# 代码注释\n```\n\n' + Array.from({ length: 70 }, (_, i) => `## ${i === 69 ? '**重复**' : i === 0 ? '重复' : `章节 ${i}`}\n\n正文\n\n`).join('');
 await fixture(page, content);
 await page.getByRole('button', { name: '大纲', exact: true }).click();
 await expect(page.locator('.outline button')).toHaveCount(71);
 await expect(page.locator('.outline')).not.toContainText('代码注释');
 const last = page.locator('.outline button').last();
 await last.click();
 await expect(last).toBeInViewport();
 await expect(page.locator('.wysiwyg-content h2').last()).toBeInViewport();
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await last.click();
 await expect(page.locator('.document .prose h2').last()).toBeInViewport();
 const ids = await page.locator('.document .prose h2').evaluateAll(nodes => nodes.map(node => node.id));
 expect(new Set(ids).size).toBe(70);
 expect(ids.at(-1)).toBe('heading-重复-2');
});

test('large notes open in a bounded source editor, support outline navigation and save without truncation', async ({ page }) => {
 const content = '# 长文\n\n' + 'A paragraph of plain text with enough words for a realistic Markdown document.\n\n'.repeat(5000) + '\n## 最后章节\n\n末尾正文\n';
 await fixture(page, content);
 await expect(page.locator('.document-space.source .cm-content')).toBeVisible();
 await expect(page.locator('.wysiwyg-content, .document .prose')).toHaveCount(0);
 expect(await page.locator('.cm-line').count()).toBeLessThan(100);
 expect(await page.evaluate(() => document.querySelectorAll('*').length)).toBeLessThan(1000);
 await page.getByRole('button', { name: '大纲', exact: true }).click();
 await page.locator('.outline').getByRole('button', { name: '最后章节', exact: true }).click();
 await expect(page.locator('.cm-content')).toContainText('最后章节');
 await page.keyboard.insertText('已定位');
 await page.keyboard.press('ControlOrMeta+s');
 await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).contents['audit-0'])).toBe(content.replace('## 最后章节', '已定位## 最后章节'));
 await page.reload();
 await expect(page.locator('.document-space.source .cm-content')).toBeVisible();
});

test('24px note cards fit two full preview lines and virtualization reaches the last row', async ({ page }) => {
 await fixture(page, '# 标题\n\n这是足够长的摘要内容，用来检查两行预览在大字体下是否完整显示。'.repeat(5), 50);
 await page.getByTitle('设置', { exact: true }).click();
 await page.getByRole('combobox', { name: '字体大小' }).click();
 await page.getByRole('option', { name: '24 px', exact: true }).click();
 await page.getByRole('button', { name: '保存设置', exact: true }).click();
 const geometry = await page.locator('.note-card').first().evaluate(card => {
  const preview = card.querySelector('.note-card-preview')!;
  const meta = card.querySelector('.note-card-meta')!;
  return { preview: preview.getBoundingClientRect().height, line: parseFloat(getComputedStyle(preview).lineHeight), metaBottom: meta.getBoundingClientRect().bottom, bottom: card.getBoundingClientRect().bottom };
 });
 expect(geometry.preview).toBeGreaterThanOrEqual(geometry.line * 2 - 1);
 expect(geometry.metaBottom).toBeLessThanOrEqual(geometry.bottom);
 await page.locator('.note-list').evaluate(e => { e.scrollTop = e.scrollHeight; });
 await expect(page.locator('.note-card[title="审查笔记 49"]')).toBeInViewport();
 expect(await page.locator('.note-card').count()).toBeLessThan(20);
 await page.screenshot({ path: 'test-results/audit-font24.png' });
});
