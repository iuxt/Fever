const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { VaultStore } = require('../electron/vault.cjs');

async function fixture(t) {
  const selected = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-optimization-'));
  const store = new VaultStore(); await store.open(selected);
  const root = store.root;
  t.after(async () => { clearTimeout(store.metadataTimer); await fs.rm(root, { recursive: true, force: true }); });
  return { root, store, note: store.manifest.notes[0] };
}

test('list previews read only a UTF-8 prefix and cap concurrent reads, including cancellations', async t => {
  const { root, store, note } = await fixture(t);
  const file = path.join(root, 'notes', note.filename);
  await fs.writeFile(file, '😀中文'.repeat(200000));
  const open = fs.open; let active = 0, peak = 0, bytes = 0, closed = 0;
  fs.open = async (...args) => {
    const handle = await open(...args);
    if (args[0] !== file) return handle;
    const read = handle.read.bind(handle), close = handle.close.bind(handle);
    handle.read = async (...args) => {
      ++active; peak = Math.max(peak, active);
      try { await new Promise(resolve => setTimeout(resolve, 15)); const result = await read(...args); bytes += result.bytesRead; return result; }
      finally { --active; }
    };
    handle.close = async () => { ++closed; return close(); };
    return handle;
  };
  t.after(() => { fs.open = open; });
  const requests = Array.from({ length: 16 }, (_, i) => store.preview(note.id, `preview-${i}`).then(value => ({ value }), error => ({ error })));
  while (!active) await new Promise(resolve => setTimeout(resolve, 1));
  store.cancelPreview('preview-0'); store.cancelPreview('preview-15');
  const results = await Promise.all(requests);
  assert.equal(results[0].error.name, 'AbortError'); assert.match(results[15].error.message, /取消/);
  for (const result of results.slice(1, -1)) {
    assert.equal(result.value.length, 8192); assert.ok(!result.value.includes('\ufffd'));
  }
  assert.ok(peak >= 2 && peak <= 4); assert.ok(bytes > 0 && bytes <= 15 * 32768); assert.equal(closed, 15);
  assert.equal(store.previewRequests.size, 0); assert.equal(store.previewQueue.length, 0);
});

test('autosaves append small metadata records and one flush writes the complete manifest', async t => {
  const { root, store, note } = await fixture(t);
  store.manifest.notes = Array.from({ length: 2000 }, (_, i) => ({ ...note, id: i ? `note-${i}` : note.id, filename: i ? `note-${i}.md` : note.filename, updatedAt: '2000-01-01T00:00:00.000Z' }));
  await store.persist();
  const write = fs.writeFile, writes = [];
  fs.writeFile = async (file, value, ...args) => { writes.push({ file, bytes: Buffer.byteLength(value) }); return write(file, value, ...args); };
  t.after(() => { fs.writeFile = write; });
  for (let i = 0; i < 3; ++i) await store.save(note.id, `短笔记 ${i}`);
  assert.equal(writes.filter(write => path.basename(write.file).startsWith('.fever-')).length, 0);
  assert.ok((await fs.stat(store.metadata.file)).size < 2000);
  const pending = await store.status(true);
  assert.ok(pending.changes.some(change => change.path === 'fever.json' && change.unstaged && !change.unstagedWhitespaceOnly));
  await store.flushMetadata();
  assert.equal(writes.filter(write => path.basename(write.file).startsWith('.fever-')).length, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'fever.json'), 'utf8')), store.manifest);
  assert.equal(await fs.readFile(store.metadata.file, 'utf8'), '');
});

test('reopening recovers timestamps after a process interruption and ignores an unfinished last append', async t => {
  const { root, store, note } = await fixture(t);
  await store.save(note.id, 'first draft'); await store.save(note.id, 'latest draft');
  clearTimeout(store.metadataTimer);
  const updatedAt = store.note(note.id).updatedAt;
  await fs.appendFile(store.metadata.file, '{"id":');
  const reopened = new VaultStore(); await reopened.open(root);
  assert.equal(await reopened.read(note.id), 'latest draft'); assert.equal(reopened.note(note.id).updatedAt, updatedAt);
  assert.equal(await fs.readFile(reopened.metadata.file, 'utf8'), '');
});

test('metadata recovery does not overwrite timestamps from an externally replaced manifest', async t => {
  const { root, store, note } = await fixture(t);
  await store.save(note.id, 'draft'); clearTimeout(store.metadataTimer);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'fever.json'), 'utf8'));
  manifest.notes[0].updatedAt = '2040-01-01T00:00:00.000Z';
  await fs.writeFile(path.join(root, 'fever.json'), JSON.stringify(manifest));
  const reopened = new VaultStore(); await reopened.open(root);
  assert.equal(reopened.note(note.id).updatedAt, manifest.notes[0].updatedAt);
});

test('failed metadata flush keeps the recovery log and partial appends can be retried', async t => {
  const { root, store, note } = await fixture(t);
  const append = fs.appendFile;
  t.after(() => { fs.appendFile = append; });
  fs.appendFile = async (file, text, ...args) => { await append(file, text.slice(0, 12), ...args); throw new Error('disk full'); };
  await assert.rejects(store.save(note.id, 'retry me'), /disk full/);
  fs.appendFile = append;
  await store.save(note.id, 'retry succeeded'); clearTimeout(store.metadataTimer);
  const updatedAt = store.note(note.id).updatedAt;
  store.persist = async () => { throw new Error('manifest write failed'); };
  await assert.rejects(store.flushMetadata(), /manifest write failed/);
  assert.ok((await fs.stat(store.metadata.file)).size > 0);
  const reopened = new VaultStore(); await reopened.open(root);
  assert.equal(await reopened.read(note.id), 'retry succeeded'); assert.equal(reopened.note(note.id).updatedAt, updatedAt);
});

test('Git staging and switching libraries flush metadata before accessing another snapshot', async t => {
  const { root, store, note } = await fixture(t);
  await store.configure({ author: 'Test', email: 'test@example.com', remote: '' });
  const saved = await store.save(note.id, 'committed draft');
  await store.stage('fever.json');
  const indexed = JSON.parse(await store.git(['show', ':fever.json']));
  assert.equal(indexed.notes.find(n => n.id === note.id).updatedAt, saved.updatedAt);
  const latest = await store.save(note.id, 'before switching');
  const other = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-other-'));
  t.after(() => fs.rm(other, { recursive: true, force: true }));
  await store.open(other);
  const persisted = JSON.parse(await fs.readFile(path.join(root, 'fever.json'), 'utf8'));
  assert.equal(persisted.notes.find(n => n.id === note.id).updatedAt, latest.updatedAt);
});

test('a failed journal cleanup cannot roll back a successfully persisted tree change', async t => {
  const { root, store, note } = await fixture(t);
  await store.save(note.id, 'draft');
  const write = fs.writeFile; let errors = 0;
  store.onMetadataError = () => { ++errors; };
  fs.writeFile = async (file, ...args) => { if (file === store.metadata.file) throw new Error('journal locked'); return write(file, ...args); };
  t.after(() => { fs.writeFile = write; });
  await store.update(note.id, 'renamed', '项目');
  assert.ok(errors > 0);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'fever.json'), 'utf8')), store.manifest);
  fs.writeFile = write;
  await store.flushMetadata();
  assert.equal(store.metadata.dirty, false);
});
