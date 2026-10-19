const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp' };

// Each reader is bound to one vault, so an in-flight request cannot read a newly opened vault.
class RevisionImages {
 constructor(root, environment) { this.root = root; this.environment = environment; this.trees = new Map(); }
 async git(args, input) {
  const task = exec('git', args, { cwd: this.root, env: { ...this.environment, GIT_LFS_SKIP_SMUDGE: '0', GIT_LFS_SKIP_DOWNLOAD_ERRORS: '0' }, encoding: 'buffer', windowsHide: true, timeout: 120000, maxBuffer: MAX_IMAGE_BYTES });
  task.child.stdin.on('error', () => {}); // A command that exits early is reported by execFile below.
  task.child.stdin.end(input);
  try { return (await task).stdout; }
  catch (e) { throw new Error((e.stderr?.toString() || e.message).trim()); }
 }
 async tree(hash) {
  if (!/^[0-9a-f]{40,64}$/.test(hash)) throw new Error('提交标识无效');
  if (!this.trees.has(hash)) {
   const task = this.git(['ls-tree', '-rz', '--full-tree', hash]).then(bytes => {
    const files = new Map();
    for (const record of bytes.toString('utf8').split('\0')) {
     const tab = record.indexOf('\t');
     if (tab < 0) continue;
     const [mode, type, oid] = record.slice(0, tab).split(' ');
     // Never follow a Git symlink or expose arbitrary repository files as images.
     const filename = record.slice(tab + 1);
     if (type === 'blob' && /^100(644|755)$/.test(mode) && mimeTypes[path.posix.extname(filename).toLowerCase()]) files.set(filename, oid);
    }
    return files;
   });
   this.trees.set(hash, task);
   if (this.trees.size > 4) this.trees.delete(this.trees.keys().next().value);
   task.catch(() => { if (this.trees.get(hash) === task) this.trees.delete(hash); });
  }
  return this.trees.get(hash);
 }
 async resolve(hash, notePath, source, wiki = false) {
  if (typeof source !== 'string' || !source || source.length > 8192 || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(source)) throw new Error('历史图片必须引用仓库内的文件');
  // Strip URL query/fragment before decoding, so encoded # and ? remain filename characters.
  let target = source.split(/[?#]/, 1)[0];
  try { target = decodeURIComponent(target); } catch { throw new Error('图片路径编码无效'); }
  target = target.replaceAll('\\', '/');
  if (!target || /[\0-\x1f\x7f]/.test(target) || /^[a-z]:/i.test(target) || target.startsWith('//')) throw new Error('图片路径无效');
  const rootPath = path.posix.normalize(target.replace(/^\//, ''));
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(notePath), target));
  const candidates = target.startsWith('/') ? [rootPath] : wiki ? [relative, rootPath] : [relative];
  const files = await this.tree(hash);
  for (const candidate of candidates) {
   if (candidate !== '..' && !candidate.startsWith('../') && files.has(candidate)) return { path: candidate, oid: files.get(candidate) };
  }
  if (wiki && !target.startsWith('/') && !target.split('/').includes('..')) {
   const matches = [...files.keys()].filter(file => file === rootPath || file.endsWith('/' + rootPath));
   if (matches.length === 1) return { path: matches[0], oid: files.get(matches[0]) };
   if (matches.length > 1) throw new Error('历史图片名称重复，请使用完整路径');
  }
  throw new Error('这个提交中找不到引用的图片');
 }
 async read(hash, notePath, source, wiki = false) {
  const file = await this.resolve(hash, notePath, source, wiki);
  const size = Number((await this.git(['cat-file', '-s', file.oid])).toString().trim());
  if (!size || size > MAX_IMAGE_BYTES) throw new Error('历史图片最大为 20 MB');
  let bytes = await this.git(['cat-file', 'blob', file.oid]);
  if (bytes.subarray(0, 80).toString().startsWith('version https://git-lfs.github.com/spec/v1')) {
   const pointer = bytes.toString('utf8');
   const oid = pointer.match(/^oid sha256:([0-9a-f]{64})\r?$/m)?.[1];
   const length = Number(pointer.match(/^size (\d+)\r?$/m)?.[1]);
   if (!oid || !Number.isSafeInteger(length) || length <= 0 || length > MAX_IMAGE_BYTES) throw new Error('历史 LFS 图片指针无效或超过 20 MB');
   try {
    // Smudge reads the exact OID locally, fetching it from the configured remote when missing.
    // It respects custom LFS storage and worktrees, without modifying the index or worktree.
    bytes = await this.git(['-c', 'lfs.skipdownloaderrors=false', '-c', 'lfs.fetchinclude=', '-c', 'lfs.fetchexclude=', 'lfs', 'smudge', '--', file.path], bytes);
   } catch { throw new Error('历史 LFS 图片不可用，请检查 Git LFS 和远程仓库连接'); }
   if (bytes.length !== length || createHash('sha256').update(bytes).digest('hex') !== oid) throw new Error('历史 LFS 图片校验失败');
  }
  return { bytes, mime: mimeTypes[path.posix.extname(file.path).toLowerCase()], path: file.path };
 }
}

module.exports = { RevisionImages };
