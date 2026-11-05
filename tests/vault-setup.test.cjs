const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { VaultStore } = require('../electron/vault.cjs');

async function fixture(t) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-setup-'));
  t.after(() => fs.rm(scratch, { recursive: true, force: true }));
  const dir = path.join(scratch, 'vault'); await fs.mkdir(dir);
  const globalConfig = path.join(scratch, 'gitconfig');
  await fs.writeFile(globalConfig, '[init]\n\tdefaultBranch = custom\n');
  const store = new VaultStore();
  store.environment = { ...store.environment, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '0' };
  return { scratch, dir, globalConfig, store };
}

test('a fresh machine can commit immediately with local identity, ignore rules and LFS tracking', async t => {
  const { dir, globalConfig, store } = await fixture(t);
  const globalBefore = await fs.readFile(globalConfig, 'utf8');
  await store.open(dir);
  assert.equal((await store.status()).branch, 'main');
  assert.equal((await store.settings()).author, 'Fever');
  assert.equal((await store.settings()).email, 'fever@localhost');
  assert.equal((await store.git(['config', '--local', 'user.name'])).trim(), 'Fever');
  const ignored = ['.DS_Store', 'notes/.DS_Store', 'drawings/Thumbs.db', 'Desktop.ini', '.fever-test.tmp', 'notes/.test.tmp', 'drawings/.test.tmp'];
  for (const file of ignored) await fs.writeFile(path.join(dir, file), 'temporary');
  const changes = (await store.status()).changes.map(change => change.path);
  for (const file of ignored) assert.ok(!changes.includes(file), file);
  assert.ok(changes.includes('.gitignore'));
  assert.match(await store.git(['check-attr', 'filter', 'diff', 'merge', 'text', '--', 'images/nested/pixel.png']), /filter: lfs[\s\S]*diff: lfs[\s\S]*merge: lfs[\s\S]*text: unset/);
  await store.commit('first backup');
  assert.ok((await store.git(['ls-tree', '--name-only', 'HEAD'])).includes('.gitignore'));
  assert.equal((await store.status()).changes.length, 0);
  assert.equal(await fs.readFile(globalConfig, 'utf8'), globalBefore);
  if (store.lfs) {
    assert.equal((await store.git(['config', '--local', 'filter.lfs.required'])).trim(), 'true');
    const hook = path.resolve(dir, (await store.git(['rev-parse', '--git-path', 'hooks/pre-push'])).trim());
    assert.match(await fs.readFile(hook, 'utf8'), /git lfs pre-push/);
    const note = store.manifest.notes[0];
    const image = await store.image([1, 2, 3], 'pixel.png', note.id);
    await store.commit('image backup');
    assert.match(await store.git(['show', `HEAD:${image.slice(3)}`]), /git-lfs.github.com\/spec\/v1/);
  }
});

test('reopening preserves existing config, branch and identities and does not duplicate setup rules', async t => {
  const { dir, globalConfig, store } = await fixture(t);
  await fs.appendFile(globalConfig, '[user]\n\tname = Existing User\n\temail = existing@example.com\n');
  store.root = dir;
  await store.git(['init', '-b', 'existing']);
  const ignore = '# user rules\r\nprivate/\r\n.DS_Store';
  const attributes = '# user rules\n*.pdf -diff\nimages/** filter=lfs';
  await fs.writeFile(path.join(dir, '.gitignore'), ignore);
  await fs.writeFile(path.join(dir, '.gitattributes'), attributes);
  await store.open(dir);
  assert.equal((await store.status()).branch, 'existing');
  assert.equal((await store.settings()).author, 'Existing User');
  assert.equal((await store.settings()).email, 'existing@example.com');
  assert.equal(await store.git(['config', '--local', 'user.name'], true), '');
  const savedIgnore = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
  const savedAttributes = await fs.readFile(path.join(dir, '.gitattributes'), 'utf8');
  assert.ok(savedIgnore.startsWith(ignore + '\r\n'));
  assert.ok(savedAttributes.startsWith(attributes + '\n'));
  assert.match(await store.git(['check-attr', 'merge', '--', 'images/pixel.png']), /merge: lfs/);
  await store.configure({ author: 'Local User', email: 'local@example.com', remote: '' });
  await store.commit('baseline');
  await store.open(dir);
  assert.equal((await store.settings()).author, 'Local User');
  assert.equal(await fs.readFile(path.join(dir, '.gitignore'), 'utf8'), savedIgnore);
  assert.equal(await fs.readFile(path.join(dir, '.gitattributes'), 'utf8'), savedAttributes);
  assert.deepEqual((await store.status()).changes, []);
  await fs.unlink(path.join(dir, '.gitignore'));
  await store.open(dir);
  assert.match(await fs.readFile(path.join(dir, '.gitignore'), 'utf8'), /\.fever-\*\.tmp/);
});

test('missing LFS keeps text backups usable and is configured on the next open after installation', async t => {
  const { dir, store } = await fixture(t);
  const git = store.git.bind(store);
  store.git = (args, ...rest) => args[0] === 'lfs' && args[1] === 'version' ? Promise.resolve('') : git(args, ...rest);
  const vault = await store.open(dir);
  assert.equal(vault.lfs, false);
  assert.match(vault.setupWarnings.join(' '), /未找到 Git LFS/);
  // System metadata and empty image directories must not disable text backups.
  await fs.writeFile(path.join(dir, 'images/.DS_Store'), 'metadata');
  await fs.mkdir(path.join(dir, 'images/empty'));
  await store.commit('text without LFS');
  await assert.rejects(store.image([1], 'pixel.png', vault.manifest.notes[0].id), /Git LFS/);
  store.git = git;
  const reopened = await store.open(dir);
  if ((await store.git(['lfs', 'version'], true)).trim()) {
    assert.equal(reopened.lfs, true);
    assert.deepEqual(reopened.setupWarnings, []);
  }
});

test('a custom pre-push hook is preserved and LFS setup failure does not block opening text notes', async t => {
  const { dir, store } = await fixture(t);
  store.root = dir;
  if (!(await store.git(['lfs', 'version'], true)).trim()) { t.skip('Git LFS not installed'); return; }
  await store.git(['init']);
  const hook = path.join(dir, '.git/hooks/pre-push');
  const content = '#!/bin/sh\necho custom hook\n';
  await fs.writeFile(hook, content, { mode: 0o755 });
  const vault = await store.open(dir);
  assert.equal(vault.lfs, false);
  assert.match(vault.setupWarnings.join(' '), /pre-push/);
  assert.equal(await fs.readFile(hook, 'utf8'), content);
  await store.commit('text with custom hook');
  await fs.unlink(hook);
  assert.equal((await store.open(dir)).lfs, true);
});

test('missing Git fails before creating files and keeps the previously open vault', async t => {
  const { scratch, dir, store } = await fixture(t);
  await store.open(dir);
  const previous = store.snapshot();
  const other = path.join(scratch, 'other'); await fs.mkdir(other);
  store.environment.PATH = path.join(scratch, 'missing-bin');
  await assert.rejects(store.open(other), /未找到 Git.*安装 Git/);
  assert.deepEqual(await fs.readdir(other), []);
  assert.deepEqual(store.snapshot(), previous);
});

test('setup refuses symlink config files without touching their targets', async t => {
  const { scratch, dir, store } = await fixture(t);
  const target = path.join(scratch, 'outside'); await fs.writeFile(target, '# private config');
  await fs.symlink(target, path.join(dir, '.gitignore'));
  await assert.rejects(store.open(dir), /符号链接/);
  assert.equal(await fs.readFile(target, 'utf8'), '# private config');
});
