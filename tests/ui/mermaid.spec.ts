import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const flowchart = 'flowchart LR\n    A[开始] --> B[完成]';
const fence = (source: string, language = 'mermaid') => `\`\`\`${language}\n${source}\n\`\`\``;

async function seed(page: Page, content: string) {
 await page.addInitScript(content => {
  if (localStorage.getItem('fever-demo-v1')) return;
  const note = { id: 'mermaid-test', title: 'Mermaid 测试', category: '', filename: 'mermaid-test.md', createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z' };
  localStorage.setItem('fever-demo-v1', JSON.stringify({ manifest: { version: 1, notes: [note], categories: [] }, contents: { [note.id]: content }, versions: {}, images: {}, dirty: [], settings: { autoCommit: false, interval: 10, author: '', email: '', remote: '' } }));
 }, content);
 await page.goto('/');
 await page.locator('.all-notes').first().click();
 await page.locator('.note-row').filter({ hasText: 'Mermaid 测试' }).click();
 await expect(page.getByRole('textbox', { name: '笔记正文' })).toBeVisible();
}

async function saved(page: Page) {
 return page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).contents['mermaid-test'] as string);
}

async function diagram(image: Locator) {
 await expect(image).toBeVisible({ timeout: 20000 });
 await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
 return decodeURIComponent((await image.getAttribute('src'))!.split(',').slice(1).join(','));
}

test('renders multiple diagram types offline in editing and preview without rewriting Markdown', async ({ page }) => {
 const errors: string[] = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
 const sources = [flowchart, 'sequenceDiagram\n    Alice->>Bob: Hello', 'classDiagram\n    Animal <|-- Duck', 'stateDiagram-v2\n    [*] --> Ready', 'erDiagram\n    CUSTOMER ||--o{ ORDER : places', 'gantt\n    dateFormat YYYY-MM-DD\n    section Plan\n    Task :2026-10-18, 1d'];
 const original = sources.map(source => fence(source)).join('\n\n') + '\n\n' + fence('const value = 42;', 'js') + '\n';
 await seed(page, original);
 const images = page.locator('.mermaid-preview img');
 await expect(images).toHaveCount(sources.length, { timeout: 20000 });
 expect(await diagram(images.first())).toContain('开始');
 for (let i = 0; i < sources.length; i++) await diagram(images.nth(i));
 await expect(page.locator('.editor-code-block .hljs-keyword')).toHaveText('const');
 expect(await saved(page)).toBe(original);
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await expect(images).toHaveCount(sources.length, { timeout: 20000 });
 for (let i = 0; i < sources.length; i++) await diagram(images.nth(i));
 expect(await saved(page)).toBe(original);
 expect(errors).toEqual([]);
});

test('edits diagram source, persists it and restores the chart after reload', async ({ page }) => {
 await seed(page, fence(flowchart) + '\n');
 const block = page.locator('.editor-code-block');
 await diagram(block.locator('.mermaid-preview img'));
 await block.getByRole('button', { name: '编辑源码', exact: true }).click();
 const code = block.locator('pre code');
 await expect(code).toBeVisible();
 await code.fill('flowchart TD');
 await code.click();
 await page.keyboard.press('End');
 await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
 await page.keyboard.press('Shift+Enter');
 await page.keyboard.insertText('    A[修改后] --> C[保存]');
 await expect.poll(() => saved(page)).toContain('flowchart TD\n    A[修改后] --> C[保存]');
 await block.getByRole('button', { name: '查看图表', exact: true }).click();
 expect(await diagram(block.locator('.mermaid-preview img'))).toContain('修改后');
 await page.reload();
 expect(await diagram(block.locator('.mermaid-preview img'))).toContain('修改后');
});

test('recovers from invalid syntax and keeps other diagrams working', async ({ page }) => {
 const invalid = 'flowchart LR\n    A[broken';
 await seed(page, fence(invalid) + '\n\n' + fence(flowchart));
 const blocks = page.locator('.editor-code-block');
 await expect(blocks.first().getByRole('alert')).toContainText('Mermaid 图表渲染失败', { timeout: 20000 });
 await expect(blocks.first().locator('.mermaid-preview code')).toHaveText(invalid);
 await diagram(blocks.last().locator('.mermaid-preview img'));
 await blocks.first().getByRole('button', { name: '编辑源码', exact: true }).click();
 await blocks.first().locator('pre code').fill(flowchart);
 await blocks.first().getByRole('button', { name: '查看图表', exact: true }).click();
 await diagram(blocks.first().locator('.mermaid-preview img'));
 await expect(page.getByRole('alert')).toHaveCount(0);
 await expect(page.locator('body > [id^="dfever-mermaid-"]')).toHaveCount(0);
});

test('selects Mermaid as a code language and switches back without losing source', async ({ page }) => {
 await seed(page, fence(flowchart, 'plaintext'));
 const language = page.getByRole('combobox', { name: '代码块语言' });
 await language.fill('mermaid'); await language.press('Enter');
 await diagram(page.locator('.mermaid-preview img'));
 await expect.poll(() => saved(page)).toContain('```mermaid');
 await language.fill('plaintext'); await language.press('Enter');
 await expect(page.locator('.mermaid-preview')).toHaveCount(0);
 await expect(page.locator('.editor-code-block pre code')).toHaveText(flowchart);
});

test('updates the rendered theme live without modifying note content', async ({ page }, testInfo) => {
 await page.emulateMedia({ colorScheme: 'light' });
 const original = fence(flowchart);
 await seed(page, original);
 const image = page.locator('.mermaid-preview img');
 const light = await diagram(image);
 await page.screenshot({ path: testInfo.outputPath('mermaid-light.png') });
 await page.emulateMedia({ colorScheme: 'dark' });
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
 await expect.poll(() => image.getAttribute('src')).not.toBe(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(light)}`);
 const dark = await diagram(image);
 await page.screenshot({ path: testInfo.outputPath('mermaid-dark.png') });
 expect(dark).not.toBe(light);
 expect(await saved(page)).toBe(original);
});

test('updates split preview from the latest source and isolates diagram markup', async ({ page }) => {
 await seed(page, fence(flowchart));
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 const source = page.locator('.source-editor .cm-content');
 await source.fill(fence('flowchart LR\n    X[最终版本] --> Y[完成]\n    click X "javascript:alert(1)"'));
 const svg = await diagram(page.locator('.mermaid-preview img'));
 expect(svg).toContain('最终版本');
 expect(svg).not.toContain('foreignObject');
 await expect(page.locator('.mermaid-preview svg, .mermaid-preview a, .mermaid-preview script, .mermaid-preview iframe')).toHaveCount(0);
 await expect.poll(() => saved(page)).toContain('最终版本');
});

test('exports a rendered self-contained diagram before preview finishes loading', async ({ page, context }) => {
 await seed(page, fence(flowchart));
 await page.getByTitle('更多笔记操作', { exact: true }).click();
 await page.getByRole('button', { name: '导出…', exact: true }).click();
 const dialog = page.getByRole('dialog');
 await dialog.getByRole('combobox', { name: '文件格式' }).click();
 await dialog.getByRole('option', { name: /^HTML / }).click();
 const downloading = page.waitForEvent('download');
 await dialog.getByRole('button', { name: '导出', exact: true }).click();
 const download = await downloading;
 const html = await readFile((await download.path())!, 'utf8');
 expect(html).toContain('data:image/svg+xml;');
 const exported = await context.newPage();
 await exported.setContent(html);
 expect(await diagram(exported.locator('.mermaid-preview img'))).toContain('开始');
 await expect(exported.locator('[data-export-pending="true"]')).toHaveCount(0);
});
