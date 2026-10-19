const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { ensureFolder } = require('../electron/manifest.mjs');
const { VaultStore } = require('../electron/vault.cjs');

function watchReads(t, delay = 0) {
 const original = fs.open, counts = { active: 0, peak: 0, files: 0 };
 fs.open = async (...args) => {
  counts.files++; counts.active++; counts.peak = Math.max(counts.peak, counts.active);
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  let handle;
  try { handle = await original(...args); } catch (e) { counts.active--; throw e; }
  const close = handle.close.bind(handle);
  handle.close = async () => { try { return await close(); } finally { counts.active--; } };
  return handle;
 };
 t.after(() => { fs.open = original; });
 return counts;
}

async function fixture(t) {
 const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-search-'));
 t.after(() => fs.rm(folder, { recursive: true, force: true }));
 const store = new VaultStore(); await store.open(folder);
 for (let i = 0; i < 24; i++) {
  store.manifest.notes.push({ id: `search-${i}`, filename: `search-${i}.md`, title: i === 1 ? 'Title Needle' : `笔记 ${i}`, folderId: ensureFolder(store.manifest, i === 2 ? 'Category Needle' : '测试'), createdAt: '', updatedAt: '' });
  await fs.writeFile(path.join(folder, 'notes', `search-${i}.md`), 'x'.repeat(65535) + (i === 3 ? 'NEEDLE 中文 ΩΣ\n' : `token-${i}\n`));
 }
 await store.persist(); return { store, folder };
}

test('search matches titles/categories/bodies in manifest order with bounded concurrent reads', async t => {
 const { store, folder } = await fixture(t);
 const counts = watchReads(t, 5);
 assert.deepEqual(await store.search('needle'), ['search-1', 'search-2', 'search-3']);
 assert.ok(counts.peak > 0 && counts.peak <= 4, `Expected at most four reads, saw ${counts.peak}`);
 assert.deepEqual(await store.search('中文 ως'), ['search-3']);
 await fs.unlink(path.join(folder, 'notes', 'search-4.md'));
 assert.deepEqual(await store.search('token-23'), ['search-23']);
 assert.deepEqual(await store.search('  '), []);
 await assert.rejects(store.search(null), /搜索内容无效/);
});

test('clearing or replacing a query aborts reads and stops scheduling old work', async t => {
 const { store } = await fixture(t);
 const counts = watchReads(t, 20);
 const obsolete = store.search('missing');
 while (counts.files < 4) await new Promise(resolve => setTimeout(resolve, 1));
 store.cancelSearch();
 assert.deepEqual(await obsolete, []);
 assert.equal(counts.files, 4);
 assert.equal(counts.active, 0);
 const first = store.search('token-3');
 const second = store.search('token-23');
 assert.deepEqual(await first, []);
 assert.deepEqual(await second, ['search-23']);
});

test('changing vaults cancels the previous search without leaking its results', async t => {
 const { store } = await fixture(t);
 const second = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-other-vault-'));
 t.after(() => fs.rm(second, { recursive: true, force: true }));
 watchReads(t, 25);
 const obsolete = store.search('token-23');
 await store.open(second);
 assert.deepEqual(await obsolete, []);
 assert.deepEqual(await store.search('token-23'), []);
});

test('repeated searches read only changed files and still detect external edits and deletions', async t => {
 const { store, folder } = await fixture(t);
 const counts = watchReads(t);
 assert.deepEqual(await store.search('needle'), ['search-1', 'search-2', 'search-3']);
 counts.files = 0;
 assert.deepEqual(await store.search('needle'), ['search-1', 'search-2', 'search-3']);
 assert.equal(counts.files, 0);
 await store.save('search-3', 'replaced'); counts.files = 0;
 assert.deepEqual(await store.search('needle'), ['search-1', 'search-2']);
 assert.equal(counts.files, 1);
 await fs.writeFile(path.join(folder, 'notes/search-4.md'), 'external needle'); counts.files = 0;
 assert.deepEqual(await store.search('needle'), ['search-1', 'search-2', 'search-4']);
 assert.equal(counts.files, 1);
 await fs.unlink(path.join(folder, 'notes/search-4.md'));
 assert.deepEqual(await store.search('needle'), ['search-1', 'search-2']);
});

test('typed image payload preserves byte offsets and rejects oversize before allocating a Buffer', async t => {
 const { store, folder } = await fixture(t);
 store.lfs = true;
 const note = store.snapshot().manifest.notes[0];
 const bytes = new Uint8Array([90, 1, 2, 3, 91]);
 const src = await store.image(bytes.subarray(1, 4), 'image.png', note.id);
 assert.deepEqual(await fs.readFile(path.join(folder, src.slice(3))), Buffer.from([1, 2, 3]));
 await assert.rejects(store.image(new Uint8Array(20 * 1024 * 1024 + 1), 'large.png', note.id), /最大 20 MB/);
 await assert.rejects(store.image({}, 'bad.png', note.id), /最大 20 MB/);
});
