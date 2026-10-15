const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { VaultStore } = require('../electron/vault.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N3IAAAAASUVORK5CYII=', 'base64');

test('external image replacement preserves Markdown, code, frontmatter and ordinary links', async () => {
 const { externalImageUrls, replaceExternalImages } = await import('../src/externalImages.ts');
 const url = 'https://example.com/image(1)?a=1&b=2';
 const input = '---\r\nimage: ![property](https://example.com/property.png)\r\n---\r\n\r\n' +
  String.raw`[![图](https://example.com/image\(1\)?a=1&amp;b=2 "标题")](https://example.com/page)` + '\r\n\r\n' +
  '![再次引用](<https://example.com/image(1)?a=1&b=2>)\r\n\r\n' +
  '![引用][shared]\r\n\r\n[网站][shared]\r\n\r\n[shared]: https://example.com/ref "保留标题"\r\n\r\n' +
  '`![code](https://example.com/code.png)`\r\n\r\n```md\r\n![fenced](https://example.com/fenced.png)\r\n```\r\n\r\n' +
  '![local](../images/local.png)\r\n\r\n[普通链接](https://example.com/file.png)\r\n';
 assert.deepEqual(externalImageUrls(input), [url, 'https://example.com/ref']);
 const result = replaceExternalImages(input, { [url]: '../images/a.png', 'https://example.com/ref': '../images/b.png' });
 assert.equal(result.replaced, 3);
 assert.equal(result.content, input
  .replace(String.raw`https://example.com/image\(1\)?a=1&amp;b=2`, '../images/a.png')
  .replace('<https://example.com/image(1)?a=1&b=2>', '<../images/a.png>')
  .replace('![引用][shared]', '![引用](../images/b.png "保留标题")'));
 assert.deepEqual(externalImageUrls('![shortcut]\n\n[shortcut]: https://example.com/ref'), ['https://example.com/ref']);
 assert.deepEqual(externalImageUrls(result.content), []);
 const table = '| 图片 |\n| --- |\n| ![图](https://example.com/table.png) |';
 assert.equal(replaceExternalImages(table, { 'https://example.com/table.png': '../images/table.png' }).content, table.replace('https://example.com/table.png', '../images/table.png'));
});

test('downloads deduplicated images through redirects, rejects invalid/oversized files, and stores Git LFS assets', async t => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-remote-images-'));
 t.after(() => fs.rm(dir, { recursive: true, force: true }));
 let requests = 0;
 const server = http.createServer((request, response) => {
  if (request.url === '/redirect') { response.writeHead(302, { location: '/image' }); response.end(); }
  else if (request.url === '/image') { requests++; response.writeHead(200, { 'content-type': 'application/octet-stream' }); response.end(png); }
  else if (request.url === '/fake.png') { response.writeHead(200, { 'content-type': 'image/png' }); response.end('<html>not an image</html>'); }
  else if (request.url === '/large') { response.writeHead(200, { 'content-length': 21 * 1024 * 1024 }); response.end(); }
  else if (request.url === '/chunked') { response.writeHead(200); response.end(Buffer.alloc(21 * 1024 * 1024)); }
  else { response.writeHead(404); response.end(); }
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
 const base = `http://127.0.0.1:${server.address().port}`;
 const store = new VaultStore(); await store.open(dir);
 if (!store.lfs) { t.skip('Git LFS not installed'); return; }
 const note = store.snapshot().manifest.notes[0];
 const result = await store.localizeImages([`${base}/redirect`, `${base}/redirect`, `${base}/fake.png`, `${base}/missing`, `${base}/large`, `${base}/chunked`], note.id);
 assert.equal(requests, 1);
 assert.equal(Object.keys(result.replacements).length, 1);
 assert.equal(result.failed.length, 4);
 assert.match(result.failed[0].message, /不是支持/);
 assert.match(result.failed[1].message, /404/);
 assert.match(result.failed[2].message, /20 MB/);
 assert.match(result.failed[3].message, /20 MB/);
 const relative = result.replacements[`${base}/redirect`];
 assert.equal(path.posix.dirname(relative), `../images/${note.id}`);
 assert.match(path.posix.basename(relative), /^\d{4}-\d{2}-\d{2}-\d{6}-\d{3}\.png$/);
 assert.deepEqual(await fs.readFile(path.join(dir, relative.slice(3))), png);
 assert.equal((await fs.readdir(path.join(dir, 'images'))).length, 1);
 await store.configure({ author: 'Test', email: 'test@example.com', remote: '' });
 await store.commit('localize images');
 assert.match(await store.git(['show', `HEAD:${relative.slice(3)}`]), /git-lfs.github.com\/spec\/v1/);
 await assert.rejects(store.localizeImages(['file:///tmp/image.png'], note.id), /无效/);
 store.lfs = false;
 await assert.rejects(store.localizeImages([`${base}/image`], note.id), /Git LFS/);
 assert.equal(requests, 1);
});

test('slow downloads allow autosaves and cannot write into a switched vault', { timeout: 5000 }, async t => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-remote-switch-'));
 t.after(() => fs.rm(dir, { recursive: true, force: true }));
 const store = new VaultStore(); await store.open(dir);
 if (!store.lfs) { t.skip('Git LFS not installed'); return; }
 let received, release;
 const waiting = new Promise(resolve => { received = resolve; });
 const server = http.createServer((_request, response) => { release = () => response.end(png); received(); });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
 const note = store.snapshot().manifest.notes[0];
 const conversion = store.localizeImages([`http://127.0.0.1:${server.address().port}/image`], note.id);
 await waiting;
 await store.save(note.id, 'edited while downloading');
 assert.equal(await store.read(note.id), 'edited while downloading');
 const other = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-remote-other-'));
 t.after(() => fs.rm(other, { recursive: true, force: true }));
 await store.open(other);
 release();
 const result = await conversion;
 assert.deepEqual(result.replacements, {});
 assert.match(result.failed[0].message, /笔记库已变化/);
 assert.deepEqual(await fs.readdir(path.join(dir, 'images')), []);
 assert.deepEqual(await fs.readdir(path.join(other, 'images')), []);
});
