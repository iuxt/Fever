import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page) {
 await page.addInitScript(() => {
  const note = { id: 'a', filename: 'a.md', title: '自动拉取测试', category: '', createdAt: '2026-10-18', updatedAt: '2026-10-18' };
  const other = { ...note, id: 'b', filename: 'b.md', title: '剩余文章' };
  const controls = (window as any).autoPullControls = { tick: () => {}, pulls: 0, checks: 0, head: 'before', content: '# 原始正文', remote: 'https://example.com/notes.git', dirty: false, failure: false, hold: false, release: () => {}, unchanged: false, removed: false };
  window.fever = {
   desktop: true,
   current: async () => ({ path: '/test/auto-pull', name: '测试库', lfs: true, manifest: { version: 1, categories: [], notes: controls.removed ? [other] : [other, note] } }),
   read: async () => controls.content,
   save: async (_id, content) => { controls.content = content; controls.dirty = true; },
   status: async () => { controls.checks++; return { branch: 'main', head: controls.head, changes: controls.dirty ? [{ path: 'notes/a.md', status: ' M', staged: false, unstaged: true }] : [], ahead: 0, behind: 0, remote: controls.remote, lfs: true }; },
   settings: async () => ({ autoCommit: false, interval: 10, autoPull: true, pullInterval: 1, author: '', email: '', remote: controls.remote }),
   pull: async () => {
    controls.pulls++;
    if (controls.hold) await new Promise<void>(resolve => { controls.release = resolve; });
    if (controls.failure) throw new Error('网络连接失败');
    if (!controls.unchanged) { controls.content = '# 远程更新后的正文'; controls.head = 'after'; }
   },
   onAutoPull: callback => { controls.tick = callback; return () => { controls.tick = () => {}; }; },
   history: async () => [], cancelSearch: async () => {}, asset: src => src,
  } as typeof window.fever;
 });
 await page.goto('/');
 await page.locator('.note-row').filter({ hasText: '自动拉取测试' }).click();
 await expect(page.locator('.wysiwyg-content')).toContainText('原始正文');
}

const tick = (page: Page) => page.evaluate(() => (window as any).autoPullControls.tick());
const pulls = (page: Page) => page.evaluate(() => (window as any).autoPullControls.pulls);

async function pull(page: Page, automatic: boolean) {
 if (automatic) await tick(page);
 else {
  await page.getByRole('button', { name: 'Git', exact: true }).click();
  await page.getByRole('button', { name: '拉取', exact: true }).click();
 }
 await expect.poll(() => pulls(page)).toBe(1);
 await expect(page.locator('.app-shell')).not.toHaveAttribute('inert');
}

for (const automatic of [false, true]) {
 for (const unchanged of [false, true]) {
  test(`${automatic ? 'automatic' : 'manual'} pull keeps all tabs closed (${unchanged ? 'no remote update' : 'remote update'})`, async ({ page }) => {
   await fixture(page);
   await page.getByTitle('关闭标签', { exact: true }).click();
   await expect(page.locator('.tab')).toHaveCount(0);
   await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
   await page.evaluate(unchanged => { (window as any).autoPullControls.unchanged = unchanged; }, unchanged);
   await pull(page, automatic);
   await expect(page.locator('.tab')).toHaveCount(0);
   await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
   await expect(page.locator('.toast.error')).toHaveCount(0);
  });
 }

 test(`${automatic ? 'automatic' : 'manual'} pull refreshes the current article`, async ({ page }) => {
  await fixture(page);
  await pull(page, automatic);
  await expect(page.locator('.tab')).toHaveCount(1);
  await expect(page.locator('.tab.current')).toContainText('自动拉取测试');
  await expect(page.locator('.wysiwyg-content')).toContainText('远程更新后的正文');
 });

 for (const otherOpen of [false, true]) {
  test(`${automatic ? 'automatic' : 'manual'} pull closes the removed article with ${otherOpen ? 'a background tab' : 'no other tabs'}`, async ({ page }) => {
   await fixture(page);
   if (otherOpen) {
    await page.locator('.note-row').filter({ hasText: '剩余文章' }).click();
    await page.locator('.note-row').filter({ hasText: '自动拉取测试' }).click();
   }
   await page.evaluate(() => { (window as any).autoPullControls.removed = true; });
   await pull(page, automatic);
   await expect(page.locator('.tab')).toHaveCount(otherOpen ? 1 : 0);
   await expect(page.locator('.tab.current')).toHaveCount(0);
   await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
   await expect(page.locator('.note-row')).toContainText('剩余文章');
   await expect(page.locator('.toast.error')).toHaveCount(0);
  });
 }
}

test('automatic pulls serialize ticks, protect the editor and refresh remote content', async ({ page }) => {
 await fixture(page);
 await page.evaluate(() => { (window as any).autoPullControls.hold = true; });
 await tick(page);
 await expect.poll(() => pulls(page)).toBe(1);
 await expect(page.locator('.app-shell')).toHaveAttribute('inert');
 await tick(page);
 await page.keyboard.insertText('不能写入旧文档');
 expect(await pulls(page)).toBe(1);
 await page.evaluate(() => (window as any).autoPullControls.release());
 await expect(page.locator('.wysiwyg-content')).toContainText('远程更新后的正文');
 await expect(page.locator('.wysiwyg-content')).not.toContainText('不能写入旧文档');
 await expect(page.locator('.app-shell')).not.toHaveAttribute('inert');
});

test('automatic pulls skip missing remotes, local changes, pending drafts and settings dialogs', async ({ page }) => {
 await fixture(page);
 for (const state of [{ remote: '' }, { remote: 'https://example.com/notes.git', dirty: true }]) {
  const checks = await page.evaluate(state => { Object.assign((window as any).autoPullControls, state); return (window as any).autoPullControls.checks; }, state);
  await tick(page);
  await expect.poll(() => page.evaluate(() => (window as any).autoPullControls.checks)).toBeGreaterThan(checks);
  await expect(page.locator('.app-shell')).not.toHaveAttribute('inert');
  expect(await pulls(page)).toBe(0);
 }
 await page.evaluate(() => { (window as any).autoPullControls.dirty = false; });
 await page.getByTitle('设置', { exact: true }).click();
 await tick(page);
 expect(await pulls(page)).toBe(0);
 await page.getByRole('button', { name: '取消', exact: true }).click();
 // Dispatch the timer in the same task as the edit, before the 650ms autosave.
 await page.locator('.wysiwyg-content').evaluate(element => {
  const editor = (element as any).editor;
  editor.commands.setContent('<p>尚未保存的草稿</p>');
  (window as any).autoPullControls.tick();
 });
 await expect(page.locator('.wysiwyg-content')).toContainText('尚未保存的草稿');
 expect(await pulls(page)).toBe(0);
 await expect(page.locator('.toast.error')).toHaveCount(0);
});

test('a failed automatic pull reports the error, unlocks editing and retries on the next tick', async ({ page }) => {
 await fixture(page);
 await page.evaluate(() => { (window as any).autoPullControls.failure = true; });
 await tick(page);
 await expect(page.locator('.toast.error')).toContainText('自动拉取失败：网络连接失败');
 await expect(page.locator('.app-shell')).not.toHaveAttribute('inert');
 await expect(page.locator('.wysiwyg-content')).toContainText('原始正文');
 await page.evaluate(() => { (window as any).autoPullControls.failure = false; });
 await tick(page);
 await expect(page.locator('.wysiwyg-content')).toContainText('远程更新后的正文');
 expect(await pulls(page)).toBe(2);
});
