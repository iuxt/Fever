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

test('diff filters whitespace and blank lines while preserving raw staged and working snapshots', async t => {
 const { store, dir, file } = await fixture(t);
 const original = '# Title\nalpha beta\nsecond line\n';
 const stagedContent = '#  Title  \nalpha  beta\n\n\t\nsecond line\n';
 await fs.writeFile(path.join(dir, file), original); await store.commit('whitespace baseline');
 await fs.writeFile(path.join(dir, file), stagedContent);
 const working = await store.diff(file);
 assert.match(working.patch, /\+alpha  beta/);
 assert.equal(working.whitespaceIgnoredPatch, '已忽略空格和空行变化，没有其他文本差异。');
 assert.equal(await fs.readFile(path.join(dir, file), 'utf8'), stagedContent);
 assert.equal((await store.status()).changes.find(change => change.path === file).unstaged, true);
 await store.stage(file);
 assert.equal((await store.diff(file, true)).whitespaceIgnoredPatch, working.whitespaceIgnoredPatch);
 assert.match((await store.diff(file, true)).patch, /\+alpha  beta/);
 const workingContent = stagedContent.replace('second line', 'actual content');
 await fs.writeFile(path.join(dir, file), workingContent);
 const mixed = await store.diff(file);
 assert.match(mixed.whitespaceIgnoredPatch, /-second line\n\+actual content/);
 assert.equal((await store.diff(file, true)).whitespaceIgnoredPatch, working.whitespaceIgnoredPatch);
 await store.commit('keep exact staged whitespace', true);
 assert.equal(await store.git(['show', `HEAD:${file}`]), stagedContent);
 assert.equal(await fs.readFile(path.join(dir, file), 'utf8'), workingContent);
});

test('filtered diff retains real edits and their line numbers alongside whitespace changes', async t => {
 const { store, dir, file } = await fixture(t);
 const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
 await fs.writeFile(path.join(dir, file), lines.join('\n') + '\n'); await store.commit('mixed baseline');
 lines[0] = 'line   1  ';
 lines[29] = 'meaningful edit';
 await fs.writeFile(path.join(dir, file), '\n' + lines.join('\n') + '\n');
 const diff = await store.diff(file);
 assert.match(diff.patch, /\+line   1  /);
 assert.doesNotMatch(diff.whitespaceIgnoredPatch, /\+line   1  /);
 assert.match(diff.whitespaceIgnoredPatch, /@@ -27,4 \+28,4 @@/);
 assert.match(diff.whitespaceIgnoredPatch, /-line 30\n\+meaningful edit/);
});

test('filtered diff keeps blank file additions, deletions and mode changes visible', async t => {
 const { store, dir } = await fixture(t);
 const file = 'notes/blank [1].txt';
 await fs.writeFile(path.join(dir, file), '\n \n');
 assert.match((await store.diff(file)).patch, /--- \/dev\/null/);
 await store.stage(file);
 assert.match((await store.diff(file, true)).whitespaceIgnoredPatch, /new file mode/);
 await store.commit('blank file');
 await store.git(['update-index', '--chmod=+x', '--', file]);
 assert.match((await store.diff(file, true)).whitespaceIgnoredPatch, /new mode 100755/);
 await store.unstage(file);
 await fs.unlink(path.join(dir, file));
 assert.match((await store.diff(file)).whitespaceIgnoredPatch, /deleted file mode/);
});

test('status identifies whitespace-only changes separately for the index and working tree in batches', async t => {
 const { store, dir } = await fixture(t);
 const stagedBlank = 'notes/暂存 [1].txt', workingBlank = 'notes/工作区 [2].txt';
 const binary = 'images/changed.bin', renamed = 'notes/renamed.txt', mode = 'notes/mode.txt';
 for (const file of [stagedBlank, workingBlank, renamed, mode]) await fs.writeFile(path.join(dir, file), 'alpha beta\n');
 await fs.writeFile(path.join(dir, binary), Buffer.from([0, 1, 2]));
 await store.commit('filter fixtures');
 await fs.writeFile(path.join(dir, stagedBlank), 'alpha  beta\n\n \n'); await store.stage(stagedBlank);
 await fs.writeFile(path.join(dir, stagedBlank), 'actual edit\n');
 await fs.writeFile(path.join(dir, workingBlank), 'actual edit\n'); await store.stage(workingBlank);
 await fs.writeFile(path.join(dir, workingBlank), '\tactual  edit  \n\n');
 await fs.writeFile(path.join(dir, binary), Buffer.from([0, 2, 3]));
 await store.git(['mv', '--', renamed, 'notes/new name.txt']);
 await store.git(['update-index', '--chmod=+x', '--', mode]);
 await fs.writeFile(path.join(dir, 'notes/new blank.txt'), '\n \n');
 const git = store.git.bind(store), calls = [];
 store.git = async (...args) => { calls.push(args[0]); return git(...args); };
 const status = await store.status(true), changes = new Map(status.changes.map(change => [change.path, change]));
 assert.equal(calls.filter(args => args[0] === 'diff').length, 2);
 assert.equal(changes.get(stagedBlank).stagedWhitespaceOnly, true);
 assert.equal(changes.get(stagedBlank).unstagedWhitespaceOnly, undefined);
 assert.equal(changes.get(workingBlank).stagedWhitespaceOnly, undefined);
 assert.equal(changes.get(workingBlank).unstagedWhitespaceOnly, true);
 for (const file of [binary, 'notes/new name.txt', mode, 'notes/new blank.txt']) {
  assert.ok(changes.has(file));
  assert.equal(changes.get(file).stagedWhitespaceOnly, undefined);
  assert.equal(changes.get(file).unstagedWhitespaceOnly, undefined);
 }
 const raw = await store.status();
 assert.ok(raw.changes.every(change => !change.stagedWhitespaceOnly && !change.unstagedWhitespaceOnly));
 assert.equal(raw.changes.length, status.changes.length);
 // Content can become meaningful while the porcelain status remains M.
 await fs.writeFile(path.join(dir, workingBlank), 'another actual edit\n');
 assert.equal((await store.status(true)).changes.find(change => change.path === workingBlank).unstagedWhitespaceOnly, undefined);
 assert.equal(await store.git(['show', `:${stagedBlank}`]), 'alpha  beta\n\n \n');
});

test('filtered commit restores whole whitespace-only files including CRLF and final newlines without creating an empty commit', async t => {
 const { store, dir } = await fixture(t);
 const files = ['notes/中文 [1].txt', 'notes/crlf.txt', 'notes/no-final-newline.txt'];
 if (process.platform !== 'win32') files.push('notes/换行\n:(glob)*.txt');
 for (const file of files) await fs.writeFile(path.join(dir, file), 'alpha beta\nsecond line\n');
 await store.commit('whitespace fixtures');
 const head = await store.git(['rev-parse', 'HEAD']);
 for (const [index, file] of files.entries()) await fs.writeFile(path.join(dir, file), index === 1 ? 'alpha beta\r\nsecond line\r\n' : index === 2 ? 'alpha beta\nsecond line' : '\nalpha  beta  \n\t\nsecond line\n\n');
 const result = await store.commit('ignore whitespace', false, true);
 assert.equal(result.committed, false);
 assert.deepEqual(new Set(result.restoredPaths), new Set(files));
 assert.equal(await store.git(['rev-parse', 'HEAD']), head);
 for (const file of files) {
  assert.equal(await fs.readFile(path.join(dir, file), 'utf8'), 'alpha beta\nsecond line\n');
  assert.equal(await store.git(['show', `:${file}`]), 'alpha beta\nsecond line\n');
 }
 assert.equal((await store.status()).changes.length, 0);
});

test('filtered staged commit removes whitespace on either side and preserves meaningful staged and working snapshots', async t => {
 const { store, dir } = await fixture(t);
 const unstagedReal = 'notes/working.txt', stagedReal = 'notes/staged.txt';
 for (const file of [unstagedReal, stagedReal]) await fs.writeFile(path.join(dir, file), 'base text\n');
 await store.commit('separate snapshots');
 await fs.writeFile(path.join(dir, unstagedReal), 'base  text  \n\n'); await store.stage(unstagedReal);
 await fs.writeFile(path.join(dir, unstagedReal), 'keep actual working edit\n');
 await fs.writeFile(path.join(dir, stagedReal), 'keep actual staged edit\n'); await store.stage(stagedReal);
 await fs.writeFile(path.join(dir, stagedReal), 'keep  actual staged edit  \n\n');
 const result = await store.commit('selected real edit', true, true);
 assert.equal(result.committed, true);
 assert.deepEqual(new Set(result.restoredPaths), new Set([unstagedReal, stagedReal]));
 assert.equal(await store.git(['show', `HEAD:${unstagedReal}`]), 'base text\n');
 assert.equal(await fs.readFile(path.join(dir, unstagedReal), 'utf8'), 'keep actual working edit\n');
 assert.equal(await store.git(['show', `HEAD:${stagedReal}`]), 'keep actual staged edit\n');
 assert.equal(await fs.readFile(path.join(dir, stagedReal), 'utf8'), 'keep actual staged edit\n');
 const remaining = (await store.status()).changes;
 assert.equal(remaining.length, 1); assert.equal(remaining[0].path, unstagedReal);
 assert.equal(remaining[0].staged, false); assert.equal(remaining[0].unstaged, true);
});

test('a whitespace-only staged selection is reset without committing later real working edits', async t => {
 const { store, dir, file } = await fixture(t);
 const original = await fs.readFile(path.join(dir, file), 'utf8');
 const head = await store.git(['rev-parse', 'HEAD']);
 await fs.writeFile(path.join(dir, file), original + '\n \n'); await store.stage(file);
 await fs.writeFile(path.join(dir, file), 'later real edit\n');
 assert.deepEqual(await store.commit('blank selection', true, true), { committed: false, restoredPaths: [file], changes: [] });
 assert.equal(await store.git(['rev-parse', 'HEAD']), head);
 assert.equal(await store.git(['show', `:${file}`]), original);
 assert.equal(await fs.readFile(path.join(dir, file), 'utf8'), 'later real edit\n');
});

test('filtered full commits keep mixed content changes and file lifecycle changes intact', async t => {
 const { store, dir } = await fixture(t);
 const blank = 'notes/blank.txt', mixed = 'notes/mixed.txt', deleted = 'notes/deleted.txt', renamed = 'notes/old.txt';
 for (const file of [blank, mixed, deleted, renamed]) await fs.writeFile(path.join(dir, file), 'base text\n');
 await store.commit('content and lifecycle fixtures');
 await fs.writeFile(path.join(dir, blank), '\nbase  text\n\n');
 const content = '\nbase  text\n\nactual addition  \n';
 await fs.writeFile(path.join(dir, mixed), content);
 await fs.unlink(path.join(dir, deleted));
 await store.git(['mv', '--', renamed, 'notes/new.txt']);
 await fs.writeFile(path.join(dir, 'notes/new blank.txt'), '\n \n');
 const result = await store.commit('keep substantive changes', false, true);
 assert.equal(result.committed, true); assert.deepEqual(result.restoredPaths, [blank]);
 assert.equal(await fs.readFile(path.join(dir, blank), 'utf8'), 'base text\n');
 assert.equal(await store.git(['show', `HEAD:${mixed}`]), content);
 assert.equal(await store.git(['show', 'HEAD:notes/new blank.txt']), '\n \n');
 assert.equal(await store.git(['show', 'HEAD:notes/new.txt']), 'base text\n');
 assert.equal(await store.git(['ls-tree', '--name-only', 'HEAD', '--', deleted, renamed]), '');
 assert.equal((await store.status()).changes.length, 0);
});

test('disabling the commit filter retains whitespace-only changes exactly', async t => {
 const { store, dir, file } = await fixture(t);
 const original = await fs.readFile(path.join(dir, file), 'utf8'), content = original + '\n \n';
 await fs.writeFile(path.join(dir, file), content);
 const result = await store.commit('keep whitespace', false, false);
 assert.equal(result.committed, true);
 assert.deepEqual(result.restoredPaths, []);
 assert.deepEqual(result.changes, [{ status: 'M', path: file }]);
 assert.match(result.hash, /^[0-9a-f]{40,64}$/);
 assert.equal(await store.git(['show', `HEAD:${file}`]), content);
 assert.equal(await fs.readFile(path.join(dir, file), 'utf8'), content);
});

test('whitespace restoration validates every path before touching earlier files', async t => {
 const { store, dir, file } = await fixture(t);
 await fs.symlink('target', path.join(dir, 'notes/link.txt')); await store.commit('link fixture');
 const original = await fs.readFile(path.join(dir, file), 'utf8');
 await fs.writeFile(path.join(dir, file), original + '\n \n');
 await fs.unlink(path.join(dir, 'notes/link.txt')); await fs.symlink('target ', path.join(dir, 'notes/link.txt'));
 await assert.rejects(store.commit('invalid restoration', false, true), /符号链接/);
 assert.equal(await fs.readFile(path.join(dir, file), 'utf8'), original + '\n \n');
 assert.equal(await fs.readlink(path.join(dir, 'notes/link.txt')), 'target ');
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
 const specialPaths = ['notes/中文 (glob) [1].txt'];
 // Windows forbids control characters, colons and asterisks in filenames.
 if (process.platform !== 'win32') specialPaths.push('notes/换行\n:(glob)* [1].txt');
 for (const name of specialPaths) await fs.writeFile(path.join(dir, name), 'new file\n');
 await fs.writeFile(path.join(dir, 'images/new.png'), Buffer.from([0, 1, 2]));
 const paths = await store.discardAll();
 assert.ok(paths.includes(file)); assert.ok(paths.includes(oldPath)); assert.ok(paths.includes(newPath));
 assert.ok(!paths.includes(kept));
 assert.equal(await store.read(note.id), autocrlf ? original.replace(/\n/g, '\r\n') : original);
 for (const name of [oldPath, deleted]) assert.equal(await fs.readFile(path.join(dir, name), 'utf8'), autocrlf ? 'original\r\n' : 'original\n');
 for (const name of [newPath, addedPath, `drawings/${drawing.filename}`, ...specialPaths, 'images/new.png']) await assert.rejects(fs.access(path.join(dir, name)), { code: 'ENOENT' });
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
 manifest.notes[0].title = 'renamed in JSON'; manifest.folders.push({ id: 'editor-folder', name: 'editor category', parentId: null });
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
