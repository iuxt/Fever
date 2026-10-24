const { test } = require('node:test');
const assert = require('node:assert/strict');

test('outline uses Markdown structure, inline text and unique anchors while preserving source lines', async () => {
 const { unified } = await import('unified');
 const { default: parse } = await import('remark-parse');
 const { default: gfm } = await import('remark-gfm');
 const { documentHeadings, headingMarkdown } = await import('../src/headings.ts');
 const source = '---\ntitle: hidden\n---\n# **标题** [链接](https://example.com) `代码`\n\n```sh\n# 注释\n```\n\n## 重复\n\n## 重复\n\nSetext\n------\n';
 const tree = unified().use(parse).use(gfm).parse(headingMarkdown(source));
 const headings = documentHeadings(tree);
 assert.deepEqual(headings.map(({ text, line }) => [text, line]), [['标题 链接 代码', 4], ['重复', 10], ['重复', 12], ['Setext', 14]]);
 assert.equal(new Set(headings.map(h => h.id)).size, 4);
 assert.equal(headings[1].id, 'heading-重复');
 assert.equal(headings[2].id, 'heading-重复-2');
 assert.equal(tree.children.find(n => n.type === 'heading').data.hProperties.id, headings[0].id);
});
