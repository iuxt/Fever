const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { VaultStore } = require('../electron/vault.cjs');

async function fixture(t) {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-background-pull-'));
  t.after(() => fs.rm(scratch, { recursive: true, force: true }));
  const dir = path.join(scratch, 'vault'), remote = path.join(scratch, 'remote.git'), clone = path.join(scratch, 'writer');
  await fs.mkdir(dir);
  const store = new VaultStore(); await store.open(dir);
  await store.configure({ author: 'Pull Test', email: 'pull@example.com', remote: '' });
  await store.commit('initial');
  await store.git(['init', '--bare', '--initial-branch=main', remote]);
  await store.git(['remote', 'add', 'origin', remote]); await store.push();
  await store.git(['clone', remote, clone]);
  const writer = new VaultStore(); await writer.open(clone);
  await writer.configure({ author: 'Writer', email: 'writer@example.com', remote: '' });
  await writer.git(['remote', 'add', 'origin', remote]);
  const note = store.manifest.notes[0];
  await writer.save(note.id, '# Remote update\n'); await writer.commit('remote update');
  await writer.git(['push', 'origin', 'main']);
  return { scratch, dir, store, note, writer, clone };
}

function holdFetch(store) {
  const git = store.git.bind(store);
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { started = resolve; });
  store.git = async (args, ...options) => {
    if (args[0] === 'fetch') { started(); await gate; }
    return git(args, ...options);
  };
  return { waiting, release };
}

for (const invalid of ['json', 'schema', 'missing', 'symlink']) test(`invalid remote manifest (${invalid}) leaves HEAD, worktree, index and memory unchanged`, async t => {
  const { dir, store, note, writer, clone } = await fixture(t);
  const file = path.join(clone, 'fever.json');
  if (invalid === 'missing') await fs.rm(file);
  else await fs.writeFile(file, invalid === 'json' ? '{ invalid' : JSON.stringify({ version: 2, folders: [], notes: invalid === 'symlink' ? [] : [{ ...note, folderId: 'missing' }] }));
  await writer.git(['add', '-A']);
  if (invalid === 'symlink') {
    // Stage a Git symlink with valid JSON as its target, on every platform.
    const oid = (await writer.git(['hash-object', 'fever.json'])).trim();
    await writer.git(['update-index', '--cacheinfo', `120000,${oid},fever.json`]);
  }
  await writer.git(['commit', '-m', 'broken remote manifest']); await writer.git(['push', 'origin', 'main']);
  const head = await store.git(['rev-parse', 'HEAD']), index = await store.git(['write-tree']);
  const manifest = await fs.readFile(path.join(dir, 'fever.json'), 'utf8'), body = await store.read(note.id), snapshot = store.snapshot();
  await assert.rejects(store.pull());
  assert.equal(await store.git(['rev-parse', 'HEAD']), head);
  assert.equal(await store.git(['write-tree']), index);
  assert.equal(await fs.readFile(path.join(dir, 'fever.json'), 'utf8'), manifest);
  assert.equal(await store.read(note.id), body);
  assert.deepEqual(store.snapshot(), snapshot);
  assert.equal(await store.git(['status', '--porcelain']), '');
  assert.equal(await store.git(['for-each-ref', '--format=%(refname)', 'refs/fever/pulls/']), '');
  await store.save(note.id, '# Local edit after rejected pull\n'); await store.flushMetadata();
  assert.equal(await store.git(['rev-parse', 'HEAD']), head);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'fever.json'), 'utf8')).notes[0].id, note.id);
});

test('pulling a remote ancestor preserves the newer local manifest', async t => {
  const { store } = await fixture(t);
  await store.pull();
  const local = await store.create('Local note ahead of origin', 'Local'); await store.commit('local ahead');
  const snapshot = store.snapshot(), head = await store.git(['rev-parse', 'HEAD']);
  const result = await store.pull();
  assert.equal(result.before, result.after);
  assert.equal(await store.git(['rev-parse', 'HEAD']), head);
  assert.deepEqual(store.snapshot(), snapshot);
  assert.equal(await store.read(local.id), '# Local note ahead of origin\n\n');
});

test('a stalled fetch leaves saves, metadata flushes and status usable and preserves local edits', { timeout: 15000 }, async t => {
  const { store, note } = await fixture(t);
  const gate = holdFetch(store);
  t.after(() => gate.release());
  const fetching = store.preparePull();
  assert.equal(store.preparePull(), fetching, 'concurrent requests share one fetch');
  await gate.waiting;
  await store.save(note.id, '# Edited while offline\n');
  await store.flushMetadata();
  assert.equal(await store.read(note.id), '# Edited while offline\n');
  assert.ok((await store.status()).changes.length);
  gate.release();
  const token = await fetching;
  await assert.rejects(store.pull(token), /冲突.*notes\//);
  assert.equal(await store.read(note.id), '# Edited while offline\n');
  assert.equal(await store.git(['for-each-ref', '--format=%(refname)', 'refs/fever/pulls/']), '');
});

test('pull preserves local new notes, folders, untracked files and existing stash entries', async t => {
  const { store, dir, note } = await fixture(t);
  await fs.writeFile(path.join(dir, 'scratch.txt'), 'existing stash\n');
  await store.git(['stash', 'push', '-u', '-m', 'user stash']);
  const stash = await store.git(['rev-parse', 'refs/stash']);
  const local = await store.create('Local draft', 'Local folder');
  await store.save(local.id, '# Uncommitted draft\n'); await store.flushMetadata();
  await fs.writeFile(path.join(dir, 'untracked.txt'), 'untouched\n');
  const result = await store.pull();
  assert.equal(result.commitCount, 1);
  assert.equal(await store.read(note.id), '# Remote update\n');
  assert.equal(await store.read(local.id), '# Uncommitted draft\n');
  assert.equal(store.snapshot().manifest.notes.find(n => n.id === local.id).category, 'Local folder');
  assert.equal(await fs.readFile(path.join(dir, 'untracked.txt'), 'utf8'), 'untouched\n');
  assert.equal(await store.git(['rev-parse', 'refs/stash']), stash);
  assert.match(await store.git(['status', '--porcelain']), /\?\? untracked.txt/);
  const reopened = new VaultStore(); await reopened.open(dir);
  assert.equal(await reopened.read(local.id), '# Uncommitted draft\n');
});

test('pull merges separate lines in one note while preserving partial staging and both save timestamps', async t => {
  const { store, writer, note } = await fixture(t);
  const base = '# Shared\n\nfirst\n\nmiddle\n\nlast\n';
  await writer.save(note.id, base); await writer.commit('shared base'); await writer.push(); await store.pull();
  await store.save(note.id, base.replace('first', 'staged first')); await store.flushMetadata();
  await store.stageAll();
  await store.save(note.id, base.replace('first', 'working first')); await store.flushMetadata();
  const localTimestamp = store.note(note.id).updatedAt;
  await writer.save(note.id, base.replace('last', 'remote last')); await writer.commit('remote line'); await writer.push();
  const remoteTimestamp = writer.note(note.id).updatedAt;
  const result = await store.pull();
  assert.equal(result.commitCount, 1);
  assert.equal(await store.read(note.id), base.replace('first', 'working first').replace('last', 'remote last'));
  assert.equal(await store.git(['show', `:notes/${note.filename}`]), base.replace('first', 'staged first').replace('last', 'remote last'));
  assert.equal(store.note(note.id).updatedAt, [localTimestamp, remoteTimestamp].sort().at(-1));
  const status = await store.status();
  assert.ok(status.changes.find(change => change.path === `notes/${note.filename}` && change.staged && change.unstaged));
  assert.equal(await store.git(['ls-files', '--unmerged']), '');
});

test('a conflicting pull leaves HEAD, index, file bytes, metadata and untracked files unchanged', async t => {
  const { store, note, dir } = await fixture(t);
  await store.save(note.id, '# Conflicting local draft\n'); await store.flushMetadata();
  await store.stageAll();
  await store.save(note.id, '# More uncommitted local content\n'); await store.flushMetadata();
  await fs.writeFile(path.join(dir, 'local.txt'), 'untracked\n');
  const head = await store.git(['rev-parse', 'HEAD']), index = await store.git(['write-tree']);
  const manifest = await fs.readFile(path.join(dir, 'fever.json')), snapshot = store.snapshot();
  await assert.rejects(store.pull(), error => /冲突/.test(error.message) && error.message.includes(`notes/${note.filename}`));
  assert.equal(await store.git(['rev-parse', 'HEAD']), head);
  assert.equal(await store.git(['write-tree']), index);
  assert.deepEqual(await fs.readFile(path.join(dir, 'fever.json')), manifest);
  assert.deepEqual(store.snapshot(), snapshot);
  assert.equal(await store.read(note.id), '# More uncommitted local content\n');
  assert.equal(await fs.readFile(path.join(dir, 'local.txt'), 'utf8'), 'untracked\n');
  assert.equal(await store.git(['ls-files', '--unmerged']), '');
});

test('a dirty note with no remote updates returns normally and preserves its exact staged state', async t => {
  const { store, note } = await fixture(t);
  await store.pull();
  await store.save(note.id, '# Local staged\n'); await store.stageAll();
  await store.save(note.id, '# Local working\n'); await store.flushMetadata();
  const index = await store.git(['write-tree']), snapshot = store.snapshot();
  const result = await store.pull();
  assert.equal(result.before, result.after);
  assert.equal(result.commitCount, 0);
  assert.equal(await store.git(['write-tree']), index);
  assert.deepEqual(store.snapshot(), snapshot);
  assert.equal(await store.read(note.id), '# Local working\n');
});

for (const phase of ['merge', 'restore']) test(`failed ${phase} rolls back overlapping files and preserves local additions`, async t => {
  const { store, note, dir } = await fixture(t);
  const local = await store.create('Local note', 'Local');
  await store.stageAll();
  const head = await store.git(['rev-parse', 'HEAD']), index = await store.git(['write-tree']);
  const manifest = await fs.readFile(path.join(dir, 'fever.json')), original = await store.read(note.id);
  const git = store.git.bind(store);
  let failed = false;
  store.git = async (args, ...options) => {
    if (!failed && args[0] === (phase === 'merge' ? 'merge' : 'update-index')) { failed = true; throw new Error('Injected pull failure'); }
    return git(args, ...options);
  };
  await assert.rejects(store.pull(), /Injected pull failure/);
  assert.ok(failed);
  assert.equal(await store.git(['rev-parse', 'HEAD']), head);
  assert.equal(await store.git(['write-tree']), index);
  assert.deepEqual(await fs.readFile(path.join(dir, 'fever.json')), manifest);
  assert.equal(await store.read(note.id), original);
  assert.equal(await store.read(local.id), '# Local note\n\n');
});

for (const collision of ['untracked', 'binary', 'deleted']) test(`${collision} conflicts preserve all local content before applying`, async t => {
  const { store, writer, note, dir, clone } = await fixture(t);
  let file = `notes/${note.filename}`;
  if (collision === 'untracked') {
    file = 'new.txt';
    await fs.writeFile(path.join(dir, file), 'local new file\n');
    await fs.writeFile(path.join(clone, file), 'remote new file\n');
    await writer.git(['add', '--', file]); await writer.git(['commit', '-m', 'remote new file']);
  } else if (collision === 'binary') {
    await fs.writeFile(path.join(dir, file), Buffer.from([0, 1, 2]));
  } else {
    await fs.rm(path.join(dir, file));
  }
  if (collision === 'untracked') await writer.push();
  const head = await store.git(['rev-parse', 'HEAD']), index = await store.git(['write-tree']);
  const before = await fs.readFile(path.join(dir, file)).catch(() => null);
  await assert.rejects(store.pull(), error => /冲突/.test(error.message) && error.message.includes(file));
  assert.equal(await store.git(['rev-parse', 'HEAD']), head);
  assert.equal(await store.git(['write-tree']), index);
  assert.deepEqual(await fs.readFile(path.join(dir, file)).catch(() => null), before);
});

test('competing note titles conflict while an independent title and body edit merge', async t => {
  const { store, writer, note } = await fixture(t);
  await store.update(note.id, 'Local title', '收件箱');
  await store.pull();
  assert.equal(store.note(note.id).title, 'Local title');
  assert.equal(await store.read(note.id), '# Remote update\n');
  await writer.update(note.id, 'Remote title', '收件箱'); await writer.commit('remote title'); await writer.push();
  const snapshot = store.snapshot(), head = await store.git(['rev-parse', 'HEAD']);
  await assert.rejects(store.pull(), /冲突.*fever.json/);
  assert.deepEqual(store.snapshot(), snapshot);
  assert.equal(await store.git(['rev-parse', 'HEAD']), head);
});

test('a failed rollback retains a durable copy of both original versions and reports its location', async t => {
  const { store, note, dir } = await fixture(t);
  await store.create('Local draft', 'Local'); await store.stageAll();
  const manifest = await fs.readFile(path.join(dir, 'fever.json'));
  const git = store.git.bind(store);
  store.git = async (args, ...options) => {
    if (args[0] === 'update-index') throw new Error('simulated write failure');
    return git(args, ...options);
  };
  await assert.rejects(store.pull(), /备份已保留在 .*fever-pull-.*\.json/);
  const backupName = (await fs.readdir(path.join(dir, '.git'))).find(name => /^fever-pull-.*\.json$/.test(name));
  assert.ok(backupName);
  const backup = JSON.parse(await fs.readFile(path.join(dir, '.git', backupName), 'utf8'));
  const file = backup.files.find(file => file.path === 'fever.json');
  assert.deepEqual(Buffer.from(file.work, 'base64'), manifest);
  assert.deepEqual(Buffer.from(file.index, 'base64'), manifest);
  assert.match(await store.read(note.id), /欢迎使用 Fever/);
});

test('prepared updates apply without a second network operation and clean up their refs', async t => {
  const { store, note } = await fixture(t);
  const original = await store.read(note.id);
  const token = await store.preparePull();
  assert.equal(await store.read(note.id), original);
  const git = store.git.bind(store);
  store.git = async (args, ...options) => {
    assert.ok(!['fetch', 'pull'].includes(args[0]), 'application must use the downloaded commit');
    return git(args, ...options);
  };
  const result = await store.pull(token);
  assert.equal(result.commitCount, 1);
  assert.equal(await store.read(note.id), '# Remote update\n');
  assert.equal(await store.git(['for-each-ref', '--format=%(refname)', 'refs/fever/pulls/']), '');
  await assert.rejects(store.pull(token), /请求已失效/);
});

for (const change of ['commit', 'branch', 'remote', 'reopen']) {
  test(`a ${change} after fetching invalidates the prepared update`, async t => {
    const { store, dir, note } = await fixture(t);
    const token = await store.preparePull();
    const original = await store.read(note.id);
    if (change === 'commit') { await store.create('Local note', ''); await store.commit('local commit'); }
    if (change === 'branch') await store.git(['checkout', '-b', 'local-branch']);
    if (change === 'remote') await store.git(['remote', 'set-url', 'origin', dir]);
    if (change === 'reopen') await store.open(dir);
    await assert.rejects(store.pull(token), /已变化/);
    assert.equal(await store.read(note.id), original);
    assert.equal(await store.git(['for-each-ref', '--format=%(refname)', 'refs/fever/pulls/']), '');
  });
}

test('switching libraries during a fetch never fetches or applies into the new library', async t => {
  const { store, scratch, dir, note } = await fixture(t);
  const gate = holdFetch(store); t.after(() => gate.release());
  const fetching = store.preparePull();
  // Attach the rejection handler before releasing the network gate.
  const rejected = assert.rejects(fetching, /笔记库已变化/);
  await gate.waiting;
  const other = path.join(scratch, 'other'); await fs.mkdir(other);
  await store.open(other);
  const otherNote = await store.create('Other library', '');
  gate.release(); await rejected;
  assert.equal(store.root, await fs.realpath(other));
  assert.equal(await store.read(otherNote.id), '# Other library\n\n');
  assert.ok(!store.manifest.notes.some(row => row.id === note.id));
  assert.equal(await store.git(['for-each-ref', '--format=%(refname)', 'refs/fever/pulls/'], false, dir), '');
});

test('canceling a fetched update releases its ref and leaves the workspace unchanged', async t => {
  const { store, note } = await fixture(t);
  const original = await store.read(note.id);
  const token = await store.preparePull();
  await store.cancelPull(token);
  assert.equal(await store.read(note.id), original);
  assert.equal(await store.git(['for-each-ref', '--format=%(refname)', 'refs/fever/pulls/']), '');
  await assert.rejects(store.pull(token), /请求已失效/);
});
