const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { isUtf8 } = require('node:buffer');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { downloadImage } = require('./remote-images.cjs');
const { readBounded, readPrefix } = require('./files.cjs');
const { RevisionImages } = require('./revision-images.cjs');
const { MetadataJournal } = require('./metadata.cjs');
const MANIFEST = 'fever.json';
const notePath = note => `${note.directory || 'notes'}/${note.filename}`;
const { readManifest, manifestView, noteView, noteCategory, folderPaths, validCategory, ensureFolder, moveCategory, removeCategory } = require('./manifest.mjs');
function validateDrawing(content) {
  let scene;
  try { scene = JSON.parse(content); } catch { throw new Error('Excalidraw 文件不是有效的 JSON'); }
  if (!scene || scene.type !== 'excalidraw' || !Array.isArray(scene.elements) || scene.elements.some(e => !e || typeof e.id !== 'string' || typeof e.type !== 'string' || !Number.isFinite(e.x) || !Number.isFinite(e.y)) || (scene.appState != null && (typeof scene.appState !== 'object' || Array.isArray(scene.appState))) || (scene.files != null && (typeof scene.files !== 'object' || Array.isArray(scene.files)))) throw new Error('Excalidraw 绘图格式无效');
}
const defaults = { autoCommit: false, interval: 10, autoPull: false, pullInterval: 10, author: '', email: '', remote: '' };

class VaultStore {
  constructor() {
    this.root = null; this.manifest = null; this.lfs = false; this.tail = Promise.resolve();
    this.searchCache = null; this.statusTask = null; this.operationVersion = 0;
    this.imageImports = new Map();
    this.previewRequests = new Map(); this.previewQueue = []; this.activePreviews = 0;
    this.metadata = null; this.metadataTimer = null;
    this.environment = { ...process.env };
    // Finder-launched macOS apps do not inherit an interactive shell's Homebrew PATH.
    if (process.platform === 'darwin') this.environment.PATH = [...new Set([...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'])].join(path.delimiter);
  }
  queued(fn, deferMetadata = false) { const next = this.tail.then(async () => { ++this.operationVersion; if (!deferMetadata) await this.flushMetadataInternal(); return fn(); }); this.tail = next.catch(() => {}); return next; }
  async flushMetadataInternal() { if (this.metadata?.dirty) await this.persist(); }
  flushMetadata() { return this.queued(async () => {}); }
  scheduleMetadata() {
    // A fixed deadline also bounds the journal during uninterrupted typing.
    if (this.metadataTimer) return;
    this.metadataTimer = setTimeout(() => {
      this.metadataTimer = null;
      this.flushMetadata().catch(error => this.onMetadataError?.(error.message));
    }, 5000);
    this.metadataTimer.unref?.();
  }
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
  preview(id, requestId) {
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(requestId)) return Promise.reject(new Error('摘要请求无效'));
    this.cancelPreview(requestId);
    const root = this.root, relative = notePath(this.note(id)), controller = new AbortController();
    return new Promise((resolve, reject) => {
      const task = { requestId, controller, reject, run: async () => {
        if (this.root !== root) throw new Error('笔记库已变化');
        const file = await this.safe(relative);
        if (this.root !== root) throw new Error('笔记库已变化');
        return readPrefix(file, { signal: controller.signal });
      }, resolve };
      this.previewRequests.set(requestId, task); this.previewQueue.push(task); this.drainPreviews();
    });
  }
  drainPreviews() {
    while (this.activePreviews < 4 && this.previewQueue.length) {
      const task = this.previewQueue.shift(); ++this.activePreviews;
      task.run().then(task.resolve, task.reject).finally(() => {
        --this.activePreviews;
        if (this.previewRequests.get(task.requestId) === task) this.previewRequests.delete(task.requestId);
        this.drainPreviews();
      });
    }
  }
  cancelPreview(requestId) {
    const task = this.previewRequests.get(requestId);
    if (!task) return;
    task.controller.abort(); this.previewRequests.delete(requestId);
    const index = this.previewQueue.indexOf(task);
    if (index >= 0) { this.previewQueue.splice(index, 1); task.reject(new Error('摘要读取已取消')); }
  }
  cancelSearch() { this.searchController?.abort(); this.searchController = null; }
  async search(query, scope) {
    if (scope !== undefined && scope !== 'trash') throw new Error('搜索范围无效');
    this.cancelSearch();
    if (typeof query !== 'string') throw new Error('搜索内容无效');
    if (!query.trim() || !this.manifest) return [];
    const controller = new AbortController(); this.searchController = controller;
    const { signal } = controller, needle = query.toLowerCase(), notes = scope === 'trash' ? (this.manifest.trash || []) : this.manifest.notes;
    const paths = folderPaths(this.manifest);
    // Cache only match booleans for the current query, never whole note bodies.
    if (this.searchCache?.root !== this.root || this.searchCache.query !== needle || this.searchCache.scope !== scope) this.searchCache = { root: this.root, query: needle, scope, files: new Map() };
    const cache = this.searchCache.files;
    const matches = new Set(); let cursor = 0;
    // Keep full Unicode case folding, but hold at most four note bodies in the main
    // process. Only IDs cross IPC; aborted queries stop scheduling file reads.
    const worker = async () => {
      while (!signal.aborted && cursor < notes.length) {
        const note = notes[cursor++];
        if (note.title.toLowerCase().includes(needle) || noteCategory(this.manifest, note, paths).toLowerCase().includes(needle)) { matches.add(note.id); continue; }
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
      clearTimeout(this.metadataTimer); this.metadataTimer = null;
      // Once renamed, the new manifest is committed. A cleanup failure must not
      // make a caller roll back its in-memory tree over the successfully saved file.
      try { await this.metadata?.clear(); }
      catch (error) { this.onMetadataError?.(error.message); this.scheduleMetadata(); }
    } finally { await fs.rm(temp, { force: true }); }
  }
  snapshot() { return { path: this.root, name: path.basename(this.root), manifest: manifestView(this.manifest), lfs: this.lfs }; }
  async open(folder) {
    return this.queued(async () => {
      this.cancelSearch();
      for (const requestId of this.previewRequests.keys()) this.cancelPreview(requestId);
      this.searchCache = null;
      const root = await fs.realpath(folder);
      const previous = { root: this.root, manifest: this.manifest, lfs: this.lfs, metadata: this.metadata };
      this.root = root;
      try {
        // Reject a parent repository before creating anything in the selection.
        const top = (await this.git(['rev-parse', '--show-toplevel'], true)).trim();
        if (top && await fs.realpath(top) !== root) throw new Error('请选择独立的 Git 仓库根目录，不能选择其他仓库的子目录');
        let manifest, isNew = false;
        try {
          manifest = JSON.parse(await fs.readFile(await this.safe(MANIFEST), 'utf8'));
          manifest = readManifest(manifest, previous.root === root ? previous.manifest : undefined);
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
          // Never silently index or overwrite an unrelated content directory.
          for (const directory of ['notes', 'drawings', 'images']) {
            const entries = await fs.readdir(await this.safe(directory)).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
            if (entries.length) throw new Error(`此文件夹包含 ${directory} 文件但没有 fever.json，请选择空文件夹或已有笔记库`);
          }
          const entries = await fs.readdir(root);
          if (entries.some(entry => !['.git', '.DS_Store', 'notes', 'drawings', 'images'].includes(entry))) throw new Error('此文件夹包含其他文件但没有 fever.json，请选择空文件夹或已有笔记库');
          manifest = readManifest({ version: 1, categories: ['收件箱'], notes: [] });
          isNew = true;
        }
        this.manifest = manifest;
        await fs.mkdir(await this.safe('notes'), { recursive: true });
        await fs.mkdir(await this.safe('drawings'), { recursive: true });
        await fs.mkdir(await this.safe('images'), { recursive: true });
        if (!top) await this.git(['init', '-b', 'main']);
        this.metadata = new MetadataJournal(path.resolve(root, (await this.git(['rev-parse', '--git-path', 'fever-updates.jsonl'])).trim()));
        await this.metadata.recover(this.manifest);
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
    validCategory(category, true);
    if (!['markdown', 'excalidraw'].includes(format)) throw new Error('不支持的文件格式');
    const id = randomUUID(), now = new Date().toISOString();
    const note = { id, filename: id + (format === 'excalidraw' ? '.excalidraw' : '.md'), title, createdAt: now, updatedAt: now, ...(sourcePath ? { sourcePath } : {}) };
    const legacyDrawing = /^excalidraw-plugin:[ \t]*\S/m.test(content?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || '');
    if (format === 'excalidraw' || legacyDrawing) note.directory = 'drawings';
    content ??= format === 'excalidraw' ? JSON.stringify({ type: 'excalidraw', version: 2, source: 'Fever', elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }, null, 2) : `# ${title}\n\n`;
    if (format === 'excalidraw') validateDrawing(content);
    const file = await this.safe(notePath(note)), previous = structuredClone(this.manifest);
    await fs.writeFile(file, content, { flag: 'wx' });
    note.folderId = ensureFolder(this.manifest, category);
    this.manifest.notes.push(note);
    try { await this.persist(); }
    catch (e) { this.manifest = previous; await fs.rm(file, { force: true }); throw e; }
    return noteView(this.manifest, note);
  }
  create(title, category, format) { return this.queued(() => this.createInternal(title, category, undefined, format)); }
  async read(id, scope) {
    if (scope !== undefined && scope !== 'trash') throw new Error('读取范围无效');
    const note = scope === 'trash' ? this.manifest?.trash?.find(n => n.id === id) : this.note(id);
    if (!note) throw new Error('回收站中找不到这篇笔记');
    return (await readBounded(await this.safe(notePath(note)))).toString('utf8');
  }
  save(id, content) { return this.queued(() => this.saveInternal(id, content), true); }
  // Call only from a queued operation so lookup, content and metadata stay together.
  async saveInternal(id, content) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > 10 * 1024 * 1024) throw new Error('笔记最大为 10 MB');
    const note = this.note(id), file = await this.safe(notePath(note));
    if (note.filename.endsWith('.excalidraw')) validateDrawing(content);
    const temp = await this.safe(`${path.posix.dirname(notePath(note))}/.${randomUUID()}.tmp`);
    try { await fs.writeFile(temp, content); await fs.rename(temp, file); }
    finally { await fs.rm(temp, { force: true }); }
    const updatedAt = note.updatedAt;
    note.updatedAt = new Date().toISOString();
    try {
      if (this.metadata) { await this.metadata.record(note, updatedAt); this.scheduleMetadata(); }
      else await this.persist();
    }
    catch (e) { note.updatedAt = updatedAt; throw e; }
    return { updatedAt: note.updatedAt };
  }
  update(id, title, category) { return this.queued(async () => {
    if (typeof title !== 'string' || !title.trim() || title.length > 200 || typeof category !== 'string' || category.length > 200) throw new Error('标题或分类无效');
    const previous = structuredClone(this.manifest);
    category = category.trim();
    const note = this.note(id); Object.assign(note, { title: title.trim(), folderId: ensureFolder(this.manifest, category), updatedAt: new Date().toISOString() });
    try { await this.persist(); }
    catch (e) { this.manifest = previous; throw e; }
    return noteView(this.manifest, note);
  }); }
  remove(id) { return this.queued(async () => {
    const note = this.note(id);
    await this.safe(notePath(note));
    const previous = structuredClone(this.manifest);
    this.manifest.notes = this.manifest.notes.filter(n => n.id !== id);
    (this.manifest.trash ||= []).push({ ...note, originalCategory: noteCategory(this.manifest, note) });
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
    note.folderId = ensureFolder(this.manifest, noteCategory(this.manifest, note));
    delete note.originalCategory;
    this.manifest.notes.push(note);
    try { await this.persist(); }
    catch (e) { this.manifest = previous; throw e; }
    return noteView(this.manifest, note);
  }); }
  category(category) { return this.queued(async () => {
    if (typeof category !== 'string' || !category.trim() || category.length > 200 || category.split('/').some(c => !c.trim())) throw new Error('分类无效');
    const previous = structuredClone(this.manifest);
    ensureFolder(this.manifest, category.trim());
    try { await this.persist(); }
    catch (e) { this.manifest = previous; throw e; }
  }); }
  moveCategory(from, to, placement) { return this.queued(async () => {
    const previous = this.manifest;
    this.manifest = moveCategory(previous, from, to, placement);
    try { await this.persist(); }
    catch (e) { this.manifest = previous; throw e; }
    this.cancelSearch();
  }); }
  removeCategory(category) { return this.queued(async () => {
    if (typeof category !== 'string' || !category.trim() || category.length > 200 || category.split('/').some(c => !c.trim())) throw new Error('分类无效');
    category = category.trim();
    const previous = this.manifest;
    const next = removeCategory(previous, category);
    const retained = new Set(next.notes);
    for (const note of previous.notes) if (!retained.has(note)) await this.safe(notePath(note));
    this.manifest = next;
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
  status(inspectWhitespace = false) {
    const root = this.root, version = this.operationVersion;
    if (this.statusTask?.root === root && this.statusTask.version === version && this.statusTask.inspectWhitespace === inspectWhitespace) return this.statusTask.promise;
    const task = { root, version, inspectWhitespace };
    task.promise = this.readStatus(inspectWhitespace).then(status => { if (this.root !== root) throw new Error('笔记库已变化'); return status; }).finally(() => { if (this.statusTask === task) this.statusTask = null; });
    this.statusTask = task; return task.promise;
  }
  async readStatus(inspectWhitespace = false) {
    const raw = await this.git(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
    const fields = raw.split('\0').filter(Boolean), changes = [];
    const whitespaceCandidates = { staged: new Set(), unstaged: new Set() };
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
      if (kind === '1') {
        if (code[0] === 'M') whitespaceCandidates.staged.add(file);
        if (code[1] === 'M') whitespaceCandidates.unstaged.add(file);
      }
    }
    if (inspectWhitespace) {
      // Scan each side once, rather than spawning a diff for every changed file.
      for (const side of ['staged', 'unstaged']) {
        if (!whitespaceCandidates[side].size) continue;
        const meaningful = new Set((await this.git(['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '--name-only', '-z', '--ignore-all-space', '--ignore-blank-lines', ...(side === 'staged' ? ['--cached'] : []), '--'])).split('\0').filter(Boolean));
        for (const change of changes) if (whitespaceCandidates[side].has(change.path) && !meaningful.has(change.path)) change[`${side}WhitespaceOnly`] = true;
      }
    }
    // The journal is private; expose the pending manifest edit until materialized.
    if (this.metadata?.dirty) {
      const manifest = changes.find(change => change.path === MANIFEST);
      if (manifest) { manifest.unstaged = true; delete manifest.unstagedWhitespaceOnly; }
      else changes.push({ path: MANIFEST, status: 'M', staged: false, unstaged: true });
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
    return this.queued(async () => {
      const note = this.manifest?.notes.find(n => notePath(n) === relative);
      if (note) { const result = await this.saveInternal(note.id, content); await this.flushMetadataInternal(); return result; }
      this.assertNotTrashedFile(relative);
      const file = await this.changeFile(relative);
      if (typeof content !== 'string' || Buffer.byteLength(content) > 10 * 1024 * 1024) throw new Error('文本文件最大为 10 MB');
      const bytes = await readBounded(file);
      if (bytes.includes(0) || !isUtf8(bytes) || /\.(png|jpe?g|gif|webp|avif)$/i.test(relative)) throw new Error('二进制文件不能作为文本保存');
      let manifest;
      if (relative === MANIFEST) {
        const parsed = JSON.parse(content);
        manifest = readManifest(parsed, this.manifest);
        content = JSON.stringify(manifest, null, 2) + '\n';
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
    const args = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', ...(staged ? ['--cached'] : [])];
    const patch = await this.git([...args, '--', ...paths]);
    const whitespaceIgnoredPatch = patch ? await this.git([...args, '--ignore-all-space', '--ignore-blank-lines', '--', ...paths]) : '';
    return {
      path: relative,
      patch: patch || '没有文本差异（文件权限或属性发生变化）。',
      whitespaceIgnoredPatch: whitespaceIgnoredPatch || (patch ? '已忽略空格和空行变化，没有其他文本差异。' : '没有文本差异（文件权限或属性发生变化）。'),
    };
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
      readManifest(restored, this.manifest);
    }
    if (tracked.length) await this.git(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked.map(p => `:(literal)${p}`)]);
    for (const file of added) {
      if ((await this.git(['ls-files', '--', `:(literal)${file}`])).trim()) await this.git(['rm', '--cached', '-f', '--', `:(literal)${file}`]);
      await fs.rm(await this.changeFile(file), { force: true });
    }
    this.cancelSearch();
    if (relative === MANIFEST) {
      const text = await fs.readFile(await this.safe(MANIFEST), 'utf8');
      this.manifest = readManifest(JSON.parse(text), this.manifest);
    } else if (added.some(file => this.manifest.notes.some(n => notePath(n) === file))) {
      // Discarding a new note must not leave a dangling entry in the library.
      this.manifest.notes = this.manifest.notes.filter(n => !added.includes(notePath(n)));
      await this.persist();
    }
  }); }
  // Keep command lines below Windows' limit, including quoting and Unicode paths.
  async gitPaths(args, files) {
    let output = '', batch = [], size = 0;
    for (const file of files) {
      const literal = `:(literal)${file}`, bytes = Buffer.byteLength(literal) + 3;
      if (batch.length && size + bytes > 24000) {
        output += await this.git([...args, '--', ...batch]); batch = []; size = 0;
      }
      batch.push(literal); size += bytes;
    }
    if (batch.length) output += await this.git([...args, '--', ...batch]);
    return output;
  }
  discardAll() { return this.queued(async () => {
    const changes = (await this.status()).changes.filter(change => change.unstaged);
    if (!changes.length) return [];
    // Validate the entire selection before changing files or the index.
    const trashPaths = new Set((this.manifest.trash || []).map(notePath));
    for (const change of changes) {
      await this.validateChange(change);
      if (trashPaths.has(change.path) || trashPaths.has(change.originalPath)) throw new Error('回收站中的笔记为只读，请先还原到原位置');
    }
    const paths = [...new Set(changes.flatMap(change => [change.path, ...(change.originalPath ? [change.originalPath] : [])]))];
    const hasHead = Boolean((await this.git(['rev-parse', '--verify', 'HEAD'], true)).trim());
    const tracked = new Set(hasHead ? (await this.gitPaths(['ls-tree', '-r', '--name-only', '-z', 'HEAD'], paths)).split('\0').filter(Boolean) : []);
    const added = paths.filter(file => !tracked.has(file));
    if (added.includes(MANIFEST)) throw new Error('请先提交初始笔记库，不能撤销未提交的笔记清单');
    let restoredManifest;
    if (tracked.has(MANIFEST)) {
      restoredManifest = JSON.parse(await this.git(['show', `HEAD:${MANIFEST}`]));
      restoredManifest = readManifest(restoredManifest, this.manifest);
    }
    const indexed = new Set(added.length ? (await this.gitPaths(['ls-files', '-z'], added)).split('\0').filter(Boolean) : []);
    this.cancelSearch();
    await this.gitPaths(['restore', '--source=HEAD', '--staged', '--worktree'], [...tracked].filter(file => file !== MANIFEST));
    await this.gitPaths(['rm', '--cached', '-f'], added.filter(file => indexed.has(file)));
    const removed = new Set();
    try {
      for (const file of added) {
        await fs.rm(await this.changeFile(file), { force: true }); removed.add(file);
      }
    } finally {
      // Persist once, including when a later deletion fails after removing notes.
      const notes = this.manifest.notes.filter(note => !removed.has(notePath(note)));
      if (notes.length !== this.manifest.notes.length) { this.manifest.notes = notes; await this.persist(); }
    }
    // Restore metadata last, after removing newly created notes by their paths.
    if (restoredManifest) {
      await this.gitPaths(['restore', '--source=HEAD', '--staged', '--worktree'], [MANIFEST]);
      this.manifest = restoredManifest;
    }
    return paths;
  }); }
  async resetWhitespaceChanges() {
    // Staging may have changed since a concurrent UI status request began.
    const changes = (await this.readStatus(true)).changes;
    const selected = changes.filter(change => change.stagedWhitespaceOnly || change.unstagedWhitespaceOnly);
    // Validate all restoration targets before changing either snapshot.
    for (const change of selected) {
      await this.validateChange(change);
      this.assertNotTrashedFile(change.path);
    }
    const worktree = selected.filter(change => change.unstagedWhitespaceOnly && !change.stagedWhitespaceOnly).map(change => change.path);
    const both = selected.filter(change => change.stagedWhitespaceOnly && (!change.unstaged || change.unstagedWhitespaceOnly)).map(change => change.path);
    const index = selected.filter(change => change.stagedWhitespaceOnly && change.unstaged && !change.unstagedWhitespaceOnly).map(change => change.path);
    let manifest;
    if (both.includes(MANIFEST) || worktree.includes(MANIFEST)) {
      const source = both.includes(MANIFEST) ? `HEAD:${MANIFEST}` : `:${MANIFEST}`;
      manifest = readManifest(JSON.parse(await this.git(['show', source])), this.manifest);
    }
    // Restore hidden working edits to the index, which may contain real staged edits.
    await this.gitPaths(['restore', '--worktree'], worktree);
    await this.gitPaths(['restore', '--source=HEAD', '--staged', '--worktree'], both);
    // A meaningful working edit must survive removing a whitespace-only staged edit.
    await this.gitPaths(['restore', '--source=HEAD', '--staged'], index);
    if (manifest) this.manifest = manifest;
    if (selected.length) this.cancelSearch();
    return selected.map(change => change.path);
  }
  commit(message, stagedOnly = false, ignoreWhitespace = false) { return this.queued(async () => {
    if (typeof message !== 'string' || !message.trim()) throw new Error('请填写提交说明');
    if (!(await this.git(['config', 'user.name'], true)).trim() || !(await this.git(['config', 'user.email'], true)).trim()) throw new Error('请先在设置中配置 Git 用户名和邮箱');
    if (!this.lfs && (await fs.readdir(await this.safe('images'))).length) throw new Error('图片提交需要安装 Git LFS');
    if (!stagedOnly) await this.git(['add', '--', MANIFEST, 'notes', 'drawings', 'images', '.gitattributes']);
    let staged = await this.git(['diff', '--cached', '--name-only', '-z']);
    if (!stagedOnly && staged.split('\0').filter(Boolean).some(p => ![MANIFEST, '.gitattributes'].includes(p) && !p.startsWith('notes/') && !p.startsWith('drawings/') && !p.startsWith('images/'))) throw new Error('仓库中有其他已暂存文件，请先处理它们再提交笔记');
    const restoredPaths = ignoreWhitespace ? await this.resetWhitespaceChanges() : [];
    if (restoredPaths.length) staged = await this.git(['diff', '--cached', '--name-only', '-z']);
    if (!staged.trim()) {
      if (restoredPaths.length) return { committed: false, restoredPaths, changes: [] };
      throw new Error('没有需要提交的变更');
    }
    await this.git(['commit', '-m', message.trim()]);
    const hash = (await this.git(['rev-parse', 'HEAD'])).trim();
    const changes = this.parseFileChanges(await this.git(['diff-tree', '--root', '--no-commit-id', '-r', '--name-status', '-z', '-M', hash, '--']));
    return { committed: true, restoredPaths, hash, changes };
  }); }
  parseFileChanges(raw) {
    const fields = raw.split('\0'), changes = [];
    for (let i = 0; i < fields.length && fields[i];) {
      const status = fields[i++][0], first = fields[i++];
      if (status === 'R' || status === 'C') changes.push({ status, originalPath: first, path: fields[i++] });
      else changes.push({ status, path: first });
    }
    return changes;
  }
  pull() { return this.queued(async () => {
    const status = await this.status();
    if (!status.remote) throw new Error('请先在设置中配置远程仓库');
    if (status.changes.length) throw new Error('请先提交本地变更再拉取');
    await this.git(['pull', '--ff-only', 'origin', status.branch]);
    this.cancelSearch();
    const text = await fs.readFile(await this.safe(MANIFEST), 'utf8');
    let manifest = JSON.parse(text);
    manifest = readManifest(manifest);
    this.manifest = manifest;
    const before = /^[0-9a-f]{40,64}$/.test(status.head) ? status.head : '';
    const after = (await this.git(['rev-parse', 'HEAD'])).trim();
    const changes = before === after ? [] : before
      ? this.parseFileChanges(await this.git(['diff', '--name-status', '-z', '-M', before, after, '--']))
      : (await this.git(['ls-tree', '-r', '--name-only', '-z', after])).split('\0').filter(Boolean).map(path => ({ path, status: 'A' }));
    const commitCount = before === after ? 0 : Number((await this.git(['rev-list', '--count', before ? `${before}..${after}` : after])).trim());
    return { before, after, changes, commitCount };
  }); }
  pullDiff(before, after, relative, originalPath) { return this.queued(async () => {
    if ((before && !/^[0-9a-f]{40,64}$/.test(before)) || !/^[0-9a-f]{40,64}$/.test(after)) throw new Error('提交标识无效');
    const paths = [relative, ...(originalPath ? [originalPath] : [])];
    for (const relative of paths) await this.changeFile(relative);
    const base = before || createHash((await this.git(['rev-parse', '--show-object-format'])).trim()).update('tree 0\0').digest('hex');
    const args = ['diff', base, after];
    const options = ['--no-ext-diff', '--no-textconv', '--no-color', '-M'];
    const literalPaths = paths.map(relative => `:(literal)${relative}`);
    const patch = await this.git([...args, ...options, '--', ...literalPaths]);
    const whitespaceIgnoredPatch = await this.git([...args, ...options, '--ignore-all-space', '--ignore-blank-lines', '--', ...literalPaths]);
    return { path: relative, patch: patch || '没有文本差异（文件权限或属性发生变化）。', whitespaceIgnoredPatch: whitespaceIgnoredPatch || (patch ? '已忽略空格和空行变化，没有其他文本差异。' : '没有文本差异（文件权限或属性发生变化）。') };
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
    const exists = await this.git(['--literal-pathspecs', 'ls-tree', '--name-only', '-z', hash, '--', currentPath]);
    if (exists.trim()) return currentPath;
    // A migrated note keeps its Git lineage even though its original filename changed.
    const lineage = await this.git(['--literal-pathspecs', 'log', '--follow', '--format=%H', '--name-status', '-z', '--', currentPath]);
    const records = lineage.split('\0');
    let file = currentPath;
    for (let index = 0; index < records.length;) {
      const commit = records[index++];
      if (!/^[0-9a-f]{40,64}$/.test(commit)) continue;
      const status = records[index++]?.replace(/^\n/, '');
      const before = records[index++];
      const after = status?.startsWith('R') ? records[index++] : before;
      if (commit === hash) return after;
      if (status?.startsWith('R')) {
        // A selected commit may only change an image, between two note commits.
        const present = await this.git(['--literal-pathspecs', 'ls-tree', '--name-only', '-z', hash, '--', file]);
        if (present) return file;
        file = before;
      }
    }
    if (file !== currentPath && await this.git(['--literal-pathspecs', 'ls-tree', '--name-only', '-z', hash, '--', file])) return file;
    throw new Error('这个版本中找不到笔记文件');
  }
  async revision(id, hash) {
    const file = await this.revisionPath(id, hash);
    return this.git(['show', `${hash}:${file}`]);
  }
  async revisionImage(id, hash, source, wiki = false) {
    const root = this.root;
    const file = await this.revisionPath(id, hash);
    if (this.root !== root) throw new Error('笔记库已变化，请重新打开历史版本');
    if (this.revisionImages?.root !== root) this.revisionImages = new RevisionImages(root, this.environment);
    return this.revisionImages.read(hash, file, source, wiki);
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
  restore(id, hash) { return this.queued(async () => {
    const note = this.note(id), created = [], resolved = new Map();
    let content = await this.revision(id, hash);
    try {
      if (!note.filename.endsWith('.excalidraw')) {
        const { rewriteImageReferences } = await import('./markdown-images.mjs');
        content = await rewriteImageReferences(content, async (source, wiki) => {
          if (/^https?:\/\//i.test(source) || /\.excalidraw(?:\.md)?$/i.test(source)) return source;
          const key = `${wiki}:${source}`;
          if (resolved.has(key)) return resolved.get(key);
          const image = await this.revisionImage(id, hash, source, wiki);
          // Reuse only an identical current file at a path supported by the editor.
          if (/^\.\.\/images\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(png|jpe?g|gif|webp|avif)$/i.test(source)) {
            const current = await readBounded(await this.safe(source.slice(3)), { limit: 20 * 1024 * 1024 }).catch(() => null);
            if (current?.equals(image.bytes)) { resolved.set(key, source); return source; }
          }
          const target = await this.writeImage(image.bytes, image.path, id);
          created.push(target); resolved.set(key, target);
          return target;
        });
      }
      await this.saveInternal(id, content);
      return content;
    } catch (error) {
      // saveInternal may have written the body before a metadata failure. Keep referenced files.
      const saved = await this.read(id).catch(() => '');
      for (const source of created) if (!saved.includes(source)) await fs.rm(await this.safe(source.slice(3)), { force: true });
      throw error;
    }
  }); }
  async settings() { return { ...defaults, author: (await this.git(['config', 'user.name'], true)).trim(), email: (await this.git(['config', 'user.email'], true)).trim(), remote: (await this.git(['remote', 'get-url', 'origin'], true)).trim() }; }
  configure(settings) { return this.queued(async () => {
    if (typeof settings.author !== 'string' || typeof settings.email !== 'string' || typeof settings.remote !== 'string') throw new Error('设置无效');
    if (settings.remote && !/^(https?:\/\/|ssh:\/\/|git@)[^\s]+$/.test(settings.remote)) throw new Error('请使用 HTTPS 或 SSH 远程仓库地址');
    await this.git(['config', '--local', 'user.name', settings.author.trim()]);
    await this.git(['config', '--local', 'user.email', settings.email.trim()]);
    const existing = (await this.git(['remote'], true)).trim().split('\n').includes('origin');
    if (settings.remote) await this.git(['remote', existing ? 'set-url' : 'add', 'origin', settings.remote]);
    else if (existing) await this.git(['remote', 'remove', 'origin']);
  }); }
}
module.exports = { VaultStore, defaults };
