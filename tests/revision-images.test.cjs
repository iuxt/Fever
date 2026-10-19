const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { VaultStore } = require('../electron/vault.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N3IAAAAASUVORK5CYII=', 'base64');

async function fixture(t) {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-revision-images-'));
 t.after(() => fs.rm(dir, { recursive: true, force: true }));
 const store = new VaultStore(); await store.open(dir);
 await store.configure({ author: 'Image Test', email: 'image@example.com', remote: '' });
 const note = store.manifest.notes[0];
 return { dir, store, note, file: `notes/${note.filename}`, head: async () => (await store.git(['rev-parse', 'HEAD'])).trim() };
}

test('historical images resolve relative to the historical Markdown directory across renames and deletions', async t => {
 const { dir, store, note, file, head } = await fixture(t);
 const old = '旧分类/子目录/旧 笔记.md', image = '旧分类/图片 #1.png';
 await fs.mkdir(path.join(dir, '旧分类/子目录'), { recursive: true });
 const content = '# Original\n\n![old](../图片%20%231.png)\n';
 await fs.writeFile(path.join(dir, old), content);
 await fs.rm(path.join(dir, file));
 await fs.writeFile(path.join(dir, image), png);
 await store.git(['add', '.']); await store.git(['commit', '-m', 'original path']);
 const original = await head();
 await store.git(['mv', old, file]); await store.git(['commit', '-am', 'rename note']);
 const renamed = await head();
 await fs.writeFile(path.join(dir, image), Buffer.concat([png, Buffer.from('new bytes')]));
 await store.git(['commit', '-am', 'change image']);
 const changed = await head();
 await fs.rm(path.join(dir, image)); await store.git(['commit', '-am', 'delete image']);
 assert.equal(await store.revisionPath(note.id, original), old);
 assert.deepEqual((await store.revisionImage(note.id, original, '../图片%20%231.png')).bytes, png);
 assert.deepEqual((await store.revisionImage(note.id, renamed, '/旧分类/图片%20%231.png')).bytes, png);
 const latest = await store.revisionImage(note.id, changed, '/旧分类/图片%20%231.png');
 assert.deepEqual(latest.bytes, Buffer.concat([png, Buffer.from('new bytes')]));
 assert.equal(latest.mime, 'image/png');
 // A standard relative reference must not silently resolve to a same-named file elsewhere.
 await assert.rejects(store.revisionImage(note.id, renamed, '../图片%20%231.png'), /找不到/);
});

test('historical wiki images use only that commit, with exact paths preferred and duplicate names rejected', async t => {
 const { dir, store, note, file, head } = await fixture(t);
 await fs.mkdir(path.join(dir, 'old-images'));
 await fs.writeFile(path.join(dir, 'old-images/图.png'), png);
 await store.save(note.id, '# Wiki\n\n![[图.png|旧图]]\n');
 await store.git(['add', '.']); await store.git(['commit', '-m', 'one image']);
 const unique = await head();
 await fs.writeFile(path.join(dir, 'notes/图.png'), Buffer.concat([png, Buffer.from('nearby')]));
 await fs.mkdir(path.join(dir, 'other'));
 await fs.writeFile(path.join(dir, 'other/图.png'), png);
 await store.git(['add', '.']); await store.git(['commit', '-m', 'duplicate names']);
 const duplicate = await head();
 assert.deepEqual((await store.revisionImage(note.id, unique, '图.png', true)).bytes, png);
 assert.deepEqual((await store.revisionImage(note.id, duplicate, '图.png', true)).bytes, Buffer.concat([png, Buffer.from('nearby')]));
 await fs.rm(path.join(dir, 'notes/图.png')); await store.git(['commit', '-am', 'ambiguous wiki image']);
 await assert.rejects(store.revisionImage(note.id, await head(), '图.png', true), /名称重复/);
 assert.deepEqual((await store.revisionImage(note.id, duplicate, 'old-images/图.png', true)).bytes, png);
 assert.deepEqual((await store.revisionImage(note.id, duplicate, '/old-images/图.png')).bytes, png);
 assert.equal(await store.revision(note.id, unique), await fs.readFile(path.join(dir, file), 'utf8'));
});

test('historical image reader rejects unsafe paths, symlinks, non-images, and oversized blobs/pointers', async t => {
 const { dir, store, note, head } = await fixture(t);
 await fs.writeFile(path.join(dir, 'secret.txt'), 'private');
 await fs.symlink('../secret.txt', path.join(dir, 'notes/link.png'));
 await fs.writeFile(path.join(dir, 'notes/huge.png'), Buffer.alloc(20 * 1024 * 1024 + 1));
 await fs.writeFile(path.join(dir, 'notes/pointer.png'), `version https://git-lfs.github.com/spec/v1\noid sha256:${'1'.repeat(64)}\nsize 20971521\n`);
 await store.git(['add', '.']); await store.git(['commit', '-m', 'unsafe image fixtures']);
 const hash = await head();
 for (const source of ['../../secret.png', '..%2f..%2fsecret.png', 'file:///tmp/x.png', '//host/x.png', 'C:/x.png', '%00.png', 'link.png', '../secret.txt', 'missing.png']) {
  await assert.rejects(store.revisionImage(note.id, hash, source), undefined, source);
 }
 await assert.rejects(store.revisionImage(note.id, hash, 'huge.png'), /20 MB/);
 await assert.rejects(store.revisionImage(note.id, hash, 'pointer.png'), /20 MB/);
 await assert.rejects(store.revisionImage(note.id, '--help', 'a.png'), /提交标识无效/);
 await assert.rejects(store.revisionImage('invalid-id', hash, 'a.png'), /不存在/);
});

test('historical LFS images read the exact OID, fetch missing objects, verify bytes, and leave worktree/index untouched', async t => {
 const { dir, store, note, head } = await fixture(t);
 assert.equal(store.lfs, true);
 const image = 'images/history.png', first = png, second = Buffer.concat([png, Buffer.from('second version')]);
 await fs.writeFile(path.join(dir, image), first);
 await store.save(note.id, '# LFS first\n\n![picture](../images/history.png)\n');
 await store.commit('first LFS'); const original = await head();
 await fs.writeFile(path.join(dir, image), second);
 await store.save(note.id, '# LFS second\n\n![picture](../images/history.png)\n');
 await store.commit('second LFS'); const changed = await head();
 const remoteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-lfs-remote-'));
 t.after(() => fs.rm(remoteDir, { recursive: true, force: true }));
 await store.git(['init', '--bare', remoteDir]);
 await store.git(['remote', 'add', 'origin', remoteDir]);
 await store.git(['push', '-u', 'origin', 'main']);
 const originalOid = createHash('sha256').update(first).digest('hex');
 const object = path.join(dir, '.git/lfs/objects', originalOid.slice(0, 2), originalOid.slice(2, 4), originalOid);
 await fs.rm(object);
 await fs.rm(path.join(dir, image));
 const status = await store.git(['status', '--porcelain=v1']);
 assert.deepEqual((await store.revisionImage(note.id, original, '../images/history.png')).bytes, first);
 assert.deepEqual(await fs.readFile(object), first, 'missing object was downloaded');
 assert.deepEqual((await store.revisionImage(note.id, changed, '../images/history.png')).bytes, second);
 assert.equal(await store.git(['status', '--porcelain=v1']), status);
 assert.equal(await head(), changed);
 await assert.rejects(fs.access(path.join(dir, image)), { code: 'ENOENT' });
 await fs.writeFile(object, Buffer.alloc(first.length, 1));
 await assert.rejects(store.revisionImage(note.id, original, '../images/history.png'), /校验失败|不可用/);
 await fs.rm(object);
 await fs.rm(remoteDir, { recursive: true, force: true });
 await assert.rejects(store.revisionImage(note.id, original, '../images/history.png'), /LFS 图片不可用/);
});

test('opening an old vault removes obsolete assets without changing Markdown references', async t => {
 const { dir, store, note } = await fixture(t);
 const content = await store.read(note.id);
 await fs.writeFile(path.join(dir, 'fever.json'), JSON.stringify({ ...store.manifest, assets: { old: '../images/new.png' } }));
 const reopened = new VaultStore();
 const vault = await reopened.open(dir);
 assert.equal(Object.hasOwn(vault.manifest, 'assets'), false);
 assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(path.join(dir, 'fever.json'), 'utf8')), 'assets'), false);
 assert.equal(await reopened.read(note.id), content);
 await reopened.saveFile('fever.json', JSON.stringify({ ...reopened.manifest, assets: { stale: '../images/stale.png' } }));
 assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(path.join(dir, 'fever.json'), 'utf8')), 'assets'), false);
});

for (const autocrlf of [false, true]) {
test(`restoring history imports historical images and preserves code, labels and historical line endings (autocrlf=${autocrlf})`, async t => {
 const { dir, store, note, head } = await fixture(t);
 await store.git(['config', '--local', 'core.autocrlf', String(autocrlf)]);
 await store.git(['config', '--local', 'core.eol', 'lf']);
 await fs.mkdir(path.join(dir, 'legacy'));
 await fs.writeFile(path.join(dir, 'legacy/旧 图.png'), png);
 const original = '# Restore\r\n\r\n![../legacy/旧%20图.png](../legacy/旧%20图.png "title")\r\n\r\n![ref][photo]\r\n\r\n[photo]: ../legacy/旧%20图.png "ref title"\r\n\r\n![[旧 图.png|caption]]\r\n\r\n`![[旧 图.png]]`\r\n\r\n```md\r\n![x](../legacy/旧%20图.png)\r\n```\r\n';
 await store.save(note.id, original);
 await store.git(['add', '.']); await store.git(['commit', '-m', 'legacy references']);
 const hash = await head();
 // Restore preserves the committed blob: Git normalizes CRLF on add when enabled.
 const historical = autocrlf ? original.replace(/\r\n/g, '\n') : original;
 assert.equal(await store.revision(note.id, hash), historical);
 await fs.writeFile(path.join(dir, 'legacy/旧 图.png'), Buffer.concat([png, Buffer.from('current version')]));
 await store.save(note.id, '# Current');
 const restored = await store.restore(note.id, hash);
 assert.equal(restored, await store.read(note.id));
 assert.match(restored, /!\[\.\.\/legacy\/旧%20图\.png\]\(\.\.\/images\/[a-z0-9-]+\/[a-z0-9-]+\.png "title"\)/);
 assert.match(restored, /!\[caption\]\(\.\.\/images\//);
 assert.ok(restored.includes('`![[旧 图.png]]`'));
 const eol = autocrlf ? '\n' : '\r\n';
 assert.ok(restored.includes(`\`\`\`md${eol}![x](../legacy/旧%20图.png)${eol}\`\`\``));
 const paths = [...restored.matchAll(/\.\.\/images\/[a-z0-9-]+\/[a-z0-9-]+\.png/g)].map(match => match[0]);
 for (const relative of paths) assert.deepEqual(await fs.readFile(path.join(dir, relative.slice(3))), png);
 assert.deepEqual(await fs.readFile(path.join(dir, 'legacy/旧 图.png')), Buffer.concat([png, Buffer.from('current version')]));
 assert.equal(Object.hasOwn(store.manifest, 'assets'), false);
});
}

test('failed historical restore cleans imported images and preserves the current note', async t => {
 const { dir, store, note, head } = await fixture(t);
 await fs.writeFile(path.join(dir, 'images/first.png'), png);
 const original = '![available](../images/first.png)\n\n![missing](../images/missing.png)\n';
 await store.save(note.id, original); await store.commit('missing fixture');
 const hash = await head();
 await fs.rm(path.join(dir, 'images/first.png'));
 await store.save(note.id, '# Keep current');
 await assert.rejects(store.restore(note.id, hash), /找不到/);
 assert.equal(await store.read(note.id), '# Keep current');
 assert.deepEqual(await fs.readdir(path.join(dir, 'images', note.id)), []);
});
