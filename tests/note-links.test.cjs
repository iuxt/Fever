const { test } = require('node:test');
const assert = require('node:assert/strict');

test('internal links resolve known filenames and migrated paths without accepting unsafe or ambiguous paths', async () => {
 const { resolveNoteLink } = await import('../src/noteLinks.ts');
 const note = { id: 'a', filename: 'a.md', sourcePath: '分类/旧笔记.md' };
 for (const href of ['a.md', './a.md', 'notes/a.md', './notes/a.md', '../notes/a.md', 'a.md#heading', '分类/%E6%97%A7%E7%AC%94%E8%AE%B0.md']) {
  assert.equal(resolveNoteLink(href, [note]), note, href);
 }
 for (const href of ['#heading', 'missing.md', '../a.md', '../notes/../a.md', '/a.md', '//host/a.md', 'file:///a.md', 'https://host/a.md', 'javascript:alert(1)', '%2f%2fhost/a.md', '%2e%2e/a.md', '%invalid']) {
  assert.equal(resolveNoteLink(href, [note]), undefined, href);
 }
 assert.equal(resolveNoteLink('a.md', [note, { id: 'b', filename: 'b.md', sourcePath: 'a.md' }]), undefined);
});
