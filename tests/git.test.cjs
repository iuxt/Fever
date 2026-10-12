const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { VaultStore } = require('../electron/vault.cjs');

async function fixture(t, commit = true) {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-git-'));
 t.after(() => fs.rm(dir, { recursive: true, force: true }));
 const store = new VaultStore(); await store.open(dir);
 await store.configure({ author: 'Git Test', email: 'git@example.com', remote: '' });
 const note = store.manifest.notes[0], file = `notes/${note.filename}`;
 if (commit) await store.commit('initial');
 return { store, dir, note, file };
}

test('diff and selected commits retain the staged snapshot and other working changes', async t => {
 const { store, note, file } = await fixture(t);
 await store.save(note.id, 'staged version\n');
 assert.match((await store.diff(file)).patch, /\+staged version/);
 await store.stage(file);
 await store.save(note.id, 'working version\n');
 const change = (await store.status()).changes.find(c => c.path === file);
 assert.equal(change.staged, true); assert.equal(change.unstaged, true);
 assert.match((await store.diff(file, true)).patch, /\+staged version/);
 assert.match((await store.diff(file)).patch, /-staged version\n\+working version/);
 await store.commit('selected only', true);
 assert.equal(await store.git(['show', `HEAD:${file}`]), 'staged version\n');
 assert.equal(await store.read(note.id), 'working version\n');
 assert.equal((await store.status()).changes.find(c => c.path === file).staged, false);
 assert.ok((await store.status()).changes.some(c => c.path === 'fever.json'));
});

test('unstage works before the first commit and preserves untracked file contents', async t => {
 const { store, dir, file } = await fixture(t, false);
 const nested = 'notes/nested/中文 [1].md';
 await fs.mkdir(path.join(dir, 'notes/nested')); await fs.writeFile(path.join(dir, nested), 'new text');
 assert.ok((await store.status()).changes.some(c => c.path === nested));
 assert.match((await store.diff(nested)).patch, /\+new text/);
 await store.stage(nested); await store.unstage(nested);
 assert.equal(await fs.readFile(path.join(dir, nested), 'utf8'), 'new text');
 assert.equal((await store.status()).changes.find(c => c.path === nested).status, '??');
 await store.stage(file); await store.unstage(file);
 await assert.rejects(store.discard('fever.json'), /初始笔记库/);
});

test('discard restores modified and deleted files, removes new notes and reloads the manifest', async t => {
 const { store, dir, note, file } = await fixture(t);
 const original = await store.read(note.id), originalTitle = note.title;
 await store.save(note.id, 'changed'); await store.stage(file); await store.discard(file);
 assert.equal(await store.read(note.id), original);
 assert.ok(!(await store.status()).changes.some(c => c.path === file));
 await fs.unlink(path.join(dir, file));
 assert.match((await store.diff(file)).patch, /deleted file mode/);
 await store.discard(file); assert.equal(await store.read(note.id), original);
 const added = await store.create('discard new note', 'test');
 await store.stage(`notes/${added.filename}`); await store.discard(`notes/${added.filename}`);
 assert.ok(!store.manifest.notes.some(n => n.id === added.id));
 await assert.rejects(fs.access(path.join(dir, 'notes', added.filename)), { code: 'ENOENT' });
 await store.update(note.id, 'new title', 'test'); await store.discard('fever.json');
 assert.equal(store.note(note.id).title, originalTitle);
 assert.equal((await store.status()).changes.length, 0);
});

test('staged renames retain their source path and can be safely unstaged or discarded', async t => {
 const { store, dir } = await fixture(t);
 const oldPath = 'notes/中文 old [1].txt', newPath = 'notes/中文 new [1].txt';
 await fs.writeFile(path.join(dir, oldPath), 'rename text\n'); await store.commit('add rename fixture');
 await store.git(['mv', '--', oldPath, newPath]);
 const change = (await store.status()).changes.find(c => c.path === newPath);
 assert.equal(change.originalPath, oldPath); assert.equal(change.staged, true);
 assert.match((await store.diff(newPath, true)).patch, /rename from/);
 await store.discard(newPath);
 assert.equal(await fs.readFile(path.join(dir, oldPath), 'utf8'), 'rename text\n');
 await assert.rejects(fs.access(path.join(dir, newPath)), { code: 'ENOENT' });
 await store.git(['mv', '--', oldPath, newPath]); await store.unstage(newPath);
 assert.equal(await fs.readFile(path.join(dir, newPath), 'utf8'), 'rename text\n');
 assert.ok((await store.status()).changes.every(c => !c.staged));
});

test('file operations reject traversal, Git internals and symlink escapes; binary diffs stay readable', async t => {
 const { store, dir } = await fixture(t);
 const outside = path.join(os.tmpdir(), `fever-git-outside-${Date.now()}.txt`);
 await fs.writeFile(outside, 'untouched'); t.after(() => fs.rm(outside, { force: true }));
 await fs.symlink(outside, path.join(dir, 'notes/link.txt'));
 for (const method of ['diff', 'stage', 'unstage', 'discard', 'changeFile', 'openFile', 'saveFile']) {
  await assert.rejects(store[method]('../outside.txt', 'text'), /路径无效/);
  await assert.rejects(store[method]('.git/config', 'text'), /路径无效/);
  await assert.rejects(store[method]('notes/link.txt', 'text'), /符号链接/);
 }
 await fs.writeFile(path.join(dir, 'images/new.png'), Buffer.from([0, 1, 2]));
 assert.match((await store.diff('images/new.png')).patch, /二进制/);
 assert.equal(await fs.readFile(outside, 'utf8'), 'untouched');
});

test('the file editor reads and saves text, validates manifests and keeps cached notes in sync', async t => {
 const { store, dir, note, file } = await fixture(t);
 assert.equal((await store.openFile(file)).content, await store.read(note.id));
 await store.saveFile(file, '# edited note');
 assert.equal(await store.read(note.id), '# edited note');
 const manifest = JSON.parse((await store.openFile('fever.json')).content);
 manifest.notes[0].title = 'renamed in JSON'; manifest.categories.push('editor category');
 await store.saveFile('fever.json', JSON.stringify(manifest));
 assert.equal(store.note(note.id).title, 'renamed in JSON');
 assert.ok(store.snapshot().manifest.categories.includes('editor category'));
 const saved = await fs.readFile(path.join(dir, 'fever.json'), 'utf8');
 await assert.rejects(store.saveFile('fever.json', '{broken'), /JSON/);
 await assert.rejects(store.saveFile('fever.json', JSON.stringify({ ...manifest, notes: [manifest.notes[0], manifest.notes[0]] })), /无效或重复/);
 assert.equal(await fs.readFile(path.join(dir, 'fever.json'), 'utf8'), saved);
 await fs.writeFile(path.join(dir, '.gitattributes'), '# text file\n');
 await store.saveFile('.gitattributes', '# editor update\n');
 assert.equal((await store.openFile('.gitattributes')).content, '# editor update\n');
});

test('the file editor previews images and rejects text saves of binary files', async t => {
 const { store, dir } = await fixture(t);
 const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N3IAAAAASUVORK5CYII=', 'base64');
 await fs.writeFile(path.join(dir, 'images/pixel.png'), image);
 const preview = await store.openFile('images/pixel.png');
 assert.equal(preview.binary, true); assert.equal(preview.content, '');
 assert.equal(preview.image, `data:image/png;base64,${image.toString('base64')}`);
 await assert.rejects(store.saveFile('images/pixel.png', 'oops'), /二进制/);
 assert.deepEqual(await fs.readFile(path.join(dir, 'images/pixel.png')), image);
 await fs.writeFile(path.join(dir, 'notes/binary.txt'), Buffer.from([0xff, 0xfe, 0x41]));
 assert.equal((await store.openFile('notes/binary.txt')).binary, true);
 await assert.rejects(store.saveFile('notes/binary.txt', 'oops'), /二进制/);
});
