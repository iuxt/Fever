import { test, expect, type Locator, type Page } from '@playwright/test';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const list: string[] = []; errors.set(page, list); page.on('pageerror', error => list.push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

async function seed(page: Page, markdown: string, images: Record<string, string> = {}) {
 await page.addInitScript(({ content, images }) => {
  if (localStorage.getItem('fever-demo-v1')) return;
  const note = { id: 'editor-test', title: '编辑器测试', category: '测试', filename: 'editor-test.md', createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' };
  localStorage.setItem('fever-demo-v1', JSON.stringify({ manifest: { version: 1, notes: [note], categories: ['测试'] }, contents: { [note.id]: content }, versions: {}, images, dirty: [], settings: { autoCommit: false, interval: 10, author: '', email: '', remote: '' } }));
 }, { content: markdown, images });
 await page.goto('/');
 await page.locator('.folder-row').filter({ hasText: '测试' }).click();
 await page.locator('.note-row').filter({ hasText: '编辑器测试' }).click();
 await page.locator('.folder-row').filter({ hasText: '测试' }).click();
 await expect(page.getByTitle('阅读模式', { exact: true })).toHaveCount(0);
 await expect(page.getByRole('textbox', { name: '笔记正文' })).toBeVisible();
}
async function saved(page: Page) {
 return page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).contents['editor-test'] as string);
}
async function chooseLanguage(input: Locator, language: string) {
 await input.fill(language);
 await input.press('Enter');
}

for (const theme of ['light', 'dark']) {
 test(`scrolls source and preview independently with the mouse wheel (${theme})`, async ({ page }) => {
  await page.addInitScript(theme => localStorage.setItem('fever-theme', theme), theme);
  const markdown = Array.from({ length: 120 }, (_, i) => `第 ${i + 1} 段正文\n`).join('\n');
  await seed(page, markdown);
  await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
  const source = page.locator('.source-editor .cm-scroller');
  const preview = page.locator('.split .document');
  await expect(source).toBeVisible();
  const scrollTop = (element: Locator) => element.evaluate(node => node.scrollTop);
  async function wheel(element: Locator, delta: number) {
   const bounds = (await element.boundingBox())!;
   await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
   await page.mouse.wheel(0, delta);
  }
  await wheel(source, 500);
  await expect.poll(() => scrollTop(source)).toBeGreaterThan(0);
  expect(await scrollTop(preview)).toBe(0);
  await wheel(source, -500);
  await expect.poll(() => scrollTop(source)).toBe(0);
  await wheel(preview, 500);
  await expect.poll(() => scrollTop(preview)).toBeGreaterThan(0);
  expect(await scrollTop(source)).toBe(0);
  await page.setViewportSize({ width: 640, height: 800 });
  await wheel(source, 500);
  await expect.poll(() => scrollTop(source)).toBeGreaterThan(0);
  expect(await saved(page)).toBe(markdown);
 });
}

const terminalBlocks = [
 { name: 'code block', markdown: '```js\nconst value = 42;\n```\n', cursor: 'pre code' },
 { name: 'table', markdown: '| A | B |\n| --- | --- |\n| a1 | b1 |\n', cursor: 'td:last-child p' },
 { name: 'image', markdown: '![末尾图片](missing.png)\n', cursor: '.editor-image' },
 { name: 'wiki image', markdown: '![[missing.png|末尾图片]]\n', cursor: '.editor-image' },
 { name: 'horizontal rule', markdown: '---\n', cursor: 'hr' },
];

for (const block of terminalBlocks) {
 test(`creates a paragraph by clicking above an initial ${block.name}`, async ({ page }) => {
  await seed(page, block.markdown);
  const editor = page.getByRole('textbox', { name: '笔记正文' });
  const first = editor.locator(':scope > :first-child');
  const bounds = (await first.boundingBox())!;
  await page.mouse.click(bounds.x + 12, bounds.y - 10);
  await expect(editor.locator(':scope > p').first()).toBeEmpty();
  const count = await editor.locator(':scope > p').count();
  const paragraph = (await first.boundingBox())!;
  await page.mouse.click(paragraph.x + 12, paragraph.y - 8);
  await expect(editor.locator(':scope > p')).toHaveCount(count);
  await page.keyboard.insertText('块前的正文');
  await expect(editor.locator(':scope > p').first()).toHaveText('块前的正文');
  if (block.name === 'table') {
   await expect.poll(() => saved(page)).toMatch(/^块前的正文\n\n+\|/);
   await expect(editor.locator('td')).toHaveText(['a1', 'b1']);
  } else await expect.poll(() => saved(page)).toBe(`块前的正文\n\n${block.markdown}`);
  await page.reload();
  await expect(editor.locator(':scope > p').first()).toHaveText('块前的正文');
 });

 test(`creates a paragraph with ${block.name === 'code block' ? 'Mod+Enter' : 'Enter'} after a terminal ${block.name}`, async ({ page }) => {
  await seed(page, block.markdown);
  const editor = page.getByRole('textbox', { name: '笔记正文' });
  expect(await saved(page)).toBe(block.markdown);
  if (block.name === 'table') {
   // Focusing a table reveals its toolbar; let the layout settle before clicking the final cell.
   await editor.locator('td').last().click();
   await expect(page.getByRole('button', { name: '添加行', exact: true })).toBeVisible();
  }
  await editor.locator(block.cursor).last().click();
  await page.keyboard.press('End');
  if (block.name === 'code block') {
   // Put the caret at the actual end, independent of font size and native End-key geometry.
   await editor.locator(block.cursor).last().evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
   });
   await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
  await page.keyboard.press(block.name === 'code block' ? 'ControlOrMeta+Enter' : 'Enter');
  await page.keyboard.insertText('块后的正文');
  await expect(editor.locator(':scope > p').last()).toHaveText('块后的正文');
  await expect.poll(() => saved(page)).toContain('\n\n块后的正文');
  if (block.name === 'table') await expect(editor.locator('td')).toHaveText(['a1', 'b1']);
  else expect(await saved(page)).toContain(block.markdown.trimEnd());
  await page.reload();
  await expect(editor.locator(':scope > p').last()).toHaveText('块后的正文');
 });

 test(`creates a paragraph by clicking below a terminal ${block.name}`, async ({ page }) => {
  await seed(page, block.markdown);
  const editor = page.getByRole('textbox', { name: '笔记正文' });
  const last = editor.locator(':scope > :last-child');
  await last.scrollIntoViewIfNeeded();
  const bounds = await last.boundingBox();
  await page.mouse.click(bounds!.x + 12, bounds!.y + bounds!.height + 16);
  await expect(editor.locator(':scope > p').last()).toBeEmpty();
  const count = await editor.locator(':scope > p').count();
  const paragraph = await last.boundingBox();
  await page.mouse.click(paragraph!.x + 12, paragraph!.y + paragraph!.height + 8);
  await expect(editor.locator(':scope > p')).toHaveCount(count);
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('点击后的正文');
  await expect(editor.locator(':scope > p').last()).toHaveText('点击后的正文');
  await expect.poll(() => saved(page)).toContain('点击后的正文');
 });
}

test('creates an undoable paragraph with ArrowUp at the start of an initial code block', async ({ page }) => {
 const original = '```js\nconst value = 42;\n```\n';
 await seed(page, original);
 const editor = page.locator('.wysiwyg-content');
 const code = editor.locator('pre code');
 await code.click();
 await code.evaluate(element => {
  const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()!;
  const range = document.createRange(); range.setStart(text, 0); range.collapse(true);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
 });
 await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
 await page.keyboard.press('ArrowUp');
 await expect(editor.locator(':scope > p')).toHaveCount(1);
 await page.getByRole('button', { name: '撤销', exact: true }).click();
 await expect(editor.locator(':scope > p')).toHaveCount(0);
 await page.getByRole('button', { name: '重做', exact: true }).click();
 await expect(editor.locator(':scope > p')).toHaveCount(1);
 await page.keyboard.insertText('代码块前面的正文');
 await expect.poll(() => saved(page)).toBe(`代码块前面的正文\n\n${original}`);
 await expect(code).toHaveText('const value = 42;');
});

for (const line of [
 { name: 'first', index: 0 },
 { name: 'middle', index: 1 },
 { name: 'empty', index: 2 },
 { name: 'last', index: 3 },
]) {
 test(`selects only the ${line.name} code line on triple click`, async ({ page }) => {
  const lines = ['const first = 1;', '  const middle = "中文";', '', 'const last = 4;'];
  const original = `正文\n\n\`\`\`js\n${lines.join('\n')}\n\`\`\`\n\n尾段\n`;
  await seed(page, original);
  const code = page.locator('.editor-code-block pre code');
  const point = await code.evaluate((element, index) => {
   // Use the first glyph's geometry so highlighted spans and empty lines share the same coordinates.
   const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()!;
   const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 1);
   const rect = range.getBoundingClientRect();
   const lineHeight = parseFloat(getComputedStyle(element.parentElement!).lineHeight);
   return { x: rect.x + 4, y: rect.y + rect.height / 2 + index * lineHeight };
  }, line.index);
  await page.mouse.click(point.x, point.y, { clickCount: 3 });
  const selected = lines[line.index] + (line.index < lines.length - 1 ? '\n' : '');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  expect(await saved(page)).toBe(original);
  await page.keyboard.insertText('replacement');
  const start = lines.slice(0, line.index).reduce((offset, text) => offset + text.length + 1, 0);
  const text = lines.join('\n');
  const edited = text.slice(0, start) + 'replacement' + text.slice(start + selected.length);
  await expect(code).toHaveText(edited);
  await expect.poll(() => saved(page)).toContain(`\`\`\`js\n${edited}\n\`\`\``);
 });
}

for (const clickCount of [2, 3]) {
 test(`ignores ${clickCount} clicks in the blank space outside code blocks`, async ({ page }) => {
  const original = '前面的正文\n\n```js\nconst first = 1;\nconst last = 2;\n```\n\n后面的正文\n';
  await seed(page, original);
  const editor = page.locator('.wysiwyg-content');
  const block = page.locator('.editor-code-block');
  const bounds = (await block.boundingBox())!;
  const code = (await block.locator('pre code').boundingBox())!;
  for (const point of [
   { x: bounds.x - 4, y: code.y + 5 },
   { x: bounds.x + bounds.width + 4, y: code.y + 5 },
   { x: bounds.x + bounds.width / 2, y: bounds.y - 4 },
   { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height + 4 },
  ]) {
   await editor.locator(':scope > p').first().click();
   await page.mouse.click(point.x, point.y, { clickCount });
   expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('');
   expect(await saved(page)).toBe(original);
  }
 });
}

test('preserves double clicks inside code and triple clicks inside prose', async ({ page }) => {
 const original = 'before paragraph\n\n```js\nconst value = 42;\n```\n';
 await seed(page, original);
 await page.locator('.editor-code-block .hljs-number').dblclick();
 await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('42');
 await page.locator('.wysiwyg-content > p').first().click({ clickCount: 3 });
 await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('before paragraph');
 expect(await saved(page)).toBe(original);
});

for (const block of [
 { name: 'paragraph with inline formatting', markdown: 'first **bold** line  \nsecond line', selector: ':scope > p', text: 'first bold line', selected: 'first bold line\n' },
 { name: 'paragraph after a hard break', markdown: 'first **bold** line  \nsecond line', selector: ':scope > p', text: 'second line', selected: 'second line', clickText: 'second' },
 { name: 'paragraph after a soft break', markdown: 'first **bold** line\nsecond line', selector: ':scope > p', text: 'second line', selected: 'second line', clickText: 'second' },
 { name: 'heading', markdown: '## heading text', selector: 'h2', text: 'heading text', selected: 'heading text' },
 { name: 'bullet list', markdown: '- first item\n- second item', selector: 'li p', text: 'first item', selected: 'first item' },
 { name: 'nested ordered list', markdown: '1. outer\n   1. nested item\n   2. next item', selector: 'li p', text: 'nested item', selected: 'nested item' },
 { name: 'task list', markdown: '- [ ] task item\n- [x] next task', selector: 'li p', text: 'task item', selected: 'task item' },
 { name: 'blockquote', markdown: '> quote line  \n> second quote line', selector: 'blockquote p', text: 'quote line', selected: 'quote line\n' },
 { name: 'table cell', markdown: '| header | other |\n| --- | --- |\n| cell text | next cell |', selector: 'td p', text: 'cell text', selected: 'cell text' },
]) {
 test(`bounds repeated clicks to the current line in a ${block.name}`, async ({ page }) => {
  const original = `${block.markdown}\n\n\`\`\`js\nconst below = 42;\n\`\`\`\n`;
  await seed(page, original);
  const target = page.locator('.wysiwyg-content').locator(block.selector).filter({ hasText: block.text }).first();
  if (block.name === 'table cell') {
   await target.click();
   await expect(page.getByRole('button', { name: '添加行', exact: true })).toBeVisible();
  }
  const point = await target.evaluate((element, needle) => {
   const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
   let text = walker.nextNode()!;
   while (needle && !text.textContent!.includes(needle)) text = walker.nextNode()!;
   const offset = needle ? text.textContent!.indexOf(needle) + 1 : 1;
   const range = document.createRange(); range.setStart(text, offset); range.setEnd(text, offset + 1);
   const rect = range.getBoundingClientRect();
   return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, block.clickText);
  await page.mouse.move(point.x, point.y);
  for (let clickCount = 1; clickCount <= 6; clickCount++) {
   await page.mouse.down({ clickCount });
   await page.mouse.up({ clickCount });
   if (clickCount < 3) continue;
   await expect.poll(() => page.evaluate(() => window.getSelection()?.toString()), { message: `${block.name}, click ${clickCount}` }).toBe(block.selected);
   expect(await target.evaluate(element => {
    const selection = window.getSelection()!;
    return element.contains(selection.anchorNode) && element.contains(selection.focusNode);
   })).toBe(true);
  }
  expect(await saved(page)).toBe(original);
  await page.keyboard.insertText('replacement');
  await expect(page.locator('.editor-code-block pre code')).toHaveText('const below = 42;');
  await expect(page.locator('.wysiwyg-content').locator(block.selector).filter({ hasText: 'replacement' })).toHaveCount(1);
 });
}

test('keeps selection bounded across successive multi-click sequences', async ({ page }) => {
 await seed(page, 'before paragraph\n\n```js\nconst first = 1;\nconst last = 2;\n```\n\n```js\nconst below = 42;\n```\n');
 const paragraph = page.locator('.wysiwyg-content > p');
 for (const clickCount of [3, 4, 5, 6]) {
  await paragraph.click({ position: { x: 8, y: 8 }, clickCount });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString()), { message: `sequence ${clickCount}` }).toBe('before paragraph');
 }
 const pre = page.locator('.editor-code-block pre').first();
 const bounds = (await pre.boundingBox())!;
 for (const clickCount of [3, 4, 5, 6]) {
  await page.mouse.click(bounds.x + 30, bounds.y + bounds.height - 3, { clickCount });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('const last = 2;');
 }
});

for (const surface of [
 { name: 'quote padding', markdown: '> quoted text', selector: 'blockquote', x: 5, y: 5 },
 { name: 'list marker', markdown: '- list item', selector: 'li', x: 0, y: 10 },
 { name: 'table cell padding', markdown: '| header | other |\n| --- | --- |\n| cell text | next cell |', selector: 'td', x: 3, y: 3 },
 { name: 'horizontal rule', markdown: '---', selector: 'hr', x: 3, y: 0 },
]) {
 test(`does not extend multi-click selection from ${surface.name} into code`, async ({ page }) => {
  const original = `before paragraph\n\n${surface.markdown}\n\n\`\`\`js\nconst below = 42;\n\`\`\`\n`;
  await seed(page, original);
  await page.locator('.wysiwyg-content > p').first().click();
  const bounds = (await page.locator('.wysiwyg-content').locator(surface.selector).first().boundingBox())!;
  for (const clickCount of [2, 3, 4, 5, 6]) {
   await page.mouse.click(bounds.x + surface.x, bounds.y + surface.y, { clickCount });
   expect(await page.evaluate(() => window.getSelection()?.toString())).not.toContain('const below');
  }
  expect(await saved(page)).toBe(original);
 });
}

test('preserves triple-click selection in Markdown source and preview', async ({ page }) => {
 await seed(page, 'before paragraph\n\n```js\nconst below = 42;\n```\n');
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await page.locator('.split .document .prose > p').click({ clickCount: 3 });
 await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim())).toBe('before paragraph');
 await page.locator('.cm-content .cm-line').first().click({ clickCount: 3 });
 await page.keyboard.insertText('replacement\n');
 await expect.poll(() => saved(page)).toBe('replacement\n\n```js\nconst below = 42;\n```\n');
});

for (const area of ['text', 'left padding', 'right padding', 'bottom padding', 'header']) {
 test(`keeps repeated clicks in code ${area} out of neighboring blocks`, async ({ page }) => {
  const original = 'before paragraph\n\n```js\nconst first = 1;\nconst last = 2;\n```\n\n```js\nconst below = 42;\n```\n';
  await seed(page, original);
  const block = page.locator('.editor-code-block').first();
  const point = await block.evaluate((element, area) => {
   const pre = element.querySelector('pre')!, code = pre.querySelector('code')!;
   const text = document.createTreeWalker(code, NodeFilter.SHOW_TEXT).nextNode()!;
   const range = document.createRange(); range.setStart(text, 1); range.setEnd(text, 2);
   const glyph = range.getBoundingClientRect(), bounds = pre.getBoundingClientRect();
   const header = element.querySelector('.editor-code-label')!.getBoundingClientRect();
   return {
    x: area === 'left padding' ? bounds.left + 3 : area === 'right padding' || area === 'header' ? bounds.right - 3 : glyph.x + 2,
    y: area === 'bottom padding' ? bounds.bottom - 3 : area === 'header' ? header.y + header.height / 2 : glyph.y + glyph.height / 2,
   };
  }, area);
  await page.mouse.move(point.x, point.y);
  for (let clickCount = 1; clickCount <= 6; clickCount++) {
   await page.mouse.down({ clickCount });
   await page.mouse.up({ clickCount });
   if (clickCount < 3) continue;
   const selected = area === 'header' ? '' : area === 'bottom padding' ? 'const last = 2;' : 'const first = 1;\n';
   await expect.poll(() => page.evaluate(() => window.getSelection()?.toString()), { message: `${area}, click ${clickCount}` }).toBe(selected);
   if (area !== 'header') expect(await block.locator('code').evaluate(element => {
    const selection = window.getSelection()!;
    return element.contains(selection.anchorNode) && element.contains(selection.focusNode);
   })).toBe(true);
  }
  expect(await saved(page)).toBe(original);
 });
}

for (const terminal of [true, false]) {
 for (const empty of [true, false]) {
  test(`keeps repeated Enter inside a ${empty ? 'blank' : 'highlighted'} ${terminal ? 'terminal' : 'nonterminal'} code block without entities`, async ({ page }) => {
   const initial = empty ? '' : 'const value = 42;';
   const suffix = terminal ? '' : '\n\n后面的正文';
   await seed(page, `\`\`\`js\n${initial}\n\`\`\`${suffix}\n`);
   const code = page.locator('.editor-code-block pre code');
   await code.click();
   await code.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
   });
   await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
   for (let i = 0; i < 4; i++) await page.keyboard.press('Enter');
   await page.keyboard.insertText('const next = 7;');
   await page.keyboard.press('Shift+Enter');
   await page.keyboard.insertText('done');
   const text = `${initial}\n\n\n\nconst next = 7;\ndone`;
   await expect(code).toHaveText(text);
   const expected = `\`\`\`js\n${text}\n\`\`\`${suffix}\n`;
   await expect.poll(() => saved(page)).toBe(expected);
   await expect(page.locator('.wysiwyg-content > p')).toHaveCount(terminal ? 0 : 1);
   await page.reload();
   await expect(code).toHaveText(text);
   await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
   await expect(page.locator('.source-editor .cm-content')).not.toContainText('&nbsp;');
   expect(await saved(page)).toBe(expected);
  });
 }
}

test('keeps code newlines and composition while allowing Mod+Enter to leave the final block', async ({ page }) => {
 await seed(page, '```text\nfirst\nlast\n```\n');
 const code = page.locator('.editor-code-block pre code');
 await code.click({ position: { x: 3, y: 3 } });
 await page.keyboard.press('End');
 await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
 await page.keyboard.press('Enter');
 await expect(code).toHaveText('first\n\nlast');
 // Place the browser caret at the end, independent of native vertical-arrow geometry.
 await code.evaluate(element => {
  const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
 });
 await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
 await page.keyboard.press('Shift+Enter');
 await page.keyboard.insertText('more');
 await expect(code).toHaveText('first\n\nlast\nmore');
 await code.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
 await expect(page.locator('.wysiwyg-content > p')).toHaveCount(0);
 await page.keyboard.press('ControlOrMeta+Enter');
 await page.keyboard.insertText('正文');
 await expect(page.locator('.wysiwyg-content > p')).toHaveText('正文');
 await expect(code).toHaveText('first\n\nlast\nmore');
});

test('creates a paragraph after a selected terminal image and supports undo', async ({ page }) => {
 await seed(page, '![末尾图片](missing.png)\n');
 const editor = page.locator('.wysiwyg-content');
 await editor.locator('.editor-image').click();
 await expect(editor.locator('.editor-image')).toHaveClass(/selected/);
 await page.keyboard.press('Enter');
 await expect(editor.locator(':scope > p')).toHaveCount(2);
 await page.getByRole('button', { name: '撤销', exact: true }).click();
 await expect(editor.locator(':scope > p')).toHaveCount(1);
 await expect(editor.locator('.editor-image')).toBeVisible();
 await page.getByRole('button', { name: '重做', exact: true }).click();
 await expect(editor.locator(':scope > p')).toHaveCount(2);
});

test('keeps a clickable line below a code block taller than the editor viewport', async ({ page }) => {
 const markdown = `\`\`\`text\n${Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n')}\n\`\`\`\n`;
 await seed(page, markdown);
 const block = page.locator('.editor-code-block');
 await page.locator('.wysiwyg-content').evaluate(editor => editor.scrollIntoView({ block: 'end' }));
 const bounds = await block.boundingBox();
 await page.mouse.click(bounds!.x + 12, bounds!.y + bounds!.height + 16);
 await page.keyboard.insertText('长代码块后的正文');
 await expect(page.locator('.wysiwyg-content > p')).toHaveText('长代码块后的正文');
 await expect.poll(() => saved(page)).toContain(`${markdown.trimEnd()}\n\n长代码块后的正文`);
});

test('clicking the bottom of the document surface creates a line after a short block', async ({ page }) => {
 await seed(page, '```text\nshort\n```\n');
 const surface = await page.locator('.document-space').boundingBox();
 const editor = await page.locator('.wysiwyg-content').boundingBox();
 await page.mouse.click(editor!.x + 20, surface!.y + surface!.height - 20);
 await page.keyboard.insertText('底部新段落');
 await expect(page.locator('.wysiwyg-content > p')).toHaveText('底部新段落');
});

for (const theme of ['light', 'dark']) {
 test(`searches code languages with keyboard and mouse without saving search text (${theme})`, async ({ page }) => {
  await page.addInitScript(theme => localStorage.setItem('fever-theme', theme), theme);
  const original = '# 搜索语言\n\n```js\nconst value = 42;\n```\n\n```python\nprint("second")\n```\n';
  await seed(page, original);
  const input = page.getByRole('combobox', { name: '代码块语言' }).first();
  const list = page.getByRole('listbox', { name: '代码块语言选项' });
  await input.fill('TyPe');
  await expect(list.getByRole('option')).toHaveText(['typescript']);
  expect(await saved(page)).toBe(original);
  await input.press('Enter');
  await expect(input).toHaveValue('typescript');
  await expect(list).toHaveCount(0);
  await expect.poll(() => saved(page)).toContain('```typescript\nconst value = 42;');

  await input.fill('ja');
  await expect(list.getByRole('option')).toHaveText(['java', 'javascript']);
  await input.press('ArrowDown');
  await expect(list.getByRole('option', { name: 'javascript', exact: true })).toHaveAttribute('aria-selected', 'true');
  await input.press('ArrowUp');
  await expect(list.getByRole('option', { name: 'java', exact: true })).toHaveAttribute('aria-selected', 'true');
  await input.press('ArrowDown'); await input.press('Enter');
  await expect(input).toHaveValue('javascript');
  await expect(page.locator('.editor-code-block').first().locator('.hljs-keyword')).toHaveText('const');

  await input.fill('py');
  await list.getByRole('option', { name: 'python', exact: true }).click();
  await expect(input).toHaveValue('python');
  await expect.poll(() => saved(page)).toContain('```python\nconst value = 42;');
  await expect(page.getByRole('combobox', { name: '代码块语言' }).last()).toHaveValue('python');
  await expect(page.locator('.editor-code-block').last().locator('pre code')).toHaveText('print("second")');

  await input.fill('纯文本');
  await expect(list.getByRole('option')).toHaveText(['纯文本 · plaintext']);
  await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(list).toBeVisible();
  await input.press('Enter');
  await expect(input).toHaveValue('plaintext');
  await expect(page.locator('.editor-code-block').first().locator('[class*="hljs-"]')).toHaveCount(0);
  await expect(page.getByText('所有更改已保存')).toBeVisible();
  const committed = await saved(page);

  await input.fill('no-such-language');
  await expect(list.getByRole('option')).toHaveCount(0);
  await expect(list.getByRole('status')).toHaveText('没有匹配的语言');
  await input.press('Enter');
  expect(await saved(page)).toBe(committed);
  await input.press('Escape');
  await expect(input).toHaveValue('plaintext');
  await expect(list).toHaveCount(0);
  await input.fill('rust'); await input.press('Tab');
  await expect(input).toHaveValue('plaintext');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('combobox', { name: '代码块语言' }).last()).toBeFocused();
  expect(await saved(page)).toBe(committed);
  await page.locator('.wysiwyg-content h1').click();
  await expect(list).toHaveCount(0);

  await chooseLanguage(input, '');
  await expect(input).toHaveValue('');
  await expect.poll(() => saved(page)).toContain('```\nconst value = 42;');
  await page.setViewportSize({ width: 780, height: 800 });
  await input.fill('script');
  await expect(list.getByRole('option')).toHaveText(['javascript', 'typescript']);
  const bounds = (await list.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(780);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(800);
  await page.screenshot({ path: `test-results/code-language-search-${theme}.png`, fullPage: true });
  await page.locator('.wysiwyg-content h1').click();
  await expect(list).toHaveCount(0);
  await expect(input).toHaveValue('');
 });

 test(`code languages persist and highlighting updates in rich editing and previews (${theme})`, async ({ page }) => {
  await page.addInitScript(theme => localStorage.setItem('fever-theme', theme), theme);
  const code = 'const message = "hello <world>";\n// comment\nconsole.log(message, 42);';
  const original = `# 高亮测试\n\n正文\n\n\`\`\`js\n${code}\n\`\`\`\n`;
  await seed(page, original);
  const block = page.locator('.editor-code-block');
  const language = block.getByRole('combobox', { name: '代码块语言' });
  const richCode = block.locator('pre code');
  await expect(language).toHaveValue('js');
  await expect(richCode).toHaveText(code);
  await expect(richCode.locator('.hljs-keyword')).toHaveText('const');
  await expect(richCode.locator('.hljs-string')).toHaveText('"hello <world>"');
  await expect(richCode.locator('.hljs-comment')).toHaveText('// comment');
  const colors = await richCode.evaluate(element => [element, element.querySelector('.hljs-keyword')!, element.querySelector('.hljs-string')!].map(token => getComputedStyle(token).color));
  expect(new Set(colors).size).toBe(3);
  expect(await saved(page)).toBe(original);
  await page.screenshot({ path: `test-results/code-highlight-${theme}.png`, fullPage: true });

  // Changing a block's language must refresh it even if the cursor is in prose.
  await page.locator('.wysiwyg-content > p').click();
  await chooseLanguage(language, 'plaintext');
  await expect(richCode.locator('[class*="hljs-"]')).toHaveCount(0);
  await expect(richCode).toHaveText(code);
  await expect.poll(() => saved(page)).toContain(`\`\`\`plaintext\n${code}\n\`\`\``);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(language).toHaveValue('js');
  await expect(richCode.locator('.hljs-keyword')).toHaveText('const');

  await chooseLanguage(language, 'typescript');
  await richCode.locator('.hljs-number').click(); await page.keyboard.press('End'); await page.keyboard.insertText(' // edited');
  await expect(richCode.locator('.hljs-comment')).toContainText(['// comment', '// edited']);
  await expect.poll(() => saved(page)).toContain('```typescript\n');
  await expect.poll(() => saved(page)).toContain('// edited');
  const edited = await richCode.textContent();

  await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
  const previewCode = page.locator('.prose pre code');
  await expect(previewCode).toHaveClass('language-typescript');
  expect((await previewCode.textContent())?.trimEnd()).toBe(edited?.trimEnd());
  await expect(previewCode.locator('.hljs-keyword')).toHaveText('const');
  expect(await previewCode.evaluate(element => [element, element.querySelector('.hljs-keyword')!, element.querySelector('.hljs-string')!].map(token => getComputedStyle(token).color))).toEqual(colors);
  await page.locator('.cm-content').fill('```python\nprint("preview update", 7)\n```\n');
  await expect(previewCode).toHaveClass('language-python');
  await expect(previewCode.locator('.hljs-string')).toHaveText('"preview update"');
  await expect(previewCode.locator('.hljs-number')).toHaveText('7');
  await expect(page.getByText('所有更改已保存')).toBeVisible();
  await page.getByTitle('编辑模式 · ⌘ E', { exact: true }).click();
  await expect(language).toHaveValue('python');
  await expect(richCode.locator('.hljs-string')).toHaveText('"preview update"');
  await page.reload();
  await expect(page.getByRole('combobox', { name: '代码块语言' })).toHaveValue('python');
  await expect(page.locator('.editor-code-block .hljs-number')).toHaveText('7');
 });
}

test('configures each code block independently and preserves aliases and unknown languages', async ({ page }) => {
 await seed(page, '# 语言测试\n\n```custom-language\n<literal>& **text**\n```\n\n```text\nconst value = 42;\n```\n\n```\nconst automatic = "hello";\n```\n\n尾段\n');
 const languages = page.getByRole('combobox', { name: '代码块语言' });
 await expect(languages).toHaveCount(3);
 await expect(languages.nth(0)).toHaveValue('custom-language');
 await expect(languages.nth(1)).toHaveValue('text');
 await expect(languages.nth(2)).toHaveValue('');
 await expect(page.locator('.editor-code-block').nth(1).locator('[class*="hljs-"]')).toHaveCount(0);
 await chooseLanguage(languages.nth(1), 'js');
 await expect(page.locator('.editor-code-block').nth(1).locator('.hljs-keyword')).toHaveText('const');
 await expect(languages.nth(0)).toHaveValue('custom-language');
 await expect.poll(() => saved(page)).toContain('```custom-language\n<literal>& **text**\n```');
 await expect.poll(() => saved(page)).toContain('```js\nconst value = 42;\n```');
 await page.locator('.wysiwyg-content > p').last().click();
 await expect(page.getByRole('button', { name: '代码块', exact: true })).toHaveAttribute('aria-pressed', 'false');
 await page.keyboard.press('End'); await page.keyboard.press('Enter');
 await page.getByRole('button', { name: '代码块', exact: true }).click();
 await expect(languages).toHaveCount(4);
 await chooseLanguage(languages.last(), 'json');
 await page.locator('.editor-code-block').last().locator('pre code').click();
 await page.keyboard.insertText('{"created": true}');
 await expect.poll(() => saved(page)).toContain('```json\n{"created": true}\n```');
 await expect(page.locator('.editor-code-block').last().locator('.hljs-attr')).toHaveText('"created"');
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await expect(page.locator('code.language-custom-language')).toHaveText('<literal>& **text**\n');
 await expect(page.locator('code.language-json .hljs-attr')).toHaveText('"created"');
});

test('renders Markdown in place, preserves an untouched file, formats and switches source modes', async ({ page }) => {
 const original = '# 标题\n\n正文\n\n- 列表项\n';
 await seed(page, original);
 await expect(page.locator('.wysiwyg-content h1')).toHaveText('标题');
 await expect(page.locator('.wysiwyg-content li')).toHaveText('列表项');
 await expect(page.locator('.cm-content')).toHaveCount(0);
 expect(await saved(page)).toBe(original);
 await page.keyboard.press('Control+e');
 await expect(page.locator('.cm-content')).toContainText('# 标题');
 await page.keyboard.press('Control+e');
 await expect(page.getByRole('textbox', { name: '笔记正文' })).toBeVisible();
 expect(await saved(page)).toBe(original);
 // Select prose through the browser selection, as a user would with the mouse.
 await page.locator('.wysiwyg-content > p').first().evaluate(p => {
  const range = document.createRange(); range.selectNodeContents(p);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
 });
 await page.getByRole('button', { name: '加粗 · ⌘ B', exact: true }).click();
 await expect(page.locator('.wysiwyg-content strong')).toHaveText('正文');
 await expect.poll(() => saved(page)).toContain('**正文**');
 await page.getByRole('button', { name: '撤销', exact: true }).click();
 await expect(page.locator('.wysiwyg-content strong')).toHaveCount(0);
 await page.getByRole('button', { name: '重做', exact: true }).click();
 await expect(page.locator('.wysiwyg-content strong')).toHaveText('正文');
 await page.getByTitle('Markdown 源码与预览').click();
 await expect(page.locator('.cm-content')).toContainText('**正文**');
 await page.locator('.cm-content').fill('# 源码修改\n\n新的正文');
 await page.getByTitle('编辑模式 · ⌘ E').click();
 await expect(page.locator('.wysiwyg-content h1')).toHaveText('源码修改');
 await expect(page.locator('.wysiwyg-content p')).toHaveText('新的正文');
 await expect.poll(() => saved(page)).toContain('新的正文');
 await page.reload();
 await expect(page.locator('.wysiwyg-content h1')).toHaveText('源码修改');
});

test('Markdown input shortcuts and Chinese composition produce formatted, saved text', async ({ page }) => {
 await seed(page, '');
 const editor = page.getByRole('textbox', { name: '笔记正文' });
 await editor.click();
 await page.keyboard.type('## ');
 await page.keyboard.insertText('即时标题');
 await expect(editor.locator('h2')).toHaveText('即时标题');
 await page.keyboard.press('Enter');
 await page.keyboard.type('- ');
 await page.keyboard.insertText('列表正文');
 await expect(editor.locator('li')).toContainText('列表正文');
 await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
 const session = await page.context().newCDPSession(page);
 await session.send('Input.imeSetComposition', { text: '中文输入', selectionStart: 4, selectionEnd: 4 });
 await session.send('Input.insertText', { text: '中文输入' });
 await expect(editor.locator('p').last()).toHaveText('中文输入');
 await expect.poll(() => saved(page)).toContain('中文输入');
 await page.getByTitle('Markdown 源码与预览').click();
 await expect(page.locator('.cm-content')).toContainText('## 即时标题');
 await expect(page.locator('.cm-content')).toContainText('- 列表正文');
});

test('edits table cells, adds rows and columns, and saves checked tasks as Markdown', async ({ page }) => {
 await seed(page, '# 表格与任务\n\n| 名称 | 状态 |\n| :--- | ---: |\n| Fever | 草稿 |\n\n- [ ] 写笔记\n');
 const editor = page.getByRole('textbox', { name: '笔记正文' });
 await expect(editor.locator('table')).toBeVisible();
 await editor.locator('td').first().click();
 await page.keyboard.press('End'); await page.keyboard.insertText(' Notes');
 await page.getByRole('button', { name: '添加行', exact: true }).click();
 await expect(editor.locator('tr')).toHaveCount(3);
 await page.getByRole('button', { name: '添加列', exact: true }).click();
 await expect(editor.locator('tr').first().locator('th')).toHaveCount(3);
 await editor.getByRole('checkbox').check();
 await expect.poll(() => saved(page)).toContain('- [x] 写笔记');
 await expect.poll(() => saved(page)).toContain('Fever Notes');
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await expect(page.locator('.prose tr')).toHaveCount(3);
 await page.getByTitle('编辑模式 · ⌘ E').click();
 await expect(editor.getByRole('checkbox')).toBeChecked();
});

test('selects and drags entire table rows and columns, with undo and Markdown persistence', async ({ page }) => {
 await seed(page, '# 拖动表格\n\n| 名称 | 状态 | 数量 |\n| :--- | :---: | ---: |\n| 苹果 | 草稿 | 10 |\n| 香蕉 | 完成 | 20 |\n| 桃子 | 归档 | 30 |\n');
 const table = page.locator('.interactive-table');
 const rows = table.locator('tr');
 await table.getByRole('button', { name: '选中第 2 行', exact: true }).click();
 await expect(rows.nth(1).locator('.selectedCell')).toHaveCount(3);
 expect(await rows.nth(1).locator('td').first().evaluate(cell => getComputedStyle(cell).cursor)).toBe('grab');
 const handle = await table.getByRole('button', { name: '选中第 2 行', exact: true }).boundingBox();
 const last = await rows.last().boundingBox();
 await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
 await page.mouse.down();
 await page.mouse.move(last!.x + 80, last!.y + last!.height, { steps: 8 });
 await expect(table.locator('.table-drop-marker.horizontal')).toBeVisible();
 await page.mouse.up();
 await expect(rows.nth(1)).toContainText('香蕉');
 await expect(rows.last()).toContainText('苹果');
 await expect(rows.last().locator('.selectedCell')).toHaveCount(3);
 await page.getByRole('button', { name: '撤销', exact: true }).click();
 await expect(rows.nth(1)).toContainText('苹果');
 await page.getByRole('button', { name: '重做', exact: true }).click();
 await expect(rows.last()).toContainText('苹果');

 await table.getByRole('button', { name: '选中第 1 列', exact: true }).click();
 await expect(table.locator('.selectedCell')).toHaveCount(4);
 const cell = await rows.nth(1).locator('td').first().boundingBox();
 const end = await rows.nth(1).locator('td').last().boundingBox();
 // A selected cell itself is also a drag surface.
 await page.mouse.move(cell!.x + 30, cell!.y + 15);
 await page.mouse.down();
 await page.mouse.move(end!.x + end!.width, end!.y + 15, { steps: 8 });
 await expect(table.locator('.table-drop-marker.vertical')).toBeVisible();
 await page.mouse.up();
 await expect(rows.first().locator('th')).toHaveText(['状态', '数量', '名称']);
 await expect(rows.nth(1).locator('td')).toHaveText(['完成', '20', '香蕉']);
 await expect(rows.last().locator('td')).toHaveText(['草稿', '10', '苹果']);
 await expect.poll(() => saved(page)).toMatch(/\| 状态\s*\| 数量\s*\| 名称\s*\|/);
 const markdown = await saved(page);
 expect(markdown).toMatch(/\| :---:\s*\| ---:\s*\| :---\s*\|/);
 await page.screenshot({ path: 'test-results/table-interactions.png', fullPage: true });
 await page.reload();
 await expect(rows.first().locator('th')).toHaveText(['状态', '数量', '名称']);
 await expect(rows.last().locator('td')).toHaveText(['草稿', '10', '苹果']);
});

test('inserts a row or column at hovered boundaries without changing neighboring cells', async ({ page }) => {
 await seed(page, '# 插入表格\n\n| A | B |\n| --- | --- |\n| a1 | b1 |\n| a2 | b2 |\n\n尾段\n');
 const table = page.locator('.interactive-table');
 const rows = table.locator('tr');
 let cell = await rows.nth(1).locator('td').first().boundingBox();
 const header = await rows.first().boundingBox();
 await page.mouse.move(cell!.x + cell!.width, header!.y - 4);
 await table.getByRole('button', { name: '在第 2 列前插入列' }).click();
 await expect(rows.first().locator('th')).toHaveText(['A', '', 'B']);
 await expect(rows.nth(1).locator('td')).toHaveText(['a1', '', 'b1']);
 cell = await rows.nth(1).locator('td').first().boundingBox();
 const bounds = await table.locator('table').boundingBox();
 await page.mouse.move(bounds!.x + bounds!.width + 4, cell!.y + cell!.height);
 await table.getByRole('button', { name: '在第 3 行前插入行' }).click();
 await expect(rows).toHaveCount(4);
 await expect(rows.nth(2).locator('td')).toHaveText(['', '', '']);
 await expect(rows.last().locator('td')).toHaveText(['a2', '', 'b2']);
 await page.getByRole('button', { name: '撤销', exact: true }).click();
 await expect(rows).toHaveCount(3);
 await page.getByRole('button', { name: '撤销', exact: true }).click();
 await expect(rows.first().locator('th')).toHaveText(['A', 'B']);

 const last = await rows.last().locator('td').last().boundingBox();
 await page.mouse.move(last!.x + last!.width + 4, last!.y + last!.height);
 await table.getByRole('button', { name: '在第 4 行前插入行' }).click();
 await expect(rows).toHaveCount(4);
 await expect(rows.last().locator('td')).toHaveText(['', '']);
 await expect.poll(() => saved(page)).toContain('a2');
 await page.reload();
 await expect(rows).toHaveCount(4);
 await expect(page.locator('.wysiwyg-content > p').last()).toHaveText('尾段');
});

test('cancels a table drag with Escape and does not move content on selection alone', async ({ page }) => {
 const original = '| A | B |\n| --- | --- |\n| a1 | b1 |\n| a2 | b2 |\n';
 await seed(page, original);
 const table = page.locator('.interactive-table');
 await table.getByRole('button', { name: '选中第 2 行', exact: true }).click();
 expect(await saved(page)).toBe(original);
 const handle = await table.getByRole('button', { name: '选中第 2 行', exact: true }).boundingBox();
 const last = await table.locator('tr').last().boundingBox();
 await page.mouse.move(handle!.x + 8, handle!.y + 14);
 await page.mouse.down();
 await page.mouse.move(last!.x + 40, last!.y + last!.height, { steps: 5 });
 await page.keyboard.press('Escape');
 await page.mouse.up();
 await expect(table.locator('.table-drop-marker')).toBeHidden();
 expect(await saved(page)).toBe(original);
 await expect(table.locator('tr').nth(1)).toContainText('a1');
});

test('shows only hovered row and column handles and keeps insertion buttons on the perimeter', async ({ page }) => {
 await seed(page, '# 悬停表格\n\n| A | B | C |\n| --- | --- | --- |\n| a1 | b1 | c1 |\n| a2 | b2 | c2 |\n');
 const table = page.locator('.interactive-table');
 const handles = table.locator('.table-handle');
 const visibleHandles = () => handles.evaluateAll(elements => elements.filter(element => getComputedStyle(element).opacity === '1').map(element => element.getAttribute('aria-label')));
 const body = await table.locator('tr').nth(1).locator('td').nth(1).boundingBox();
 await page.mouse.move(body!.x + body!.width / 2, body!.y + body!.height / 2);
 await expect.poll(visibleHandles).toEqual(['选中第 2 列', '选中第 2 行']);
 await expect(table.locator('.table-insert')).toBeHidden();
 // Interior dividers no longer show a plus.
 await page.mouse.move(body!.x + body!.width, body!.y + body!.height / 2);
 await expect(table.locator('.table-insert')).toBeHidden();
 await page.mouse.move(body!.x + body!.width / 2, body!.y + body!.height);
 await expect(table.locator('.table-insert')).toBeHidden();
 const bounds = await table.locator('table').boundingBox();
 await page.mouse.move(body!.x, bounds!.y - 5);
 const plus = table.getByRole('button', { name: '在第 2 列前插入列' });
 await expect(plus).toBeVisible();
 let position = await plus.boundingBox();
 expect(Math.abs(position!.y + position!.height / 2 - bounds!.y)).toBeLessThan(1);
 await page.screenshot({ path: 'test-results/table-perimeter-hover.png', fullPage: true });
 await page.mouse.move(bounds!.x + bounds!.width + 5, body!.y + body!.height);
 const rowPlus = table.getByRole('button', { name: '在第 3 行前插入行' });
 await expect(rowPlus).toBeVisible();
 position = await rowPlus.boundingBox();
 expect(Math.abs(position!.x + position!.width / 2 - bounds!.x - bounds!.width)).toBeLessThan(1);
 await table.getByRole('button', { name: '选中第 2 行', exact: true }).click();
 await page.mouse.move(300, 600);
 await expect.poll(visibleHandles).toEqual([]);
 await expect(table.locator('.table-insert')).toBeHidden();
});

const resizeImageUrl = 'https://example.com/resize.png';
async function resizeFixture(page: Page, markdown: string) {
 const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#95aa7c"/></svg>';
 const data = `data:image/svg+xml,${encodeURIComponent(svg)}`;
 await seed(page, markdown, { [resizeImageUrl]: data, [`${resizeImageUrl}?edited=1`]: data });
 await expect.poll(() => page.locator('.editor-image img').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(400);
}
async function dragImage(page: Page, dx: number, dy = 0) {
 const image = page.locator('.editor-image').first();
 await image.hover();
 const bounds = (await image.getByRole('button', { name: '拖动调整图片大小' }).boundingBox())!;
 await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
 await page.mouse.down();
 await page.mouse.move(bounds.x + bounds.width / 2 + dx, bounds.y + bounds.height / 2 + dy, { steps: 6 });
 await page.mouse.up();
}

test('resizes images proportionally, saves Markdown width, and supports undo and reload', async ({ page }) => {
 const original = `正文\n\n![图片名字](${resizeImageUrl} "图片标题")\n`;
 await resizeFixture(page, original);
 const image = page.locator('.editor-image img');
 await dragImage(page, -120);
 await expect.poll(() => saved(page)).toContain(`![图片名字|280](${resizeImageUrl} "图片标题")`);
 expect((await image.boundingBox())!.width).toBe(280);
 expect((await image.boundingBox())!.height).toBe(140);
 await page.getByRole('button', { name: '撤销', exact: true }).click();
 await expect.poll(() => saved(page)).toBe(original);
 expect((await image.boundingBox())!.width).toBe(400);
 await page.getByRole('button', { name: '重做', exact: true }).click();
 await expect.poll(() => saved(page)).toContain('![图片名字|280]');
 await page.reload();
 await expect(image).toHaveAttribute('alt', '图片名字');
 expect((await image.boundingBox())!.width).toBe(280);
 await dragImage(page, 0, 20);
 await expect.poll(() => saved(page)).toContain('![图片名字|320]');
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 const preview = page.locator('.split .document img');
 await expect(preview).toHaveAttribute('alt', '图片名字');
 await expect(preview).toHaveAttribute('title', '图片标题');
 expect((await preview.boundingBox())!.width).toBe(320);
 expect((await preview.boundingBox())!.height).toBe(160);
});

test('reads width metadata without changing the note and keeps oversized images within the editor', async ({ page }) => {
 const original = `![图片|561](${resizeImageUrl})\n\n![名字|非尺寸](${resizeImageUrl})\n`;
 await resizeFixture(page, original);
 const image = page.locator('.editor-image img').first();
 await expect(image).toHaveAttribute('alt', '图片');
 expect((await image.boundingBox())!.width).toBe(561);
 await expect(page.locator('.editor-image img').last()).toHaveAttribute('alt', '名字|非尺寸');
 expect(await saved(page)).toBe(original);
 await page.setViewportSize({ width: 780, height: 800 });
 const editor = page.locator('.wysiwyg-content');
 const size = (await image.boundingBox())!;
 expect(size.width).toBeLessThan(561);
 expect(size.x + size.width).toBeLessThanOrEqual((await editor.boundingBox())!.x + (await editor.boundingBox())!.width);
 expect(await saved(page)).toBe(original);
 await dragImage(page, -1000);
 await expect.poll(() => saved(page)).toContain('![图片|32]');
 await dragImage(page, 2000);
 const resized = (await image.boundingBox())!;
 expect(resized.x + resized.width).toBeLessThanOrEqual((await editor.boundingBox())!.x + (await editor.boundingBox())!.width);
});

test('canceling a resize leaves Markdown unchanged and wiki image widths survive reload', async ({ page }) => {
 const original = `![[${resizeImageUrl}|别名|240]]\n`;
 await resizeFixture(page, original);
 const image = page.locator('.editor-image');
 await image.hover();
 const handle = image.getByRole('button', { name: '拖动调整图片大小' });
 const bounds = (await handle.boundingBox())!;
 await page.mouse.move(bounds.x + 6, bounds.y + 6); await page.mouse.down();
 await page.mouse.move(bounds.x + 66, bounds.y + 6);
 await handle.dispatchEvent('pointercancel', { pointerId: 1 });
 await page.mouse.up();
 expect(await saved(page)).toBe(original);
 expect((await image.locator('img').boundingBox())!.width).toBe(240);
 await dragImage(page, 80);
 await expect.poll(() => saved(page)).toBe(`![[${resizeImageUrl}|别名|320]]\n`);
 await page.reload();
 await expect(image.locator('img')).toHaveAttribute('alt', '别名');
 expect((await image.locator('img').boundingBox())!.width).toBe(320);
});

test('edits image Markdown from the selected top-right code icon and commits on outside click', async ({ page }) => {
 const original = `图片前的正文\n\n![图片名字|240](${resizeImageUrl} "原标题")\n\n图片后的正文\n`;
 await resizeFixture(page, original);
 const image = page.locator('.editor-image img');
 const toggle = page.getByRole('button', { name: '编辑图片 Markdown', exact: true });
 const source = page.getByRole('textbox', { name: '图片 Markdown', exact: true });
 await expect(toggle).toHaveCount(0);
 await image.click();
 await expect(toggle).toBeVisible();
 const bounds = (await image.boundingBox())!, icon = (await toggle.boundingBox())!;
 expect(icon.x).toBeGreaterThan(bounds.x + bounds.width / 2);
 expect(icon.y).toBeLessThan(bounds.y + bounds.height / 2);
 await page.screenshot({ path: test.info().outputPath('image-code-icon.png') });
 await toggle.click();
 await expect(source).toBeFocused();
 await expect(source).toHaveValue(`![图片名字|240](${resizeImageUrl} "原标题")`);
 await page.screenshot({ path: test.info().outputPath('image-markdown-source.png') });
 await expect(image).toHaveCount(0);
 await expect(page.getByRole('button', { name: '拖动调整图片大小' })).toHaveCount(0);
 const modified = `![修改后的图片|320](${resizeImageUrl}?edited=1 "新标题")`;
 await source.fill(modified);
 expect(await saved(page)).toBe(original);
 await page.locator('.wysiwyg-content > p').first().click();
 await expect(source).toHaveCount(0);
 await expect(image).toHaveAttribute('alt', '修改后的图片');
 await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(400);
 expect((await image.boundingBox())!.width).toBe(320);
 await expect.poll(() => saved(page)).toBe(`图片前的正文\n\n${modified}\n\n图片后的正文\n`);
 await expect(toggle).toHaveCount(0);
 await page.getByRole('button', { name: '撤销', exact: true }).click();
 await expect.poll(() => saved(page)).toBe(original);
 await page.getByRole('button', { name: '重做', exact: true }).click();
 await expect.poll(() => saved(page)).toContain(modified);
 await page.reload();
 await expect(image).toHaveAttribute('alt', '修改后的图片');
 await image.click(); await toggle.click();
 await expect(source).toHaveValue(modified);
 await page.getByRole('button', { name: '新建笔记', exact: true }).first().click();
 await expect(source).toHaveCount(0);
 await expect(image).toBeVisible();
});

test('opening image source is clean, Escape cancels changes, and typing stays in the source field', async ({ page }) => {
 const original = `![图片|240](${resizeImageUrl})\n`;
 await resizeFixture(page, original);
 const image = page.locator('.editor-image img');
 const toggle = page.getByRole('button', { name: '编辑图片 Markdown', exact: true });
 const source = page.getByRole('textbox', { name: '图片 Markdown', exact: true });
 await image.click(); await toggle.click();
 await page.locator('.breadcrumbs').click();
 await expect(source).toHaveCount(0);
 expect(await saved(page)).toBe(original);
 await image.click(); await toggle.click();
 await source.fill(`![取消的修改|100](${resizeImageUrl})`);
 await source.press('Escape');
 await expect(source).toHaveCount(0);
 await expect(image).toHaveAttribute('alt', '图片');
 expect(await saved(page)).toBe(original);
 await image.click(); await toggle.click();
 await source.press('ControlOrMeta+A');
 await source.press('Backspace');
 await expect(source).toHaveValue('');
 await page.keyboard.insertText(`![键盘修改|200](${resizeImageUrl})`);
 await source.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
 await expect(source).toBeVisible();
 await source.press('Enter');
 await expect(source).toHaveCount(0);
 await expect(image).toHaveAttribute('alt', '键盘修改');
 await expect.poll(() => saved(page)).toBe(`![键盘修改|200](${resizeImageUrl})\n`);
 await expect(page.locator('.wysiwyg-content > p')).toHaveCount(1);
 await dragImage(page, 40);
 await expect.poll(() => saved(page)).toContain('![键盘修改|240]');
});

test('invalid image Markdown restores the original image and wiki source remains editable', async ({ page }) => {
 const original = `正文\n\n![[${resizeImageUrl}|别名|240]]\n`;
 await resizeFixture(page, original);
 const image = page.locator('.editor-image img');
 const toggle = page.getByRole('button', { name: '编辑图片 Markdown', exact: true });
 const source = page.getByRole('textbox', { name: '图片 Markdown', exact: true });
 await image.click(); await toggle.click();
 await expect(source).toHaveValue(`![[${resizeImageUrl}|别名|240]]`);
 await source.fill('![尚未完成的图片](');
 await page.locator('.wysiwyg-content > p').first().click();
 await expect(source).toHaveCount(0);
 await expect(image).toHaveAttribute('alt', '别名');
 await expect(page.getByText('图片 Markdown 格式无效，已保留原图片')).toBeVisible();
 expect(await saved(page)).toBe(original);
 await image.click(); await toggle.click();
 await source.fill(`![改为普通图片|300](${resizeImageUrl})`);
 await source.press('Tab');
 await expect(source).toHaveCount(0);
 await expect(image).toHaveAttribute('alt', '改为普通图片');
 await expect.poll(() => saved(page)).toBe(`正文\n\n![改为普通图片|300](${resizeImageUrl})\n`);
 await image.click(); await toggle.click();
 await expect(source).toHaveValue(`![改为普通图片|300](${resizeImageUrl})`);
});

test('inserts local images at the cursor and can undo the insertion', async ({ page }) => {
 await seed(page, '# 图片测试\n\n插入位置\n\n尾段\n');
 const editor = page.getByRole('textbox', { name: '笔记正文' });
 await editor.locator('p').first().click(); await page.keyboard.press('End');
 await page.locator('input[type=file]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N3IAAAAASUVORK5CYII=', 'base64') });
 await expect(editor.getByRole('img', { name: 'pixel.png', exact: true })).toBeVisible();
 expect(await editor.getByRole('img', { name: 'pixel.png', exact: true }).evaluate(img => img.naturalWidth)).toBe(1);
 await expect.poll(() => saved(page)).toMatch(/!\[pixel.png\]\(\.\.\/images\/editor-test\/\d{4}-\d{2}-\d{2}-\d{6}-\d{3}\.png\)/);
 const value = await saved(page);
 expect(value.indexOf('![pixel.png]')).toBeLessThan(value.indexOf('尾段'));
 await page.getByRole('button', { name: '撤销', exact: true }).click();
 await expect(editor.getByRole('img', { name: 'pixel.png', exact: true })).toHaveCount(0);
 await page.getByRole('button', { name: '重做', exact: true }).click();
 await expect(editor.getByRole('img', { name: 'pixel.png', exact: true })).toBeVisible();
});

test('preserves YAML and wiki embeds while treating code contents literally', async ({ page }) => {
 await page.addInitScript(() => localStorage.setItem('fever-theme', 'dark'));
 const original = '---\ntags: [想法]\naliases: [测试]\n---\n\n# 兼容笔记\n\n正文\n\n![[missing.png|图片]]\n\n`![[literal.png]]`\n\n```text\n![[literal.png]]\n```\n';
 await seed(page, original);
 await expect(page.locator('.editor-frontmatter')).toContainText('文档属性');
 await expect(page.locator('.wysiwyg-content .editor-image')).toHaveCount(1);
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 // Entering and leaving rich editing must not serialize or dirty the original document.
 expect(await saved(page)).toBe(original);
 await page.getByTitle('编辑模式 · ⌘ E').click();
 await page.locator('.wysiwyg-content > p').first().click();
 await page.keyboard.press('End'); await page.keyboard.insertText('更新');
 await expect.poll(() => saved(page)).toContain('正文更新');
 const value = await saved(page);
 expect(value.startsWith('---\ntags: [想法]\naliases: [测试]\n---\n\n')).toBe(true);
 expect(value).toContain('![[missing.png|图片]]');
 expect(value).toContain('`![[literal.png]]`');
 expect(value).toContain('```text\n![[literal.png]]\n```');
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
 await page.setViewportSize({ width: 780, height: 800 });
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
 await page.screenshot({ path: 'test-results/wysiwyg-editor.png', fullPage: true });
});

test('pastes Markdown as formatted content and keeps paste literal inside code blocks', async ({ page }) => {
 await seed(page, '# 粘贴测试\n\n正文\n');
 const editor = page.getByRole('textbox', { name: '笔记正文' });
 await editor.locator('p').first().click(); await page.keyboard.press('End'); await page.keyboard.press('Enter');
 async function paste(text: string) {
  // Synthetic clipboard events need the browser's selectionchange to settle first.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await editor.evaluate((element, text) => {
   const data = new DataTransfer(); data.setData('text/plain', text);
   element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
 }
 await paste('## 粘贴标题\n\n**加粗正文**\n\n> 引用正文\n\n````js\nconst fence = "```";\n````');
 await expect(editor.locator('h2')).toHaveText('粘贴标题');
 await expect(editor.locator('strong')).toHaveText('加粗正文');
 await expect(editor.locator('blockquote')).toContainText('引用正文');
 await expect.poll(() => saved(page)).toContain('````js\nconst fence = "```";\n````');
 await editor.locator('pre code').click(); await page.keyboard.press('End');
 await paste('**字面代码**');
 await expect(editor.locator('pre code')).toContainText('**字面代码**');
 await expect(editor.locator('pre strong')).toHaveCount(0);
 await expect.poll(() => saved(page)).toContain('**字面代码**');
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await expect(page.locator('.prose pre code')).toContainText('const fence = "```";');
});

test('finishing an image import after switching notes updates its original document', async ({ page }) => {
 await seed(page, '# 原笔记\n\n正文\n');
 await page.locator('.folder-row').filter({ hasText: '测试' }).click();
 await page.getByRole('button', { name: '新建笔记', exact: true }).first().click();
 await page.getByLabel('笔记标题').fill('另一篇');
 await page.getByRole('button', { name: '创建笔记', exact: true }).click();
 await page.locator('.note-row').filter({ hasText: '编辑器测试' }).click();
 await page.locator('.wysiwyg-content > p').click(); await page.keyboard.press('End');
 await page.evaluate(() => {
  const read = FileReader.prototype.readAsDataURL;
  FileReader.prototype.readAsDataURL = function(blob) { setTimeout(() => read.call(this, blob), 700); };
 });
 await page.locator('input[type=file]').setInputFiles({ name: 'delayed.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N3IAAAAASUVORK5CYII=', 'base64') });
 await page.keyboard.insertText('继续输入');
 await page.locator('.note-row').filter({ hasText: '另一篇' }).click();
 await expect(page.locator('.wysiwyg-content h1')).toHaveText('另一篇');
 await expect.poll(() => saved(page)).toContain('![delayed.png]');
 expect(await saved(page)).toContain('正文继续输入');
 await expect(page.locator('.wysiwyg-content .editor-image')).toHaveCount(0);
 await expect(page.locator('.wysiwyg-content h1')).toHaveText('另一篇');
 await page.locator('.note-row').filter({ hasText: '编辑器测试' }).click();
 await expect(page.locator('.wysiwyg-content').getByRole('img', { name: 'delayed.png' })).toBeVisible();
});
