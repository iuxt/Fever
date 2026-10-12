import { test, expect, type Page } from '@playwright/test';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const list: string[] = []; errors.set(page, list); page.on('pageerror', error => list.push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

async function seed(page: Page, markdown: string) {
 await page.addInitScript(content => {
  if (localStorage.getItem('fever-demo-v1')) return;
  const note = { id: 'editor-test', title: '编辑器测试', category: '测试', filename: 'editor-test.md', createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z' };
  localStorage.setItem('fever-demo-v1', JSON.stringify({ manifest: { version: 1, notes: [note], categories: ['测试'] }, contents: { [note.id]: content }, versions: {}, images: {}, dirty: [], settings: { autoCommit: false, interval: 10, author: '', email: '', remote: '' } }));
 }, markdown);
 await page.goto('/');
 await expect(page.getByTitle('阅读模式', { exact: true })).toHaveCount(0);
 await expect(page.getByRole('textbox', { name: '笔记正文' })).toBeVisible();
}
async function saved(page: Page) {
 return page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).contents['editor-test'] as string);
}

for (const theme of ['light', 'dark']) {
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
  await language.selectOption('plaintext');
  await expect(richCode.locator('[class*="hljs-"]')).toHaveCount(0);
  await expect(richCode).toHaveText(code);
  await expect.poll(() => saved(page)).toContain(`\`\`\`plaintext\n${code}\n\`\`\``);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(language).toHaveValue('js');
  await expect(richCode.locator('.hljs-keyword')).toHaveText('const');

  await language.selectOption('typescript');
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
 await languages.nth(1).selectOption('js');
 await expect(page.locator('.editor-code-block').nth(1).locator('.hljs-keyword')).toHaveText('const');
 await expect(languages.nth(0)).toHaveValue('custom-language');
 await expect.poll(() => saved(page)).toContain('```custom-language\n<literal>& **text**\n```');
 await expect.poll(() => saved(page)).toContain('```js\nconst value = 42;\n```');
 await page.locator('.wysiwyg-content > p').last().click();
 await expect(page.getByRole('button', { name: '代码块', exact: true })).toHaveAttribute('aria-pressed', 'false');
 await page.keyboard.press('End'); await page.keyboard.press('Enter');
 await page.getByRole('button', { name: '代码块', exact: true }).click();
 await expect(languages).toHaveCount(4);
 await languages.last().selectOption('json');
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
 await page.mouse.move(cell!.x + cell!.width, cell!.y + 12);
 await table.getByRole('button', { name: '在第 2 列前插入列' }).click();
 await expect(rows.first().locator('th')).toHaveText(['A', '', 'B']);
 await expect(rows.nth(1).locator('td')).toHaveText(['a1', '', 'b1']);
 cell = await rows.nth(1).locator('td').first().boundingBox();
 await page.mouse.move(cell!.x + 35, cell!.y + cell!.height);
 await table.getByRole('button', { name: '在第 3 行前插入行' }).click();
 await expect(rows).toHaveCount(4);
 await expect(rows.nth(2).locator('td')).toHaveText(['', '', '']);
 await expect(rows.last().locator('td')).toHaveText(['a2', '', 'b2']);
 await page.getByRole('button', { name: '撤销', exact: true }).click();
 await expect(rows).toHaveCount(3);
 await page.getByRole('button', { name: '撤销', exact: true }).click();
 await expect(rows.first().locator('th')).toHaveText(['A', 'B']);

 const last = await rows.last().locator('td').last().boundingBox();
 await page.mouse.move(last!.x + 30, last!.y + last!.height);
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

test('inserts local images at the cursor and can undo the insertion', async ({ page }) => {
 await seed(page, '# 图片测试\n\n插入位置\n\n尾段\n');
 const editor = page.getByRole('textbox', { name: '笔记正文' });
 await editor.locator('p').first().click(); await page.keyboard.press('End');
 await page.locator('input[type=file]').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N3IAAAAASUVORK5CYII=', 'base64') });
 await expect(editor.getByRole('img', { name: 'pixel.png', exact: true })).toBeVisible();
 expect(await editor.getByRole('img', { name: 'pixel.png', exact: true }).evaluate(img => img.naturalWidth)).toBe(1);
 await expect.poll(() => saved(page)).toMatch(/!\[pixel.png\]\([^)]*images\//);
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
