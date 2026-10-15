const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isUtf8 } = require('node:buffer');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { downloadImage } = require('./remote-images.cjs');
const { readBounded } = require('./files.cjs');
const MANIFEST = 'fever.json';
const UUID_FILE = /^[a-zA-Z0-9_-]+\.(md|markdown|txt|fountain|excalidraw)$/;
const notePath = note => `${note.directory || 'notes'}/${note.filename}`;
function validateManifest(manifest) {
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.notes) || !Array.isArray(manifest.categories)) throw new Error('不支持的笔记清单格式');
  if (manifest.trash != null && !Array.isArray(manifest.trash)) throw new Error('回收站格式无效');
  const ids = new Set(), files = new Set();
  for (const n of [...manifest.notes, ...(manifest.trash || [])]) {
    if (n?.directory !== undefined && !['notes', 'drawings'].includes(n.directory)) throw new Error('笔记存储目录无效');
    if (!n || typeof n.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(n.id) || typeof n.filename !== 'string' || !UUID_FILE.test(n.filename) || typeof n.title !== 'string' || typeof n.category !== 'string' || (n.sourcePath != null && typeof n.sourcePath !== 'string') || ids.has(n.id) || files.has(n.filename)) throw new Error('笔记清单含有无效或重复的文件记录');
    ids.add(n.id); files.add(n.filename);
  }
  if (!manifest.categories.every(c => typeof c === 'string')) throw new Error('分类格式无效');
  if (manifest.assets != null && (typeof manifest.assets !== 'object' || Array.isArray(manifest.assets) || !Object.values(manifest.assets).every(value => typeof value === 'string'))) throw new Error('图片映射格式无效');
}
function validateDrawing(content) {
  let scene;
  try { scene = JSON.parse(content); } catch { throw new Error('Excalidraw 文件不是有效的 JSON'); }
  if (!scene || scene.type !== 'excalidraw' || !Array.isArray(scene.elements) || scene.elements.some(e => !e || typeof e.id !== 'string' || typeof e.type !== 'string' || !Number.isFinite(e.x) || !Number.isFinite(e.y)) || (scene.appState != null && (typeof scene.appState !== 'object' || Array.isArray(scene.appState))) || (scene.files != null && (typeof scene.files !== 'object' || Array.isArray(scene.files)))) throw new Error('Excalidraw 绘图格式无效');
}
const defaults = { autoCommit: false, interval: 10, author: '', email: '', remote: '', excalidrawCategory: '' };

class VaultStore {
  constructor() {
    this.root = null; this.manifest = null; this.lfs = false; this.tail = Promise.resolve();
    this.searchCache = null; this.statusTask = null; this.operationVersion = 0;
    this.imageImports = new Map();
    this.environment = { ...process.env };
    // Finder-launched macOS apps do not inherit an interactive shell's Homebrew PATH.
    if (process.platform === 'darwin') this.environment.PATH = [...new Set([...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'])].join(path.delimiter);
  }
  queued(fn) { const next = this.tail.then(() => { ++this.operationVersion; return fn(); }); this.tail = next.catch(() => {}); return next; }
  async git(args, allowedFailure = false) {
    if (!this.root) throw new Error('请先打开笔记库');
    try { return (await exec('git', args, { cwd: this.root, env: this.environment, windowsHide: true, timeout: 120000, maxBuffer: 12 * 1024 * 1024 })).stdout; }
    catch (e) { if (allowedFailure) return ''; throw new Error((e.stderr || e.message).trim()); }
  }
  async safe(relative) {
    const target = path.resolve(this.root, relative);
    if (!target.startsWith(this.root + path.sep)) throw new Error('不允许访问笔记库以外的文件');
    let cursor = this.root;
    for (const segment of relative.split(/[\\/]/)) {
      cursor = path.join(cursor, segment);
      try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('笔记库文件不能使用符号链接'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    return target;
  }
  note(id, includeTrash = false) { const note = this.manifest?.notes.find(n => n.id === id) || (includeTrash && this.manifest?.trash?.find(n => n.id === id)); if (!note) throw new Error('笔记不存在'); return note; }
  cancelSearch() { this.searchController?.abort(); this.searchController = null; }
  async search(query, scope) {
    if (scope !== undefined && scope !== 'trash') throw new Error('搜索范围无效');
    this.cancelSearch();
    if (typeof query !== 'string') throw new Error('搜索内容无效');
    if (!query.trim() || !this.manifest) return [];
    const controller = new AbortController(); this.searchController = controller;
    const { signal } = controller, needle = query.toLowerCase(), notes = scope === 'trash' ? (this.manifest.trash || []) : this.manifest.notes;
    // Cache only match booleans for the current query, never whole note bodies.
    if (this.searchCache?.root !== this.root || this.searchCache.query !== needle || this.searchCache.scope !== scope) this.searchCache = { root: this.root, query: needle, scope, files: new Map() };
    const cache = this.searchCache.files;
    const matches = new Set(); let cursor = 0;
    // Keep full Unicode case folding, but hold at most four note bodies in the main
    // process. Only IDs cross IPC; aborted queries stop scheduling file reads.
    const worker = async () => {
      while (!signal.aborted && cursor < notes.length) {
        const note = notes[cursor++];
        if (note.title.toLowerCase().includes(needle) || note.category.toLowerCase().includes(needle)) { matches.add(note.id); continue; }
        try {
          const file = await this.safe(notePath(note));
          if (signal.aborted) return;
          const stat = await fs.stat(file);
          const version = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
          let result = cache.get(note.filename);
          if (!result || result.version !== version) {
            const content = (await readBounded(file, { signal })).toString('utf8');
            if (signal.aborted) return;
            result = { version, matches: content.toLowerCase().includes(needle) };
            cache.set(note.filename, result);
          }
          if (result.matches) matches.add(note.id);
        } catch { /* Missing/unreadable notes do not prevent searching the vault. */ }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(4, notes.length) }, worker));
      if (!signal.aborted) { const files = new Set(notes.map(note => note.filename)); for (const file of cache.keys()) if (!files.has(file)) cache.delete(file); }
      return signal.aborted ? [] : notes.filter(note => matches.has(note.id)).map(note => note.id);
    } finally { if (this.searchController === controller) this.searchController = null; }
  }
  async persist() {
    const text = JSON.stringify(this.manifest, null, 2) + '\n';
    const temp = await this.safe(`.fever-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temp, text);
      await fs.rename(temp, await this.safe(MANIFEST));
    } finally { await fs.rm(temp, { force: true }); }
  }
  snapshot() { return { path: this.root, name: path.basename(this.root), manifest: structuredClone(this.manifest), lfs: this.lfs }; }
  async open(folder) {
    return this.queued(async () => {
      this.cancelSearch();
      this.searchCache = null;
      const root = await fs.realpath(folder);
      const previous = { root: this.root, manifest: this.manifest, lfs: this.lfs };
      this.root = root;
      try {
        let manifest, isNew = false;
        try {
          manifest = JSON.parse(await fs.readFile(await this.safe(MANIFEST), 'utf8'));
          validateManifest(manifest);
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
          // Never silently index or overwrite an unrelated content directory.
          for (const directory of ['notes', 'drawings']) {
            const entries = await fs.readdir(await this.safe(directory)).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
            if (entries.length) throw new Error(`此文件夹包含 ${directory} 文件但没有 fever.json，请选择空文件夹或已有笔记库`);
          }
          manifest = { version: 1, categories: ['收件箱'], notes: [] };
          isNew = true;
        }
        this.manifest = manifest;
        await fs.mkdir(await this.safe('notes'), { recursive: true });
        await fs.mkdir(await this.safe('drawings'), { recursive: true });
        await fs.mkdir(await this.safe('images'), { recursive: true });
        const top = (await this.git(['rev-parse', '--show-toplevel'], true)).trim();
        if (top && await fs.realpath(top) !== root) throw new Error('请选择独立的 Git 仓库根目录，不能选择其他仓库的子目录');
        if (!top) await this.git(['init', '-b', 'main']);
        const attributesFile = await this.safe('.gitattributes');
        const attributes = await fs.readFile(attributesFile, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
        if (!attributes.includes('images/** filter=lfs')) await fs.writeFile(attributesFile, attributes + (attributes && !attributes.endsWith('\n') ? '\n' : '') + 'images/** filter=lfs diff=lfs merge=lfs -text\n');
        this.lfs = Boolean((await this.git(['lfs', 'version'], true)).trim());
        if (this.lfs) await this.git(['lfs', 'install', '--local']);
        await this.persist();
        if (isNew) await this.createInternal('欢迎使用 Fever', '收件箱', '# 欢迎使用 Fever\n\n这是属于你的本地笔记库。让每一个想法，都有迹可循。\n\n## 从这里开始\n\n- 新建笔记，写下第一个想法\n- 使用分类组织你的知识\n- 将图片拖入编辑器，自动保存到 `images/`\n- 在 Git 面板提交备份，查看每篇笔记的历史\n\n> 所有笔记保存在 `notes/` 中，标题与分类由 `fever.json` 管理。\n');
        return this.snapshot();
      } catch (e) { Object.assign(this, previous); throw e; }
    });
  }
  async createInternal(title, category, content, format = 'markdown', sourcePath) {
    title = String(title).trim(); category = String(category).trim();
    if (!title || title.length > 200 || category.length > 200) throw new Error('请输入有效的标题和分类（最多 200 字）');
    if (!['markdown', 'excalidraw'].includes(format)) throw new Error('不支持的文件格式');
    const id = randomUUID(), now = new Date().toISOString();
    const note = { id, filename: id + (format === 'excalidraw' ? '.excalidraw' : '.md'), title, category, createdAt: now, updatedAt: now, ...(sourcePath ? { sourcePath } : {}) };
    const legacyDrawing = /^excalidraw-plugin:[ \t]*\S/m.test(content?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || '');
    if (format === 'excalidraw' || legacyDrawing) note.directory = 'drawings';
    content ??= format === 'excalidraw' ? JSON.stringify({ type: 'excalidraw', version: 2, source: 'Fever', elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }, null, 2) : `# ${title}\n\n`;
    if (format === 'excalidraw') validateDrawing(content);
    const file = await this.safe(notePath(note)), previous = structuredClone(this.manifest);
    await fs.writeFile(file, content, { flag: 'wx' });
    this.manifest.notes.push(note);
    if (category && !this.manifest.categories.includes(category)) this.manifest.categories.push(category);
    try { await this.persist(); }
    catch (e) { this.manifest = previous; await fs.rm(file, { force: true }); throw e; }
    return structuredClone(note);
  }
  create(title, category, format) { return this.queued(() => this.createInternal(title, category, undefined, format)); }
  async read(id, scope) {
    if (scope !== undefined && scope !== 'trash') throw new Error('读取范围无效');
    const note = scope === 'trash' ? this.manifest?.trash?.find(n => n.id === id) : this.note(id);
    if (!note) throw new Error('回收站中找不到这篇笔记');
    return (await readBounded(await this.safe(notePath(note)))).toString('utf8');
  }
  save(id, content) {
    return this.queued(async () => {
      if (typeof content !== 'string' || Buffer.byteLength(content) > 10 * 1024 * 1024) throw new Error('笔记最大为 10 MB');
      const note = this.note(id), file = await this.safe(notePath(note));
      if (note.filename.endsWith('.excalidraw')) validateDrawing(content);
      const temp = await this.safe(`${path.posix.dirname(notePath(note))}/.${randomUUID()}.tmp`);
      try { await fs.writeFile(temp, content); await fs.rename(temp, file); }
      finally { await fs.rm(temp, { force: true }); }
      const updatedAt = note.updatedAt;
      note.updatedAt = new Date().toISOString();
      try { await this.persist(); }
      catch (e) { note.updatedAt = updatedAt; throw e; }
      return { updatedAt: note.updatedAt };
    });
  }
  update(id, title, category) { return this.queued(async () => {
    if (typeof title !== 'string' || !title.trim() || title.length > 200 || typeof category !== 'string' || category.length > 200) throw new Error('标题或分类无效');
    const previous = structuredClone(this.manifest);
    category = category.trim();
    const note = this.note(id); Object.assign(note, { title: title.trim(), category, updatedAt: new Date().toISOString() });
    if (category && !this.manifest.categories.includes(category)) this.manifest.categories.push(category);
    try { await this.persist(); }
    catch (e) { this.manifest = previous; throw e; }
    return structuredClone(note);
  }); }
  remove(id) { return this.queued(async () => {
    const note = this.note(id);
    await this.safe(notePath(note));
    const previous = structuredClone(this.manifest);
    this.manifest.notes = this.manifest.notes.filter(n => n.id !== id);
    (this.manifest.trash ||= []).push(note);
    try { await this.persist(); }
    catch (e) { this.manifest = previous; throw e; }
    this.cancelSearch();
  }); }
  restoreTrash(id) { return this.queued(async () => {
    const note = this.manifest.trash?.find(n => n.id === id);
    if (!note) throw new Error('回收站中找不到这篇笔记');
    const file = await this.safe(notePath(note));
    if (!(await fs.stat(file)).isFile()) throw new Error('笔记正文文件不存在');
    const previous = structuredClone(this.manifest);
    this.manifest.trash = this.manifest.trash.filter(n => n.id !== id);
    this.manifest.notes.push(note);
    if (note.category && !this.manifest.categories.includes(note.category)) this.manifest.categories.push(note.category);
    try { await this.persist(); }
    catch (e) { this.manifest = previous; throw e; }
    return structuredClone(note);
  }); }
  category(category) { return this.queued(async () => {
    if (typeof category !== 'string' || !category.trim() || category.length > 200 || category.split('/').some(c => !c.trim())) throw new Error('分类无效');
    const previous = structuredClone(this.manifest);
    if (!this.manifest.categories.includes(category.trim())) this.manifest.categories.push(category.trim());
    try { await this.persist(); }
    catch (e) { this.manifest = previous; throw e; }
  }); }
  removeCategory(category) { return this.queued(async () => {
    if (typeof category !== 'string' || !category.trim() || category.length > 200 || category.split('/').some(c => !c.trim())) throw new Error('分类无效');
    category = category.trim();
    const contains = value => value === category || value.startsWith(`${category}/`);
    if (!this.manifest.categories.some(contains) && !this.manifest.notes.some(note => contains(note.category))) throw new Error('分类不存在');
    const removed = this.manifest.notes.filter(note => contains(note.category));
    for (const note of removed) await this.safe(notePath(note));
    const previous = structuredClone(this.manifest);
    this.manifest.categories = this.manifest.categories.filter(value => !contains(value));
    this.manifest.notes = this.manifest.notes.filter(note => !contains(note.category));
    if (removed.length) (this.manifest.trash ||= []).push(...removed);
    try { await this.persist(); }
    catch (e) { this.manifest = previous; throw e; }
    this.cancelSearch();
  }); }
  importFile(file) { return this.queued(async () => {
    const content = (await readBounded(file, { message: '导入文件最大为 10 MB' })).toString('utf8');
    if (Buffer.byteLength(content) > 10 * 1024 * 1024) throw new Error('导入文件最大为 10 MB');
    const drawing = /\.excalidraw$/i.test(file);
    const title = (!drawing && content.match(/^#\s+(.+)$/m)?.[1]) || path.basename(file, path.extname(file));
    return this.createInternal(title.slice(0, 200), '收件箱', content, drawing ? 'excalidraw' : 'markdown', path.basename(file));
  }); }
  image(bytes, name, noteId, importId) { return this.queued(async () => {
    if (importId !== undefined && (typeof importId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(importId))) throw new Error('图片导入标识无效');
    let batch = importId && this.imageImports.get(importId);
    if (batch && (batch.root !== this.root || batch.noteId !== noteId)) throw new Error('笔记库或笔记已变化');
    const src = await this.writeImage(bytes, name, noteId);
    if (importId) {
      if (!batch) { batch = { root: this.root, noteId, sources: [] }; this.imageImports.set(importId, batch); }
      batch.sources.push(src);
    }
    return src;
  }); }
  completeImageImport(importId, keep) { return this.queued(async () => {
    const batch = this.imageImports.get(importId);
    if (!batch) return;
    if (!keep) {
      if (this.root !== batch.root) throw new Error('笔记库已变化，无法清理图片');
      // If a save reached disk before reporting failure, preserve its references.
      const note = this.manifest.notes.find(note => note.id === batch.noteId) || this.manifest.trash?.find(note => note.id === batch.noteId);
      const content = note ? (await readBounded(await this.safe(notePath(note)))).toString('utf8') : '';
      for (const src of batch.sources) if (!content.includes(src)) await fs.rm(await this.safe(src.slice(3)), { force: true });
    }
    this.imageImports.delete(importId);
  }); }
  async writeImage(bytes, name, noteId) {
    if (!this.lfs) throw new Error('请先安装 Git LFS 后重新打开笔记库，确保图片通过 LFS 管理');
    const note = this.note(noteId);
    const ext = typeof name === 'string' ? path.extname(name) : '';
    const size = ArrayBuffer.isView(bytes) ? bytes.byteLength : Array.isArray(bytes) ? bytes.length : 0;
    if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'].includes(ext.toLowerCase()) || size > 20 * 1024 * 1024 || !size) throw new Error('支持 PNG/JPEG/GIF/WebP/AVIF 图片，最大 20 MB');
    const buffer = ArrayBuffer.isView(bytes) ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : Buffer.from(bytes);
    const now = new Date(), pad = (value, width = 2) => String(value).padStart(width, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
    await fs.mkdir(await this.safe(`images/${note.id}`), { recursive: true });
    for (let suffix = 0; ; suffix++) {
      const relative = `images/${note.id}/${date}${suffix ? `-${suffix}` : ''}${ext}`;
      const file = await this.safe(relative);
      let handle;
      try {
        handle = await fs.open(file, 'wx');
        await handle.writeFile(buffer); await handle.close(); handle = null;
        return `../${relative}`;
      } catch (e) {
        if (handle) { await handle.close(); await fs.rm(file, { force: true }); }
        if (e.code !== 'EEXIST') throw e;
      }
    }
  }
  async localizeImages(urls, noteId) {
    if (!this.root) throw new Error('请先打开笔记库');
    if (!this.lfs) throw new Error('请先安装 Git LFS 后重新打开笔记库，确保图片通过 LFS 管理');
    if (!Array.isArray(urls) || urls.length > 500 || urls.some(url => typeof url !== 'string' || !/^https?:\/\//i.test(url))) throw new Error('外部图片链接无效，一次最多转换 500 张图片');
    this.note(noteId);
    const root = this.root, replacements = {}, failed = [];
    for (const url of new Set(urls)) {
      try {
        const { bytes, extension } = await downloadImage(url);
        // Network requests must not hold up autosaves or note navigation.
        replacements[url] = await this.queued(() => {
          if (this.root !== root) throw new Error('笔记库已变化，请重新转换');
          return this.writeImage(bytes, `image${extension}`, noteId);
        });
      } catch (e) { failed.push({ url, message: e.name === 'TimeoutError' ? '下载超时' : e.message }); }
    }
    return { replacements, failed };
  }
  status() {
    const root = this.root, version = this.operationVersion;
    if (this.statusTask?.root === root && this.statusTask.version === version) return this.statusTask.promise;
    const task = { root, version };
    task.promise = this.readStatus().then(status => { if (this.root !== root) throw new Error('笔记库已变化'); return status; }).finally(() => { if (this.statusTask === task) this.statusTask = null; });
    this.statusTask = task; return task.promise;
  }
  async readStatus() {
    const raw = await this.git(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
    const fields = raw.split('\0').filter(Boolean), changes = [];
    let branch = 'HEAD', head = '', ahead = 0, behind = 0;
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (field.startsWith('# branch.head ')) { branch = field.slice(14); if (branch === '(detached)') branch = 'HEAD'; continue; }
      if (field.startsWith('# branch.oid ')) { head = field.slice(13); continue; }
      if (field.startsWith('# branch.ab ')) { const counts = field.slice(12).split(' '); ahead = Number(counts[0]) || 0; behind = -(Number(counts[1]) || 0); continue; }
      if (field.startsWith('# ')) continue;
      const parts = field.split(' '), kind = parts[0];
      const code = kind === '?' ? '??' : parts[1].replaceAll('.', ' ');
      const file = kind === '?' ? field.slice(2) : parts.slice(kind === '2' ? 9 : kind === 'u' ? 10 : 8).join(' ');
      const originalPath = kind === '2' ? fields[++i] : undefined;
      changes.push({ status: code.trim(), path: file, staged: code !== '??' && code[0] !== ' ', unstaged: code === '??' || code[1] !== ' ', ...(originalPath ? { originalPath } : {}) });
    }
    return { branch, head, changes, ahead, behind, remote: (await this.git(['remote', 'get-url', 'origin'], true)).trim(), lfs: this.lfs };
  }
  async changeFile(relative) {
    if (typeof relative !== 'string' || !relative || relative.includes('\0') || relative.includes('\\') || relative.split('/').some(part => !part || /^\.git$/i.test(part) || part === '.' || part === '..') || path.isAbsolute(relative)) throw new Error('文件路径无效');
    return this.safe(relative);
  }
  openFile(relative) { return this.queued(async () => {
    const file = await this.changeFile(relative), stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('请选择文件');
    if (stat.size > 20 * 1024 * 1024) throw new Error('文件最大为 20 MB');
    const bytes = await readBounded(file, { limit: 20 * 1024 * 1024, message: '文件最大为 20 MB' }), ext = path.extname(relative).toLowerCase();
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' }[ext];
    const binary = Boolean(mime) || bytes.includes(0) || !isUtf8(bytes);
    if (!binary && bytes.length > 10 * 1024 * 1024) throw new Error('文本文件最大为 10 MB');
    return { path: relative, content: binary ? '' : bytes.toString('utf8'), binary, ...(mime ? { image: `data:${mime};base64,${bytes.toString('base64')}` } : {}) };
  }); }
  saveFile(relative, content) {
    const note = this.manifest?.notes.find(n => notePath(n) === relative);
    if (note) return this.save(note.id, content);
    return this.queued(async () => {
      this.assertNotTrashedFile(relative);
      const file = await this.changeFile(relative);
      if (typeof content !== 'string' || Buffer.byteLength(content) > 10 * 1024 * 1024) throw new Error('文本文件最大为 10 MB');
      const bytes = await readBounded(file);
      if (bytes.includes(0) || !isUtf8(bytes) || /\.(png|jpe?g|gif|webp|avif)$/i.test(relative)) throw new Error('二进制文件不能作为文本保存');
      let manifest;
      if (relative === MANIFEST) {
        const parsed = JSON.parse(content);
        validateManifest(parsed); manifest = parsed;
      }
      if (relative.endsWith('.excalidraw')) validateDrawing(content);
      const temp = await this.safe(`${path.dirname(relative)}/.fever-${randomUUID()}.tmp`);
      try { await fs.writeFile(temp, content); await fs.rename(temp, file); }
      finally { await fs.rm(temp, { force: true }); }
      if (relative === MANIFEST) this.manifest = manifest;
    });
  }
  assertNotTrashedFile(relative) {
    if (this.manifest?.trash?.some(note => notePath(note) === relative)) throw new Error('回收站中的笔记为只读，请先还原到原位置');
  }
  async validateChange(change) {
    await this.changeFile(change.path);
    if (change.originalPath) await this.changeFile(change.originalPath);
    if (/^(DD|AU|UD|UA|DU|AA|UU)$/.test(change.status)) throw new Error('请先解决文件的合并冲突');
  }
  async change(relative) {
    await this.changeFile(relative);
    const change = (await this.status()).changes.find(c => c.path === relative);
    if (!change) throw new Error('文件已没有变更，请刷新 Git 状态');
    await this.validateChange(change);
    return change;
  }
  diff(relative, staged = false) { return this.queued(async () => {
    const change = await this.change(relative);
    if (change.status === '??') {
      const file = await this.changeFile(relative), stat = await fs.stat(file);
      if (stat.size > 10 * 1024 * 1024) return { path: relative, patch: '文件过大，请打开文件查看内容。' };
      const bytes = await readBounded(file);
      if (bytes.includes(0) || relative.startsWith('images/')) return { path: relative, patch: '二进制文件已新增，无法显示文本差异。' };
      const text = bytes.toString('utf8'), lines = text ? text.replace(/\n$/, '').split('\n') : [];
      return { path: relative, patch: `--- /dev/null\n+++ b/${relative}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => '+' + line).join('\n')}${text && !text.endsWith('\n') ? '\n\\ No newline at end of file' : ''}\n` };
    }
    const paths = [relative, ...(change.originalPath ? [change.originalPath] : [])].map(p => `:(literal)${p}`);
    const patch = await this.git(['diff', '--no-ext-diff', '--no-textconv', '--no-color', ...(staged ? ['--cached'] : []), '--', ...paths]);
    return { path: relative, patch: patch || '没有文本差异（文件权限或属性发生变化）。' };
  }); }
  stage(relative) { return this.queued(async () => {
    await this.change(relative);
    await this.git(['add', '-A', '--', `:(literal)${relative}`]);
  }); }
  unstage(relative) { return this.queued(async () => {
    const change = await this.change(relative);
    const paths = [relative, ...(change.originalPath ? [change.originalPath] : [])].map(p => `:(literal)${p}`);
    if ((await this.git(['rev-parse', '--verify', 'HEAD'], true)).trim()) await this.git(['reset', 'HEAD', '--', ...paths]);
    else await this.git(['rm', '--cached', '-f', '--', ...paths]);
  }); }
  stageAll() { return this.queued(async () => {
    const changes = (await this.status()).changes.filter(change => change.unstaged);
    if (!changes.length) return;
    for (const change of changes) await this.validateChange(change);
    await this.git(['add', '-A', '--', '.']);
  }); }
  unstageAll() { return this.queued(async () => {
    const changes = (await this.status()).changes.filter(change => change.staged);
    if (!changes.length) return;
    for (const change of changes) await this.validateChange(change);
    if ((await this.git(['rev-parse', '--verify', 'HEAD'], true)).trim()) await this.git(['reset', 'HEAD', '--', '.']);
    else await this.git(['rm', '--cached', '-r', '-f', '--', '.']);
  }); }
  discard(relative) { return this.queued(async () => {
    const change = await this.change(relative), hasHead = Boolean((await this.git(['rev-parse', '--verify', 'HEAD'], true)).trim());
    const paths = [relative, ...(change.originalPath ? [change.originalPath] : [])];
    paths.forEach(file => this.assertNotTrashedFile(file));
    const tracked = [], added = [];
    for (const file of paths) {
      if (hasHead && (await this.git(['ls-tree', '--name-only', 'HEAD', '--', `:(literal)${file}`])).trim()) tracked.push(file);
      else added.push(file);
    }
    if (added.includes(MANIFEST)) throw new Error('请先提交初始笔记库，不能撤销未提交的笔记清单');
    if (relative === MANIFEST) {
      // Validate the restored snapshot before changing either the index or the file.
      const restored = JSON.parse(await this.git(['show', `HEAD:${relative}`]));
      validateManifest(restored);
    }
    if (tracked.length) await this.git(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked.map(p => `:(literal)${p}`)]);
    for (const file of added) {
      if ((await this.git(['ls-files', '--', `:(literal)${file}`])).trim()) await this.git(['rm', '--cached', '-f', '--', `:(literal)${file}`]);
      await fs.rm(await this.changeFile(file), { force: true });
    }
    this.cancelSearch();
    if (relative === MANIFEST) {
      const text = await fs.readFile(await this.safe(MANIFEST), 'utf8');
      this.manifest = JSON.parse(text);
    } else if (added.some(file => this.manifest.notes.some(n => notePath(n) === file))) {
      // Discarding a new note must not leave a dangling entry in the library.
      this.manifest.notes = this.manifest.notes.filter(n => !added.includes(notePath(n)));
      await this.persist();
    }
  }); }
  commit(message, stagedOnly = false) { return this.queued(async () => {
    if (typeof message !== 'string' || !message.trim()) throw new Error('请填写提交说明');
    if (!(await this.git(['config', 'user.name'], true)).trim() || !(await this.git(['config', 'user.email'], true)).trim()) throw new Error('请先在设置中配置 Git 用户名和邮箱');
    if (!this.lfs && (await fs.readdir(await this.safe('images'))).length) throw new Error('图片提交需要安装 Git LFS');
    if (!stagedOnly) await this.git(['add', '--', MANIFEST, 'notes', 'drawings', 'images', '.gitattributes']);
    const staged = await this.git(['diff', '--cached', '--name-only', '-z']);
    if (!staged.trim()) throw new Error('没有需要提交的变更');
    if (!stagedOnly && staged.split('\0').filter(Boolean).some(p => ![MANIFEST, '.gitattributes'].includes(p) && !p.startsWith('notes/') && !p.startsWith('drawings/') && !p.startsWith('images/'))) throw new Error('仓库中有其他已暂存文件，请先处理它们再提交笔记');
    await this.git(['commit', '-m', message.trim()]);
  }); }
  pull() { return this.queued(async () => {
    const status = await this.status();
    if (!status.remote) throw new Error('请先在设置中配置远程仓库');
    if (status.changes.length) throw new Error('请先提交本地变更再拉取');
    await this.git(['pull', '--ff-only', 'origin', status.branch]);
    this.cancelSearch();
    const text = await fs.readFile(await this.safe(MANIFEST), 'utf8');
    const manifest = JSON.parse(text);
    validateManifest(manifest);
    this.manifest = manifest;
  }); }
  push() { return this.queued(async () => { const s = await this.status(); if (!s.remote) throw new Error('请先在设置中配置远程仓库'); if (s.branch === 'HEAD') throw new Error('请先切换到分支再推送'); await this.git(['push', '--set-upstream', 'origin', s.branch]); }); }
  async history(id) {
    const args = ['log', '-80', '--format=%H%x00%an%x00%aI%x00%s'];
    if (id) args.push('--follow', '--', notePath(this.note(id, true)));
    const raw = await this.git(args, true);
    return raw.trim().split('\n').filter(Boolean).map(line => { const [hash, author, date, message] = line.split('\0'); return { hash, author, date, message }; });
  }
  async revisionPath(id, hash) {
    if (!/^[0-9a-f]{40,64}$/.test(hash)) throw new Error('提交标识无效');
    const currentPath = notePath(this.note(id, true));
    const exists = await this.git(['ls-tree', '--name-only', hash, '--', currentPath]);
    if (exists.trim()) return currentPath;
    // A migrated note keeps its Git lineage even though its original filename changed.
    const lineage = await this.git(['-c', 'core.quotepath=false', 'log', '--follow', '--format=%H', '--name-only', '--', currentPath]);
    let commit;
    for (const line of lineage.split('\n').filter(Boolean)) {
      if (/^[0-9a-f]{40,64}$/.test(line)) commit = line;
      else if (commit === hash && /\.(md|markdown|txt|fountain|excalidraw)$/i.test(line)) return line;
    }
    throw new Error('这个版本中找不到笔记文件');
  }
  async revision(id, hash) {
    const file = await this.revisionPath(id, hash);
    return this.git(['show', `${hash}:${file}`]);
  }
  async revisionComparison(id, hash) {
    const file = await this.revisionPath(id, hash);
    const commits = await this.git(['log', '--follow', '-2', '--format=%H', hash, '--', file]);
    const previousHash = commits.trim().split('\n')[1];
    const [content, previousContent] = await Promise.all([
      this.git(['show', `${hash}:${file}`]),
      previousHash ? this.revision(id, previousHash) : Promise.resolve(''),
    ]);
    return { content, previousContent, previousHash };
  }
  async restore(id, hash) { const content = await this.revision(id, hash); await this.save(id, content); return content; }
  async settings() { return { ...defaults, author: (await this.git(['config', 'user.name'], true)).trim(), email: (await this.git(['config', 'user.email'], true)).trim(), remote: (await this.git(['remote', 'get-url', 'origin'], true)).trim(), excalidrawCategory: (await this.git(['config', '--local', '--get', 'fever.excalidrawCategory'], true)).trim() }; }
  configure(settings) { return this.queued(async () => {
    if (typeof settings.author !== 'string' || typeof settings.email !== 'string' || typeof settings.remote !== 'string') throw new Error('设置无效');
    if (settings.excalidrawCategory !== undefined && (typeof settings.excalidrawCategory !== 'string' || settings.excalidrawCategory.trim().length > 200 || /[\x00-\x1f]/.test(settings.excalidrawCategory) || (settings.excalidrawCategory.trim() && settings.excalidrawCategory.trim().split('/').some(c => !c.trim())))) throw new Error('Excalidraw 默认分类无效（最多 200 字，可用 / 分隔子分类）');
    if (settings.remote && !/^(https?:\/\/|ssh:\/\/|git@)[^\s]+$/.test(settings.remote)) throw new Error('请使用 HTTPS 或 SSH 远程仓库地址');
    await this.git(['config', '--local', 'user.name', settings.author.trim()]);
    await this.git(['config', '--local', 'user.email', settings.email.trim()]);
    const existing = (await this.git(['remote'], true)).trim().split('\n').includes('origin');
    if (settings.remote) await this.git(['remote', existing ? 'set-url' : 'add', 'origin', settings.remote]);
    else if (existing) await this.git(['remote', 'remove', 'origin']);
    if (settings.excalidrawCategory !== undefined) await this.git(['config', '--local', 'fever.excalidrawCategory', settings.excalidrawCategory.trim()]);
  }); }
}
module.exports = { VaultStore, defaults };
