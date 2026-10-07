const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const { VaultStore } = require('../electron/vault.cjs');
async function fixture(t) {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-test-'));
 t.after(() => fs.rm(dir, { recursive: true, force: true }));
 const store = new VaultStore(); await store.open(dir);
 await store.configure({ author: 'Fever Test', email: 'test@example.com', remote: '' });
 return { dir, store };
}
test('UUID files, nested categories, stable filenames and persisted manifest', async t => {
 const { dir, store } = await fixture(t);
 const note = await store.create('第一篇', '项目/Fever');
 assert.match(note.filename, /^[0-9a-f-]{36}\.md$/);
 await store.save(note.id, '# 第一篇\n\n思考');
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
 await store.restore(a.id, history[1].hash);
 assert.equal(await store.read(a.id), '# A\n\n版本一');
 assert.equal((await store.history(a.id)).length, 2);
 assert.ok((await store.status()).changes.some(c => c.path === `notes/${a.filename}`));
 await store.commit('restore A'); assert.equal((await store.history(a.id)).length, 3);
 await assert.rejects(store.revision(a.id, '--help'), /无效/);
});
test('Git LFS stores the committed image as a pointer', async t => {
 const { store, dir } = await fixture(t);
 if (!store.lfs) { t.skip('Git LFS not installed'); return; }
 const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N3IAAAAASUVORK5CYII=', 'base64');
 const relative = await store.image([...image], 'pixel.png');
 assert.match(relative, /^\.\.\/images\/[0-9a-f-]+\.png$/);
 await store.commit('image');
 const pointer = (await exec('git', ['show', `HEAD:${relative.slice(3)}`], { cwd: dir })).stdout;
 assert.match(pointer, /version https:\/\/git-lfs.github.com\/spec\/v1/);
 assert.match(pointer, /oid sha256:/);
 assert.deepEqual(await fs.readFile(path.join(dir, relative.slice(3))), image);
 await assert.rejects(store.image([...image], 'bad.svg'), /支持/);
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
 assert.equal((await fs.readdir(path.join(dir, 'notes'))).length, 0);
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
 const first = await store.read(note.id);
 assert.equal(JSON.parse(first).type, 'excalidraw');
 await store.commit('blank drawing');
 const scene = { ...JSON.parse(first), elements: [{ id: 'rectangle', type: 'rectangle', x: 10, y: 20, width: 160, height: 80, version: 1 }] };
 await store.save(note.id, JSON.stringify(scene)); await store.commit('draw rectangle');
 const history = await store.history(note.id);
 assert.deepEqual(history.map(c => c.message), ['draw rectangle', 'blank drawing']);
 await store.restore(note.id, history[1].hash);
 assert.equal(await store.read(note.id), first);
 await assert.rejects(store.save(note.id, '{invalid'), /JSON/);
 await assert.rejects(store.save(note.id, JSON.stringify({ type: 'excalidraw', elements: [null] })), /无效/);
 assert.equal(await store.read(note.id), first);
 const reopened = new VaultStore(); await reopened.open(dir);
 assert.equal(await reopened.read(note.id), first);
 await store.update(note.id, '新的绘图标题', '项目/绘图');
 assert.equal(store.note(note.id).filename, note.filename);
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
 const count = store.snapshot().manifest.notes.length;
 await fs.writeFile(file, '{"type":"other","elements":[]}');
 await assert.rejects(store.importFile(file), /无效/);
 assert.equal(store.snapshot().manifest.notes.length, count);
 await assert.rejects(store.create('Bad', '', '../../outside'), /格式/);
});
