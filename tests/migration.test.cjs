const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const { VaultStore } = require('../electron/vault.cjs');

test('migration preserves Markdown formatting, converts attachments and leaves fenced code untouched', async () => {
 const { rewriteMarkdown } = await import('../scripts/notebook-migration.mjs');
 const input = '# Title\r\n\r\n![[photo.png|图]]\r\n\r\n![Original](../images/photo.png "title")\r\n\r\n[[B|另一个笔记]]\r\n\r\n```toml\r\n[[runners]]\r\n![[photo.png]]\r\n```\r\n\r\n`![[photo.png]]`\r\n';
 const map = { paths: new Map([['images/photo.png', '../images/uuid.png'], ['分类/B.md', 'uuid.md']]), external: new Map() };
 const output = rewriteMarkdown(input, '分类/A.md', map);
 assert.equal(output.replaced, 3); assert.equal(output.unresolved.length, 0);
 assert.ok(output.content.includes('![图](../images/uuid.png)'));
 assert.ok(output.content.includes('![Original](../images/uuid.png "title")'));
 assert.ok(output.content.includes('[另一个笔记](uuid.md)'));
 assert.ok(output.content.includes('```toml\r\n[[runners]]\r\n![[photo.png]]\r\n```'));
 assert.ok(output.content.includes('`![[photo.png]]`'));
});

test('legacy Git images retain original references without changing inline or fenced code', async () => {
 const { unified } = await import('unified');
 const { default: remarkParse } = await import('remark-parse');
 const { visit } = await import('unist-util-visit');
 const { default: remarkLegacyImages } = await import('../src/legacyImages.ts');
 const tree = unified().use(remarkParse).parse('![[photo.png|旧图]]\n\n`![[photo.png]]`\n\n```text\n![[photo.png]]\n```\n');
 remarkLegacyImages()(tree);
 const images = [], code = [];
 visit(tree, node => { if (node.type === 'image') images.push(node); if (node.type === 'code' || node.type === 'inlineCode') code.push(node.value); });
 assert.equal(images.length, 1); assert.equal(images[0].url, 'photo.png'); assert.equal(images[0].alt, '旧图');
 assert.deepEqual(code, ['![[photo.png]]', '![[photo.png]]']);
 assert.equal(images[0].data.hProperties['data-wiki'], 'true');
});

test('migration rewrites only URL destinations, preserving repeated labels, titles and escaped Markdown', async () => {
 const { rewriteMarkdown } = await import('../scripts/notebook-migration.mjs');
 const mapping = { paths: new Map([
  ['photo.png', '../images/image.png'], ['B.md', 'note.md'],
  ['photo(1).png', '../images/parentheses.png'], ['a&b.png', '../images/entity.png'],
 ]), external: new Map() };
 const cases = [
  ['![photo.png](photo.png "photo.png")', '![photo.png](../images/image.png "photo.png")'],
  ['[B.md](B.md)', '[B.md](note.md)'],
  ['![photo.png](<photo.png>)', '![photo.png](<../images/image.png>)'],
  ['[photo.png]: photo.png "photo.png"\r\n\r\n![photo.png][photo.png]\r\n', '[photo.png]: ../images/image.png "photo.png"\r\n\r\n![photo.png][photo.png]\r\n'],
  ['[![photo.png](photo.png)](B.md)', '[![photo.png](../images/image.png)](note.md)'],
  [String.raw`![x](photo\(1\).png)`, '![x](../images/parentheses.png)'],
  ['![x](a&amp;b.png)', '![x](../images/entity.png)'],
  ['| image |\n| --- |\n| ![photo.png](photo.png) |', '| image |\n| --- |\n| ![photo.png](../images/image.png) |'],
 ];
 for (const [input, expected] of cases) {
  const result = rewriteMarkdown(input, 'A.md', mapping);
  assert.deepEqual(result.unresolved, [], input);
  assert.equal(result.content, expected);
 }
});

test('migration maps existing PDF and other attachments before resolving references', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-attachment-test-'));
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 const source = path.join(root, 'old'), destination = path.join(root, 'new');
 await fs.mkdir(path.join(source, 'docs'), { recursive: true });
 const git = async args => (await exec('git', args, { cwd: source })).stdout;
 await git(['init', '-b', 'main']); await git(['config', 'user.name', 'Test']); await git(['config', 'user.email', 'test@example.com']);
 const input = '# Attachments\n\n[PDF](docs/report%20%231.pdf)\n\n[[docs/archive.zip|下载]]\n';
 await fs.writeFile(path.join(source, 'A.md'), input);
 const pdf = Buffer.from('%PDF-1.4\nfixture\n'), zip = Buffer.from([0x50, 0x4b, 0, 1]);
 await fs.writeFile(path.join(source, 'docs/report #1.pdf'), pdf);
 await fs.writeFile(path.join(source, 'docs/archive.zip'), zip);
 await git(['add', '.']); await git(['commit', '-m', 'attachments']);
 const { migrateNotebook } = await import('../scripts/notebook-migration.mjs');
 const result = await migrateNotebook(source, destination);
 assert.equal(result.additionalFiles, 2);
 const manifest = JSON.parse(await fs.readFile(path.join(destination, 'fever.json'), 'utf8'));
 const content = await fs.readFile(path.join(destination, 'notes', manifest.notes[0].filename), 'utf8');
 assert.equal(content, '# Attachments\n\n[PDF](../attachments/docs/report%20%231.pdf)\n\n[下载](../attachments/docs/archive.zip)\n');
 assert.deepEqual(await fs.readFile(path.join(destination, 'attachments/docs/report #1.pdf')), pdf);
 assert.deepEqual(await fs.readFile(path.join(destination, 'attachments/docs/archive.zip')), zip);
 assert.equal(await fs.readFile(path.join(source, 'A.md'), 'utf8'), input);
 assert.equal(await git(['status', '--porcelain']), '');
});

test('migrated vault retains Git lineage, resolves old revisions, and commits images through LFS', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-migration-test-'));
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 const source = path.join(root, 'old'), destination = path.join(root, 'new');
 await fs.mkdir(path.join(source, '分类'), { recursive: true }); await fs.mkdir(path.join(source, 'images'));
 const git = async args => (await exec('git', args, { cwd: source })).stdout;
 await git(['init', '-b', 'main']); await git(['config', 'user.name', 'Test']); await git(['config', 'user.email', 'test@example.com']);
 const first = '![[photo.png]]\n';
 await fs.writeFile(path.join(source, '分类', 'A.md'), first);
 for (const folder of ['.claude', '.superpowers', '.obsidian']) {
  await fs.mkdir(path.join(source, folder), { recursive: true });
  await fs.writeFile(path.join(source, folder, 'internal.md'), '# Internal tool record\n');
 }
 const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N3IAAAAASUVORK5CYII=', 'base64');
 await fs.writeFile(path.join(source, 'images', 'photo.png'), png);
 await git(['add', '.']); await git(['commit', '-m', 'original note']);
 const original = (await git(['rev-parse', 'HEAD'])).trim();
 await git(['mv', '分类/A.md', '分类/B.md']); await git(['commit', '-m', 'old rename']);
 const head = (await git(['rev-parse', 'HEAD'])).trim();
 const { migrateNotebook } = await import('../scripts/notebook-migration.mjs');
 const result = await migrateNotebook(source, destination);
 assert.equal(result.notes, 1); assert.equal(result.localImages, 1); assert.equal(result.preservedCommits, 2);
 const store = new VaultStore(); const vault = await store.open(destination), note = vault.manifest.notes[0];
 assert.equal(Object.hasOwn(vault.manifest, 'assets'), false);
 assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(path.join(destination, 'fever.json'), 'utf8')), 'assets'), false);
 assert.deepEqual((await store.revisionImage(note.id, original, 'photo.png', true)).bytes, png);
 assert.equal(note.title, 'B'); assert.equal(note.category, '分类');
 const history = await store.history(note.id);
 assert.ok(history.some(h => h.hash === original));
 assert.equal(await store.revision(note.id, original), first);
 assert.deepEqual(await store.revisionComparison(note.id, original), { content: first, previousContent: '', previousHash: undefined });
 assert.deepEqual(await store.revisionComparison(note.id, head), { content: first, previousContent: first, previousHash: original });
 const comparison = await store.revisionComparison(note.id, history[0].hash);
 assert.equal(comparison.content, await store.read(note.id));
 assert.match(comparison.previousContent, /!\[photo\]\(\/images\/[a-z0-9-]+\.png\)/);
 // Both the normalization and byte-identical rename commits must have valid images.
 for (const commit of history) {
  const content = await store.revision(note.id, commit.hash);
  const target = content.match(/!\[[^\]]*\]\(([^)]+)\)/)?.[1];
  const image = await store.revisionImage(note.id, commit.hash, target || 'photo.png', !target);
  assert.deepEqual(image.bytes, png, commit.message);
 }
 assert.equal((await git(['rev-parse', 'HEAD'])).trim(), head);
 assert.equal(await git(['status', '--porcelain']), '');
 assert.deepEqual(await fs.readFile(path.join(source, '分类', 'B.md')), Buffer.from(first));
 const image = (await fs.readdir(path.join(destination, 'images')))[0];
 assert.deepEqual(await fs.readFile(path.join(destination, 'images', image)), png);
 assert.match(await store.git(['show', `HEAD:images/${image}`]), /git-lfs.github.com\/spec\/v1/);
 assert.equal((await store.git(['remote'])).trim(), '');
 await assert.rejects(migrateNotebook(source, destination), /already exists/);
});

test('migration bounds streamed downloads and validates image bytes before creating a vault', async t => {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-migration-download-'));
 t.after(() => fs.rm(root, { recursive: true, force: true }));
 const source = path.join(root, 'old'), destination = path.join(root, 'new');
 await fs.mkdir(source);
 const git = async args => (await exec('git', args, { cwd: source })).stdout;
 await git(['init', '-b', 'main']); await git(['config', 'user.name', 'Test']); await git(['config', 'user.email', 'test@example.com']);
 await fs.writeFile(path.join(source, 'A.md'), '![image](https://example.test/image)');
 await git(['add', '.']); await git(['commit', '-m', 'remote image']);
 const { migrateNotebook } = await import('../scripts/notebook-migration.mjs');
 let reads = 0, cancelled = false;
 t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
  pull(controller) { reads++; controller.enqueue(new Uint8Array(1024 * 1024)); if (reads === 30) controller.close(); },
  cancel() { cancelled = true; },
 }), { headers: { 'Content-Type': 'image/png' } }));
 await assert.rejects(migrateNotebook(source, destination), /unavailable remote images: 1/);
 assert.ok(reads < 30, 'must stop reading an oversized stream');
 assert.equal(cancelled, true);
 globalThis.fetch.mock.restore();
 t.mock.method(globalThis, 'fetch', async () => new Response('<html>Not an image</html>', { headers: { 'Content-Type': 'image/png' } }));
 await assert.rejects(migrateNotebook(source, destination), /unavailable remote images: 1/);
 await assert.rejects(fs.access(destination), { code: 'ENOENT' });
 assert.equal(await git(['status', '--porcelain']), '');
});
