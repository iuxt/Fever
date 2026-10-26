const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { VaultStore } = require('../electron/vault.cjs');

async function fixture(t) {
 const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-git-activity-'));
 t.after(() => fs.rm(scratch, { recursive: true, force: true }));
 const dir = path.join(scratch, 'vault'); await fs.mkdir(dir);
 const store = new VaultStore(); await store.open(dir);
 await store.configure({ author: 'Activity Test', email: 'activity@example.com', remote: '' });
 await store.git(['config', '--local', 'core.autocrlf', 'false']);
 return { scratch, dir, store };
}

test('commit summaries describe the root commit and the actual staged snapshot', async t => {
 const { dir, store } = await fixture(t);
 const root = await store.commit('first');
 assert.equal(root.committed, true);
 assert.equal(root.hash, (await store.git(['rev-parse', 'HEAD'])).trim());
 assert.deepEqual(new Set(root.changes.map(change => change.path)), new Set(['.gitattributes', 'fever.json', `notes/${store.manifest.notes[0].filename}`]));
 assert.ok(root.changes.every(change => change.status === 'A'));
 const tracked = 'notes/tracked.txt', unstaged = 'notes/unstaged.txt';
 await fs.writeFile(path.join(dir, tracked), 'staged content\n'); await store.stage(tracked);
 await fs.writeFile(path.join(dir, tracked), 'later working content\n');
 await fs.writeFile(path.join(dir, unstaged), 'not selected\n');
 const result = await store.commit('selected only', true);
 assert.deepEqual(result.changes, [{ status: 'A', path: tracked }]);
 assert.equal(await store.git(['show', `HEAD:${tracked}`]), 'staged content\n');
 assert.equal(await fs.readFile(path.join(dir, tracked), 'utf8'), 'later working content\n');
});

test('pull summaries cover the full pulled range, retain exact paths and expose immutable differences', async t => {
 const { scratch, dir, store } = await fixture(t);
 const remote = path.join(scratch, 'remote.git'), clone = path.join(scratch, 'writer');
 const modified = 'notes/modified.txt', deleted = 'notes/deleted.txt', old = 'notes/old.txt', renamed = 'notes/renamed.txt', reverted = 'notes/reverted.txt';
 const added = process.platform === 'win32' ? 'notes/中文 [1].txt' : 'notes/中文\t[1]\n.txt';
 for (const file of [modified, deleted, old, reverted]) await fs.writeFile(path.join(dir, file), `${file} original\n`);
 await store.commit('initial');
 const before = (await store.git(['rev-parse', 'HEAD'])).trim();
 await store.git(['init', '--bare', '--initial-branch=main', remote]);
 await store.git(['remote', 'add', 'origin', remote]); await store.push();
 await store.git(['clone', remote, clone]);
 const writer = new VaultStore(); await writer.open(clone);
 await writer.configure({ author: 'Writer', email: 'writer@example.com', remote: '' });
 await writer.git(['remote', 'add', 'origin', remote]);
 await fs.writeFile(path.join(clone, modified), 'intermediate remote content\n');
 await fs.writeFile(path.join(clone, reverted), 'temporary change\n');
 await writer.commit('remote one');
 await fs.writeFile(path.join(clone, modified), 'final remote content\n');
 await fs.writeFile(path.join(clone, reverted), `${reverted} original\n`);
 await fs.unlink(path.join(clone, deleted));
 await writer.git(['mv', '--', old, renamed]);
 await fs.writeFile(path.join(clone, added), 'new content\n');
 await writer.commit('remote two'); await writer.push();
 const result = await store.pull();
 assert.equal(result.before, before);
 assert.equal(result.after, (await writer.git(['rev-parse', 'HEAD'])).trim());
 assert.equal(result.commitCount, 2);
 assert.deepEqual(new Map(result.changes.map(change => [change.path, change.status])), new Map([[modified, 'M'], [deleted, 'D'], [renamed, 'R'], [added, 'A']]));
 assert.equal(result.changes.find(change => change.path === renamed).originalPath, old);
 const diff = await store.pullDiff(result.before, result.after, modified);
 assert.match(diff.patch, /-notes\/modified.txt original/);
 assert.match(diff.patch, /\+final remote content/);
 assert.doesNotMatch(diff.patch, /intermediate/);
 assert.match((await store.pullDiff(result.before, result.after, deleted)).patch, /deleted file mode/);
 assert.match((await store.pullDiff(result.before, result.after, renamed, old)).patch, /rename from notes\/old.txt/);
 assert.match((await store.pullDiff(result.before, result.after, added)).patch, /\+new content/);
 assert.match((await store.pullDiff('', result.after, modified)).patch, /\+final remote content/);
 // Local edits after the pull must never enter the recorded remote comparison.
 await fs.writeFile(path.join(dir, modified), 'later local changes\n');
 assert.equal((await store.pullDiff(result.before, result.after, modified)).patch, diff.patch);
 await store.git(['restore', '--', modified]);
 const unchanged = await store.pull();
 assert.deepEqual(unchanged, { before: result.after, after: result.after, commitCount: 0, changes: [] });
 await assert.rejects(store.pullDiff('invalid', result.after, modified), /提交标识无效/);
 await assert.rejects(store.pullDiff(result.before, result.after, '../outside'), /不允许|无效/);
});
