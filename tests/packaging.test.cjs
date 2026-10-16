const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { MacPackager, Platform } = require('app-builder-lib');
const { createTargets } = require('app-builder-lib/out/targets/targetFactory');
const cleanup = require('../scripts/cleanup-mac-app.cjs');

async function fixture(t) {
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-packaging-'));
  t.after(() => fs.rm(outDir, { recursive: true, force: true }));
  const executable = path.join(outDir, 'mac-arm64/Fever.app/Contents/MacOS/Fever');
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(executable, 'app', { mode: 0o755 });
  return { outDir, executable };
}

test('macOS --dir keeps the executable available for installation', async t => {
  const { outDir, executable } = await fixture(t);
  const targets = new Map();
  // 使用实际的 electron-builder 目标创建逻辑，覆盖 --dir 返回空 Map 的行为。
  createTargets(targets, ['dir'], outDir, {
    defaultTarget: ['dmg', 'zip'],
    createTargets: MacPackager.prototype.createTargets,
  });
  assert.equal(targets.size, 0);
  await cleanup({ outDir, platformToTargets: new Map([[Platform.MAC, targets]]) });
  await fs.access(executable, fs.constants.X_OK);
});

test('macOS installers keep DMG and ZIP while removing intermediate apps for all architectures', async t => {
  const { outDir } = await fixture(t);
  const apps = ['mac', 'mac-arm64', 'mac-x64', 'mac-universal'].map(dir => path.join(outDir, dir, 'Fever.app'));
  for (const app of apps) await fs.mkdir(app, { recursive: true });
  for (const file of ['Fever.dmg', 'Fever.zip']) await fs.writeFile(path.join(outDir, file), file);
  const unrelated = path.join(outDir, 'unrelated/Fever.app');
  await fs.mkdir(unrelated, { recursive: true });
  const context = { outDir, platformToTargets: new Map([[Platform.MAC, new Map([['dmg', {}], ['zip', {}]])]]) };
  await cleanup(context);
  for (const app of apps) await assert.rejects(fs.access(app), { code: 'ENOENT' });
  for (const file of ['Fever.dmg', 'Fever.zip', 'unrelated/Fever.app']) await fs.access(path.join(outDir, file));
  await cleanup(context);
});

test('other platforms and explicit directory targets preserve apps', async t => {
  const { outDir, executable } = await fixture(t);
  for (const [platform, names] of [[Platform.LINUX, ['deb']], [Platform.MAC, ['dir', 'dmg']]]) {
    await cleanup({ outDir, platformToTargets: new Map([[platform, new Map(names.map(name => [name, {}]))]]) });
    await fs.access(executable);
  }
});
