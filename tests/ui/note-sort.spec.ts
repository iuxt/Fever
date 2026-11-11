import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
 await page.addInitScript(() => {
  if (localStorage.getItem('fever-demo-v1')) return;
  const notes = [
   { id: 'b', title: '笔记10', category: '项目', createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' },
   { id: 'a', title: '笔记2', category: '项目/子分类', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z' },
   { id: 'c', title: '笔记1', category: '其他', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' },
   { id: 'd', title: '笔记20', category: '项目', createdAt: '2026-10-04T00:00:00Z', updatedAt: '2026-10-03T08:00:00+08:00' },
  ].map(note => ({ ...note, filename: `${note.id}.md` }));
  localStorage.setItem('fever-demo-v1', JSON.stringify({
   manifest: { version: 1, categories: ['项目/子分类', '其他', '空文件夹'], notes },
   contents: Object.fromEntries(notes.map(note => [note.id, `# ${note.title}\n\n排序样例`])),
   versions: {}, dirty: [], images: {}, settings: {},
  }));
 });
 await page.goto('/');
});

const titles = (page: Page) => page.locator('.note-card-title strong');
async function sortBy(page: Page, name: string) {
 await page.getByRole('button', { name: '排序方式', exact: true }).click();
 await page.getByRole('menuitemradio', { name, exact: true }).click();
}

test('sorts by update time, creation time and natural title in both directions', async ({ page }) => {
 await expect(titles(page)).toHaveText(['笔记2', '笔记20', '笔记1', '笔记10']);
 await sortBy(page, '最早在前');
 await expect(titles(page)).toHaveText(['笔记10', '笔记1', '笔记2', '笔记20']);
 await sortBy(page, '创建时间');
 await expect(titles(page)).toHaveText(['笔记20', '笔记10', '笔记1', '笔记2']);
 await sortBy(page, '最早在前');
 await expect(titles(page)).toHaveText(['笔记2', '笔记1', '笔记10', '笔记20']);
 await sortBy(page, '标题');
 await expect(titles(page)).toHaveText(['笔记1', '笔记2', '笔记10', '笔记20']);
 await sortBy(page, '标题倒序');
 await expect(titles(page)).toHaveText(['笔记20', '笔记10', '笔记2', '笔记1']);
 // Sorting changes the view without rewriting the manifest order.
 expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).manifest.notes.map((note: { id: string }) => note.id))).toEqual(['b', 'a', 'c', 'd']);
});

test('keeps sorting across folders, full-text search, empty folders and reloads', async ({ page }) => {
 await sortBy(page, '创建时间');
 await sortBy(page, '最早在前');
 await page.locator('.folder-row').filter({ hasText: /^项目/ }).click();
 await expect(titles(page)).toHaveText(['笔记10', '笔记20']);
 await page.getByPlaceholder('搜索你的笔记…').fill('排序样例');
 await expect(titles(page)).toHaveText(['笔记2', '笔记1', '笔记10', '笔记20']);
 await page.reload();
 await expect(page.getByRole('button', { name: '排序方式', exact: true })).toHaveAttribute('title', '排序：创建时间 · 最早在前');
 await expect(titles(page)).toHaveText(['笔记2', '笔记1', '笔记10', '笔记20']);
 await page.locator('.folder-row').filter({ hasText: '空文件夹' }).click();
 await expect(page.locator('.file-list-empty')).toBeVisible();
 await sortBy(page, '标题');
 await page.locator('.all-notes').filter({ hasText: '全部笔记' }).click();
 await expect(titles(page)).toHaveText(['笔记1', '笔记2', '笔记10', '笔记20']);
});

test('autosave moves an edited note to the top and preserves the selection', async ({ page }) => {
 await page.locator('.note-card').filter({ hasText: '笔记10' }).click();
 await page.getByRole('button', { name: /^全部笔记/ }).click();
 await page.locator('.wysiwyg-content').fill('修改后的正文');
 await expect(titles(page)).toHaveText(['笔记10', '笔记2', '笔记20', '笔记1']);
 await expect(page.locator('.note-card.selected .note-card-title strong')).toHaveText('笔记10');
 await expect(page.locator('.wysiwyg-content')).toHaveText('修改后的正文');
});

test('falls back to recent updates when the stored preference is invalid', async ({ page }) => {
 await page.evaluate(() => localStorage.setItem('fever-note-sort', JSON.stringify({ field: 'unknown', direction: 'sideways' })));
 await page.reload();
 await expect(page.getByRole('button', { name: '排序方式', exact: true })).toHaveAttribute('title', '排序：更新时间 · 最新在前');
 await expect(titles(page)).toHaveText(['笔记2', '笔记20', '笔记1', '笔记10']);
});

test('sorting a large list resets scrolling and keeps rendering virtualized', async ({ page }) => {
 await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('fever-demo-v1')!);
  state.manifest.notes = Array.from({ length: 1200 }, (_, i) => ({ id: `large-${i}`, title: `笔记${i}`, folderId: null, filename: `${i}.md`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
  state.contents = Object.fromEntries(state.manifest.notes.map((note: { id: string; title: string }) => [note.id, `# ${note.title}`]));
  localStorage.setItem('fever-demo-v1', JSON.stringify(state));
 });
 await page.reload();
 await expect(titles(page).first()).toHaveText('笔记1199');
 expect(await titles(page).count()).toBeLessThan(30);
 await page.getByLabel('文件列表', { exact: true }).evaluate(el => { el.scrollTop = el.scrollHeight; });
 await expect(titles(page).last()).toHaveText('笔记0');
 await sortBy(page, '标题');
 await expect(titles(page).first()).toHaveText('笔记0');
 expect(await titles(page).count()).toBeLessThan(30);
 await page.getByLabel('文件列表', { exact: true }).evaluate(el => { el.scrollTop = el.scrollHeight; });
 await expect(titles(page).last()).toHaveText('笔记1199');
});

test('sort menu supports the keyboard and shares one row with the view tabs in a narrow dark window', async ({ page }) => {
 await page.setViewportSize({ width: 560, height: 800 });
 await page.emulateMedia({ colorScheme: 'dark' });
 const trigger = page.getByRole('button', { name: '排序方式', exact: true });
 await trigger.focus();
 await page.keyboard.press('Enter');
 await page.keyboard.press('ArrowDown');
 await page.keyboard.press('Enter');
 await expect(trigger).toHaveAttribute('title', '排序：创建时间 · 最新在前');
 await expect(trigger).toBeFocused();
 await expect(titles(page)).toHaveText(['笔记20', '笔记10', '笔记1', '笔记2']);
 await page.keyboard.press('Enter');
 await expect(page.getByRole('menuitemradio', { name: '创建时间', exact: true })).toBeFocused();
 await page.keyboard.press('End');
 await page.keyboard.press('Enter');
 await expect(titles(page)).toHaveText(['笔记2', '笔记1', '笔记10', '笔记20']);
 await page.getByPlaceholder('搜索你的笔记…').fill('排序样例');
 await trigger.click();
 await page.screenshot({ path: 'test-results/note-sort-narrow.png' });
 expect(await page.getByRole('menu', { name: '文件列表排序' }).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
 await page.keyboard.press('Escape');
 await expect(trigger).toBeFocused();
 await expect(page.getByRole('menu', { name: '文件列表排序' })).toBeHidden();
 await expect(page.getByPlaceholder('搜索你的笔记…')).toHaveValue('排序样例');
 await trigger.click();
 await page.getByRole('heading', { name: '搜索结果' }).click();
 await expect(page.getByRole('menu', { name: '文件列表排序' })).toBeHidden();
 const tabs = page.getByRole('group', { name: '文件展示方式' });
 const tabsBox = (await tabs.boundingBox())!;
 const sortBox = (await trigger.boundingBox())!;
 expect(Math.abs(tabsBox.y + tabsBox.height / 2 - sortBox.y - sortBox.height / 2)).toBeLessThan(1);
 expect(sortBox.x).toBeGreaterThan(tabsBox.x + tabsBox.width);
 expect(await page.locator('.file-list-controls').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
 await page.getByTitle('仅显示标题', { exact: true }).click();
 await expect(page.getByTitle('仅显示标题', { exact: true })).toHaveAttribute('aria-pressed', 'true');
 await page.getByTitle('显示正文预览', { exact: true }).click();
 await expect(page.getByTitle('显示正文预览', { exact: true })).toHaveAttribute('aria-pressed', 'true');
});
