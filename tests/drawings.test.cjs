const { test } = require('node:test');
const assert = require('node:assert/strict');
const LZString = require('lz-string');
const scene = JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} });

test('Obsidian drawing decoding and edits preserve surrounding Markdown and compression', async () => {
 const { drawingJSON, replaceDrawing, isLegacyDrawing } = await import('../src/drawings.ts');
 for (const format of ['json', 'compressed-json']) {
  const prefix = '---\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n---\n\n# Excalidraw Data\n\n## Text Elements\nOriginal text ^id\n\n%%\n## Drawing\n';
  const data = format === 'json' ? scene : LZString.compressToBase64(scene).match(/.{1,30}/g).join('\n\n');
  const content = prefix + '```' + format + '\n' + data + '\n```\n%%\n\nCustom notes\n';
  assert.equal(isLegacyDrawing(content), true);
  assert.equal(drawingJSON(content).trim(), scene);
  const next = JSON.stringify({ ...JSON.parse(scene), appState: { viewBackgroundColor: '#fefefe' } });
  const edited = replaceDrawing(content, next);
  assert.ok(edited.startsWith(prefix + '```' + format + '\n'));
  assert.ok(edited.endsWith('\n```\n%%\n\nCustom notes\n'));
  assert.equal(drawingJSON(edited).trim(), next);
 }
 const windows = '---\r\nexcalidraw-plugin: parsed\r\n---\r\n## Drawing\r\n```compressed-json\r\n' + LZString.compressToBase64(scene) + '\r\n```\r\n%%\r\n';
 assert.equal(drawingJSON(windows), scene);
 assert.ok(replaceDrawing(windows, scene).endsWith('\r\n```\r\n%%\r\n'));
 assert.equal(isLegacyDrawing('---\ntitle: Normal\n---\nexcalidraw-plugin: parsed\n---\n'), false);
 assert.equal(drawingJSON(scene), scene);
 assert.throws(() => drawingJSON('---\nexcalidraw-plugin: parsed\n---\nmissing'), /找不到/);
});

test('drawing references resolve stable filenames, migrated paths and unique names safely', async () => {
 const { resolveDrawing } = await import('../src/drawings.ts');
 const notes = [{ id: 'a', filename: 'abc.excalidraw', title: '架构图', directory: 'drawings' }, { id: 'b', filename: 'legacy.md', title: '旧图.excalidraw', sourcePath: 'Excalidraw/旧图.excalidraw.md' }];
 for (const reference of ['../drawings/abc.excalidraw', './drawings/abc.excalidraw', 'drawings/abc.excalidraw', 'abc.excalidraw', '架构图', '架构图.excalidraw']) assert.equal(resolveDrawing(reference, notes)?.id, 'a');
 assert.equal(resolveDrawing('../notes/legacy.md', notes)?.id, 'b');
 assert.equal(resolveDrawing('Excalidraw/%E6%97%A7%E5%9B%BE.excalidraw.md', notes)?.id, 'b');
 for (const reference of ['https://example.com/abc.excalidraw', '../../abc.excalidraw', '../notes/../abc.excalidraw', '/abc.excalidraw', 'missing.excalidraw']) assert.equal(resolveDrawing(reference, notes), undefined);
 assert.equal(resolveDrawing('架构图', [...notes, { id: 'c', filename: 'other.excalidraw', title: '架构图' }]), undefined);
});

test('wiki drawing embeds leave inline and fenced code literal', async () => {
 const { unified } = await import('unified');
 const { default: remarkParse } = await import('remark-parse');
 const { default: embeds } = await import('../src/drawings.ts');
 const tree = unified().use(remarkParse).parse('![[架构图|概览]]\n\n`![[架构图]]`\n\n```text\n![[架构图]]\n```');
 embeds([{ id: 'a', title: '架构图', filename: 'abc.excalidraw', directory: 'drawings' }])(tree);
 assert.deepEqual(tree.children[0].children[0], { type: 'image', url: '../drawings/abc.excalidraw', alt: '概览', title: null });
 assert.equal(tree.children[1].children[0].value, '![[架构图]]');
 assert.equal(tree.children[2].value, '![[架构图]]');
});
