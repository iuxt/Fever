import { test, expect } from '@playwright/test';

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
 await page.getByTitle('打开文件：fever.json', { exact: true }).click();
 const state = await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!));
 state.manifest.categories.push('关闭文件时保存');
 await page.locator('.file-editor .cm-content').fill(JSON.stringify(state.manifest, null, 2));
 await page.keyboard.press('Meta+w');
 await expect(page.locator('.file-editor')).toHaveCount(0);
 await expect(page.locator('.tab.current')).toContainText('工作区对比');
 expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).manifest.categories)).toContain('关闭文件时保存');
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
