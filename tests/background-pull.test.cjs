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
  return { scratch, dir, store, note };
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
