const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { VaultStore } = require('../electron/vault.cjs');

async function fixture(t, commit = true, autocrlf = false) {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-git-'));
 t.after(() => fs.rm(dir, { recursive: true, force: true }));
 const store = new VaultStore(); await store.open(dir);
 // Keep byte-level assertions independent of the host's Git line-ending defaults.
 await store.git(['config', '--local', 'core.autocrlf', String(autocrlf)]);
 await store.git(['config', '--local', 'core.eol', 'lf']);
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

test('bulk staging includes modifications, deletions, renames and new repository files without changing contents', async t => {
 const { store, dir, note, file } = await fixture(t);
 const oldPath = 'notes/中文 old [1].txt', newPath = 'notes/中文 new [1].txt', deletedPath = 'notes/deleted.txt';
 await fs.writeFile(path.join(dir, oldPath), 'rename text\n');
 await fs.writeFile(path.join(dir, deletedPath), 'delete text\n');
 await store.commit('bulk fixture');
 await store.save(note.id, 'first staged snapshot\n'); await store.stage(file);
 await store.save(note.id, 'latest working content\n');
 await store.git(['mv', '--', oldPath, newPath]);
 await fs.unlink(path.join(dir, deletedPath));
 await fs.writeFile(path.join(dir, 'repository [1].txt'), 'new repository file\n');
 await fs.writeFile(path.join(dir, '.gitignore'), 'ignored.txt\n');
 await fs.writeFile(path.join(dir, 'ignored.txt'), 'ignored content\n');
 await store.stageAll();
 const staged = (await store.status()).changes;
 assert.ok(staged.length >= 5);
 assert.ok(staged.every(change => change.staged && !change.unstaged));
 assert.ok(staged.some(change => change.path === newPath && change.originalPath === oldPath));
 assert.ok(staged.some(change => change.path === deletedPath));
 assert.ok(staged.some(change => change.path === 'repository [1].txt'));
 assert.ok(!staged.some(change => change.path === 'ignored.txt'));
 assert.equal(await store.git(['show', `:${file}`]), 'latest working content\n');
 await store.save(note.id, 'edit after staging\n');
 await store.unstageAll();
 assert.ok((await store.status()).changes.every(change => !change.staged));
 assert.equal(await store.read(note.id), 'edit after staging\n');
 assert.equal(await fs.readFile(path.join(dir, newPath), 'utf8'), 'rename text\n');
 assert.equal(await fs.readFile(path.join(dir, 'repository [1].txt'), 'utf8'), 'new repository file\n');
 await assert.rejects(fs.access(path.join(dir, oldPath)), { code: 'ENOENT' });
 await assert.rejects(fs.access(path.join(dir, deletedPath)), { code: 'ENOENT' });
 await store.unstageAll();
});

test('bulk unstaging before the first commit preserves all working files and can be repeated', async t => {
 const { store, dir, file } = await fixture(t, false);
 await fs.writeFile(path.join(dir, 'new [1].txt'), 'initial content\n');
 const original = await fs.readFile(path.join(dir, file), 'utf8');
 await store.stageAll();
 assert.ok((await store.status()).changes.every(change => change.staged && !change.unstaged));
 await store.unstageAll();
 assert.ok((await store.status()).changes.every(change => change.status === '??'));
 assert.equal(await fs.readFile(path.join(dir, file), 'utf8'), original);
 assert.equal(await fs.readFile(path.join(dir, 'new [1].txt'), 'utf8'), 'initial content\n');
 await store.unstageAll(); await store.stageAll(); await store.stageAll();
 await store.commit('initial bulk commit', true);
 await store.stageAll(); await store.unstageAll();
 assert.equal((await store.status()).changes.length, 0);
});

test('bulk staging validates every changed file before updating the index', async t => {
 const { store, dir, note, file } = await fixture(t);
 const outside = path.join(dir, '..', `${path.basename(dir)}-outside.txt`);
 await fs.writeFile(outside, 'untouched'); t.after(() => fs.rm(outside, { force: true }));
 await store.save(note.id, 'keep unstaged\n');
 await fs.symlink(outside, path.join(dir, 'notes/link.txt'));
 await assert.rejects(store.stageAll(), /符号链接/);
 assert.ok((await store.status()).changes.every(change => !change.staged));
 assert.equal(await store.read(note.id), 'keep unstaged\n');
 assert.equal(await fs.readFile(outside, 'utf8'), 'untouched');
 assert.ok((await store.status()).changes.some(change => change.path === file));
});

for (const autocrlf of [false, true]) {
test(`discard restores modified and deleted files, removes new notes and reloads the manifest (autocrlf=${autocrlf})`, async t => {
 const { store, dir, note, file } = await fixture(t, true, autocrlf);
 const original = await store.read(note.id), originalTitle = note.title;
 const restored = autocrlf ? original.replace(/\n/g, '\r\n') : original;
 await store.save(note.id, 'changed'); await store.stage(file); await store.discard(file);
 assert.equal(await store.read(note.id), restored);
 assert.ok(!(await store.status()).changes.some(c => c.path === file));
 await fs.unlink(path.join(dir, file));
 assert.match((await store.diff(file)).patch, /deleted file mode/);
 await store.discard(file); assert.equal(await store.read(note.id), restored);
 const added = await store.create('discard new note', 'test');
 await store.stage(`notes/${added.filename}`); await store.discard(`notes/${added.filename}`);
 assert.ok(!store.manifest.notes.some(n => n.id === added.id));
 await assert.rejects(fs.access(path.join(dir, 'notes', added.filename)), { code: 'ENOENT' });
 await store.update(note.id, 'new title', 'test'); await store.discard('fever.json');
 assert.equal(store.note(note.id).title, originalTitle);
 assert.equal((await store.status()).changes.length, 0);
});

test(`staged renames retain their source path and can be safely unstaged or discarded (autocrlf=${autocrlf})`, async t => {
 const { store, dir } = await fixture(t, true, autocrlf);
 const oldPath = 'notes/中文 old [1].txt', newPath = 'notes/中文 new [1].txt';
 const restored = autocrlf ? 'rename text\r\n' : 'rename text\n';
 await fs.writeFile(path.join(dir, oldPath), 'rename text\n'); await store.commit('add rename fixture');
 await store.git(['mv', '--', oldPath, newPath]);
 const change = (await store.status()).changes.find(c => c.path === newPath);
 assert.equal(change.originalPath, oldPath); assert.equal(change.staged, true);
 assert.match((await store.diff(newPath, true)).patch, /rename from/);
 await store.discard(newPath);
 assert.equal(await fs.readFile(path.join(dir, oldPath), 'utf8'), restored);
 await assert.rejects(fs.access(path.join(dir, newPath)), { code: 'ENOENT' });
 await store.git(['mv', '--', oldPath, newPath]); await store.unstage(newPath);
 assert.equal(await fs.readFile(path.join(dir, newPath), 'utf8'), restored);
 assert.ok((await store.status()).changes.every(c => !c.staged));
});
}

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

for (const autocrlf of [false, true]) {
test(`bulk discard restores working changes and renames while retaining staged-only files (autocrlf=${autocrlf})`, async t => {
 const { store, dir, note, file } = await fixture(t, true, autocrlf);
 const oldPath = 'notes/中文 old [1].txt', newPath = 'notes/中文 new [1].txt', deleted = 'notes/deleted.txt', kept = 'notes/keep [1].txt';
 for (const name of [oldPath, deleted, kept]) await fs.writeFile(path.join(dir, name), 'original\n');
 await store.commit('extra files');
 const original = await store.read(note.id), originalManifest = structuredClone(store.manifest);
 await fs.writeFile(path.join(dir, kept), 'staged only\n'); await store.stage(kept);
 await store.save(note.id, 'staged note\n'); await store.stage(file); await store.save(note.id, 'working note\n');
 await store.git(['mv', '--', oldPath, newPath]); await fs.appendFile(path.join(dir, newPath), 'working rename\n');
 await fs.unlink(path.join(dir, deleted));
 const added = await store.create('new staged note', 'temporary');
 const addedPath = `notes/${added.filename}`;
 await store.stage(addedPath); await store.save(added.id, 'modified after staging\n');
 const drawing = await store.create('new drawing', 'temporary', 'excalidraw');
 const special = 'notes/换行\n:(glob)* [1].txt';
 await fs.writeFile(path.join(dir, special), 'new file\n');
 await fs.writeFile(path.join(dir, 'images/new.png'), Buffer.from([0, 1, 2]));
 const paths = await store.discardAll();
 assert.ok(paths.includes(file)); assert.ok(paths.includes(oldPath)); assert.ok(paths.includes(newPath));
 assert.ok(!paths.includes(kept));
 assert.equal(await store.read(note.id), autocrlf ? original.replace(/\n/g, '\r\n') : original);
 for (const name of [oldPath, deleted]) assert.equal(await fs.readFile(path.join(dir, name), 'utf8'), autocrlf ? 'original\r\n' : 'original\n');
 for (const name of [newPath, addedPath, `drawings/${drawing.filename}`, special, 'images/new.png']) await assert.rejects(fs.access(path.join(dir, name)), { code: 'ENOENT' });
 assert.deepEqual(store.manifest, originalManifest);
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'fever.json'), 'utf8')), originalManifest);
 assert.equal(await fs.readFile(path.join(dir, kept), 'utf8'), 'staged only\n');
 assert.equal(await store.git(['show', `:${kept}`]), 'staged only\n');
 const remaining = (await store.status()).changes;
 assert.equal(remaining.length, 1); assert.equal(remaining[0].path, kept);
 assert.equal(remaining[0].staged, true); assert.equal(remaining[0].unstaged, false);
 assert.deepEqual(await store.discardAll(), []);
});
}

test('bulk discard uses one status scan and batches many long literal paths', async t => {
 const { store, dir } = await fixture(t);
 const files = Array.from({ length: 200 }, (_, index) => `notes/${String(index).padStart(3, '0')}-${'long-name-'.repeat(16)} [中文].txt`);
 for (const file of files) await fs.writeFile(path.join(dir, file), 'original\n');
 await store.commit('many files');
 for (const file of files) await fs.writeFile(path.join(dir, file), 'modified\n');
 const git = store.git.bind(store), calls = [];
 store.git = async (...args) => { calls.push(args[0]); return git(...args); };
 assert.equal((await store.discardAll()).length, files.length);
 assert.equal(calls.filter(args => args[0] === 'status').length, 1);
 assert.ok(calls.length <= 8, `expected batched Git commands, got ${calls.length}`);
 assert.ok(calls.filter(args => args[0] === 'restore').length > 1, 'long paths should be split into bounded commands');
 for (const file of files) assert.equal(await fs.readFile(path.join(dir, file), 'utf8'), 'original\n');
 assert.equal((await store.status()).changes.length, 0);
});

test('bulk discard validates protected trash and symlinks before restoring any files', async t => {
 const { store, dir, note, file } = await fixture(t);
 await store.save(note.id, 'keep working edit');
 const added = await store.create('trashed new note', ''); await store.remove(added.id);
 await assert.rejects(store.discardAll(), /回收站.*只读/);
 assert.equal(await store.read(note.id), 'keep working edit');
 assert.equal(await store.read(added.id, 'trash'), '# trashed new note\n\n');
 await store.restoreTrash(added.id);
 const outside = path.join(dir, 'outside.txt'); await fs.writeFile(outside, 'outside content');
 await fs.symlink(outside, path.join(dir, 'notes/link.txt'));
 await assert.rejects(store.discardAll(), /符号链接/);
 assert.equal(await fs.readFile(path.join(dir, file), 'utf8'), 'keep working edit');
 await fs.access(path.join(dir, 'notes', added.filename));
 assert.equal(await fs.readFile(outside, 'utf8'), 'outside content');
});

test('bulk discard rejects an unborn or invalid HEAD manifest before changing files', async t => {
 const { store, dir, note, file } = await fixture(t, false);
 await store.save(note.id, 'keep before initial commit');
 await assert.rejects(store.discardAll(), /初始笔记库/);
 assert.equal(await store.read(note.id), 'keep before initial commit');
 const manifest = await fs.readFile(path.join(dir, 'fever.json'), 'utf8');
 await fs.writeFile(path.join(dir, 'fever.json'), '{broken');
 await store.git(['add', '-A']); await store.git(['commit', '-m', 'invalid manifest fixture']);
 await fs.writeFile(path.join(dir, 'fever.json'), manifest);
 await store.save(note.id, 'keep with invalid HEAD'); await store.stage(file);
 await store.save(note.id, 'working with invalid HEAD');
 await assert.rejects(store.discardAll(), /JSON/);
 assert.equal(await store.read(note.id), 'working with invalid HEAD');
 assert.equal(await store.git(['show', `:${file}`]), 'keep with invalid HEAD');
});

test('bulk discard removes new note records when the manifest is staged-only', async t => {
 const { store, dir } = await fixture(t);
 const added = await store.create('new note', ''); await store.stage('fever.json');
 await store.discardAll();
 assert.ok(!store.manifest.notes.some(note => note.id === added.id));
 const persisted = JSON.parse(await fs.readFile(path.join(dir, 'fever.json'), 'utf8'));
 assert.ok(!persisted.notes.some(note => note.id === added.id));
 await assert.rejects(fs.access(path.join(dir, 'notes', added.filename)), { code: 'ENOENT' });
 assert.ok(JSON.parse(await store.git(['show', ':fever.json'])).notes.some(note => note.id === added.id));
});

test('bulk discard rejects merge conflicts before restoring unrelated files', async t => {
 const { store, dir, note } = await fixture(t);
 const conflict = path.join(dir, 'notes/conflict.txt');
 await fs.writeFile(conflict, 'base\n'); await store.commit('base');
 await store.git(['checkout', '-b', 'conflicting-side']);
 await fs.writeFile(conflict, 'side\n'); await store.commit('side');
 await store.git(['checkout', 'main']);
 await fs.writeFile(conflict, 'main\n'); await store.commit('main');
 await store.git(['merge', 'conflicting-side'], true);
 await store.save(note.id, 'keep unrelated work');
 const before = await fs.readFile(conflict, 'utf8');
 assert.match(before, /<<<<<<< HEAD/);
 await assert.rejects(store.discardAll(), /合并冲突/);
 assert.equal(await fs.readFile(conflict, 'utf8'), before);
 assert.equal(await store.read(note.id), 'keep unrelated work');
 assert.ok((await store.git(['ls-files', '-u'])).trim());
});

test('bulk discard persists removed note records if a later deletion fails', async t => {
 const { store, dir } = await fixture(t);
 await store.create('first new note', ''); await store.create('second new note', '');
 const paths = (await store.status()).changes.filter(change => change.path.startsWith('notes/')).map(change => change.path);
 const remove = fs.rm;
 t.mock.method(fs, 'rm', async (file, options) => {
  if (file === path.join(store.root, paths[1])) throw new Error('injected deletion failure');
  return remove(file, options);
 });
 await assert.rejects(store.discardAll(), /injected deletion failure/);
 await assert.rejects(fs.access(path.join(dir, paths[0])), { code: 'ENOENT' });
 await fs.access(path.join(dir, paths[1]));
 const persisted = JSON.parse(await fs.readFile(path.join(dir, 'fever.json'), 'utf8'));
 for (const manifest of [store.manifest, persisted]) {
  assert.ok(!manifest.notes.some(note => `notes/${note.filename}` === paths[0]));
  assert.ok(manifest.notes.some(note => `notes/${note.filename}` === paths[1]));
 }
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
