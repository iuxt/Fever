import { test, expect, type Page } from '@playwright/test';
import { manifestView } from '../../electron/manifest.mjs';

const folder = (page: Page, path: string) => page.locator(`.folder-row[title="${path}"]`);
const note = (page: Page, title: string) => page.locator(`.note-card[title="${title}"]`);
const chosen = (page: Page) => page.locator('.note-card[aria-pressed="true"] .note-card-title strong');
const state = async (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!));
const manifest = async (page: Page) => manifestView((await state(page)).manifest);

async function seed(page: Page, count = 5) {
 await page.addInitScript(count => {
  if (localStorage.getItem('fever-demo-v1')) return;
  const notes = Array.from({ length: count }, (_, i) => ({
   id: `note-${i}`, title: `文件${i}`, category: i === count - 1 ? '来源/子目录' : '来源', filename: `note-${i}.md`,
   createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z',
  }));
  localStorage.setItem('fever-note-sort', JSON.stringify({ field: 'title', direction: 'asc' }));
  localStorage.setItem('fever-demo-v1', JSON.stringify({
   manifest: { version: 1, categories: ['来源/子目录', '目标', '其他'], notes },
   contents: Object.fromEntries(notes.map(note => [note.id, `# ${note.title}\n\n正文`])),
   versions: {}, dirty: [], images: {}, settings: {},
  }));
 }, count);
 await page.goto('/');
 await folder(page, '来源').click();
}

test('modifier selection, ranges, toggle and Escape keep the open draft intact', async ({ page }) => {
 await seed(page);
 await note(page, '文件0').click();
 await page.locator('.wysiwyg-content').fill('正在编辑的草稿');
 await note(page, '文件2').click({ modifiers: ['ControlOrMeta'] });
 await expect(chosen(page)).toHaveText(['文件0', '文件2']);
 await expect(page.locator('.wysiwyg-content')).toHaveText('正在编辑的草稿');
 await expect(page.locator('.tabs .tab')).toHaveCount(1);
 await note(page, '文件2').click({ modifiers: ['ControlOrMeta'] });
 await expect(chosen(page)).toHaveText(['文件0']);
 await note(page, '文件0').click({ modifiers: ['ControlOrMeta'] });
 await note(page, '文件3').click({ modifiers: ['Shift'] });
 await expect(chosen(page)).toHaveText(['文件0', '文件1', '文件2', '文件3']);
 await expect(page.getByRole('status')).toHaveText('已选 4 项');
 await page.keyboard.press('Escape');
 await expect(chosen(page)).toHaveCount(0);
 await note(page, '文件1').click({ modifiers: ['Shift'] });
 await expect(chosen(page)).toHaveText(['文件1']);
 await note(page, '文件2').click();
 await expect(chosen(page)).toHaveText(['文件2']);
 await expect(page.locator('.wysiwyg-content h1')).toHaveText('文件2');
});

test('select all moves only direct folder files, saves drafts, and persists after reload', async ({ page }) => {
 await seed(page);
 await note(page, '文件0').click();
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await page.locator('.cm-content').fill('# 批量移动前的草稿');
 await page.getByRole('checkbox', { name: '全选当前列表' }).check();
 await expect(chosen(page)).toHaveText(['文件0', '文件1', '文件2', '文件3']);
 await note(page, '文件2').dragTo(folder(page, '目标'));
 await expect(folder(page, '目标')).toHaveAttribute('aria-pressed', 'true');
 await expect(page.locator('.note-card')).toHaveCount(4);
 await expect(page.locator('.cm-content')).toContainText('批量移动前的草稿');
 await expect(page.locator('.tabs .tab')).toHaveCount(1);
 const moved = await manifest(page);
 expect(moved.notes.map(note => [note.id, note.category])).toEqual([
  ['note-0', '目标'], ['note-1', '目标'], ['note-2', '目标'], ['note-3', '目标'], ['note-4', '来源/子目录'],
 ]);
 expect((await state(page)).contents['note-0']).toContain('批量移动前的草稿');
 await page.reload();
 await expect(folder(page, '目标')).toHaveAttribute('aria-pressed', 'true');
 await expect(page.locator('.note-card')).toHaveCount(4);
 await expect(page.locator('.wysiwyg-content')).toContainText('批量移动前的草稿');
});

test('keyboard select all includes virtualized rows and leaves editor shortcuts scoped', async ({ page }) => {
 await seed(page, 121);
 await note(page, '文件0').click();
 await page.locator('.wysiwyg-content').fill('正文全选不会选择文件');
 await page.keyboard.press('ControlOrMeta+a');
 await expect(page.getByRole('status')).toHaveText('已选 1 项');
 await page.getByLabel('文件列表', { exact: true }).focus();
 await page.keyboard.press('ControlOrMeta+a');
 await expect(page.getByRole('status')).toHaveText('已选 120 项');
 expect(await page.locator('.note-card').count()).toBeLessThan(30);
 await note(page, '文件0').dragTo(folder(page, '目标'));
 await expect.poll(async () => (await manifest(page)).notes.filter(note => note.category === '目标').length).toBe(120);
 expect((await manifest(page)).notes.find(note => note.id === 'note-120')?.category).toBe('来源/子目录');
});

test('selection survives sorting and view switches, then resets on folder and search changes', async ({ page }) => {
 await seed(page);
 await note(page, '文件0').click({ modifiers: ['ControlOrMeta'] });
 await note(page, '文件2').click({ modifiers: ['ControlOrMeta'] });
 await page.getByRole('button', { name: '切换为降序', exact: true }).click();
 await expect(chosen(page)).toHaveText(['文件2', '文件0']);
 await page.getByTitle('仅显示标题', { exact: true }).click();
 await expect(chosen(page)).toHaveText(['文件2', '文件0']);
 await folder(page, '其他').click();
 await folder(page, '来源').click();
 await expect(chosen(page)).toHaveCount(0);
 await page.getByRole('checkbox', { name: '全选当前列表' }).check();
 await page.getByPlaceholder('搜索你的笔记…').fill('文件1');
 await expect(chosen(page)).toHaveCount(0);
 await page.getByLabel('文件列表', { exact: true }).focus();
 await page.keyboard.press('ControlOrMeta+a');
 await expect(chosen(page)).toHaveText(['文件1']);
 await page.setViewportSize({ width: 560, height: 800 });
 await page.emulateMedia({ colorScheme: 'dark' });
 expect(await page.locator('.note-selection-bar').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
 await page.screenshot({ path: 'test-results/note-selection-narrow.png' });
 await page.getByRole('button', { name: '取消选择', exact: true }).click();
 await expect(chosen(page)).toHaveCount(0);
});

test('search selection spans folders and can be moved together to uncategorized', async ({ page }) => {
 await seed(page);
 await page.getByPlaceholder('搜索你的笔记…').fill('文件');
 await page.getByRole('checkbox', { name: '全选当前列表' }).check();
 await expect(page.getByRole('status')).toHaveText('已选 5 项');
 const card = (await note(page, '文件0').boundingBox())!;
 await page.mouse.move(card.x + 50, card.y + 30); await page.mouse.down();
 await page.mouse.move(card.x + 65, card.y + 40, { steps: 5 });
 const root = page.locator('.folder-root-drop');
 await root.hover();
 const target = (await root.boundingBox())!;
 await page.mouse.move(target.x + target.width / 2 + 2, target.y + target.height / 2);
 await expect(root).toHaveClass(/folder-drop-target/); await page.mouse.up();
 await expect(page.locator('.file-list-header h2')).toHaveText('未分类');
 await expect(page.getByPlaceholder('搜索你的笔记…')).toHaveValue('');
 expect((await manifest(page)).notes.every(note => note.category === '')).toBe(true);
});

test('dragging an unselected file moves only that file and same-folder batch drops do nothing', async ({ page }) => {
 await seed(page);
 await page.getByRole('checkbox', { name: '全选当前列表' }).check();
 const before = (await state(page)).manifest;
 await note(page, '文件0').dragTo(folder(page, '来源'));
 expect((await state(page)).manifest).toEqual(before);
 await page.getByRole('checkbox', { name: '全选当前列表' }).uncheck();
 await note(page, '文件0').click({ modifiers: ['ControlOrMeta'] });
 await note(page, '文件1').click({ modifiers: ['ControlOrMeta'] });
 await note(page, '文件3').dragTo(folder(page, '目标'));
 await expect(folder(page, '目标')).toHaveAttribute('aria-pressed', 'true');
 expect((await manifest(page)).notes.filter(note => note.category === '目标').map(note => note.id)).toEqual(['note-3']);
});
