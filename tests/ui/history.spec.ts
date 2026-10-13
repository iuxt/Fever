import { test, expect } from '@playwright/test';

test('history defaults to a full diff and previews the selected version without changing the draft', async ({ page }) => {
 const before = '# 历史正文\n\n' + Array.from({ length: 30 }, (_, i) => `相同内容 ${i}`).join('\n') + '\n旧内容\n末尾相同内容\n';
 const after = before.replace('旧内容', '新内容');
 const draft = '# 未提交正文\n\n保留工作区内容。';
 await page.addInitScript(({ before, after, draft }) => {
  const commit = (digit: string, message: string) => ({ hash: digit.repeat(40), message, author: 'Test', date: '2026-10-13T01:00:00Z' });
  localStorage.setItem('fever-demo-v1', JSON.stringify({
   manifest: { version: 1, categories: ['测试'], notes: [{ id: 'history', filename: 'history.md', title: '历史测试', category: '测试', createdAt: '2026-10-13', updatedAt: '2026-10-13' }] },
   contents: { history: draft },
   versions: { history: [
    { commit: commit('3', '内容相同的版本'), content: after },
    { commit: commit('2', '修改正文'), content: after },
    { commit: commit('1', '首次记录'), content: before },
   ] },
   settings: { autoCommit: false, interval: 10, author: 'Test', email: 'test@example.com', remote: '' }, dirty: [], images: {},
  }));
 }, { before, after, draft });
 await page.goto('/');
 await page.locator('.folder-row').filter({ hasText: '测试' }).click();
 await page.locator('.note-row').filter({ hasText: '历史测试' }).click();
 await page.getByRole('button', { name: '历史', exact: true }).click();
 await page.getByRole('button', { name: /修改正文/ }).click();
 const diff = page.getByLabel('历史版本差异');
 await expect(diff.locator('.diff-remove')).toHaveText('-旧内容\n');
 await expect(diff.locator('.diff-add')).toHaveText('+新内容\n');
 await expect(diff.locator('.diff-context')).toHaveCount(33);
 await expect(diff).toContainText('相同内容 0');
 await expect(diff).toContainText('末尾相同内容');
 await expect(page.getByLabel('历史版本（只读）').getByRole('heading')).toHaveCount(0);
 await expect(page.locator('.document-space [contenteditable="true"]')).toHaveCount(0);
 await page.screenshot({ path: 'test-results/history-diff.png', fullPage: true });
 await page.getByRole('button', { name: '预览此版本', exact: true }).click();
 await expect(page.getByLabel('历史版本（只读）').getByRole('heading', { name: '历史正文' })).toBeVisible();
 await expect(page.locator('.revision-document .prose')).toContainText('新内容');
 await expect(page.locator('.revision-document .prose')).not.toContainText('旧内容');
 await expect(diff).toHaveCount(0);
 await page.getByRole('button', { name: '查看 diff', exact: true }).click();
 await expect(diff.locator('.diff-add')).toHaveText('+新内容\n');
 await page.getByRole('button', { name: '预览此版本', exact: true }).click();
 await page.getByRole('button', { name: /首次记录/ }).click();
 await expect(diff).toBeVisible();
 await expect(diff.locator('.diff-remove')).toHaveCount(0);
 await expect(diff.locator('.diff-context')).toHaveCount(0);
 await expect(diff.locator('.diff-add')).toHaveCount(34);
 await page.getByRole('button', { name: /内容相同的版本/ }).click();
 await expect(diff.locator('.diff-context')).toHaveCount(34);
 await expect(diff.locator('.diff-add, .diff-remove')).toHaveCount(0);
 await expect(page.getByText('内容无变化', { exact: true })).toBeVisible();
 expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).contents.history)).toBe(draft);
 await page.getByRole('button', { name: '返回当前版本', exact: true }).click();
 await expect(page.locator('.wysiwyg-content')).toContainText('保留工作区内容。');
});
