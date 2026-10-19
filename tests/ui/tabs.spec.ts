import { test, expect } from '@playwright/test';

for (const desktop of [false, true]) {
 for (const fail of [false, true]) {
  test(`${desktop ? 'native' : 'browser'} tabs close while a Git commit is pending (${fail ? 'failure' : 'success'})`, async ({ page }) => {
   await page.addInitScript(({ desktop, fail }) => {
    const note = (id: string) => ({ id, title: `Note ${id}`, filename: `${id}.md`, category: '', createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z' });
    const controls = { waiting: false, release: () => {}, close: () => {}, currentCalls: 0, file: 'before commit', committedFile: '' };
    (window as any).commitControls = controls;
    window.fever = {
     desktop,
     onCloseTab: callback => { controls.close = callback; return () => { controls.close = () => {}; }; },
     current: async () => {
      controls.currentCalls++;
      return { path: '/test/commit-tabs', name: 'commit-tabs', lfs: true, manifest: { version: 1, categories: [], notes: [note('a'), note('b')] } };
     },
     read: async id => `# Note ${id}`,
     status: async () => ({ branch: 'main', changes: ['notes/a.md', 'settings.txt'].map(path => ({ path, status: ' M', staged: false, unstaged: true })), ahead: 0, behind: 0, remote: '', lfs: true }),
     settings: async () => ({ autoCommit: false, interval: 10, author: '', email: '', remote: '' }),
     cancelSearch: async () => {}, asset: () => '',
     diff: async path => ({ path, patch: '@@ -1 +1 @@\n-before\n+after' }),
     openFile: async path => ({ path, content: controls.file, binary: false }),
     saveFile: async (_path, content) => { controls.file = content; },
     commit: async () => {
      controls.committedFile = controls.file;
      await new Promise<void>(resolve => { controls.waiting = true; controls.release = resolve; });
      controls.waiting = false;
      if (fail) throw new Error('测试提交失败');
     },
    } as typeof window.fever;
   }, { desktop, fail });
   await page.goto('/');
   await page.locator('.note-row').filter({ hasText: 'Note b' }).click();
   await page.locator('.note-row').filter({ hasText: 'Note a' }).click();
   await page.getByRole('button', { name: 'Git', exact: true }).click();
   await page.getByRole('button', { name: '查看工作区差异：Note a', exact: true }).click();
   await page.locator('.change').filter({ hasText: 'settings.txt' }).hover();
   await page.getByTitle('打开文件：settings.txt', { exact: true }).click();
   await page.locator('.file-editor .cm-content').fill('saved before commit');
   await page.getByRole('button', { name: '提交所有笔记变更', exact: true }).click();
   await expect.poll(() => page.evaluate(() => (window as any).commitControls.waiting)).toBe(true);
   expect(await page.evaluate(() => (window as any).commitControls.committedFile)).toBe('saved before commit');
   const currentCalls = await page.evaluate(() => (window as any).commitControls.currentCalls);
   const closeShortcut = async () => {
    if (desktop) await page.evaluate(() => (window as any).commitControls.close());
    else await page.keyboard.press('ControlOrMeta+w');
   };
   await page.getByTitle('关闭文件：settings.txt', { exact: true }).click();
   await expect(page.locator('.tab')).toHaveCount(3);
   await expect(page.locator('.tab.current')).toContainText('工作区对比');
   await closeShortcut();
   await expect(page.locator('.tab')).toHaveCount(2);
   await expect(page.locator('.tab.current')).toContainText('Note a');
   await page.locator('.tab').filter({ hasText: 'Note b' }).getByTitle('关闭标签', { exact: true }).click();
   await expect(page.locator('.tab')).toHaveCount(1);
   await closeShortcut();
   await expect(page.locator('.tab')).toHaveCount(0);
   await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
   // Tab operations must not unlock Git controls or refresh behind the pending commit.
   await expect(page.getByRole('button', { name: '正在处理…', exact: true })).toBeDisabled();
   await expect(page.getByTitle('全部暂存', { exact: true })).toBeDisabled();
   expect(await page.evaluate(() => (window as any).commitControls.currentCalls)).toBe(currentCalls);
   expect(await page.evaluate(() => (window as any).commitControls.waiting)).toBe(true);
   await page.evaluate(() => (window as any).commitControls.release());
   await expect(page.getByText(fail ? '测试提交失败' : '已创建 Git 提交', { exact: true })).toBeVisible();
   await expect(page.getByRole('button', { name: '提交所有笔记变更', exact: true })).toBeEnabled();
   await expect(page.locator('.tab')).toHaveCount(0);
  });
 }
}

for (const remaining of ['none', 'note', 'file'] as const) {
 test(`deleting the active note closes its tab with ${remaining} remaining`, async ({ page }) => {
  await page.goto('/');
  if (remaining === 'note') {
   await page.locator('.folder-row').filter({ hasText: '知识管理' }).click();
   await page.locator('.note-row').filter({ hasText: '构建我的第二大脑' }).click();
  }
  await page.locator('.folder-row').filter({ hasText: '开始使用' }).click();
  await page.locator('.note-row').filter({ hasText: 'Markdown 语法指南' }).click();
  if (remaining === 'file') {
   await page.getByTitle('Markdown 源码与预览').click();
   await page.locator('.cm-content').fill('# 删除前的修改');
   await page.getByRole('button', { name: 'Git', exact: true }).click();
   await page.getByTitle('刷新 Git 状态', { exact: true }).click();
   await page.getByRole('button', { name: '查看工作区差异：fever.json', exact: true }).hover();
   await page.getByTitle('打开文件：fever.json', { exact: true }).click();
   await page.locator('.tab').getByRole('button', { name: 'Markdown 语法指南', exact: true }).click();
  }
  await page.getByTitle('更多笔记操作').click();
  await page.getByRole('button', { name: '删除笔记', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除笔记', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.note-row').filter({ hasText: 'Markdown 语法指南' })).toHaveCount(0);
  await expect(page.locator('.tab')).toHaveCount(remaining === 'none' ? 0 : 1);
  if (remaining === 'none') {
   await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
   await page.reload();
   await expect(page.locator('.tab')).toHaveCount(0);
   await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
  } else {
   await expect(page.locator('.tab.current')).toContainText(remaining === 'note' ? '构建我的第二大脑' : 'fever.json');
  }
 });
}

for (const modifier of ['Meta', 'Control']) {
 test(`${modifier}+W saves and closes the active note, keeping the workspace open`, async ({ page }) => {
  await page.goto('/');
  await page.locator('.folder-row').filter({ hasText: '开始使用' }).click();
  await page.locator('.note-row').filter({ hasText: '欢迎使用 Fever' }).click();
  await page.locator('.note-row').filter({ hasText: 'Markdown 语法指南' }).click();
  await page.getByTitle('Markdown 源码与预览').click();
  const draft = '# 关闭前保存\n\n尚未等待自动保存。';
  await page.locator('.cm-content').fill(draft);
  await page.keyboard.press(`${modifier}+w`);
  await expect(page.locator('.tab')).toHaveCount(1);
  await expect(page.locator('.tab.current')).toContainText('欢迎使用 Fever');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).contents['demo-2'])).toBe(draft);
  await page.locator('.cm-content').focus();
  await page.keyboard.press(`${modifier}+w`);
  await expect(page.locator('.tab')).toHaveCount(0);
  await expect(page.locator('.workspace')).toBeVisible();
  await page.keyboard.press(`${modifier}+w`);
  await expect(page.locator('.tab')).toHaveCount(0);
  await page.locator('.note-row').filter({ hasText: 'Markdown 语法指南' }).click();
  await expect(page.locator('.cm-content')).toContainText('尚未等待自动保存。');
 });
}

test('close shortcut handles file and diff tabs without reopening closed notes', async ({ page }) => {
 await page.goto('/');
 await page.locator('.folder-row').filter({ hasText: '开始使用' }).click();
 await page.locator('.note-row').filter({ hasText: '欢迎使用 Fever' }).click();
 await page.getByTitle('Markdown 源码与预览').click();
 await page.locator('.cm-content').fill('# 产生差异');
 await page.getByRole('button', { name: 'Git', exact: true }).click();
 await page.getByTitle('刷新 Git 状态', { exact: true }).click();
 await page.getByRole('button', { name: '查看工作区差异：欢迎使用 Fever', exact: true }).click();
 await page.getByRole('button', { name: '查看工作区差异：fever.json', exact: true }).hover();
 await page.getByTitle('打开文件：fever.json', { exact: true }).click();
 const state = await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!));
 state.manifest.folders.push({ id: 'saved-on-close', name: '关闭文件时保存', parentId: null });
 await page.locator('.file-editor .cm-content').fill(JSON.stringify(state.manifest, null, 2));
 await page.keyboard.press('Meta+w');
 await expect(page.locator('.file-editor')).toHaveCount(0);
 await expect(page.locator('.tab.current')).toContainText('工作区对比');
 expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).manifest.folders.map((folder: { name: string }) => folder.name))).toContain('关闭文件时保存');
 await page.getByTitle('关闭标签', { exact: true }).click();
 await expect(page.locator('.tab')).toHaveCount(1);
 await page.keyboard.press('Control+w');
 await expect(page.locator('.tab')).toHaveCount(0);
 await expect(page.locator('.workspace')).toBeVisible();
});

test('closing the last note activates an existing editor tab and a modal blocks the shortcut', async ({ page }) => {
 await page.goto('/');
 await page.locator('.folder-row').filter({ hasText: '开始使用' }).click();
 await page.locator('.note-row').filter({ hasText: '欢迎使用 Fever' }).click();
 await page.getByTitle('Markdown 源码与预览').click();
 await page.locator('.cm-content').fill('# 产生文件变更');
 await expect(page.getByText('所有更改已保存')).toBeVisible();
 await page.getByRole('button', { name: 'Git', exact: true }).click();
 await page.getByTitle('刷新 Git 状态', { exact: true }).click();
 await page.getByRole('button', { name: '查看工作区差异：fever.json', exact: true }).hover();
 await page.getByTitle('打开文件：fever.json', { exact: true }).click();
 await page.locator('.tab').getByRole('button', { name: '欢迎使用 Fever', exact: true }).click();
 await page.getByRole('button', { name: '新建笔记', exact: true }).first().click();
 await page.getByLabel('笔记标题').fill('对话框内容');
 await page.keyboard.press('Meta+w');
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.locator('.tab')).toHaveCount(2);
 await page.getByRole('button', { name: '取消', exact: true }).click();
 await page.keyboard.press('Meta+w');
 await expect(page.locator('.tab')).toHaveCount(1);
 await expect(page.locator('.tab.current')).toContainText('fever.json');
 await page.keyboard.press('Meta+w');
 await expect(page.locator('.tab')).toHaveCount(0);
});
