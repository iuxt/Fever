import { test, expect, type Page } from '@playwright/test';

type Controls = {
 contents: Record<string, string>;
 currentCalls: number;
 waitingSearch?: boolean;
 releaseSearch?: () => void;
 holdNextRead: boolean;
 waiting: boolean;
 release: () => void;
};
declare global { interface Window { reviewControls: Controls } }

async function desktopFixture(page: Page, content = '# Note A\n\n[Other note](b.md)\n') {
 await page.addInitScript(content => {
  const note = (id: string, title: string) => ({ id, title, filename: `${id}.md`, category: '', createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z' });
  let vault = { path: '/test/first', name: 'first', lfs: true, manifest: { version: 1 as const, categories: [], notes: [note('a', 'Note A'), note('b', 'Note B')].filter(note => note.id !== localStorage.getItem('test-removed-note')) } };
  const controls: Controls = { contents: { a: content, b: '# Note B\n\nTarget body', c: '# New vault note\n\nNew library body' }, currentCalls: 0, holdNextRead: false, waiting: false, release: () => {} };
  window.reviewControls = controls;
  window.fever = {
   desktop: true,
   current: async () => { controls.currentCalls++; return structuredClone(vault); },
   open: async () => {
    vault = { ...vault, path: '/test/second', name: 'second', manifest: { ...vault.manifest, notes: [note('c', 'New vault note')] } };
    return structuredClone(vault);
   },
   read: async id => {
    const value = controls.contents[id];
    if (controls.holdNextRead) {
     controls.holdNextRead = false;
     await new Promise<void>(resolve => { controls.waiting = true; controls.release = () => { controls.waiting = false; resolve(); }; });
    } else await new Promise(resolve => setTimeout(resolve, 30));
    return value;
   },
   save: async (id, value) => {
    controls.contents[id] = value;
    const note = vault.manifest.notes.find(note => note.id === id)!;
    note.updatedAt = new Date().toISOString();
    return { updatedAt: note.updatedAt };
   },
   search: async query => Object.keys(controls.contents).filter(id => controls.contents[id].toLowerCase().includes(query.toLowerCase())),
   status: async () => ({ branch: 'main', changes: [], ahead: 0, behind: 0, remote: '', lfs: true }),
   settings: async () => ({ autoCommit: false, interval: 10, author: '', email: '', remote: '' }),
   history: async () => [],
   cancelSearch: async () => {},
   asset: src => /^https?:\/\//i.test(src) ? src : '',
  } as typeof window.fever;
 }, content);
 await page.goto('/');
 await page.locator('.note-row').filter({ hasText: 'Note A' }).click();
 await expect(page.locator('.note-row.selected .note-card-title strong')).toHaveText('Note A');
 await expect(page.locator('.wysiwyg-content')).toBeVisible();
}

for (const mode of ['rich', 'source']) {
 test(`${mode} autosaves and manual saves update metadata without reloading the library`, async ({ page }) => {
  await desktopFixture(page);
  if (mode === 'source') await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
  const editor = page.locator(mode === 'source' ? '.cm-content' : '.wysiwyg-content');
  const calls = await page.evaluate(() => window.reviewControls.currentCalls);
  await page.getByRole('button', { name: '大纲', exact: true }).click();
  const oldTime = await page.locator('.note-info dd').nth(1).textContent();
  for (const value of ['First edit', 'Second edit']) {
   await editor.fill(value);
   await expect.poll(() => page.evaluate(() => window.reviewControls.contents.a)).toContain(value);
   await expect(page.getByText('所有更改已保存')).toBeVisible();
   expect(await page.evaluate(() => window.reviewControls.currentCalls)).toBe(calls);
   await expect(page.locator('.note-row.selected .note-card-title strong')).toHaveText('Note A');
  }
  await expect(page.locator('.note-info dd').nth(1)).not.toHaveText(oldTime!);
  await editor.fill('Manual save');
  await editor.press('ControlOrMeta+s');
  await expect(page.getByText('笔记已保存', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.reviewControls.contents.a)).toContain('Manual save');
  expect(await page.evaluate(() => window.reviewControls.currentCalls)).toBe(calls);
 });
}

test('autosave retains content search results during a search and removes matches after content changes', async ({ page }) => {
 await desktopFixture(page, '# Note A\n\nUnique search phrase');
 await page.getByPlaceholder('搜索你的笔记…').fill('Unique search phrase');
 await expect(page.locator('.note-row .note-card-title strong')).toHaveText('Note A');
 await page.evaluate(() => {
  const search = window.fever!.search;
  window.fever!.search = async query => {
   const result = await search(query);
   await new Promise<void>(resolve => {
    window.reviewControls.waitingSearch = true;
    window.reviewControls.releaseSearch = () => { window.fever!.search = search; resolve(); };
   });
   return result;
  };
 });
 await page.locator('.wysiwyg-content').fill('Unique search phrase with more text');
 await expect.poll(() => page.evaluate(() => window.reviewControls.waitingSearch)).toBe(true);
 await expect(page.locator('.note-row .note-card-title strong')).toHaveText('Note A');
 await page.evaluate(() => window.reviewControls.releaseSearch!());
 await page.locator('.wysiwyg-content').fill('Unrelated content');
 await expect.poll(() => page.evaluate(() => window.reviewControls.contents.a)).toContain('Unrelated content');
 await expect(page.locator('.note-row')).toHaveCount(0);
 await expect(page.getByText('没有找到相关笔记')).toBeVisible();
});

for (const mode of ['rich', 'source']) for (const savedBeforeRead of [false, true]) {
 test(`${mode} keeps edits made during a read even when autosave ${savedBeforeRead ? 'has finished' : 'is pending'}`, async ({ page }) => {
  await desktopFixture(page);
  if (mode === 'source') await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
  const editor = page.locator(mode === 'source' ? '.cm-content' : '.wysiwyg-content');
  await page.evaluate(() => { window.reviewControls.holdNextRead = true; });
  await page.locator('.note-row').filter({ hasText: 'Note A' }).click();
  await expect.poll(() => page.evaluate(() => window.reviewControls.waiting)).toBe(true);
  await editor.fill('NEW INPUT');
  if (savedBeforeRead) {
   await expect.poll(() => page.evaluate(() => window.reviewControls.contents.a)).toContain('NEW INPUT');
   await expect(page.getByText('所有更改已保存')).toBeVisible();
  }
  await page.evaluate(() => window.reviewControls.release());
  await expect(editor).toContainText('NEW INPUT');
  await editor.press('End');
  await page.keyboard.insertText(' MORE');
  await expect.poll(() => page.evaluate(() => window.reviewControls.contents.a)).toContain('NEW INPUT MORE');
 });
}

test('switching to a new library leaves the workspace empty', async ({ page }) => {
 await desktopFixture(page);
 await page.getByTitle('设置', { exact: true }).click();
 await page.getByRole('button', { name: '切换', exact: true }).click();
 await expect(page.locator('.note-row .note-card-title strong')).toHaveText('New vault note');
 await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
 await expect(page.locator('.tab')).toHaveCount(0);
});

test('reopening restores the last selected note, including selection through a link', async ({ page }) => {
 await desktopFixture(page);
 await page.locator('.wysiwyg-content').getByRole('link', { name: 'Other note' }).click({ modifiers: ['ControlOrMeta'] });
 await expect(page.locator('.tab.current')).toContainText('Note B');
 await page.reload();
 await expect(page.locator('.tab')).toHaveCount(1);
 await expect(page.locator('.tab.current')).toContainText('Note B');
 await expect(page.locator('.wysiwyg-content')).toContainText('Target body');
});

test('a removed last note leaves the workspace empty on every reopen', async ({ page }) => {
 await desktopFixture(page);
 await page.locator('.note-row').filter({ hasText: 'Note B' }).click();
 await expect(page.locator('.tab.current')).toContainText('Note B');
 await page.evaluate(() => localStorage.setItem('test-removed-note', 'b'));
 await page.reload();
 await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
 await expect(page.locator('.tab')).toHaveCount(0);
 await page.reload();
 await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
 await expect(page.locator('.tab')).toHaveCount(0);
});

test('each library restores its own last note even when note IDs overlap', async ({ page }) => {
 await desktopFixture(page);
 await page.locator('.note-row').filter({ hasText: 'Note B' }).click();
 await expect(page.locator('.tab.current')).toContainText('Note B');
 await page.evaluate(() => {
  let second = false;
  const current = window.fever!.current;
  window.fever!.current = async () => ({ ...(await current())!, path: second ? '/test/second' : '/test/first' });
  window.fever!.open = async () => { second = !second; return window.fever!.current(); };
 });
 async function switchLibrary() {
  await page.getByTitle('设置', { exact: true }).click();
  await page.getByRole('button', { name: '切换', exact: true }).click();
 }
 await switchLibrary();
 await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
 await page.locator('.note-row').filter({ hasText: 'Note A' }).click();
 await expect(page.locator('.tab.current')).toContainText('Note A');
 await switchLibrary();
 await expect(page.locator('.tab.current')).toContainText('Note B');
 await switchLibrary();
 await expect(page.locator('.tab.current')).toContainText('Note A');
});

test('a delayed read cannot reopen the last note after its tab is closed', async ({ page }) => {
 await desktopFixture(page);
 await page.evaluate(() => { window.reviewControls.holdNextRead = true; });
 await page.locator('.note-row').filter({ hasText: 'Note A' }).click();
 await expect.poll(() => page.evaluate(() => window.reviewControls.waiting)).toBe(true);
 await page.getByTitle('关闭标签', { exact: true }).click();
 await expect(page.locator('.tab')).toHaveCount(0);
 await page.evaluate(() => window.reviewControls.release());
 await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
 await page.locator('.note-row').filter({ hasText: 'Note B' }).click();
 await expect(page.locator('.tab')).toHaveCount(1);
 await expect(page.locator('.tab.current')).toContainText('Note B');
});

test('preview opens a migrated note link inside the app and preserves the source note', async ({ page }) => {
 const content = '# Note A\n\n[Other note](b.md)\n';
 await desktopFixture(page, content);
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await page.locator('.prose').getByRole('link', { name: 'Other note' }).click();
 await expect(page.locator('.note-row.selected .note-card-title strong')).toHaveText('Note B');
 await expect(page.locator('.cm-content')).toContainText('Target body');
 expect(await page.evaluate(() => window.reviewControls.contents.a)).toBe(content);
 expect(page.url()).toBe('http://127.0.0.1:5173/');
});

test('rich editor follows internal links with a modifier while normal clicks remain editable', async ({ page }) => {
 await desktopFixture(page, '# Note A\n\n[Other note](../notes/b.md)\n');
 const link = page.locator('.wysiwyg-content').getByRole('link', { name: 'Other note' });
 await link.click();
 await expect(page.locator('.note-row.selected .note-card-title strong')).toHaveText('Note A');
 await link.click({ modifiers: ['ControlOrMeta'] });
 await expect(page.locator('.note-row.selected .note-card-title strong')).toHaveText('Note B');
 await expect(page.locator('.wysiwyg-content')).toContainText('Target body');
});

test('HTTP and HTTPS external images load under the actual page CSP', async ({ page }) => {
 const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N3IAAAAASUVORK5CYII=', 'base64');
 await page.route(/^https?:\/\/images\.example\.test\//, route => route.fulfill({ contentType: 'image/png', body: png }));
 await desktopFixture(page, '# Note A\n\n![http](http://images.example.test/pixel.png)\n\n![https](https://images.example.test/pixel.png)\n');
 const loadedImages = () => page.locator('.prose img[alt="http"], .prose img[alt="https"]').evaluateAll(images => images.length === 2 && images.every(image => (image as HTMLImageElement).naturalWidth === 1));
 await expect(page.locator('.wysiwyg-content .editor-image img')).toHaveCount(2);
 await expect.poll(loadedImages).toBe(true);
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await expect(page.locator('.prose img')).toHaveCount(2);
 await expect.poll(loadedImages).toBe(true);
});

test('overlapping saves wait for the latest edit without submitting duplicate writes', async ({ page }) => {
 await desktopFixture(page);
 await page.evaluate(() => {
  const save = window.fever!.save;
  let calls = 0;
  (window as any).saveCalls = () => calls;
  window.fever!.save = async (id, value) => {
   calls++;
   if (calls === 1) await new Promise<void>(resolve => {
    window.reviewControls.waiting = true;
    window.reviewControls.release = () => { window.reviewControls.waiting = false; resolve(); };
   });
   return save(id, value);
  };
 });
 const editor = page.locator('.wysiwyg-content');
 await editor.fill('First edit');
 await editor.press('ControlOrMeta+s');
 await expect.poll(() => page.evaluate(() => window.reviewControls.waiting)).toBe(true);
 await editor.fill('Latest edit');
 await editor.press('ControlOrMeta+s');
 expect(await page.evaluate(() => (window as any).saveCalls())).toBe(1);
 await page.evaluate(() => window.reviewControls.release());
 await expect.poll(() => page.evaluate(() => window.reviewControls.contents.a)).toContain('Latest edit');
 await expect(page.getByText('所有更改已保存')).toBeVisible();
 expect(await page.evaluate(() => (window as any).saveCalls())).toBe(2);
});

test('pull prevents editing the old document while remote files are being replaced', async ({ page }) => {
 await desktopFixture(page);
 await page.evaluate(() => {
  window.fever!.pull = async () => {
   await new Promise<void>(resolve => {
    window.reviewControls.waiting = true;
    window.reviewControls.release = resolve;
   });
   window.reviewControls.contents.a = '# Remote update\n\nNew remote content';
  };
 });
 await page.getByRole('button', { name: 'Git', exact: true }).click();
 await page.getByRole('button', { name: '拉取', exact: true }).click();
 await expect.poll(() => page.evaluate(() => window.reviewControls.waiting)).toBe(true);
 await page.locator('.wysiwyg-content').evaluate(el => (el as HTMLElement).focus());
 await page.keyboard.insertText('Stale edit during pull');
 await page.evaluate(() => window.reviewControls.release());
 await expect(page.locator('.wysiwyg-content')).toContainText('New remote content');
 await expect(page.locator('.app-shell')).not.toHaveAttribute('inert');
 await page.locator('.wysiwyg-content').press('ControlOrMeta+s');
 expect(await page.evaluate(() => window.reviewControls.contents.a)).toContain('New remote content');
});
