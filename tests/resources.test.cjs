const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { readBounded } = require('../electron/files.cjs');
const { VaultStore } = require('../electron/vault.cjs');

async function fixture(t) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-resources-'));
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 const store = new VaultStore(); await store.open(root);
 return { store, root, note: store.manifest.notes[0] };
}

test('oversized imports, note reads and searches reject before reading file data', async t => {
 const { store, root, note } = await fixture(t);
 const file = path.join(root, 'notes', note.filename);
 await fs.truncate(file, 64 * 1024 * 1024);
 const open = fs.open; let reads = 0, closed = 0;
 fs.open = async (...args) => {
  const handle = await open(...args), read = handle.read.bind(handle), close = handle.close.bind(handle);
  handle.read = (...args) => { reads++; return read(...args); };
  handle.close = async () => { closed++; return close(); };
  return handle;
 };
 t.after(() => { fs.open = open; });
 await assert.rejects(store.importFile(file), /导入文件最大为 10 MB/);
 await assert.rejects(store.read(note.id), /笔记最大为 10 MB/);
 assert.deepEqual(await store.search('no-match'), []);
 assert.equal(reads, 0); assert.equal(closed, 3);
});

test('bounded reads cap bytes and close handles even if a file grows after stat or is aborted', async t => {
 const { root } = await fixture(t), file = path.join(root, 'growth.txt');
 await fs.writeFile(file, Buffer.alloc(4096));
 const open = fs.open; let requested = 0, closed = 0;
 fs.open = async (...args) => {
  const handle = await open(...args), read = handle.read.bind(handle), close = handle.close.bind(handle);
  handle.stat = async () => ({ size: 0, isFile: () => true });
  handle.read = (...args) => { requested += args[2]; return read(...args); };
  handle.close = async () => { closed++; return close(); };
  return handle;
 };
 t.after(() => { fs.open = open; });
 await assert.rejects(readBounded(file, { limit: 1024 }), /10 MB/);
 assert.equal(requested, 1025); assert.equal(closed, 1);
 const controller = new AbortController(); controller.abort();
 await assert.rejects(readBounded(file, { signal: controller.signal }), { name: 'AbortError' });
 assert.equal(closed, 1);
});

test('image batches roll back only their own new files and keep saved references', async t => {
 const { store, root, note } = await fixture(t); store.lfs = true;
 const existing = await store.image([1], 'existing.png', note.id);
 const first = await store.image([2], 'first.png', note.id, 'failed-batch');
 await assert.rejects(store.image([3], 'bad.txt', note.id, 'failed-batch'), /支持/);
 await store.completeImageImport('failed-batch', false);
 await assert.rejects(fs.access(path.join(root, first.slice(3))), { code: 'ENOENT' });
 assert.deepEqual(await fs.readFile(path.join(root, existing.slice(3))), Buffer.from([1]));
 const referenced = await store.image([4], 'keep.png', note.id, 'saved-batch');
 await store.save(note.id, `![saved](${referenced})`);
 await store.completeImageImport('saved-batch', false);
 assert.deepEqual(await fs.readFile(path.join(root, referenced.slice(3))), Buffer.from([4]));
 const draft = await store.image([5], 'draft.png', note.id, 'draft-batch');
 await store.completeImageImport('draft-batch', true);
 await fs.access(path.join(root, draft.slice(3)));
 assert.equal(store.imageImports.size, 0);
});

test('status coalesces simultaneous requests, reports HEAD and refreshes after mutations', async t => {
 const { store, note } = await fixture(t);
 const git = store.git.bind(store); let calls = 0;
 store.git = async (...args) => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return git(...args); };
 const results = await Promise.all([store.status(), store.status(), store.status()]);
 assert.equal(calls, 2);
 assert.equal(results[0], results[1]); assert.equal(results[1], results[2]);
 assert.equal(results[0].branch, 'main');
 await store.configure({ author: 'Test', email: 'test@example.com', remote: '' });
 await store.commit('initial');
 const committed = await store.status(); assert.match(committed.head, /^[a-f0-9]{40}$/);
 await store.save(note.id, 'modified');
 const dirty = await store.status(); assert.equal(dirty.head, committed.head);
 assert.ok(dirty.changes.some(change => change.path === `notes/${note.filename}`));
});

test('FSNotes body saves preserve metadata bytes and still reload external metadata edits', async t => {
 const { store, root, note } = await fixture(t);
 await fs.rm(path.join(root, 'fever.json'));
 const metadata = { version: 1, folders: [], notes: [{ id: note.id, name: 'FSNotes', fileExtension: 'md', trashed: false }] };
 const file = path.join(root, 'metadata.json'), text = JSON.stringify(metadata);
 await fs.writeFile(file, text); await store.open(root);
 store.persist = async () => { throw new Error('should not rewrite metadata on a body save'); };
 await store.save(note.id, 'body only');
 assert.equal(await fs.readFile(file, 'utf8'), text);
 metadata.notes[0].name = '外部标题'; await fs.writeFile(file, JSON.stringify(metadata));
 const result = await store.save(note.id, 'after external edit');
 assert.equal(result.vault.manifest.notes[0].title, '外部标题');
 assert.equal(await fs.readFile(file, 'utf8'), JSON.stringify(metadata));
});

test('large revision diffs stop within a bounded edit budget while small diffs retain line semantics', async () => {
 const { revisionRows } = await import('../src/diffRows.ts');
 const start = performance.now();
 assert.equal(revisionRows(Array.from({ length: 6000 }, (_,i) => `before ${i}`).join('\n'), Array.from({ length: 6000 }, (_,i) => `after ${i}`).join('\n')), null);
 assert.ok(performance.now() - start < 1500);
 assert.deepEqual(revisionRows('same\nold\n', 'same\nnew\n'), [{ text: ' same', style: 'diff-context' }, { text: '-old', style: 'diff-remove' }, { text: '+new', style: 'diff-add' }]);
});
