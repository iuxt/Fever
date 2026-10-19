import { test, expect } from '@playwright/test';
import { folderPaths } from '../../electron/manifest.mjs';

test('fixed Excalidraw category ignores legacy settings and applies to new and embedded drawings', async ({ page }) => {
 await page.goto('/');
 await page.getByTitle('设置', { exact: true }).click();
 await expect(page.getByLabel('Excalidraw 默认分类')).toHaveCount(0);
 await page.getByRole('button', { name: '保存设置', exact: true }).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('fever-demo-v1')!);
  state.settings.excalidrawCategory = '旧分类/绘图';
  localStorage.setItem('fever-demo-v1', JSON.stringify(state));
 });
 await page.reload();
 await page.getByTitle('新建绘图', { exact: true }).click();
 await expect(page.getByLabel('所属分类')).toHaveValue('Excalidraw');
 await page.getByLabel('绘图标题').fill('默认分类绘图');
 await page.getByRole('button', { name: '创建绘图', exact: true }).click();
 await expect.poll(async () => {
  const manifest = await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).manifest);
  return folderPaths(manifest).get(manifest.notes.find((note: { title: string }) => note.title === '默认分类绘图')?.folderId);
 }).toBe('Excalidraw');
 expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).manifest.notes.find((note: { title: string }) => note.title === '默认分类绘图').directory)).toBe('drawings');
 await page.getByRole('button', { name: '新建笔记', exact: true }).first().click();
 await page.getByLabel('笔记标题').fill('嵌入文档');
 await page.getByLabel('所属分类').fill('文档');
 await page.getByRole('button', { name: '创建笔记', exact: true }).click();
 await page.getByRole('button', { name: '插入 Excalidraw', exact: true }).click();
 await page.getByLabel('选择绘图').selectOption('');
 await expect(page.getByLabel('所属分类')).toHaveValue('Excalidraw');
 await page.getByLabel('绘图标题').fill('自选分类绘图');
 await page.getByLabel('所属分类').fill('临时绘图');
 await page.getByRole('button', { name: '插入绘图', exact: true }).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect.poll(async () => {
  const manifest = await page.evaluate(() => JSON.parse(localStorage.getItem('fever-demo-v1')!).manifest);
  return folderPaths(manifest).get(manifest.notes.find((note: { title: string }) => note.title === '自选分类绘图')?.folderId);
 }).toBe('临时绘图');
 expect(await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('fever-demo-v1')!);
  const document = state.manifest.notes.find((note: { title: string }) => note.title === '嵌入文档');
  return state.contents[document.id];
 })).toContain('../drawings/');
 await page.reload();
 await page.getByTitle('新建绘图', { exact: true }).click();
 await expect(page.getByLabel('所属分类')).toHaveValue('Excalidraw');
});
