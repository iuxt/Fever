const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canIgnoreWhitespace, requiresSourceEditing } = require('../electron/markdown-safety.mjs');

test('Markdown filtering retains code, list nesting, hard breaks, YAML and word boundaries', () => {
  const pairs = [
    ['```python\nif enabled:\n    run()\nfinish()\n```\n', '```python\nif enabled:\n    run()\n    finish()\n```\n'],
    ['- parent\n- child\n', '- parent\n  - child\n'],
    ['first\nsecond\n', 'first  \nsecond\n'],
    ['`a b`\n', '`a  b`\n'],
    ['---\nkey:\n  value: 1\n---\nbody\n', '---\nkey:\nvalue: 1\n---\nbody\n'],
    ['alpha beta\n', 'alphabeta\n'],
    ['first\nsecond\n', 'first\n\nsecond\n'],
    ['<!-- keep spaces -->\n', '<!-- keep  spaces -->\n'],
  ];
  for (const [before, after] of pairs) assert.equal(canIgnoreWhitespace('note.md', before, after), false, after);
  assert.equal(canIgnoreWhitespace('note.md', '# Title\n\nalpha beta\n', '#  Title  \n\nalpha  beta\n\n \n'), true);
  assert.equal(canIgnoreWhitespace('note.md', 'paragraph\n', 'paragraph\r\n\r\n'), true);
  assert.equal(canIgnoreWhitespace('script.py', 'x = 1\n', 'x=1\n'), false);
  assert.equal(canIgnoreWhitespace('fever.json', '{"title":"a b"}', '{"title":"a  b"}'), false);
  assert.equal(canIgnoreWhitespace('fever.json', '{"title":"a b"}', '{\n  "title": "a b"\n}'), true);
});

test('source editing protects HTML and footnotes without treating code, autolinks or YAML as HTML', () => {
  for (const content of ['# Title\n\n<!-- private comment -->\n', '<details>\n<summary>Title</summary>\n\nbody\n\n</details>', 'Text[^1]\n\n[^1]: source\n', 'before <span>text</span> after']) assert.equal(requiresSourceEditing(content), true, content);
  for (const content of ['# Title\n\nplain text', '`<span>example</span>`\n', '```html\n<!-- example -->\n[^1]: source\n```\n', 'Text `[^1]`\n', '<https://example.com>\n', '---\nexample: <span>\n---\n\nbody\n']) assert.equal(requiresSourceEditing(content), false, content);
});

test('HTML line breaks in table cells support rich text while other HTML stays protected', () => {
  for (const tag of ['<br>', '<br/>', '<br />', '<BR>']) {
    assert.equal(requiresSourceEditing(`| Name | Details |\n| --- | --- |\n| Server | first${tag}second |\n`), false, tag);
  }
  for (const html of ['<br class="custom">', '<br onclick="run()">', '<br><span>text</span>', '<!-- keep -->']) {
    assert.equal(requiresSourceEditing(`| Details |\n| --- |\n| first${html}second |\n`), true, html);
  }
});

test('preview converts only HTML line breaks and leaves code and other HTML untouched', async () => {
  const { unified } = await import('unified');
  const { default: parse } = await import('remark-parse');
  const { default: gfm } = await import('remark-gfm');
  const { default: breaks } = await import('../src/markdownBreaks.ts');
  const processor = unified().use(parse).use(gfm).use(breaks);
  const tree = processor.runSync(processor.parse('| Details |\n| --- |\n| one<br>two<br/>three<br />four<BR>five |\n\n`<br>`\n\n```html\n<br>\n```\n\n<br class="custom">\n\n<br>\n'));
  const nodes = [];
  const { visit } = await import('unist-util-visit');
  visit(tree, node => { nodes.push(node); });
  assert.equal(nodes.filter(node => node.type === 'break').length, 5);
  assert.equal(nodes.find(node => node.type === 'inlineCode').value, '<br>');
  assert.equal(nodes.find(node => node.type === 'code').value, '<br>');
  assert.deepEqual(nodes.filter(node => node.type === 'html').map(node => node.value), ['<br class="custom">']);
});
