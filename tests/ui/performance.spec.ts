import { test, expect, type Page } from '@playwright/test';

async function mockVault(page: Page, count = 1) {
 await page.addInitScript(count => {
  const notes = Array.from({ length: count }, (_,i) => ({ id: `perf-${i}`, title: `性能笔记 ${i}`, filename: `perf-${i}.md`, category: '', createdAt: '2026-10-15', updatedAt: '2026-10-15' }));
  const controls = { head: 'a'.repeat(40), historyCalls: 0, statusCalls: 0, images: [] as string[], batchResults: [] as boolean[], content: '# 正文\n', savesFail: false, holdNextStatus: false, waitingStatus: false, releaseStatus: () => {} };
  (window as any).performanceControls = controls;
  window.fever = {
   desktop: true,
   current: async () => ({ path: '/test/performance', name: 'performance', lfs: true, manifest: { version: 1, categories: [], notes } }),
   read: async () => controls.content,
   save: async (_id, content) => { if (controls.savesFail) throw new Error('save failed'); controls.content = content; },
   search: async () => [], cancelSearch: async () => {}, asset: () => '',
   settings: async () => ({ autoCommit: false, interval: 10, author: '', email: '', remote: '' }),
   status: async () => {
    controls.statusCalls++;
    const result = { head: controls.head, branch: 'main', changes: count === 1 ? [] : notes.map(note => ({ status: '??', path: `notes/${note.filename}`, staged: false, unstaged: true })), ahead: 0, behind: 0, remote: '', lfs: true };
    if (controls.holdNextStatus) { controls.holdNextStatus = false; controls.waitingStatus = true; await new Promise<void>(resolve => { controls.releaseStatus = () => { controls.waitingStatus = false; resolve(); }; }); }
    return result;
   },
   history: async () => { controls.historyCalls++; return []; },
   diff: async path => ({ path, patch: '+last file\n' }),
   image: async (_bytes, _name, noteId) => { if (controls.images.length) throw new Error('disk full'); const src = `../images/${noteId}/new.png`; controls.images.push(src); return src; },
   completeImageImport: async (_id, keep) => { controls.batchResults.push(keep); if (!keep) controls.images = []; },
  } as typeof window.fever;
 }, count);
 await page.goto('/');
 await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
}

test('large Git lists mount visible rows and can scroll to and open the last change', async ({ page }) => {
 await mockVault(page, 2000);
 await page.getByRole('button', { name: 'Git', exact: true }).click();
 await expect(page.getByRole('region', { name: '工作区变更', exact: true }).locator('.changes-count')).toHaveText('2000');
 expect(await page.locator('.git-changes .change').count()).toBeLessThan(50);
 await page.locator('.git-changes').evaluate(element => { element.scrollTop = element.scrollHeight; });
 await page.getByRole('button', { name: '查看工作区差异：性能笔记 1999', exact: true }).click();
 await expect(page.locator('.diff-editor')).toContainText('+last file');
});

test('history refreshes only while visible and when HEAD changes', async ({ page }) => {
 await page.clock.install();
 await mockVault(page);
 await page.locator('.note-row').first().click();
 await page.getByRole('button', { name: '历史', exact: true }).click();
 await expect.poll(() => page.evaluate(() => (window as any).performanceControls.historyCalls)).toBe(1);
 await page.clock.fastForward(16000);
 await expect.poll(() => page.evaluate(() => (window as any).performanceControls.statusCalls)).toBeGreaterThan(1);
 expect(await page.evaluate(() => (window as any).performanceControls.historyCalls)).toBe(1);
 await page.getByTitle('切换右侧面板').click();
 await page.evaluate(() => { (window as any).performanceControls.head = 'b'.repeat(40); });
 await page.clock.fastForward(16000);
 await expect.poll(() => page.evaluate(() => (window as any).performanceControls.statusCalls)).toBeGreaterThan(2);
 expect(await page.evaluate(() => (window as any).performanceControls.historyCalls)).toBe(1);
 await page.getByTitle('切换右侧面板').click();
 await expect.poll(() => page.evaluate(() => (window as any).performanceControls.historyCalls)).toBe(2);
 await page.evaluate(() => { (window as any).performanceControls.head = 'c'.repeat(40); });
 await page.clock.fastForward(16000);
 await expect.poll(() => page.evaluate(() => (window as any).performanceControls.historyCalls)).toBe(3);
});

test('batch image validation precedes writes and later write failures roll back the batch', async ({ page }) => {
 await mockVault(page);
 await page.locator('.note-row').first().click();
 const drop = async (invalid: boolean) => page.evaluate(invalid => {
  const files = new DataTransfer(); files.items.add(new File(['png'], 'first.png', { type: 'image/png' }));
  files.items.add(new File(['png'], invalid ? 'bad.txt' : 'second.png', { type: invalid ? 'text/plain' : 'image/png' }));
  document.querySelector('.document-space')!.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: files }));
 }, invalid);
 await drop(true);
 await expect(page.locator('.toast')).toContainText('支持 PNG');
 expect(await page.evaluate(() => (window as any).performanceControls.images)).toEqual([]);
 await drop(false);
 await expect(page.locator('.toast')).toContainText('disk full');
 expect(await page.evaluate(() => (window as any).performanceControls.batchResults)).toEqual([false]);
 expect(await page.evaluate(() => (window as any).performanceControls.images)).toEqual([]);
 await expect(page.locator('.wysiwyg-content img')).toHaveCount(0);
});

test('a delayed background status cannot replace a newer save status', async ({ page }) => {
 await page.clock.install(); await mockVault(page); await page.locator('.note-row').first().click();
 await page.getByRole('button', { name: '历史', exact: true }).click();
 await expect.poll(() => page.evaluate(() => (window as any).performanceControls.historyCalls)).toBe(1);
 await page.evaluate(() => { const c = (window as any).performanceControls; c.head = 'b'.repeat(40); c.holdNextStatus = true; });
 await page.clock.fastForward(16000);
 await expect.poll(() => page.evaluate(() => (window as any).performanceControls.waitingStatus)).toBe(true);
 await page.evaluate(() => { (window as any).performanceControls.head = 'c'.repeat(40); });
 await page.locator('.wysiwyg-content').fill('save while status is pending');
 await page.clock.fastForward(1000);
 await expect.poll(() => page.evaluate(() => (window as any).performanceControls.historyCalls)).toBe(2);
 await page.evaluate(() => (window as any).performanceControls.releaseStatus());
 await page.clock.fastForward(100);
 expect(await page.evaluate(() => (window as any).performanceControls.historyCalls)).toBe(2);
});

test('failed saves keep images referenced by the unsaved draft', async ({ page }) => {
 await mockVault(page); await page.locator('.note-row').first().click();
 await page.evaluate(() => { (window as any).performanceControls.savesFail = true; });
 await page.locator('input[type=file]').setInputFiles({ name: 'one.png', mimeType: 'image/png', buffer: Buffer.from('image') });
 await expect(page.locator('.toast')).toContainText('save failed');
 expect(await page.evaluate(() => (window as any).performanceControls.batchResults)).toEqual([true]);
 expect(await page.evaluate(() => (window as any).performanceControls.images)).toHaveLength(1);
 await expect(page.getByRole('img', { name: 'one.png', exact: true })).toHaveCount(1);
 await page.evaluate(() => { (window as any).performanceControls.savesFail = false; });
 await page.keyboard.press('ControlOrMeta+s');
 await expect.poll(() => page.evaluate(() => (window as any).performanceControls.content)).toContain('../images/perf-0/new.png');
});

test('unlabelled and oversized code stays readable without auto detection in rich and preview modes', async ({ page }) => {
 await mockVault(page);
 const large = 'const value = 123; // plain preview\n'.repeat(2048);
 await page.evaluate(large => { (window as any).performanceControls.content = '```\nconst small = 1;\n```\n\n```javascript\n' + large + '```\n'; }, large);
 await page.locator('.note-row').first().click();
 await expect(page.locator('.document-space.source .cm-content')).toBeVisible();
 // Large notes open as source; explicitly opt into rich text to test highlighting.
 await page.getByTitle('编辑模式 · ⌘ E', { exact: true }).click();
 await expect(page.locator('.editor-code-block pre code').last()).toHaveText(large.trimEnd());
 await expect(page.locator('.editor-code-block [class*="hljs-"]')).toHaveCount(0);
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await expect(page.locator('.document .prose pre code').last()).toHaveText(large.trimEnd());
 await expect(page.locator('.document .prose pre code [class*="hljs-"]')).toHaveCount(0);
});

test('large history diffs fall back to paged text and cancel workers when navigating away', async ({ page }) => {
 await page.addInitScript(() => {
  const commits = ['2', '1'].map((digit, i) => ({ commit: { hash: digit.repeat(40), message: i ? '旧版本' : '大量改写', author: 'Test', date: '2026-10-15' }, content: Array.from({ length: 6000 }, (_,line) => `${i ? 'before' : 'after'} ${line}`).join('\n') }));
  localStorage.setItem('fever-demo-v1', JSON.stringify({ manifest: { version: 1, categories: [], notes: [{ id: 'large', filename: 'large.md', title: '大版本', category: '', createdAt: '2026-10-15', updatedAt: '2026-10-15' }] }, contents: { large: '# 当前草稿' }, versions: { large: commits }, dirty: [], images: {}, settings: { autoCommit: false, interval: 10, author: '', email: '', remote: '' } }));
 });
 await page.goto('/'); await page.locator('.note-row').click();
 await page.getByRole('button', { name: '历史', exact: true }).click();
 await page.getByRole('button', { name: /大量改写/ }).click();
 await expect(page.getByText('差异较大，已改为分页查看两个版本的内容。')).toBeVisible();
 await expect(page.getByLabel('此版本内容', { exact: true })).toContainText('after 199');
 await expect(page.getByLabel('此版本内容', { exact: true })).not.toContainText('after 200');
 await page.getByLabel('此版本内容分页').getByRole('button', { name: '下一页' }).click();
 await expect(page.getByLabel('此版本内容', { exact: true })).toContainText('after 200');
 await page.getByRole('button', { name: '返回当前版本', exact: true }).click();
 await expect(page.locator('.wysiwyg-content')).toContainText('当前草稿');
 await page.getByRole('button', { name: /大量改写/ }).click();
 await page.getByRole('button', { name: '返回当前版本', exact: true }).click();
 await expect(page.locator('.wysiwyg-content')).toContainText('当前草稿');
});
