const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readManifest, manifestView, moveCategory, removeCategory, ensureFolder, folderPaths } = require('../electron/manifest.mjs');
const legacy = () => ({ version: 1, categories: ['项目/子分类', '项目/空分类', '目标'], notes: [
 { id: 'a', title: 'A', filename: 'a.md', category: '项目/子分类', createdAt: '', updatedAt: '' },
 { id: 'b', title: 'B', filename: 'b.md', category: '', createdAt: '', updatedAt: '' },
], trash: [{ id: 'c', title: 'C', filename: 'c.md', category: '已删除/原位置', createdAt: '', updatedAt: '' }] });

test('v1 migration normalizes implicit/empty folders, root notes and original trash locations without modifying input', () => {
 const input = legacy(), before = structuredClone(input), manifest = readManifest(input);
 assert.deepEqual(input, before);
 assert.equal(manifest.version, 2); assert.equal(manifest.categories, undefined);
 assert.equal(manifest.folders.length, 4);
 assert.equal(new Set(manifest.folders.map(folder => folder.id)).size, 4);
 for (const folder of manifest.folders) assert.match(folder.id, /^[0-9a-f-]{36}$/);
 assert.equal(manifest.notes[0].category, undefined); assert.ok(manifest.notes[0].folderId);
 assert.equal(manifest.notes[1].folderId, null);
 assert.equal(manifest.trash[0].originalCategory, '已删除/原位置');
 assert.equal(manifest.trash[0].folderId, null);
 assert.equal(manifestView(manifest).notes[0].category, '项目/子分类');
 assert.deepEqual(readManifest(manifest), manifest);
 assert.deepEqual(readManifest(input, manifest), manifest);
 const view = manifestView(manifest); view.folders.push({ id: 'new', name: 'New', parentId: null });
 assert.equal(manifest.folders.length, 4);
});

test('rename and move only modify the targeted folder, leaving IDs, descendants, notes and timestamps byte-identical', () => {
 const manifest = readManifest(legacy()), original = JSON.stringify(manifest.notes), paths = folderPaths(manifest);
 const target = manifest.folders.find(folder => paths.get(folder.id) === '项目');
 const renamed = moveCategory(manifest, '项目', '新项目');
 assert.deepEqual(renamed.folders, manifest.folders.map(folder => folder.id === target.id ? { ...folder, name: '新项目' } : folder));
 const moved = moveCategory(renamed, '新项目', '目标/新项目');
 assert.equal(JSON.stringify(moved.notes), original);
 assert.deepEqual(moved.trash, manifest.trash);
 assert.deepEqual(moved.folders.filter(folder => folder.id !== target.id), manifest.folders.filter(folder => folder.id !== target.id));
 assert.equal(manifestView(moved).notes[0].category, '目标/新项目/子分类');
});

test('v2 rejects duplicate folders, missing parents, cycles, dangling note references and sibling collisions', () => {
 const base = readManifest(legacy()), first = base.folders[0];
 for (const mutate of [
  manifest => manifest.folders.push({ ...first }),
  manifest => { manifest.folders[0].parentId = 'missing'; },
  manifest => { manifest.folders[0].parentId = manifest.folders[1].id; },
  manifest => { manifest.notes[0].folderId = 'missing'; },
  manifest => { delete manifest.notes[0].folderId; },
  manifest => { manifest.folders[0].name = 'bad/name'; },
  manifest => manifest.folders.push({ ...first, id: 'different' }),
  manifest => { manifest.notes[0].originalCategory = 'spoof'; },
  manifest => { manifest.trash[0].originalCategory = 'bad//path'; },
  manifest => { manifest.trash[0].originalCategory = '长'.repeat(201); },
 ]) { const manifest = structuredClone(base); mutate(manifest); assert.throws(() => readManifest(manifest)); }
});

test('deleting folders preserves trash locations through later rename, removal and restoration', () => {
 let manifest = readManifest(legacy());
 manifest = removeCategory(manifest, '项目');
 assert.equal(manifest.trash.find(note => note.id === 'a').originalCategory, '项目/子分类');
 assert.equal(manifest.trash.find(note => note.id === 'a').folderId, null);
 const trash = manifest.trash.find(note => note.id === 'a');
 const id = ensureFolder(manifest, trash.originalCategory);
 manifest.trash = manifest.trash.filter(note => note !== trash);
 const { originalCategory, ...note } = trash; manifest.notes.push({ ...note, folderId: id });
 assert.equal(manifestView(readManifest(manifest)).notes.find(note => note.id === 'a').category, '项目/子分类');
});

test('folder ordering preserves subtree order and references when children precede their parent records', () => {
 const original = readManifest({ version: 1, categories: ['A/first', 'A/second', 'B/empty', 'C'], notes: legacy().notes });
 let ordered = moveCategory(original, 'A', 'A', { target: 'C', position: 'after' });
 assert.deepEqual(manifestView(ordered).categories.slice(0, 6), ['B', 'B/empty', 'C', 'A', 'A/first', 'A/second']);
 ordered = moveCategory(ordered, 'A/second', 'A/second', { target: 'A/first', position: 'before' });
 assert.deepEqual(manifestView(ordered).categories.filter(path => path.startsWith('A/')), ['A/second', 'A/first']);
 ordered = moveCategory(ordered, 'B', 'A/B', { target: 'A/first', position: 'after' });
 assert.deepEqual(manifestView(ordered).categories.slice(0, 7), ['C', 'A', 'A/second', 'A/first', 'A/B', 'A/B/empty', '项目']);
 assert.deepEqual(ordered.notes, original.notes);
 assert.deepEqual(readManifest(ordered), ordered);
 assert.equal(manifestView(original).categories[0], 'A');
});

test('folder ordering rejects invalid positions, missing targets, different parents and cycles without mutation', () => {
 const manifest = readManifest(legacy()), before = structuredClone(manifest);
 for (const [to, placement] of [
  ['项目', null], ['项目', { target: '目标', position: 'invalid' }],
  ['项目', { target: '不存在', position: 'before' }], ['项目', { target: '项目', position: 'after' }],
  ['项目', { target: '项目/子分类', position: 'after' }],
  ['项目/子分类/项目', { target: '项目/子分类', position: 'before' }],
 ]) assert.throws(() => moveCategory(manifest, '项目', to, placement));
 assert.deepEqual(manifest, before);
});
