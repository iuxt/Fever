import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page) {
 await page.addInitScript(() => {
  const note = { id: 'a', filename: 'a.md', title: '自动拉取测试', category: '', createdAt: '2026-10-18', updatedAt: '2026-10-18' };
  const other = { ...note, id: 'b', filename: 'b.md', title: '剩余文章' };
  const controls = (window as any).autoPullControls = { tick: () => {}, pulls: 0, checks: 0, head: '1'.repeat(40), nextHead: '2'.repeat(40), content: '# 原始正文', remote: 'https://example.com/notes.git', dirty: false, failure: false, hold: false, release: () => {}, unchanged: false, removed: false, changes: [{ path: 'notes/a.md', status: 'M' }], diffRequest: null as unknown };
  window.fever = {
   desktop: true,
   current: async () => ({ path: '/test/auto-pull', name: '测试库', lfs: true, manifest: { version: 1, categories: [], notes: controls.removed ? [other] : [other, note] } }),
   read: async id => id === 'a' ? controls.content : '# 剩余文章正文',
   save: async (_id, content) => { controls.content = content; controls.dirty = true; },
   status: async () => { controls.checks++; return { branch: 'main', head: controls.head, changes: controls.dirty ? [{ path: 'notes/a.md', status: ' M', staged: false, unstaged: true }] : [], ahead: 0, behind: 0, remote: controls.remote, lfs: true }; },
   settings: async () => ({ autoCommit: false, interval: 10, autoPull: true, pullInterval: 1, author: '', email: '', remote: controls.remote }),
   preparePull: async () => {
    controls.pulls++;
    if (controls.hold) await new Promise<void>(resolve => { controls.release = resolve; });
    if (controls.failure) throw new Error('网络连接失败');
    return 'prepared-pull';
   },
   cancelPull: async () => {},
   pull: async () => {
    const before = controls.head;
    if (!controls.unchanged) { controls.content = '# 远程更新后的正文'; controls.head = controls.nextHead; }
    return { before, after: controls.head, commitCount: controls.unchanged ? 0 : 2, changes: controls.unchanged ? [] : controls.changes };
   },
   pullDiff: async (before, after, path, originalPath) => {
    controls.diffRequest = { before, after, path, originalPath };
    return { path, patch: '@@ -1 +1 @@\n-before pull\n+after pull\n' };
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

test('each updated pull replaces the remote file list instead of accumulating older files', async ({ page }) => {
 await fixture(page);
 await pull(page, false);
 const remote = page.getByRole('region', { name: '远端变更', exact: true });
 await expect(remote.getByRole('button', { name: '查看远端差异：自动拉取测试', exact: true })).toBeVisible();
 await page.evaluate(() => {
  const controls = (window as any).autoPullControls;
  controls.nextHead = '3'.repeat(40);
  controls.changes = [{ path: 'notes/b.md', status: 'M' }];
 });
 await tick(page);
 await expect.poll(() => pulls(page)).toBe(2);
 await expect(remote.getByRole('button', { name: '查看远端差异：剩余文章', exact: true })).toBeVisible();
 await expect(remote.getByRole('button', { name: '查看远端差异：自动拉取测试', exact: true })).toHaveCount(0);
 await expect(remote.locator('.changes-count')).toHaveText('1');
 const record = await page.evaluate(() => JSON.parse(localStorage.getItem('fever-last-pull:/test/auto-pull')!));
 expect(record.before).toBe('2'.repeat(40));
 expect(record.after).toBe('3'.repeat(40));
 expect(record.changes).toEqual([{ path: 'notes/b.md', status: 'M' }]);
});

test('pull reports file totals and keeps a persistent, read-only remote change list', async ({ page }) => {
 await fixture(page);
 await page.getByTitle('关闭标签', { exact: true }).click();
 await page.evaluate(() => { (window as any).autoPullControls.changes = [
  { path: 'notes/a.md', status: 'M' }, { path: 'notes/new.txt', status: 'A' },
  { path: 'notes/deleted.txt', status: 'D' }, { path: 'notes/renamed.txt', originalPath: 'notes/old.txt', status: 'R' },
 ]; });
 await pull(page, false);
 await expect(page.locator('.toast')).toContainText('2 个提交 · 4 个文件（新增 1 · 修改 1 · 删除 1 · 重命名 1）');
 await expect(page.locator('.git-operation-summary')).toContainText('4 个文件');
 const remote = page.getByRole('region', { name: '远端变更', exact: true });
 await expect(page.locator('.changes-heading')).toHaveText(['已暂存变更', '工作区变更', '远端变更']);
 await expect(remote.locator('.changes-count')).toHaveText('4');
 await expect(page.getByRole('region', { name: '工作区变更', exact: true }).locator('.changes-count')).toHaveText('0');
 await expect(remote.getByRole('button', { name: /暂存|撤销|还原/ })).toHaveCount(0);
 await expect(remote.getByTitle('打开远端变更：notes/deleted.txt', { exact: true })).toBeDisabled();
 await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
 await remote.getByRole('button', { name: '查看远端差异：自动拉取测试', exact: true }).click();
 await expect(page.locator('.tab.current')).toContainText('远端对比');
 await expect(page.locator('.diff-editor')).toContainText('+after pull');
 expect(await page.evaluate(() => (window as any).autoPullControls.diffRequest)).toEqual({ before: '1'.repeat(40), after: '2'.repeat(40), path: 'notes/a.md', originalPath: undefined });
 await page.getByRole('switch', { name: '忽略空格和空行' }).uncheck();
 await expect(remote.locator('.changes-count')).toHaveText('4');
 await page.screenshot({ path: 'test-results/git-remote-changes.png' });
 // A pull with no updates preserves both the list and the current diff tab.
 await page.evaluate(() => { (window as any).autoPullControls.unchanged = true; });
 await page.getByRole('button', { name: '拉取', exact: true }).click();
 await expect(page.locator('.toast')).toContainText('已是最新，无远端更新');
 await expect(page.locator('.toast')).toContainText('0 个提交 · 0 个文件');
 await expect(remote.locator('.changes-count')).toHaveText('4');
 await expect(page.locator('.tab.current')).toContainText('远端对比');
 await page.reload();
 await page.getByRole('button', { name: 'Git', exact: true }).click();
 await expect(remote.locator('.changes-count')).toHaveText('4');
 // A failed pull must not replace the last successful result.
 await page.evaluate(() => { (window as any).autoPullControls.failure = true; });
 await page.getByRole('button', { name: '拉取', exact: true }).click();
 await expect(page.locator('.toast.error')).toContainText('网络连接失败');
 await expect(remote.locator('.changes-count')).toHaveText('4');
});

async function pull(page: Page, automatic: boolean) {
 await page.getByRole('button', { name: 'Git', exact: true }).click();
 if (automatic) await tick(page);
 else {
  await page.getByRole('button', { name: '拉取', exact: true }).click();
 }
 await expect.poll(() => pulls(page)).toBe(1);
 await expect(page.getByRole('button', { name: '拉取', exact: true })).toHaveAttribute('aria-busy', 'false');
 await expect(page.locator('.app-shell')).not.toHaveAttribute('inert');
}

for (const automatic of [false, true]) {
 test(`${automatic ? 'automatic' : 'manual'} network wait permits navigation and refreshes the latest selection`, async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Git', exact: true }).click();
  await page.evaluate(() => { (window as any).autoPullControls.hold = true; });
  if (automatic) await tick(page);
  else await page.getByRole('button', { name: '拉取', exact: true }).click();
  await expect.poll(() => pulls(page)).toBe(1);
  await expect(page.getByRole('button', { name: '拉取', exact: true })).toBeDisabled();
  await expect(page.locator('.app-shell')).not.toHaveAttribute('inert');
  await page.locator('.note-row').filter({ hasText: '剩余文章' }).click();
  await expect(page.locator('.wysiwyg-content')).toContainText('剩余文章正文');
  await page.evaluate(() => (window as any).autoPullControls.release());
  await expect(page.getByRole('button', { name: '拉取', exact: true })).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.tab.current')).toContainText('剩余文章');
  await expect(page.locator('.wysiwyg-content')).toContainText('剩余文章正文');
  await expect(page.locator('.toast.error')).toHaveCount(0);
 });

 test(`${automatic ? 'automatic' : 'manual'} network wait permits closing the last tab`, async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Git', exact: true }).click();
  await page.evaluate(() => { (window as any).autoPullControls.hold = true; });
  if (automatic) await tick(page);
  else await page.getByRole('button', { name: '拉取', exact: true }).click();
  await expect.poll(() => pulls(page)).toBe(1);
  await page.getByTitle('关闭标签', { exact: true }).click();
  await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
  await page.evaluate(() => (window as any).autoPullControls.release());
  await expect(page.getByRole('button', { name: '拉取', exact: true })).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.tab')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
 });

 test(`${automatic ? 'automatic' : 'manual'} pull leaves a settings dialog opened during fetching usable`, async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Git', exact: true }).click();
  await page.evaluate(() => { (window as any).autoPullControls.hold = true; });
  if (automatic) await tick(page);
  else await page.getByRole('button', { name: '拉取', exact: true }).click();
  await expect.poll(() => pulls(page)).toBe(1);
  await page.getByTitle('设置', { exact: true }).click();
  await page.evaluate(() => (window as any).autoPullControls.release());
  await expect(page.getByRole('button', { name: '拉取', exact: true })).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.wysiwyg-content')).toContainText('原始正文');
  await expect(page.locator('.app-shell')).not.toHaveAttribute('inert');
 });

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

test('automatic pulls serialize ticks and allow editing and saving during the network wait', async ({ page }) => {
 await fixture(page);
 await page.evaluate(() => { (window as any).autoPullControls.hold = true; });
 await tick(page);
 await expect.poll(() => pulls(page)).toBe(1);
 await expect(page.locator('.app-shell')).not.toHaveAttribute('inert');
 await tick(page);
 await page.locator('.wysiwyg-content').fill('拉取期间继续编辑');
 await page.locator('.wysiwyg-content').press('ControlOrMeta+s');
 await expect.poll(() => page.evaluate(() => (window as any).autoPullControls.content)).toContain('拉取期间继续编辑');
 expect(await pulls(page)).toBe(1);
 await page.evaluate(() => (window as any).autoPullControls.release());
 await expect(page.locator('.wysiwyg-content')).toContainText('拉取期间继续编辑');
 await expect(page.locator('.wysiwyg-content')).not.toContainText('远程更新后的正文');
 await expect(page.locator('.app-shell')).not.toHaveAttribute('inert');
});

test('manual fetch preserves an unsaved edit made immediately before the network reply', async ({ page }) => {
 await fixture(page);
 await page.getByRole('button', { name: 'Git', exact: true }).click();
 await page.evaluate(() => { (window as any).autoPullControls.hold = true; });
 await page.getByRole('button', { name: '拉取', exact: true }).click();
 await expect.poll(() => pulls(page)).toBe(1);
 await page.locator('.wysiwyg-content').evaluate(element => {
  (element as any).editor.commands.setContent('<p>网络返回前的最后输入</p>');
  (window as any).autoPullControls.release();
 });
 await expect(page.getByRole('button', { name: '拉取', exact: true })).toHaveAttribute('aria-busy', 'false');
 await expect(page.locator('.wysiwyg-content')).toContainText('网络返回前的最后输入');
 await expect.poll(() => page.evaluate(() => (window as any).autoPullControls.content)).toContain('网络返回前的最后输入');
 await expect(page.locator('.toast.error')).toHaveCount(0);
});

test('a network reply does not cancel a note selection that is still reading', async ({ page }) => {
 await fixture(page);
 await page.getByRole('button', { name: 'Git', exact: true }).click();
 await page.evaluate(() => {
  const controls = (window as any).autoPullControls;
  controls.hold = true;
  const read = window.fever!.read;
  window.fever!.read = async (id, scope) => {
   if (id === 'b') await new Promise<void>(resolve => { controls.releaseRead = resolve; });
   return read(id, scope);
  };
 });
 await page.getByRole('button', { name: '拉取', exact: true }).click();
 await expect.poll(() => pulls(page)).toBe(1);
 await page.locator('.note-row').filter({ hasText: '剩余文章' }).click();
 await expect.poll(() => page.evaluate(() => typeof (window as any).autoPullControls.releaseRead)).toBe('function');
 await page.evaluate(() => (window as any).autoPullControls.release());
 await expect(page.getByRole('button', { name: '拉取', exact: true })).toHaveAttribute('aria-busy', 'false');
 await page.evaluate(() => (window as any).autoPullControls.releaseRead());
 await expect(page.locator('.tab.current')).toContainText('剩余文章');
 await expect(page.locator('.wysiwyg-content')).toContainText('剩余文章正文');
 expect(await page.evaluate(() => (window as any).autoPullControls.head)).toBe('1'.repeat(40));
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
