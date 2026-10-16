const { test } = require('node:test');
const assert = require('node:assert/strict');
const defaults = { caseSensitive: false, wholeWord: false, regex: false };
const search = async (text, query, options = {}, scope = null) => {
 const { findMatches } = await import('../src/articleSearch.ts');
 return findMatches([{ from: 10, text }], query, { ...defaults, ...options }, scope);
};
test('article search escapes literal characters and supports Unicode case and word boundaries', async () => {
 assert.equal((await search('a.b axb A.B', 'a.b')).matches.length, 2);
 assert.equal((await search('a.b axb A.B', 'a.b', { caseSensitive: true })).matches.length, 1);
 assert.equal((await search('cat cats cat_ cat2 猫cat cat猫 cat', 'cat', { wholeWord: true })).matches.length, 2);
 assert.equal((await search('中文 中文词 中文', '中文', { wholeWord: true })).matches.length, 2);
});
test('article search scopes complete matches without changing regex anchors or lookaround context', async () => {
 const { matches } = await search('foo bar foo', 'foo', {}, { from: 11, to: 21 });
 assert.deepEqual(matches.map(({ from, to }) => [from, to]), [[18, 21]]);
 assert.equal((await search('abc', '^b', { regex: true }, { from: 11, to: 12 })).matches.length, 0);
 assert.equal((await search('abc', '(?<=a)b', { regex: true }, { from: 11, to: 12 })).matches.length, 1);
});
test('invalid regex is reported and zero-width regex advances across Unicode characters', async () => {
 assert.equal((await search('text', '[', { regex: true })).error, '正则表达式无效');
 const result = await search('😀a\nb', '^|(?=a)|$', { regex: true });
 assert.deepEqual(result.matches.map(match => match.from), [10, 12, 13, 14, 15]);
});
test('regex replacement expands captures and keeps literal replacement unchanged', async () => {
 const { replacementText } = await import('../src/articleSearch.ts');
 const { matches } = await search('note-42', '(?<name>note)-(\\d+)', { regex: true });
 assert.equal(replacementText(matches[0], '$2-$1-$<name>-$$-$&-$3-$12', true), '42-note-note-$-note-42-$3-note2');
 assert.equal(replacementText(matches[0], '$1', false), '$1');
});
test('article search caps rendered matches and distinguishes exactly-at-limit results', async () => {
 const { matchLimit } = await import('../src/articleSearch.ts');
 assert.equal((await search('a'.repeat(matchLimit), 'a')).limited, false);
 const result = await search('a'.repeat(matchLimit + 1), 'a');
 assert.equal(result.matches.length, matchLimit);
 assert.equal(result.limited, true);
});
