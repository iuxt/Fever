const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const { VaultStore } = require('../electron/vault.cjs');
const { metadataView } = require('../electron/metadata.cjs');

const folderID = '11111111-1111-4111-8111-111111111111';
const childID = '22222222-2222-4222-8222-222222222222';
const noteID = '33333333-3333-4333-8333-333333333333';
const trashID = '44444444-4444-4444-8444-444444444444';
const rootID = '55555555-5555-4555-8555-555555555555';
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-fsnotes-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'notes')); await fs.mkdir(path.join(dir, 'images', noteID), { recursive: true });
  const metadata = { version: 1, extra: { retained: true }, folders: [
    { id: folderID, name: '项目', legacyPath: 'old-project' },
    { id: childID, name: 'Fever', parentID: folderID },
  ], notes: [
    { id: noteID, name: '原标题', folderID: childID, fileExtension: 'md', trashed: false, aliases: ['旧别名'], legacyPath: 'old-project/old.md', custom: { kept: true } },
    { id: trashID, name: '已删除', fileExtension: 'md', trashed: true, aliases: ['废纸篓别名'] },
    { id: rootID, name: '根目录笔记', fileExtension: 'txt', trashed: false },
  ] };
  const body = `# 正文标题与清单标题不同\n\n![截图](../images/${noteID}/pixel.png)\n`;
  await fs.writeFile(path.join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2) + '\n');
  await fs.writeFile(path.join(dir, 'notes', `${noteID}.md`), body);
  await fs.writeFile(path.join(dir, 'notes', `${trashID}.md`), 'trash retained');
  await fs.writeFile(path.join(dir, 'notes', `${rootID}.txt`), 'root retained');
  await fs.writeFile(path.join(dir, 'notes', '.fsnotes-library'), '1\n');
  await fs.writeFile(path.join(dir, 'images', noteID, 'pixel.png'), 'image retained');
  await fs.writeFile(path.join(dir, '.gitattributes'), 'images/** filter=lfs diff=lfs merge=lfs -text\n');
  const store = new VaultStore(); await store.open(dir);
  return { dir, store, metadata, body, load: async () => JSON.parse(await fs.readFile(path.join(dir, 'metadata.json'), 'utf8')) };
}

test('FSNotes opens without rewriting its snapshot or creating Fever files', async t => {
  const { dir, store, metadata, body } = await fixture(t);
  assert.equal(await fs.readFile(path.join(dir, 'metadata.json'), 'utf8'), JSON.stringify(metadata, null, 2) + '\n');
  await assert.rejects(fs.access(path.join(dir, 'fever.json')), { code: 'ENOENT' });
  const vault = store.snapshot(); assert.equal(vault.format, 'fsnotes');
  assert.deepEqual(vault.manifest.categories, ['项目', '项目/Fever']);
  assert.equal(vault.manifest.notes.length, 2);
  assert.equal(store.note(noteID).title, '原标题'); assert.equal(store.note(noteID).category, '项目/Fever');
  assert.equal(store.note(rootID).category, ''); assert.ok(Date.parse(store.note(noteID).updatedAt));
  assert.equal(await store.read(noteID), body);
  assert.deepEqual(await store.search('正文标题'), [noteID]);
  await assert.rejects(store.read(trashID), /不存在/);
});

test('the repository file editor validates and reloads FSNotes metadata before subsequent note saves', async t => {
 const { store, load, body } = await fixture(t);
 const file = await store.openFile('metadata.json'), metadata = JSON.parse(file.content);
 metadata.notes[0].name = '源码编辑后的标题'; metadata.extra.editor = true;
 await store.saveFile('metadata.json', JSON.stringify(metadata, null, 2));
 assert.equal(store.note(noteID).title, '源码编辑后的标题');
 await store.save(noteID, body + 'more content');
 assert.equal((await load()).notes[0].name, '源码编辑后的标题');
 assert.equal((await load()).extra.editor, true);
 const saved = (await store.openFile('metadata.json')).content;
 metadata.notes[0].fileExtension = '../../outside';
 await assert.rejects(store.saveFile('metadata.json', JSON.stringify(metadata)), /无效/);
 assert.equal((await store.openFile('metadata.json')).content, saved);
});

test('FSNotes edits preserve IDs, aliases, unknown fields, folder ancestry and trash files', async t => {
  const { dir, store, metadata, body, load } = await fixture(t);
  await store.update(noteID, '新标题', '新项目/子分类');
  await store.save(noteID, body + '\n修改正文\n');
  await store.category('空分类/更深层');
  const created = await store.create('新笔记', '新项目/子分类');
  const next = await load(), note = next.notes.find(n => n.id === noteID);
  assert.deepEqual(next.extra, metadata.extra); assert.deepEqual(note.custom, { kept: true });
  assert.deepEqual(note.aliases, ['旧别名', '原标题']); assert.equal(note.legacyPath, 'old-project/old.md');
  assert.equal(note.fileExtension, 'md'); assert.equal(next.notes.find(n => n.id === created.id).fileExtension, 'md');
  assert.deepEqual(next.folders.find(f => f.id === folderID), metadata.folders[0]);
  assert.equal(metadataView(next).notes.find(n => n.id === noteID).category, '新项目/子分类');
  assert.ok(metadataView(next).categories.includes('空分类/更深层'));
  await store.remove(noteID);
  assert.equal((await load()).notes.find(n => n.id === noteID).trashed, true);
  assert.equal(await fs.readFile(path.join(dir, 'notes', `${noteID}.md`), 'utf8'), body + '\n修改正文\n');
  assert.equal(await fs.readFile(path.join(dir, 'images', noteID, 'pixel.png'), 'utf8'), 'image retained');
  assert.deepEqual((await load()).notes.find(n => n.id === trashID), metadata.notes.find(n => n.id === trashID));
  const sameFolder = await store.create('分类大小写', '项目/fever');
  assert.equal(sameFolder.category, '项目/Fever');
  assert.equal((await load()).folders.filter(f => f.parentID === folderID).length, 1);
  const reopened = new VaultStore(); await reopened.open(dir);
  assert.ok(!reopened.manifest.notes.some(n => n.id === noteID)); assert.equal(await reopened.read(created.id), '# 新笔记\n\n');
  await assert.rejects(fs.access(path.join(dir, 'fever.json')), { code: 'ENOENT' });
});

test('external metadata edits are retained and external trash prevents overwriting note files', async t => {
  const { dir, store, metadata } = await fixture(t);
  metadata.notes[0].name = '外部修改';
  metadata.extra.external = 'kept';
  await fs.writeFile(path.join(dir, 'metadata.json'), JSON.stringify(metadata));
  await store.save(noteID, 'latest body');
  const next = JSON.parse(await fs.readFile(path.join(dir, 'metadata.json'), 'utf8'));
  assert.equal(next.notes[0].name, '外部修改'); assert.equal(next.extra.external, 'kept');
  assert.equal(store.note(noteID).title, '外部修改');
  next.notes[0].trashed = true;
  const text = JSON.stringify(next); await fs.writeFile(path.join(dir, 'metadata.json'), text);
  for (const action of [() => store.save(noteID, 'overwritten'), () => store.update(noteID, 'stale', ''), () => store.remove(noteID)]) await assert.rejects(action(), /不存在/);
  assert.equal(await fs.readFile(path.join(dir, 'notes', `${noteID}.md`), 'utf8'), 'latest body');
  assert.equal(await fs.readFile(path.join(dir, 'metadata.json'), 'utf8'), text);
});

test('FSNotes Git commits and revisions track the original files and metadata', async t => {
  const { dir, store, body } = await fixture(t);
  await store.configure({ author: 'Test', email: 'test@example.com', remote: '' });
  await store.commit('existing FSNotes library');
  assert.equal((await store.git(['status', '--porcelain'])).trim(), '');
  await store.save(noteID, body + '\n版本二'); await store.update(noteID, '重命名', '项目');
  await store.commit('edit FSNotes');
  const history = await store.history(noteID);
  assert.deepEqual(history.map(c => c.message), ['edit FSNotes', 'existing FSNotes library']);
  assert.equal(await store.revision(noteID, history[1].hash), body);
  const tracked = await store.git(['ls-tree', '-r', '--name-only', 'HEAD']);
  assert.ok(tracked.includes('metadata.json')); assert.ok(!tracked.includes('fever.json'));
  assert.ok(tracked.includes('notes/.fsnotes-library'));
  await store.restore(noteID, history[1].hash); assert.equal(await store.read(noteID), body);
});

test('FSNotes fast-forward pull reloads folders, trash and the native snapshot', async t => {
  const { dir, store } = await fixture(t);
  await store.configure({ author: 'Test', email: 'test@example.com', remote: '' });
  await store.commit('initial library');
  const remote = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-fsnotes-remote-'));
  const clone = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-fsnotes-clone-'));
  t.after(() => fs.rm(remote, { recursive: true, force: true })); t.after(() => fs.rm(clone, { recursive: true, force: true }));
  await exec('git', ['init', '--bare', '-b', 'main', remote]);
  await store.git(['remote', 'add', 'origin', remote]); await store.push();
  await exec('git', ['clone', remote, clone]);
  const other = new VaultStore(); await other.open(clone);
  await other.git(['config', '--local', 'user.name', 'Other']); await other.git(['config', '--local', 'user.email', 'other@example.com']);
  const note = await other.create('来自远程', '远程/分类'); await other.remove(rootID);
  await other.commit('remote FSNotes update'); await other.push();
  await store.pull();
  assert.equal(store.note(note.id).category, '远程/分类'); assert.ok(!store.manifest.notes.some(n => n.id === rootID));
  await store.update(noteID, '本地重命名', '项目');
  const next = JSON.parse(await fs.readFile(path.join(dir, 'metadata.json'), 'utf8'));
  assert.ok(next.notes.some(n => n.id === note.id)); assert.equal(next.notes.find(n => n.id === rootID).trashed, true);
  await assert.rejects(fs.access(path.join(dir, 'fever.json')), { code: 'ENOENT' });
});

test('empty FSNotes snapshots stay empty and switching library formats resets the adapter', async t => {
  const { dir, store } = await fixture(t);
  await fs.writeFile(path.join(dir, 'metadata.json'), JSON.stringify({ version: 1, folders: [], notes: [] }));
  assert.equal((await store.open(dir)).manifest.notes.length, 0);
  const empty = path.join(dir, '..', path.basename(dir) + '-native'); await fs.mkdir(empty);
  t.after(() => fs.rm(empty, { recursive: true, force: true }));
  assert.equal((await store.open(empty)).format, 'fever');
  await store.create('native', '收件箱');
  assert.equal(store.manifestFile, 'fever.json');
  assert.equal((await store.open(dir)).format, 'fsnotes');
  assert.equal(store.manifest.notes.length, 0);
});

test('malformed metadata, cycles and symlinked notes are rejected without rewriting the snapshot', async t => {
  const { dir, store, metadata } = await fixture(t);
  const cases = [
    { ...metadata, version: 2 },
    { ...metadata, notes: [...metadata.notes, metadata.notes[0]] },
    { ...metadata, folders: metadata.folders.map(f => ({ ...f, parentID: childID })) },
    { ...metadata, notes: [{ ...metadata.notes[0], fileExtension: '../escape' }] },
    { ...metadata, notes: [{ ...metadata.notes[0], id: '../../escape' }] },
    { ...metadata, notes: [{ ...metadata.notes[0], folderID: trashID }] },
  ];
  for (const next of cases) {
    const text = JSON.stringify(next); await fs.writeFile(path.join(dir, 'metadata.json'), text);
    await assert.rejects(store.open(dir), /无效/);
    assert.equal(await fs.readFile(path.join(dir, 'metadata.json'), 'utf8'), text);
  }
  await fs.writeFile(path.join(dir, 'metadata.json'), JSON.stringify(metadata));
  const outside = path.join(dir, '..', path.basename(dir) + '-outside.md'); await fs.writeFile(outside, 'protected');
  t.after(() => fs.rm(outside, { force: true }));
  await fs.unlink(path.join(dir, 'notes', `${noteID}.md`)); await fs.symlink(outside, path.join(dir, 'notes', `${noteID}.md`));
  await assert.rejects(store.open(dir), /符号链接/);
  assert.equal(await fs.readFile(outside, 'utf8'), 'protected');
});

test('FSNotes drawings use Markdown files and remain editable after reopening', async t => {
  const { dir, store, load } = await fixture(t);
  const { drawingJSON, replaceDrawing, isDrawingNote } = await import('../src/drawings.ts');
  const note = await store.create('架构图', '绘图', 'excalidraw');
  assert.equal(note.filename, `${note.id}.md`); assert.equal(isDrawingNote(note), true);
  const content = await store.read(note.id), scene = JSON.parse(drawingJSON(content));
  assert.equal(scene.type, 'excalidraw');
  scene.elements.push({ id: 'box', type: 'rectangle', x: 1, y: 2 });
  await store.save(note.id, replaceDrawing(content, JSON.stringify(scene)));
  const reopened = new VaultStore(); await reopened.open(dir);
  assert.equal(isDrawingNote(reopened.note(note.id)), true);
  assert.deepEqual(JSON.parse(drawingJSON(await reopened.read(note.id))), scene);
  assert.equal((await load()).notes.find(n => n.id === note.id).fileExtension, 'md');
});

test('sandbox preload accepts nested FSNotes image paths and rejects traversal', async () => {
  let api;
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../electron/preload.cjs'), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } }, ipcRenderer: { invoke() {} } }) });
  assert.equal(api.asset(`../images/${noteID}/pixel.png`), `fever-asset://vault/images/${noteID}/pixel.png`);
  assert.equal(api.asset('../images/flat.PNG'), 'fever-asset://vault/images/flat.PNG');
  assert.equal(api.asset('https://example.com/pixel.png'), 'https://example.com/pixel.png');
  for (const value of ['../images/../secret.png', '../images/a/../../secret.png', '../images/a/%2e%2e/secret.png', '../images/a\\secret.png', '../images/a/file.crt', 'file:///secret.png', 'javascript:alert(1)', 'data:text/html,unsafe']) assert.equal(api.asset(value), '');
});
