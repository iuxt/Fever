import { test, expect, type Page } from '@playwright/test';

async function chooseAppearance(page: Page, label: string, value: string) {
 await page.getByRole('combobox', { name: label }).click();
 await page.getByRole('option', { name: value, exact: true }).click();
}

async function openSettings(page: Page) {
 await page.getByTitle('设置', { exact: true }).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.locator('.document-space')).toBeVisible();
}

test('follows live system changes and remembers explicit theme overrides', async ({ page }) => {
 await page.emulateMedia({ colorScheme: 'dark' });
 await page.goto('/');
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
 await openSettings(page);
 await expect(page.getByLabel('颜色模式')).toHaveText('跟随系统');
 await page.emulateMedia({ colorScheme: 'light' });
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
 await chooseAppearance(page, '颜色模式', '暗色模式');
 await page.emulateMedia({ colorScheme: 'dark' });
 await page.emulateMedia({ colorScheme: 'light' });
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
 await page.reload();
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
 await openSettings(page);
 await expect(page.getByLabel('颜色模式')).toHaveText('暗色模式');
 await chooseAppearance(page, '颜色模式', '亮色模式');
 await page.emulateMedia({ colorScheme: 'dark' });
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
 await chooseAppearance(page, '颜色模式', '跟随系统');
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
 await page.reload();
 await openSettings(page);
 await expect(page.getByLabel('颜色模式')).toHaveText('跟随系统');
 await page.emulateMedia({ colorScheme: 'light' });
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('font size applies to interface, rich text, source and history without rewriting notes', async ({ page }) => {
 await page.goto('/');
 await page.locator('.folder-row').filter({ hasText: '开始使用' }).click();
 await page.locator('.note-row').filter({ hasText: '欢迎使用 Fever' }).click();
 await openSettings(page);
 await page.getByRole('button', { name: '保存设置', exact: true }).click();
 const initialNotes = await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).contents);
 await openSettings(page);
 await expect(page.getByLabel('字体大小')).toHaveText('16 px（默认）');
 await chooseAppearance(page, '字体大小', '24 px');
 await expect.poll(() => page.getByLabel('字体预览').evaluate(el => getComputedStyle(el).fontSize)).toBe('24px');
 await expect.poll(() => page.getByLabel('颜色模式').evaluate(el => getComputedStyle(el).fontSize)).toBe('21px');
 await page.getByRole('button', { name: '取消', exact: true }).click();
 await expect.poll(() => page.locator('.wysiwyg-content').evaluate(el => getComputedStyle(el).fontSize)).toBe('24px');
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await expect.poll(() => page.locator('.cm-editor').evaluate(el => getComputedStyle(el).fontSize)).toBe('24px');
 await expect.poll(() => page.locator('.document .prose').evaluate(el => getComputedStyle(el).fontSize)).toBe('24px');
 await page.reload();
 await openSettings(page);
 await expect(page.getByLabel('字体大小')).toHaveText('24 px');
 await page.getByRole('button', { name: '取消', exact: true }).click();
 await page.getByRole('button', { name: '历史', exact: true }).click();
 await page.getByRole('button', { name: /创建笔记，记录最初的想法/ }).click();
 await page.getByRole('button', { name: '预览此版本', exact: true }).click();
 await expect.poll(() => page.locator('.revision-document .prose').evaluate(el => getComputedStyle(el).fontSize)).toBe('24px');
 expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).contents)).toEqual(initialNotes);
 await openSettings(page);
 await chooseAppearance(page, '字体大小', '12 px');
 await expect.poll(() => page.locator('.revision-document .prose').evaluate(el => getComputedStyle(el).fontSize)).toBe('12px');
 await page.setViewportSize({ width: 780, height: 800 });
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
 await chooseAppearance(page, '字体大小', '24 px');
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
 await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeInViewport();
 await page.getByRole('button', { name: '取消', exact: true }).click();
 for (const label of ['所有更改已保存', '浏览器演示']) {
  await expect(page.getByText(label, { exact: true })).toBeInViewport();
 }
 const statusFits = await page.locator('.status-bar').evaluate(bar => {
  const bounds = bar.getBoundingClientRect();
  return [...bar.querySelectorAll('span, button')].every(element => {
   const rect = element.getBoundingClientRect();
   return rect.top >= bounds.top && rect.bottom <= bounds.bottom && rect.right <= bounds.right;
  });
 });
 expect(statusFits).toBe(true);
});

test('invalid appearance preferences fall back to readable defaults', async ({ page }) => {
 await page.addInitScript(() => {
  localStorage.setItem('fever-theme', 'unknown');
  localStorage.setItem('fever-font-size', '-100');
  localStorage.setItem('fever-editor-width', '99999');
  localStorage.setItem('fever-editor-full-width', 'unknown');
 });
 await page.emulateMedia({ colorScheme: 'light' });
 await page.goto('/');
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
 await openSettings(page);
 await expect(page.getByLabel('颜色模式')).toHaveText('跟随系统');
 await expect(page.getByLabel('字体大小')).toHaveText('16 px（默认）');
 await expect(page.getByRole('slider', { name: '正文最大宽度' })).toHaveValue('960');
 await expect(page.getByRole('switch', { name: '铺满编辑区' })).toHaveAttribute('aria-checked', 'false');
});

test('editor width adjusts live, persists, fits small windows and applies to historical previews', async ({ page }) => {
 await page.setViewportSize({ width: 2000, height: 1000 });
 await page.goto('/');
 await page.locator('.folder-row').filter({ hasText: '开始使用' }).click();
 await page.locator('.note-row').filter({ hasText: '欢迎使用 Fever' }).click();
 await expect(page.locator('.wysiwyg-content')).toBeVisible();
 const originalText = await page.locator('.wysiwyg-content').textContent();
 const width = () => page.locator('.wysiwyg-content').evaluate(element => element.getBoundingClientRect().width);
 await expect.poll(width).toBe(960);
 await page.getByRole('button', { name: '调整正文宽度' }).click();
 const slider = page.getByRole('slider', { name: '正文最大宽度' });
 await slider.focus(); await page.keyboard.press('Home');
 await expect(slider).toHaveValue('600');
 await expect.poll(width).toBe(600);
 await page.keyboard.press('ArrowRight');
 await expect.poll(width).toBe(620);
 await page.keyboard.press('Escape');
 await expect(slider).toHaveCount(0);
 await expect(page.getByRole('button', { name: '调整正文宽度' })).toBeFocused();
 await page.reload();
 await expect.poll(width).toBe(620);
 await page.getByRole('button', { name: '调整正文宽度' }).click();
 await page.getByRole('switch', { name: '铺满编辑区' }).click();
 await expect(slider).toBeDisabled();
 await expect.poll(width).toBeGreaterThan(1200);
 await page.reload();
 await expect.poll(width).toBeGreaterThan(1200);
 await openSettings(page);
 await expect(page.getByRole('switch', { name: '铺满编辑区' })).toHaveAttribute('aria-checked', 'true');
 await page.getByRole('switch', { name: '铺满编辑区' }).click();
 await expect.poll(width).toBe(620);
 await page.getByRole('button', { name: '恢复默认', exact: true }).click();
 await expect.poll(width).toBe(960);
 await page.getByRole('button', { name: '取消', exact: true }).click();
 await page.getByRole('button', { name: '历史', exact: true }).click();
 await page.getByRole('button', { name: /创建笔记，记录最初的想法/ }).click();
 await page.getByRole('button', { name: '预览此版本', exact: true }).click();
 await page.getByRole('button', { name: '调整正文宽度' }).click();
 await slider.focus(); await page.keyboard.press('Home');
 await expect.poll(() => page.locator('.revision-document .prose').evaluate(element => element.getBoundingClientRect().width)).toBe(600);
 await page.keyboard.press('Escape');
 await page.getByRole('button', { name: '返回当前版本', exact: true }).click();
 await expect(page.locator('.wysiwyg-content')).toHaveText(originalText!);
 // Leave enough space for two 600 px columns beside the folder and note lists.
 await page.getByTitle('关闭右侧面板', { exact: true }).click();
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await expect.poll(() => page.locator('.document .prose').evaluate(element => element.getBoundingClientRect().width)).toBe(600);
 await page.getByTitle('编辑模式 · ⌘ E', { exact: true }).click();
 await page.getByRole('button', { name: '调整正文宽度' }).click();
 await page.getByRole('switch', { name: '铺满编辑区' }).click();
 await page.setViewportSize({ width: 780, height: 800 });
 await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
 await expect(page.getByRole('slider', { name: '正文最大宽度' })).toBeInViewport();
 await page.keyboard.press('Escape');
 await page.getByTitle('Markdown 源码与预览', { exact: true }).click();
 await expect(page.locator('.cm-content')).toBeVisible();
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const theme of ['light', 'dark']) {
 test(`body, secondary text and controls have readable contrast (${theme})`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: theme as 'light' | 'dark' });
  await page.goto('/');
  await page.locator('.folder-row').filter({ hasText: '开始使用' }).click();
  await page.locator('.note-row').filter({ hasText: '欢迎使用 Fever' }).click();
  await expect(page.locator('.wysiwyg-content p').first()).toBeVisible();
  await page.getByRole('button', { name: '大纲', exact: true }).click();
  await openSettings(page);
  const samples = await page.evaluate(() => {
   const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(value => {
     const channel = Number(value) / 255;
     return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
   };
   return ['.wysiwyg-content p', '.note-row.selected span', '.folder-row', '.sidebar-foot', '.status-bar', '.outline button', '.modal label', '.modal .select-trigger', '.form-hint', '.demo-info', '.modal .primary', '.modal .secondary', '.font-preview span'].map(selector => {
    const element = document.querySelector(selector)!;
    let background = element;
    while (getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)' && background.parentElement) background = background.parentElement;
    const text = luminance(getComputedStyle(element).color), surface = luminance(getComputedStyle(background).backgroundColor);
    return { selector, ratio: (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05), opacity: getComputedStyle(element).opacity };
   });
  });
  for (const sample of samples) {
   expect(sample.ratio, sample.selector).toBeGreaterThanOrEqual(4.5);
   expect(sample.opacity, sample.selector).toBe('1');
  }
  await page.screenshot({ path: `test-results/appearance-${theme}.png`, fullPage: true });
 });
}


test('appearance menus support keyboard selection, dismiss without closing settings and close outside', async ({ page }) => {
 await page.goto('/');
 await openSettings(page);
 const theme = page.getByRole('combobox', { name: '颜色模式' });
 await theme.focus();
 await page.keyboard.press('Enter');
 await expect(page.getByRole('listbox', { name: '颜色模式' })).toBeVisible();
 await page.keyboard.press('End');
 await page.keyboard.press('Enter');
 await expect(theme).toHaveText('暗色模式');
 await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
 await theme.click();
 await page.keyboard.press('Home');
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByRole('listbox')).toHaveCount(0);
 await expect(theme).toHaveText('暗色模式');
 await expect(theme).toBeFocused();
 await theme.click();
 await page.getByRole('heading', { name: '笔记库设置' }).click();
 await expect(page.getByRole('listbox')).toHaveCount(0);
 await theme.click();
 await page.screenshot({ path: 'test-results/custom-theme-dark.png' });
 await chooseAppearance(page, '字体大小', '24 px');
 await expect(page.getByRole('listbox')).toHaveCount(0);
 await expect(page.getByRole('combobox', { name: '字体大小' })).toHaveText('24 px');
});
