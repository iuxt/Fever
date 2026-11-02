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
  await assert.rejects(store.pull(token), /提交本地变更/);
  assert.equal(await store.read(note.id), '# Edited while offline\n');
  assert.equal(await store.git(['for-each-ref', '--format=%(refname)', 'refs/fever/pulls/']), '');
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
