import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const exec = promisify(execFile);
const scratch = await mkdtemp(path.join(tmpdir(), 'fever-desktop-setup-'));
const globalConfig = path.join(scratch, 'gitconfig');
await writeFile(globalConfig, '');
const env = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '0' };
delete env.ELECTRON_RUN_AS_NODE;
let app;

async function openVault(name, prepare) {
  const folder = path.join(scratch, name), data = path.join(scratch, `${name}-data`);
  await mkdir(folder); await mkdir(data);
  await prepare?.(folder);
  app = await electron.launch({ args: ['.', `--fever-data=${data}`], env });
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Fever', exact: true })).toBeVisible();
  await app.evaluate(({ dialog }, vaultPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [vaultPath] }); }, folder);
  await page.getByRole('button', { name: '选择笔记库文件夹' }).click();
  await expect(page.getByRole('heading', { name: '未打开笔记' })).toBeVisible();
  return { folder, page };
}

try {
  const { folder, page } = await openVault('fresh');
  await page.getByRole('button', { name: 'Git', exact: true }).click();
  await page.getByPlaceholder('这次记录了什么？').fill('first backup without manual configuration');
  await page.getByRole('button', { name: '提交所有笔记变更', exact: true }).click();
  await expect(page.getByText('已创建 Git 提交', { exact: true })).toBeVisible();
  const git = async args => (await exec('git', args, { cwd: folder, env })).stdout;
  assert.equal((await git(['config', '--local', 'user.name'])).trim(), 'Fever');
  assert.equal((await git(['config', '--local', 'user.email'])).trim(), 'fever@localhost');
  assert.match(await git(['show', 'HEAD:.gitignore']), /\.fever-\*\.tmp/);
  assert.match(await git(['show', 'HEAD:.gitattributes']), /images\/\*\* filter=lfs diff=lfs merge=lfs -text/);
  assert.equal((await git(['status', '--porcelain'])).trim(), '');
  await page.getByTitle('设置', { exact: true }).click();
  await page.getByRole('tab', { name: '同步与备份', exact: true }).click();
  await expect(page.getByLabel('用户名', { exact: true })).toHaveValue('Fever');
  await expect(page.getByLabel('邮箱', { exact: true })).toHaveValue('fever@localhost');
  await app.close(); app = null;

  const lfsInstalled = await exec('git', ['lfs', 'version'], { env }).then(() => true, () => false);
  if (lfsInstalled) {
    const hookContent = '#!/bin/sh\necho preserve custom hook\n';
    const conflict = await openVault('custom-hook', async folder => {
      await exec('git', ['init', folder], { env });
      await writeFile(path.join(folder, '.git/hooks/pre-push'), hookContent, { mode: 0o755 });
    });
    await expect(conflict.page.locator('.toast')).toContainText('Git LFS 配置未完成');
    await conflict.page.getByTitle('设置', { exact: true }).click();
    await conflict.page.getByRole('tab', { name: '笔记库', exact: true }).click();
    await expect(conflict.page.getByRole('tabpanel')).toContainText('Git LFS 配置未完成');
    assert.equal(await readFile(path.join(conflict.folder, '.git/hooks/pre-push'), 'utf8'), hookContent);
  }
  assert.equal(await readFile(globalConfig, 'utf8'), '');
  console.log('Desktop setup passed: first backup, local identity, Git config files and LFS conflict guidance.');
} finally {
  await app?.close();
  await rm(scratch, { recursive: true, force: true });
}
