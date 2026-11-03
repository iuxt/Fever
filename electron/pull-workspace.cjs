const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual: equal } = require('node:util');
const { isUtf8 } = require('node:buffer');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readBounded, MAX_NOTE_BYTES } = require('./files.cjs');
const { readManifest } = require('./manifest.mjs');
const exec = promisify(execFile);
const MANIFEST = 'fever.json';
const conflict = files => new Error(`本地与远端修改存在冲突，已保留本地内容，请先处理这些文件：${files.join('、')}`);

// Merge metadata by stable record ID, rather than by the lines JSON happens to use.
// A timestamp records either side's latest save; other competing field edits conflict.
function mergeValue(base, local, remote, key = '') {
  if (equal(local, remote) || equal(base, remote)) return local;
  if (equal(base, local)) return remote;
  if (key === 'updatedAt' && [local, remote].every(value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))) return local > remote ? local : remote;
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote) && ['notes', 'trash', 'folders'].includes(key)) {
    const map = list => new Map(list.map(record => [record.id, record]));
    const b = map(base), l = map(local), r = map(remote);
    const order = list => list.filter(record => b.has(record.id)).map(record => record.id);
    const reordered = list => { const ids = new Set(list.map(record => record.id)); return !equal(order(list), base.filter(record => ids.has(record.id)).map(record => record.id)); };
    const localReordered = reordered(local), remoteReordered = reordered(remote);
    if (localReordered && remoteReordered && !equal(order(local), order(remote))) throw conflict([MANIFEST]);
    const first = localReordered ? local : remote, second = first === local ? remote : local;
    const ids = [...new Set([...first, ...second, ...base].map(record => record.id))];
    return ids.map(id => mergeValue(b.get(id), l.get(id), r.get(id))).filter(record => record !== undefined);
  }
  if ([base, local, remote].every(value => value && typeof value === 'object' && !Array.isArray(value))) {
    const result = {};
    for (const field of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const value = mergeValue(base[field], local[field], remote[field], field);
      if (value !== undefined) Object.defineProperty(result, field, { value, enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  throw conflict([MANIFEST]);
}

async function blob(store, oid) {
  return (await exec('git', ['cat-file', 'blob', oid], { cwd: store.root, env: store.environment, encoding: 'buffer', timeout: 120000, maxBuffer: 12 * 1024 * 1024 })).stdout;
}
async function treeEntry(store, tree, file) {
  const raw = await store.git(['ls-tree', '-z', tree, '--', `:(literal)${file}`]);
  const match = /^(100644|100755) blob ([0-9a-f]+)\t/.exec(raw);
  return match ? { mode: match[1], oid: match[2] } : null;
}
async function mergeText(store, base, local, remote, file, directory) {
  if (local.equals(remote) || base.equals(remote)) return local;
  if (base.equals(local)) return remote;
  if (file === MANIFEST) {
    try {
      const parse = bytes => { const manifest = readManifest(JSON.parse(bytes.toString('utf8')), store.manifest); return { ...manifest, trash: manifest.trash || [] }; };
      const merged = mergeValue(parse(base), parse(local), parse(remote));
      return Buffer.from(JSON.stringify(readManifest(merged), null, 2) + '\n');
    } catch { throw conflict([file]); }
  }
  if ([base, local, remote].some(bytes => !isUtf8(bytes) || bytes.includes(0))) throw conflict([file]);
  await fs.writeFile(path.join(directory, 'base'), base);
  await fs.writeFile(path.join(directory, 'local'), local);
  await fs.writeFile(path.join(directory, 'remote'), remote);
  try {
    return (await exec('git', ['merge-file', '-p', '--', path.join(directory, 'local'), path.join(directory, 'base'), path.join(directory, 'remote')], { cwd: store.root, env: store.environment, encoding: 'buffer', timeout: 120000, maxBuffer: 12 * 1024 * 1024 })).stdout;
  } catch (error) {
    if (typeof error.code === 'number' && error.code > 0 && error.code < 128) throw conflict([file]);
    throw new Error(`无法合并文件 ${file}：${error.message}`);
  }
}

// Preflight all overlapping files without changing HEAD, the index or the worktree.
// The actual fast-forward can then leave disjoint local files entirely untouched.
async function prepareWorkspace(store, head, target, changes) {
  const remote = (await store.git(['diff', '--no-renames', '--name-only', '-z', head, target, '--'])).split('\0').filter(Boolean);
  const local = [...new Set(changes.flatMap(change => [change.path, ...(change.originalPath ? [change.originalPath] : [])]))];
  const remotePaths = new Set(remote), localPaths = new Set(local), collisions = new Set();
  const overlaps = local.filter(file => remotePaths.has(file));
  const parents = (file, paths, report) => {
    for (let index = file.lastIndexOf('/'); index >= 0; index = file.lastIndexOf('/', index - 1)) {
      const parent = file.slice(0, index);
      if (paths.has(parent)) collisions.add(report || parent);
    }
  };
  local.forEach(file => parents(file, remotePaths, file));
  remote.forEach(file => parents(file, localPaths));
  if (collisions.size) throw conflict([...collisions]);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fever-pull-'));
  const files = [];
  try {
    for (const file of overlaps) {
      const before = await treeEntry(store, head, file), incoming = await treeEntry(store, target, file);
      const indexed = /^(100644|100755) ([0-9a-f]+) 0\t/.exec(await store.git(['ls-files', '--stage', '-z', '--', `:(literal)${file}`]));
      const absolute = await store.safe(file);
      const stat = await fs.lstat(absolute).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      // Adds, deletes, renames, symlinks and competing mode changes need an explicit decision.
      if (!before || !incoming || !indexed || !stat?.isFile() || changes.some(change => change.path === file && /[RCDU?!]/.test(change.status)) || before.mode !== incoming.mode || before.mode !== indexed[1]) throw conflict([file]);
      const working = await readBounded(absolute), index = await blob(store, indexed[2]);
      const base = await blob(store, before.oid), theirs = await blob(store, incoming.oid);
      const mergedWork = await mergeText(store, base, working, theirs, file, directory);
      const mergedIndex = await mergeText(store, base, index, theirs, file, directory);
      if (mergedWork.length > MAX_NOTE_BYTES || mergedIndex.length > MAX_NOTE_BYTES) throw new Error(`合并后文件超过 10 MB，已保留本地内容：${file}`);
      files.push({ path: file, work: working.toString('base64'), index: index.toString('base64'), mode: indexed[1], workMode: stat.mode & 0o777, mergedWork, mergedIndex });
    }
    return files;
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

async function writeVersion(store, file, content, indexContent, mode, workMode) {
  const absolute = await store.safe(file), temporary = await store.safe(`${path.posix.dirname(file)}/.fever-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, content, { mode: workMode });
    await fs.chmod(temporary, workMode);
    await fs.rename(temporary, absolute);
    const oid = (await store.git(['hash-object', '-w', '--no-filters', '--', absolute])).trim();
    let indexOid = oid;
    if (!content.equals(indexContent)) {
      await fs.writeFile(temporary, indexContent);
      indexOid = (await store.git(['hash-object', '-w', '--no-filters', '--', temporary])).trim();
    }
    await store.git(['update-index', '--add', '--cacheinfo', mode, indexOid, file]);
  } finally { await fs.rm(temporary, { force: true }); }
}

async function applyWorkspace(store, head, target, files) {
  if (!files.length) { await store.git(['merge', '--ff-only', target]); return; }
  for (const file of files) {
    const current = await readBounded(await store.safe(file.path));
    const indexed = await store.git(['ls-files', '--stage', '-z', '--', `:(literal)${file.path}`]);
    const match = /^(100644|100755) ([0-9a-f]+) 0\t/.exec(indexed);
    if (!current.equals(Buffer.from(file.work, 'base64')) || !match || match[1] !== file.mode || !(await blob(store, match[2])).equals(Buffer.from(file.index, 'base64'))) throw new Error(`本地文件已变化，请重新拉取：${file.path}`);
  }
  // Keep an on-disk copy until the fast-forward and both local versions are restored.
  const backup = path.resolve(store.root, (await store.git(['rev-parse', '--git-path', `fever-pull-${randomUUID()}.json`])).trim());
  await fs.writeFile(backup, JSON.stringify({ head, target, files: files.map(({ mergedWork, mergedIndex, ...file }) => file) }), { flag: 'wx', mode: 0o600 });
  try {
    await store.gitPaths(['restore', '--source=HEAD', '--staged', '--worktree'], files.map(file => file.path));
    await store.git(['merge', '--ff-only', target]);
    for (const file of files) await writeVersion(store, file.path, file.mergedWork, file.mergedIndex, file.mode, file.workMode);
  } catch (error) {
    try {
      if ((await store.git(['rev-parse', 'HEAD'])).trim() === target) {
        await store.gitPaths(['restore', '--source=HEAD', '--staged', '--worktree'], files.map(file => file.path));
        // Reverse only the incoming tree changes; reset would unstage or remove
        // unrelated local additions that the forward merge correctly preserved.
        await store.git(['read-tree', '-u', '-m', target, head]);
        await store.git(['update-ref', '-m', 'fever: roll back pull', 'HEAD', head, target]);
      }
      for (const file of files) await writeVersion(store, file.path, Buffer.from(file.work, 'base64'), Buffer.from(file.index, 'base64'), file.mode, file.workMode);
    } catch (rollback) {
      throw new Error(`拉取未完成，本地内容备份已保留在 ${backup}。${rollback.message}`);
    }
    await fs.rm(backup, { force: true }).catch(() => {});
    throw error;
  }
  await fs.rm(backup, { force: true }).catch(() => {});
}

module.exports = { prepareWorkspace, applyWorkspace };
