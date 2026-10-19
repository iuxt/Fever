const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const { manifestView, noteView } = require('../electron/manifest.mjs');
const { VaultStore } = require('../electron/vault.cjs');
async function fixture(t) {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-test-'));
 t.after(() => fs.rm(dir, { recursive: true, force: true }));
 const store = new VaultStore(); await store.open(dir);
 await store.configure({ author: 'Fever Test', email: 'test@example.com', remote: '' });
 return { dir, store };
}
test('trash can be read, searched and inspected through Git history without allowing edits or repeated deletion', async t => {
 const { dir, store } = await fixture(t);
 const note = await store.create('Archived title', '原位置/分类');
 await store.save(note.id, '# v1'); await store.commit('first version');
 await store.save(note.id, '# v2\n\nbody needle'); await store.commit('second version');
 await store.save(note.id, '# uncommitted\n\nbody needle');
 await store.removeCategory('原位置');
 const reopened = new VaultStore(); await reopened.open(dir);
 assert.equal(await reopened.read(note.id, 'trash'), '# uncommitted\n\nbody needle');
 assert.deepEqual(await reopened.search('body needle'), []);
 for (const query of ['archived TITLE', '原位置/分类', 'BODY needle']) {
  assert.deepEqual(await reopened.search(query, 'trash'), [note.id]);
 }
 const history = await reopened.history(note.id);
 assert.deepEqual(history.map(c => c.message), ['second version', 'first version']);
 assert.deepEqual(await reopened.revisionComparison(note.id, history[0].hash), { content: '# v2\n\nbody needle', previousContent: '# v1', previousHash: history[1].hash });
 await assert.rejects(reopened.read(note.id), /不存在/);
 await assert.rejects(reopened.save(note.id, 'overwrite'), /不存在/);
 await assert.rejects(reopened.update(note.id, 'rename', ''), /不存在/);
 await assert.rejects(reopened.remove(note.id), /不存在/);
 await assert.rejects(reopened.restore(note.id, history[1].hash), /不存在/);
 await assert.rejects(reopened.saveFile(`notes/${note.filename}`, 'overwrite from Git'), /回收站.*只读/);
 await assert.rejects(reopened.discard(`notes/${note.filename}`), /回收站.*只读/);
 assert.equal(await reopened.read(note.id, 'trash'), '# uncommitted\n\nbody needle');
 await reopened.restoreTrash(note.id);
 assert.equal(await reopened.read(note.id), '# uncommitted\n\nbody needle');
 assert.equal(noteView(reopened.manifest, reopened.note(note.id)).category, '原位置/分类');
 await assert.rejects(reopened.read(note.id, 'trash'), /找不到/);
 assert.deepEqual(await reopened.search('body needle', 'trash'), []);
});
test('Git discard cannot permanently delete an uncommitted trashed note', async t => {
 const { store, dir } = await fixture(t);
 const note = await store.create('新笔记', '');
 await store.remove(note.id);
 await assert.rejects(store.discard(`notes/${note.filename}`), /回收站.*只读/);
 assert.equal(await store.read(note.id, 'trash'), '# 新笔记\n\n');
 await fs.access(path.join(dir, 'notes', note.filename));
});
test('UUID files, nested categories, stable filenames and persisted manifest', async t => {
 const { dir, store } = await fixture(t);
 const note = await store.create('第一篇', '项目/Fever');
 assert.match(note.filename, /^[0-9a-f-]{36}\.md$/);
 const saved = await store.save(note.id, '# 第一篇\n\n思考');
 assert.equal(saved.updatedAt, store.snapshot().manifest.notes.find(n => n.id === note.id).updatedAt);
 await store.update(note.id, '重命名', '日记/2026');
 const manifest = JSON.parse(await fs.readFile(path.join(dir, 'fever.json'), 'utf8'));
 const persisted = manifest.notes.find(n => n.id === note.id);
 assert.equal(persisted.filename, note.filename); assert.equal(persisted.title, '重命名');
 assert.equal(await store.read(note.id), '# 第一篇\n\n思考');
 const reopened = new VaultStore(); await reopened.open(dir);
 assert.equal(await reopened.read(note.id), '# 第一篇\n\n思考');
 await assert.rejects(store.read('../../secret'), /不存在/);
});
test('real Git commits, per-note history, exact revision and non-destructive restore', async t => {
 const { store } = await fixture(t);
 const a = await store.create('A', '测试'), b = await store.create('B', '测试');
 await store.save(a.id, '# A\n\n版本一'); await store.commit('initial');
 await store.save(a.id, '# A\n\n版本二'); await store.commit('update A');
 await store.save(b.id, '# B\n\n独立修改'); await store.commit('update B');
 const history = await store.history(a.id);
 assert.deepEqual(history.map(c => c.message), ['update A', 'initial']);
 assert.equal(await store.revision(a.id, history[1].hash), '# A\n\n版本一');
 assert.deepEqual(await store.revisionComparison(a.id, history[0].hash), { content: '# A\n\n版本二', previousContent: '# A\n\n版本一', previousHash: history[1].hash });
 assert.deepEqual(await store.revisionComparison(a.id, history[1].hash), { content: '# A\n\n版本一', previousContent: '', previousHash: undefined });
 await store.restore(a.id, history[1].hash);
 assert.equal(await store.read(a.id), '# A\n\n版本一');
 assert.equal((await store.history(a.id)).length, 2);
 assert.ok((await store.status()).changes.some(c => c.path === `notes/${a.filename}`));
 await store.commit('restore A'); assert.equal((await store.history(a.id)).length, 3);
 await assert.rejects(store.revision(a.id, '--help'), /无效/);
 await assert.rejects(store.revisionComparison(a.id, '--help'), /无效/);
});
test('Git LFS stores the committed image as a pointer', async t => {
 const { store, dir } = await fixture(t);
 if (!store.lfs) { t.skip('Git LFS not installed'); return; }
 const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N3IAAAAASUVORK5CYII=', 'base64');
 const note = store.snapshot().manifest.notes[0];
 const relative = await store.image([...image], 'pixel.png', note.id);
 assert.equal(path.posix.dirname(relative), `../images/${note.id}`);
 assert.match(path.posix.basename(relative), /^\d{4}-\d{2}-\d{2}-\d{6}-\d{3}\.png$/);
 await store.commit('image');
 const pointer = (await exec('git', ['show', `HEAD:${relative.slice(3)}`], { cwd: dir })).stdout;
 assert.match(pointer, /version https:\/\/git-lfs.github.com\/spec\/v1/);
 assert.match(pointer, /oid sha256:/);
 assert.deepEqual(await fs.readFile(path.join(dir, relative.slice(3))), image);
 await assert.rejects(store.image([...image], 'bad.svg', note.id), /支持/);
});
test('images use note directories and local dates, preserve formats, and avoid overwriting collisions', async t => {
 const { store, dir } = await fixture(t);
 store.lfs = true;
 const a = await store.create('A', ''), b = await store.create('B', '');
 t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 15, 14, 30, 25, 123).getTime() });
 const first = await store.image([1, 2, 3], 'original.JPEG', a.id);
 const second = await store.image([4, 5, 6], 'other.JPEG', a.id);
 const otherNote = await store.image([7, 8, 9], 'original.JPEG', b.id);
 assert.equal(first, `../images/${a.id}/2026-10-15-143025-123.JPEG`);
 assert.equal(second, `../images/${a.id}/2026-10-15-143025-123-1.JPEG`);
 assert.equal(otherNote, `../images/${b.id}/2026-10-15-143025-123.JPEG`);
 for (const [relative, bytes] of [[first, [1, 2, 3]], [second, [4, 5, 6]], [otherNote, [7, 8, 9]]]) {
  assert.deepEqual(await fs.readFile(path.join(dir, relative.slice(3))), Buffer.from(bytes));
 }
 await assert.rejects(store.image([1], 'image.png', '../escape'), /不存在/);
 await assert.rejects(store.image([1], 'image.png'), /不存在/);
 await store.remove(a.id);
 await assert.rejects(store.image([1], 'image.png', a.id), /不存在/);
});
test('serialized autosaves retain the latest version without corrupting the manifest', async t => {
 const { store, dir } = await fixture(t);
 const note = await store.create('并发保存', '测试');
 await Promise.all(Array.from({ length: 12 }, (_, i) => store.save(note.id, `version ${i}`)));
 assert.equal(await store.read(note.id), 'version 11');
 const manifest = JSON.parse(await fs.readFile(path.join(dir, 'fever.json'), 'utf8'));
 assert.equal(manifest.notes.filter(n => n.id === note.id).length, 1);
});
test('reopening an intentionally empty vault does not recreate deleted welcome notes', async t => {
 const { store, dir } = await fixture(t);
 for (const note of store.snapshot().manifest.notes) await store.remove(note.id);
 const reopened = new VaultStore();
 assert.equal((await reopened.open(dir)).manifest.notes.length, 0);
 assert.equal(reopened.snapshot().manifest.trash.length, 1);
 assert.equal((await fs.readdir(path.join(dir, 'notes'))).length, 1);
});

test('opening existing content requires fever.json and leaves the current vault unchanged on failure', async t => {
 const { store, dir } = await fixture(t), before = store.snapshot();
 for (const directory of ['notes', 'drawings']) {
  const other = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-unrecognized-'));
  t.after(() => fs.rm(other, { recursive: true, force: true }));
  await fs.mkdir(path.join(other, directory));
  const file = path.join(other, directory, 'existing.md');
  await fs.writeFile(file, 'Existing content');
  await assert.rejects(store.open(other), /没有 fever.json/);
  assert.deepEqual(store.snapshot(), before);
  assert.equal(await fs.readFile(file, 'utf8'), 'Existing content');
  await assert.rejects(fs.access(path.join(other, 'fever.json')), { code: 'ENOENT' });
 }
 assert.equal(store.root, await fs.realpath(dir));
});
test('trash retains uncommitted content, attachments, identity and category across reopen and Git commits', async t => {
 const { store, dir } = await fixture(t);
 const note = await store.create('可恢复的笔记', '项目/回收站');
 await fs.mkdir(path.join(dir, 'images', note.id));
 await fs.writeFile(path.join(dir, 'images', note.id, 'attachment.png'), 'attachment retained');
 await store.save(note.id, '# 最新内容\n\n尚未提交的正文');
 const before = noteView(store.manifest, store.note(note.id));
 await store.remove(note.id);
 assert.deepEqual(store.snapshot().manifest.trash, [before]);
 assert.equal(await fs.readFile(path.join(dir, 'notes', note.filename), 'utf8'), '# 最新内容\n\n尚未提交的正文');
 assert.equal(await fs.readFile(path.join(dir, 'images', note.id, 'attachment.png'), 'utf8'), 'attachment retained');
 assert.deepEqual(await store.search('尚未提交'), []);
 await assert.rejects(store.read(note.id), /不存在/);
 await assert.rejects(store.save(note.id, 'overwrite trash'), /不存在/);
 await assert.rejects(store.remove(note.id), /不存在/);
 // A backup includes the retained note body even when the note was never committed before deletion.
 await store.git(['add', '--', 'fever.json', 'notes']);
 await store.commit('backup trash', true);
 assert.equal(await store.git(['show', `HEAD:notes/${note.filename}`]), '# 最新内容\n\n尚未提交的正文');
 const reopened = new VaultStore(); await reopened.open(dir);
 assert.deepEqual(reopened.snapshot().manifest.trash, [before]);
 assert.deepEqual(await reopened.restoreTrash(note.id), before);
 assert.deepEqual(reopened.snapshot().manifest.trash, []);
 assert.deepEqual(noteView(reopened.manifest, reopened.note(note.id)), before);
 assert.deepEqual(await reopened.search('尚未提交'), [note.id]);
 await assert.rejects(reopened.restoreTrash(note.id), /找不到/);
 const again = new VaultStore(); await again.open(dir);
 assert.equal(await again.read(note.id), '# 最新内容\n\n尚未提交的正文');
 assert.deepEqual(again.snapshot().manifest.trash, []);
});
test('failed trash persistence and missing restore files leave library records intact', async t => {
 const { store, dir } = await fixture(t);
 const note = await store.create('保护数据', '测试');
 const persist = store.persist;
 store.persist = async () => { throw new Error('write failed'); };
 await assert.rejects(store.remove(note.id), /write failed/);
 assert.equal(store.note(note.id).id, note.id);
 assert.equal(store.snapshot().manifest.trash, undefined);
 store.persist = persist; await store.remove(note.id);
 store.persist = async () => { throw new Error('write failed'); };
 await assert.rejects(store.restoreTrash(note.id), /write failed/);
 assert.equal(store.snapshot().manifest.trash[0].id, note.id);
 await assert.rejects(store.read(note.id), /不存在/);
 store.persist = persist;
 await fs.unlink(path.join(dir, 'notes', note.filename));
 await assert.rejects(store.restoreTrash(note.id), { code: 'ENOENT' });
 assert.equal(store.snapshot().manifest.trash[0].id, note.id);
});
test('trash manifests reject escaping paths and duplicate active records', async t => {
 const { store, dir } = await fixture(t);
 const manifest = store.snapshot().manifest, note = manifest.notes[0];
 for (const trash of ['invalid', [{ ...note, filename: '../../escape.md' }], [note]]) {
  await fs.writeFile(path.join(dir, 'fever.json'), JSON.stringify({ ...manifest, trash }));
  await assert.rejects(new VaultStore().open(dir), /无效/);
 }
});
test('deleting a category trashes its subtree, preserves similarly named siblings and restores original paths', async t => {
 const { store, dir } = await fixture(t);
 const parent = await store.create('父分类笔记', '项目'), child = await store.create('子分类笔记', '项目/Fever');
 const sibling = await store.create('相似分类', '项目备份');
 await store.category('项目/空分类/子分类');
 await store.save(child.id, '尚未提交的正文');
 await fs.writeFile(path.join(dir, 'images', 'retained.png'), 'attachment');
 const notes = [noteView(store.manifest, store.note(parent.id)), noteView(store.manifest, store.note(child.id))];
 await store.removeCategory('项目');
 assert.ok(!store.snapshot().manifest.categories.some(category => category === '项目' || category.startsWith('项目/')));
 assert.deepEqual(store.snapshot().manifest.trash, notes.map(note => ({ ...note, folderId: null })));
 assert.equal(noteView(store.manifest, store.note(sibling.id)).category, '项目备份');
 assert.equal(await fs.readFile(path.join(dir, 'notes', child.filename), 'utf8'), '尚未提交的正文');
 assert.equal(await fs.readFile(path.join(dir, 'images', 'retained.png'), 'utf8'), 'attachment');
 assert.deepEqual(await store.search('尚未提交'), []);
 const reopened = new VaultStore(); await reopened.open(dir);
 assert.deepEqual(reopened.manifest.trash, store.manifest.trash);
 assert.equal((await reopened.restoreTrash(child.id)).category, '项目/Fever');
 assert.equal(reopened.note(child.id).filename, notes[1].filename);
 assert.ok(reopened.snapshot().manifest.categories.includes('项目/Fever'));
 assert.equal(await reopened.read(child.id), '尚未提交的正文');
});
test('empty and implicit parent categories can be deleted and invalid targets leave the manifest intact', async t => {
 const { store, dir } = await fixture(t);
 await store.category('空分类'); await store.removeCategory('空分类');
 await store.category('隐式父分类/子分类'); await store.removeCategory('隐式父分类');
 const before = store.snapshot().manifest;
 for (const category of ['', '/', '项目//子分类', '不存在', null]) await assert.rejects(store.removeCategory(category), /分类/);
 assert.deepEqual(store.snapshot().manifest, before);
 const reopened = new VaultStore(); await reopened.open(dir);
 assert.deepEqual(reopened.snapshot().manifest, before);
});
test('category rename and move preserve complete subtrees, note files and trash across reopen', async t => {
 const { store, dir } = await fixture(t);
 const parent = await store.create('父笔记', '项目'), child = await store.create('子笔记', '项目/子分类');
 const sibling = await store.create('相似分类', '项目备份');
 const trashed = await store.create('已删除', '项目/子分类'); await store.remove(trashed.id);
 await store.save(child.id, '未提交的正文');
 await store.category('项目/空分类/空子分类'); await store.category('目标');
 await store.moveCategory('项目', '新项目');
 assert.equal(noteView(store.manifest, store.note(parent.id)).category, '新项目');
 await store.moveCategory('新项目', '目标/新项目');
 assert.equal(noteView(store.manifest, store.note(parent.id)).category, '目标/新项目');
 assert.equal(noteView(store.manifest, store.note(child.id)).category, '目标/新项目/子分类');
 assert.equal(store.note(child.id).filename, child.filename);
 assert.equal(noteView(store.manifest, store.note(sibling.id)).category, '项目备份');
 assert.equal(store.snapshot().manifest.trash[0].category, '项目/子分类');
 assert.ok(store.snapshot().manifest.categories.includes('目标/新项目/空分类/空子分类'));
 assert.ok(!store.snapshot().manifest.categories.some(path => path === '项目' || path.startsWith('项目/')));
 assert.equal(await fs.readFile(path.join(dir, 'notes', child.filename), 'utf8'), '未提交的正文');
 const reopened = new VaultStore(); await reopened.open(dir);
 assert.deepEqual(reopened.manifest, store.manifest);
 await reopened.moveCategory('目标/新项目', '新项目');
 assert.equal(noteView(reopened.manifest, reopened.note(child.id)).category, '新项目/子分类');
 assert.ok(reopened.snapshot().manifest.categories.includes('目标'));
});
test('moving implicit and empty folders retains their original parent', async t => {
 const { store } = await fixture(t);
 await store.category('隐式父分类/子分类/空文件夹');
 await store.moveCategory('隐式父分类/子分类', '子分类');
 assert.ok(store.snapshot().manifest.categories.includes('隐式父分类'));
 assert.ok(store.snapshot().manifest.categories.includes('子分类/空文件夹'));
 await store.moveCategory('子分类/空文件夹', '重命名空文件夹');
 assert.ok(store.snapshot().manifest.categories.includes('子分类'));
 assert.ok(store.snapshot().manifest.categories.includes('重命名空文件夹'));
});
test('category moves reject collisions, cycles, invalid paths and overlong descendant paths atomically', async t => {
 const { store, dir } = await fixture(t);
 await store.category('项目/子分类'); await store.category('占用/隐式文件夹');
 const before = store.snapshot().manifest;
 for (const [from, to] of [
  ['项目', '项目/子分类/项目'], ['项目', '占用'], ['项目', '占用/隐式文件夹'],
  ['不存在', '新名字'], ['项目', ''], ['项目', '/'], ['项目', '无效//分类'],
  [null, '名字'], ['项目', null], ['项目', '长'.repeat(198)],
 ]) {
  await assert.rejects(store.moveCategory(from, to), /分类|文件夹|200/);
  assert.deepEqual(store.snapshot().manifest, before);
 }
 await store.moveCategory('项目', '项目');
 const reopened = new VaultStore(); await reopened.open(dir);
 assert.deepEqual(reopened.snapshot().manifest, before);
});
test('category moves roll back the whole tree when persistence fails', async t => {
 const { store } = await fixture(t);
 await store.create('保护数据', '项目/子分类'); await store.category('项目/空分类');
 const before = store.snapshot().manifest;
 store.persist = async () => { throw new Error('write failed'); };
 await assert.rejects(store.moveCategory('项目', '重命名'), /write failed/);
 assert.deepEqual(store.snapshot().manifest, before);
});
test('category deletion rolls back every record when persistence fails', async t => {
 const { store, dir } = await fixture(t);
 const note = await store.create('保护数据', '项目/子分类');
 const before = store.snapshot().manifest;
 store.persist = async () => { throw new Error('write failed'); };
 await assert.rejects(store.removeCategory('项目'), /write failed/);
 assert.deepEqual(store.snapshot().manifest, before);
 assert.equal(await fs.readFile(path.join(dir, 'notes', note.filename), 'utf8'), '# 保护数据\n\n');
});
test('malformed manifests and symlink escapes are rejected without overwriting files', async t => {
 const { dir, store } = await fixture(t);
 const note = await store.create('保护', '测试');
 const outside = path.join(os.tmpdir(), `fever-protected-${Date.now()}.md`);
 await fs.writeFile(outside, 'untouched'); t.after(() => fs.rm(outside, { force: true }));
 await fs.unlink(path.join(dir, 'notes', note.filename)); await fs.symlink(outside, path.join(dir, 'notes', note.filename));
 await assert.rejects(store.save(note.id, 'changed'), /符号链接/);
 assert.equal(await fs.readFile(outside, 'utf8'), 'untouched');
 await fs.writeFile(path.join(dir, 'fever.json'), JSON.stringify({ version: 1, categories: [], notes: [{ id: 'evil', title: 'evil', category: '', filename: '../../escape.md' }] }));
 await assert.rejects(new VaultStore().open(dir), /无效/);
});
test('push and fast-forward pull work against a local bare Git repository', async t => {
 const { store, dir } = await fixture(t);
 const remote = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-remote-')); t.after(() => fs.rm(remote, { recursive: true, force: true }));
 await exec('git', ['init', '--bare', '-b', 'main', remote]);
 await store.commit('initial'); await store.git(['remote', 'add', 'origin', remote]); await store.push();
 const clone = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-clone-')); t.after(() => fs.rm(clone, { recursive: true, force: true }));
 await exec('git', ['clone', remote, clone]); const other = new VaultStore(); await other.open(clone);
 await other.git(['config', '--local', 'user.name', 'Other']); await other.git(['config', '--local', 'user.email', 'other@example.com']);
 const note = await other.create('来自远程', '收件箱'); await other.commit('remote note'); await other.push();
 await store.pull(); assert.ok(store.snapshot().manifest.notes.some(n => n.id === note.id));
 assert.match(await fs.readFile(path.join(dir, 'notes', note.filename), 'utf8'), /来自远程/);
 await store.save(note.id, 'local change'); await assert.rejects(store.pull(), /提交本地变更/);
});

test('Excalidraw creation, atomic saves, Git revisions and reopen retain drawing data', async t => {
 const { store, dir } = await fixture(t);
 const note = await store.create('系统架构', '绘图', 'excalidraw');
 assert.match(note.filename, /^[0-9a-f-]{36}\.excalidraw$/);
 assert.equal(note.directory, 'drawings');
 const file = `drawings/${note.filename}`;
 await fs.access(path.join(dir, file));
 await assert.rejects(fs.access(path.join(dir, 'notes', note.filename)), { code: 'ENOENT' });
 const first = await store.read(note.id);
 assert.equal(JSON.parse(first).type, 'excalidraw');
 await store.commit('blank drawing');
 const scene = { ...JSON.parse(first), elements: [{ id: 'rectangle', type: 'rectangle', x: 10, y: 20, width: 160, height: 80, version: 1 }] };
 await store.saveFile(file, JSON.stringify(scene));
 assert.deepEqual(await store.search('rectangle'), [note.id]);
 assert.ok((await store.diff(file)).patch.includes('rectangle'));
 await store.commit('draw rectangle');
 assert.equal(await store.git(['show', `HEAD:${file}`]), JSON.stringify(scene));
 const history = await store.history(note.id);
 assert.deepEqual(history.map(c => c.message), ['draw rectangle', 'blank drawing']);
 await store.restore(note.id, history[1].hash);
 assert.equal(await store.read(note.id), first);
 await assert.rejects(store.save(note.id, '{invalid'), /JSON/);
 await assert.rejects(store.save(note.id, JSON.stringify({ type: 'excalidraw', elements: [null] })), /无效/);
 assert.equal(await store.read(note.id), first);
 const reopened = new VaultStore(); await reopened.open(dir);
 assert.equal(await reopened.read(note.id), first);
 assert.equal(reopened.note(note.id).directory, 'drawings');
 await store.update(note.id, '新的绘图标题', '项目/绘图');
 assert.equal(store.note(note.id).filename, note.filename);
 await store.removeCategory('项目');
 assert.equal(await store.read(note.id, 'trash'), first);
 await assert.rejects(store.saveFile(file, 'overwrite'), /回收站.*只读/);
 await assert.rejects(store.discard(file), /回收站.*只读/);
 const restored = await store.restoreTrash(note.id);
 assert.equal(restored.directory, 'drawings');
 assert.equal(await store.read(note.id), first);
});

test('legacy notes/ drawings coexist with drawings/ and retain their original Git history', async t => {
 const { store, dir } = await fixture(t);
 const legacy = await store.create('旧版绘图', '绘图', 'excalidraw');
 await fs.rename(path.join(dir, 'drawings', legacy.filename), path.join(dir, 'notes', legacy.filename));
 delete store.note(legacy.id).directory;
 await store.persist(); await store.commit('legacy drawing');
 const reopened = new VaultStore(); await reopened.open(dir);
 const original = await reopened.read(legacy.id);
 const current = await reopened.create('新版绘图', '绘图', 'excalidraw');
 assert.equal(current.directory, 'drawings');
 await reopened.save(legacy.id, original.replace('#ffffff', '#fafafa'));
 await reopened.commit('both layouts');
 const history = await reopened.history(legacy.id);
 assert.deepEqual(history.map(commit => commit.message), ['both layouts', 'legacy drawing']);
 assert.equal(await reopened.revision(legacy.id, history[1].hash), original);
 await fs.access(path.join(dir, 'notes', legacy.filename));
 await fs.access(path.join(dir, 'drawings', current.filename));
 await assert.rejects(fs.access(path.join(dir, 'drawings', legacy.filename)), { code: 'ENOENT' });
});

test('discard and failed creation remove drawings without leaving dangling manifest entries', async t => {
 const { store, dir } = await fixture(t);
 await store.commit('initial');
 const note = await store.create('撤销绘图', '绘图', 'excalidraw');
 await store.stage(`drawings/${note.filename}`);
 await store.discard(`drawings/${note.filename}`);
 assert.ok(!store.manifest.notes.some(item => item.id === note.id));
 assert.deepEqual(await fs.readdir(path.join(dir, 'drawings')), []);
 const before = store.snapshot().manifest;
 store.persist = async () => { throw new Error('write failed'); };
 await assert.rejects(store.create('失败绘图', '绘图', 'excalidraw'), /write failed/);
 assert.deepEqual(store.snapshot().manifest, before);
 assert.deepEqual(await fs.readdir(path.join(dir, 'drawings')), []);
});

test('Excalidraw imports preserve images and reject invalid files without adding notes', async t => {
 const { store } = await fixture(t);
 const imports = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-drawings-'));
 t.after(() => fs.rm(imports, { recursive: true, force: true }));
 const file = path.join(imports, '我的绘图.excalidraw');
 const content = JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: { viewBackgroundColor: '#fafafa' }, files: { image: { id: 'image', dataURL: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png', created: 1 } } });
 await fs.writeFile(file, content);
 const note = await store.importFile(file);
 assert.equal(note.title, '我的绘图'); assert.equal(await store.read(note.id), content);
 assert.equal(note.directory, 'drawings');
 const markdownFile = path.join(imports, '旧图.excalidraw.md');
 const markdown = `---\nexcalidraw-plugin: parsed\n---\n\n## Drawing\n\`\`\`json\n${content}\n\`\`\`\n`;
 await fs.writeFile(markdownFile, markdown);
 const imported = await store.importFile(markdownFile);
 assert.equal(imported.directory, 'drawings');
 assert.equal(await store.read(imported.id), markdown);
 const count = store.snapshot().manifest.notes.length;
 await fs.writeFile(file, '{"type":"other","elements":[]}');
 await assert.rejects(store.importFile(file), /无效/);
 assert.equal(store.snapshot().manifest.notes.length, count);
 await assert.rejects(store.create('Bad', '', '../../outside'), /格式/);
});

test('failed creation, rename and category writes do not leak into later saves', async t => {
 const { store, dir } = await fixture(t);
 const before = store.snapshot().manifest, files = await fs.readdir(path.join(dir, 'notes'));
 const persist = store.persist;
 store.persist = async () => { throw new Error('write failed'); };
 await assert.rejects(store.create('Failed note', 'Failed/category'), /write failed/);
 assert.deepEqual(store.snapshot().manifest, before);
 assert.deepEqual(await fs.readdir(path.join(dir, 'notes')), files);
 await assert.rejects(store.update(before.notes[0].id, 'Failed rename', 'Failed/move'), /write failed/);
 assert.deepEqual(store.snapshot().manifest, before);
 await assert.rejects(store.category('Failed/folder'), /write failed/);
 assert.deepEqual(store.snapshot().manifest, before);
 store.persist = persist;
 await store.save(before.notes[0].id, 'Successful later save');
 const reopened = new VaultStore(); await reopened.open(dir);
 assert.equal(reopened.manifest.notes.length, before.notes.length);
 assert.equal(reopened.note(before.notes[0].id).title, before.notes[0].title);
 assert.deepEqual(reopened.snapshot().manifest.categories, before.categories);
});

test('equivalent file paths cannot bypass manifest validation or trash protection', async t => {
 const { store, dir } = await fixture(t);
 const note = store.manifest.notes[0]; await store.remove(note.id);
 const original = await store.read(note.id, 'trash');
 for (const alias of [`./notes/${note.filename}`, `notes//${note.filename}`, `notes/./${note.filename}`]) {
  await assert.rejects(store.saveFile(alias, 'overwrite'), /无效|只读/);
 }
 for (const alias of ['./fever.json', './/fever.json']) await assert.rejects(store.saveFile(alias, '{}'), /无效|格式/);
 assert.equal(await store.read(note.id, 'trash'), original);
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'fever.json'), 'utf8')), store.manifest);
});

test('manifest fields reject coercible filenames, reserved IDs and invalid note metadata', async t => {
 const { store, dir } = await fixture(t), before = store.snapshot().manifest;
 for (const fields of [{ filename: [before.notes[0].filename] }, { id: 'file:fever.json' }, { id: '' }, { sourcePath: {} }, { directory: '../outside' }, { directory: '/tmp' }, { directory: ['drawings'] }, { directory: null }]) {
  const content = JSON.stringify({ ...before, notes: [{ ...before.notes[0], ...fields }] });
  await assert.rejects(store.saveFile('fever.json', content), /无效/);
 }
 assert.deepEqual(manifestView(JSON.parse(await fs.readFile(path.join(dir, 'fever.json'), 'utf8'))), before);
});

test('rejecting a nested Git directory leaves it untouched and preserves the open vault', async t => {
 const { store, dir } = await fixture(t), before = store.snapshot();
 const child = path.join(dir, 'unrelated');
 await fs.mkdir(child);
 await assert.rejects(store.open(child), /仓库.*子目录/);
 assert.deepEqual(await fs.readdir(child), []);
 assert.deepEqual(store.snapshot(), before);
});

test('initialization rejects unrelated files and existing images without creating a vault', async t => {
 const { store } = await fixture(t), before = store.snapshot();
 for (const relative of ['personal.txt', 'images/photo.png']) {
  const other = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-unrelated-'));
  t.after(() => fs.rm(other, { recursive: true, force: true }));
  const file = path.join(other, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, 'keep me');
  const entries = await fs.readdir(other);
  await assert.rejects(store.open(other), /没有 fever.json/);
  assert.deepEqual(await fs.readdir(other), entries);
  assert.equal(await fs.readFile(file, 'utf8'), 'keep me');
  assert.deepEqual(store.snapshot(), before);
 }
});

test('file saves resolve note identity after preceding manifest writes', async t => {
 const { store, dir } = await fixture(t);
 const note = store.manifest.notes[0], manifest = store.snapshot().manifest;
 manifest.notes[0].id = 'replacement-id';
 manifest.notes[0].updatedAt = '2000-01-01T00:00:00.000Z';
 const metadata = store.saveFile('fever.json', JSON.stringify(manifest));
 const save = store.saveFile(`notes/${note.filename}`, 'latest content');
 await Promise.all([metadata, save]);
 assert.equal(await store.read('replacement-id'), 'latest content');
 const persisted = JSON.parse(await fs.readFile(path.join(dir, 'fever.json'), 'utf8'));
 assert.notEqual(persisted.notes[0].updatedAt, manifest.notes[0].updatedAt);
 assert.deepEqual(persisted, store.manifest);
});

test('history restore finishes in its original vault before a queued library switch', async t => {
 const { store, dir } = await fixture(t);
 const note = store.manifest.notes[0];
 await store.save(note.id, 'historical content'); await store.commit('history');
 const hash = (await store.history(note.id))[0].hash;
 await store.save(note.id, 'current content');
 const other = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-restore-'));
 t.after(() => fs.rm(other, { recursive: true, force: true }));
 const second = new VaultStore(); await second.open(other);
 second.manifest = structuredClone(store.manifest);
 await second.persist();
 await fs.writeFile(path.join(other, 'notes', note.filename), 'other library content');
 const revision = store.revision.bind(store);
 let release, entered;
 const started = new Promise(resolve => { entered = resolve; });
 store.revision = async (...args) => {
  const content = await revision(...args);
  entered(); await new Promise(resolve => { release = resolve; });
  return content;
 };
 const restoring = store.restore(note.id, hash);
 await started;
 const switching = store.open(other);
 // Both operations are issued while the historical read is still in flight.
 release();
 await Promise.all([restoring, switching]);
 assert.equal(await fs.readFile(path.join(dir, 'notes', note.filename), 'utf8'), 'historical content');
 assert.equal(await store.read(note.id), 'other library content');
});

test('v1 vaults migrate on open, retain stable UUIDs on reopen and produce single-line folder diffs', async t => {
 const { store, dir } = await fixture(t);
 const note = await store.create('旧版笔记', '项目/子分类');
 await store.category('项目/空分类'); await store.category('目标');
 const view = store.snapshot().manifest;
 const old = { version: 1, categories: view.categories, notes: view.notes.map(({ folderId, ...note }) => note) };
 const oldText = JSON.stringify(old, null, 2) + '\n';
 await fs.writeFile(path.join(dir, 'fever.json'), oldText);
 await store.commit('v1 snapshot');
 const reopened = new VaultStore(); await reopened.open(dir);
 const migrated = JSON.parse(await fs.readFile(path.join(dir, 'fever.json'), 'utf8'));
 assert.equal(migrated.version, 2); assert.equal(migrated.categories, undefined);
 assert.ok(migrated.notes.every(note => note.category === undefined));
 assert.equal(await reopened.read(note.id), '# 旧版笔记\n\n');
 const again = new VaultStore(); await again.open(dir);
 assert.deepEqual(again.manifest, migrated);
 await reopened.commit('migrate v2');
 await reopened.moveCategory('项目', '新项目');
 assert.deepEqual(reopened.manifest.notes, migrated.notes);
 assert.match((await reopened.git(['diff', '--numstat', '--', 'fever.json'])).trim(), /^1\s+1\s+fever\.json$/);
 await reopened.commit('rename folder');
 await reopened.moveCategory('新项目', '目标/新项目');
 assert.deepEqual(reopened.manifest.notes, migrated.notes);
 assert.match((await reopened.git(['diff', '--numstat', '--', 'fever.json'])).trim(), /^1\s+1\s+fever\.json$/);
});

test('old Git manifests remain readable after discard and file edits upgrade them without changing note history', async t => {
 const { store, dir } = await fixture(t);
 const note = await store.create('历史兼容', '项目/子分类');
 const view = store.snapshot().manifest;
 const oldText = JSON.stringify({ version: 1, categories: view.categories, notes: view.notes.map(({ folderId, ...note }) => note) }, null, 2) + '\n';
 await fs.writeFile(path.join(dir, 'fever.json'), oldText); await store.commit('v1 baseline');
 const hash = (await store.history(note.id))[0].hash;
 const reopened = new VaultStore(); await reopened.open(dir);
 await reopened.moveCategory('项目', '重命名');
 await reopened.discard('fever.json');
 assert.equal(await fs.readFile(path.join(dir, 'fever.json'), 'utf8'), oldText);
 assert.equal(reopened.snapshot().manifest.notes.find(item => item.id === note.id).category, '项目/子分类');
 assert.equal(await reopened.revision(note.id, hash), '# 历史兼容\n\n');
 await reopened.saveFile('fever.json', oldText);
 assert.equal(JSON.parse(await fs.readFile(path.join(dir, 'fever.json'), 'utf8')).version, 2);
 const before = await fs.readFile(path.join(dir, 'fever.json'), 'utf8');
 const invalid = structuredClone(reopened.manifest); invalid.folders[0].parentId = invalid.folders[0].id;
 await assert.rejects(reopened.saveFile('fever.json', JSON.stringify(invalid)), /循环/);
 assert.equal(await fs.readFile(path.join(dir, 'fever.json'), 'utf8'), before);
});

test('failed v1 migration preserves the original manifest and the previously open vault', async t => {
 const { store } = await fixture(t), before = store.snapshot();
 const other = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-v1-migration-failure-'));
 t.after(() => fs.rm(other, { recursive: true, force: true }));
 const legacy = JSON.stringify({ version: 1, categories: ['隐式/空文件夹'], notes: [] });
 await fs.writeFile(path.join(other, 'fever.json'), legacy);
 store.persist = async () => { throw new Error('write failed'); };
 await assert.rejects(store.open(other), /write failed/);
 assert.equal(await fs.readFile(path.join(other, 'fever.json'), 'utf8'), legacy);
 assert.deepEqual(store.snapshot(), before);
});
