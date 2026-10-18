import { test, expect } from '@playwright/test';

test('settings tabs support keyboard navigation and retain drafts until saved or cancelled', async ({ page }) => {
 await page.goto('/');
 await page.getByTitle('设置', { exact: true }).click();
 const tab = (name: string) => page.getByRole('tab', { name, exact: true });
 await expect(tab('外观')).toBeFocused();
 await expect(page.getByRole('tabpanel')).toHaveAccessibleName('外观');
 await expect(page.getByLabel('用户名')).toHaveCount(0);
 await page.keyboard.press('ArrowLeft');
 await expect(tab('快捷键')).toBeFocused();
 await expect(page.locator('.shortcut-list')).toContainText('代码块');
 await page.keyboard.press('Home');
 await expect(tab('外观')).toBeFocused();
 await page.keyboard.press('End');
 await expect(tab('快捷键')).toHaveAttribute('aria-selected', 'true');
 await page.keyboard.press('ArrowRight');
 await expect(tab('外观')).toBeFocused();
 await page.keyboard.press('ArrowRight');
 await expect(page.getByRole('tabpanel')).toHaveAccessibleName('笔记库');
 await expect(page.locator('.settings-vault')).toBeVisible();
 await expect(page.locator('.demo-info')).toBeVisible();
 await page.keyboard.press('ArrowRight');
 await expect(tab('同步与备份')).toBeFocused();
 await page.getByLabel('用户名').fill('分类设置测试');
 await page.getByLabel('邮箱').fill('tabs@example.com');
 await page.getByLabel('远程仓库（origin）').fill('git@example.com:notes.git');
 await expect(page.getByRole('switch', { name: '定时自动备份' })).toBeDisabled();
 await expect(page.getByRole('switch', { name: '定时自动拉取' })).toBeDisabled();
 await tab('外观').click();
 await page.getByRole('combobox', { name: '颜色模式' }).click();
 await page.getByRole('option', { name: '暗色模式', exact: true }).click();
 await tab('同步与备份').click();
 await expect(page.getByLabel('用户名')).toHaveValue('分类设置测试');
 await expect(page.getByLabel('邮箱')).toHaveValue('tabs@example.com');
 await expect(page.getByLabel('远程仓库（origin）')).toHaveValue('git@example.com:notes.git');
 // The shared footer saves drafts even from a different category.
 await tab('快捷键').click();
 await page.getByRole('button', { name: '保存设置', exact: true }).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.reload();
 await page.getByTitle('设置', { exact: true }).click();
 await expect(tab('外观')).toHaveAttribute('aria-selected', 'true');
 await expect(page.getByRole('combobox', { name: '颜色模式' })).toHaveText('暗色模式');
 await tab('同步与备份').click();
 await expect(page.getByLabel('用户名')).toHaveValue('分类设置测试');
 await page.getByLabel('用户名').fill('取消的修改');
 await tab('笔记库').click();
 await page.getByRole('button', { name: '取消', exact: true }).click();
 await page.getByTitle('设置', { exact: true }).click();
 await tab('同步与备份').click();
 await expect(page.getByLabel('用户名')).toHaveValue('分类设置测试');
});

for (const theme of ['light', 'dark'] as const) {
 test(`settings keep navigation and actions visible with large text (${theme})`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(() => localStorage.setItem('fever-font-size', '24'));
  await page.setViewportSize({ width: 520, height: 640 });
  await page.goto('/');
  await expect(page.getByTitle('设置', { exact: true })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+,');
  for (const name of ['外观', '笔记库', '同步与备份', '快捷键']) {
   await page.getByRole('tab', { name, exact: true }).click();
   await expect(page.getByRole('tabpanel')).toHaveAccessibleName(name);
   await page.getByRole('tabpanel').evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
   await expect(page.getByRole('tablist')).toBeInViewport();
   await expect(page.getByRole('button', { name: '保存设置', exact: true })).toBeInViewport();
   expect(await page.getByRole('tabpanel').evaluate(panel => panel.scrollWidth <= panel.clientWidth)).toBe(true);
  }
  await page.screenshot({ path: `test-results/settings-small-${theme}.png` });
 });
}
