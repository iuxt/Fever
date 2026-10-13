const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isUtf8 } = require('node:buffer');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const { metadataView, updateMetadata } = require('./metadata.cjs');
const { downloadImage } = require('./remote-images.cjs');
const MANIFEST = 'fever.json';
const UUID_FILE = /^[a-zA-Z0-9_-]+\.(md|markdown|txt|fountain|excalidraw)$/;
function validateManifest(manifest) {
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.notes) || !Array.isArray(manifest.categories)) throw new Error('不支持的笔记清单格式');
  const ids = new Set(), files = new Set();
  for (const n of manifest.notes) {
    if (!n || typeof n.id !== 'string' || !UUID_FILE.test(n.filename) || typeof n.title !== 'string' || typeof n.category !== 'string' || ids.has(n.id) || files.has(n.filename)) throw new Error('笔记清单含有无效或重复的文件记录');
    ids.add(n.id); files.add(n.filename);
  }
  if (!manifest.categories.every(c => typeof c === 'string')) throw new Error('分类格式无效');
}
function validateDrawing(content) {
  let scene;
  try { scene = JSON.parse(content); } catch { throw new Error('Excalidraw 文件不是有效的 JSON'); }
  if (!scene || scene.type !== 'excalidraw' || !Array.isArray(scene.elements) || scene.elements.some(e => !e || typeof e.id !== 'string' || typeof e.type !== 'string' || !Number.isFinite(e.x) || !Number.isFinite(e.y)) || (scene.appState != null && (typeof scene.appState !== 'object' || Array.isArray(scene.appState))) || (scene.files != null && (typeof scene.files !== 'object' || Array.isArray(scene.files)))) throw new Error('Excalidraw 绘图格式无效');
}
const defaults = { autoCommit: false, interval: 10, author: '', email: '', remote: '' };

class VaultStore {
  constructor() {
    this.root = null; this.manifest = null; this.lfs = false; this.tail = Promise.resolve();
    this.manifestFile = MANIFEST; this.metadata = null; this.metadataText = null;
    this.environment = { ...process.env };
    // Finder-launched macOS apps do not inherit an interactive shell's Homebrew PATH.
    if (process.platform === 'darwin') this.environment.PATH = [...new Set([...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'])].join(path.delimiter);
  }
  queued(fn) { const next = this.tail.then(fn); this.tail = next.catch(() => {}); return next; }
  mutate(fn) { return this.queued(async () => {
    if (this.metadata) {
      const text = await fs.readFile(await this.safe(this.manifestFile), 'utf8');
      if (text !== this.metadataText) this.manifest = await this.loadMetadata(text);
    }
    return fn();
  }); }
  async assertMetadataUnchanged() {
    if (this.metadata && await fs.readFile(await this.safe(this.manifestFile), 'utf8') !== this.metadataText) throw new Error('metadata.json 已被其他程序修改，请重新打开笔记库后再保存');
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
  note(id) { const note = this.manifest?.notes.find(n => n.id === id); if (!note) throw new Error('笔记不存在'); return note; }
  cancelSearch() { this.searchController?.abort(); this.searchController = null; }
  async search(query) {
    this.cancelSearch();
    if (typeof query !== 'string') throw new Error('搜索内容无效');
    if (!query.trim() || !this.manifest) return [];
    const controller = new AbortController(); this.searchController = controller;
    const { signal } = controller, needle = query.toLowerCase(), notes = this.manifest.notes;
    const matches = new Set(); let cursor = 0;
    // Keep full Unicode case folding, but hold at most four note bodies in the main
    // process. Only IDs cross IPC; aborted queries stop scheduling file reads.
    const worker = async () => {
      while (!signal.aborted && cursor < notes.length) {
        const note = notes[cursor++];
        if (note.title.toLowerCase().includes(needle) || note.category.toLowerCase().includes(needle)) { matches.add(note.id); continue; }
        try {
          const file = await this.safe(`notes/${note.filename}`);
          if (signal.aborted) return;
          const content = await fs.readFile(file, { encoding: 'utf8', signal });
          if (content.toLowerCase().includes(needle)) matches.add(note.id);
        } catch { /* Missing/unreadable notes do not prevent searching the vault. */ }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(4, notes.length) }, worker));
      return signal.aborted ? [] : notes.filter(note => matches.has(note.id)).map(note => note.id);
    } finally { if (this.searchController === controller) this.searchController = null; }
  }
  async persist() {
    await this.assertMetadataUnchanged();
    const metadata = this.metadata ? updateMetadata(this.metadata, this.manifest) : null;
    const text = JSON.stringify(metadata || this.manifest, null, 2) + '\n';
    const temp = await this.safe(`.fever-${randomUUID()}.tmp`);
    await fs.writeFile(temp, text);
    await fs.rename(temp, await this.safe(this.manifestFile));
    if (metadata) {
      this.metadata = metadata; this.metadataText = text;
      const view = metadataView(metadata), categories = new Map(view.notes.map(note => [note.id, note.category]));
      this.manifest.categories = view.categories;
      for (const note of this.manifest.notes) note.category = categories.get(note.id);
    }
  }
  async loadMetadata(text) {
    const metadata = JSON.parse(text), manifest = metadataView(metadata);
    // FSNotes stores timestamps on the note files, rather than in its snapshot.
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, manifest.notes.length) }, async () => {
      while (cursor < manifest.notes.length) {
        const note = manifest.notes[cursor++], file = await this.safe(`notes/${note.filename}`);
        try {
          const stat = await fs.stat(file);
          note.createdAt = stat.birthtime.toISOString(); note.updatedAt = stat.mtime.toISOString();
          if (/\.(md|markdown)$/.test(note.filename)) {
            const handle = await fs.open(file, 'r');
            try {
              const { buffer, bytesRead } = await handle.read(Buffer.alloc(2048), 0, 2048, 0);
              const header = buffer.subarray(0, bytesRead).toString('utf8').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
              if (/^excalidraw-plugin:[ \t]*\S/m.test(header || '')) note.sourcePath = `${note.id}.excalidraw.md`;
            } finally { await handle.close(); }
          }
        } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
    }));
    this.metadata = metadata; this.metadataText = text; this.manifestFile = 'metadata.json';
    return manifest;
  }
  snapshot() { return { path: this.root, name: path.basename(this.root), manifest: structuredClone(this.manifest), lfs: this.lfs, format: this.metadata ? 'fsnotes' : 'fever' }; }
  async open(folder) {
    return this.queued(async () => {
      this.cancelSearch();
      const root = await fs.realpath(folder);
      const previous = { root: this.root, manifest: this.manifest, lfs: this.lfs, manifestFile: this.manifestFile, metadata: this.metadata, metadataText: this.metadataText };
      this.root = root;
      this.manifestFile = MANIFEST; this.metadata = null; this.metadataText = null;
      try {
        let manifest, isNew = false;
        try {
          manifest = JSON.parse(await fs.readFile(await this.safe(MANIFEST), 'utf8'));
          validateManifest(manifest);
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
          let text;
          try { text = await fs.readFile(await this.safe('metadata.json'), 'utf8'); }
          catch (e) { if (e.code !== 'ENOENT') throw e; }
          if (text !== undefined) manifest = await this.loadMetadata(text);
          else {
            // Never silently index or overwrite an unrelated notes directory.
            const entries = await fs.readdir(await this.safe('notes')).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
            if (entries.length) throw new Error('此文件夹包含 notes 文件但没有 fever.json 或 metadata.json，请选择空文件夹或已有笔记库');
            manifest = { version: 1, categories: ['收件箱'], notes: [] };
            isNew = true;
          }
        }
        this.manifest = manifest;
        await fs.mkdir(await this.safe('notes'), { recursive: true });
        await fs.mkdir(await this.safe('images'), { recursive: true });
        const top = (await this.git(['rev-parse', '--show-toplevel'], true)).trim();
        if (top && await fs.realpath(top) !== root) throw new Error('请选择独立的 Git 仓库根目录，不能选择其他仓库的子目录');
        if (!top) await this.git(['init', '-b', 'main']);
        const attributesFile = await this.safe('.gitattributes');
        const attributes = await fs.readFile(attributesFile, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
        if (!attributes.includes('images/** filter=lfs')) await fs.writeFile(attributesFile, attributes + (attributes && !attributes.endsWith('\n') ? '\n' : '') + 'images/** filter=lfs diff=lfs merge=lfs -text\n');
        this.lfs = Boolean((await this.git(['lfs', 'version'], true)).trim());
        if (this.lfs) await this.git(['lfs', 'install', '--local']);
        if (!this.metadata) await this.persist();
        if (isNew) await this.createInternal('欢迎使用 Fever', '收件箱', '# 欢迎使用 Fever\n\n这是属于你的本地笔记库。让每一个想法，都有迹可循。\n\n## 从这里开始\n\n- 新建笔记，写下第一个想法\n- 使用分类组织你的知识\n- 将图片拖入编辑器，自动保存到 `images/`\n- 在 Git 面板提交备份，查看每篇笔记的历史\n\n> 所有笔记保存在 `notes/` 中，标题与分类由 `fever.json` 管理。\n');
        return this.snapshot();
      } catch (e) { Object.assign(this, previous); throw e; }
    });
  }
  async createInternal(title, category, content, format = 'markdown', sourcePath) {
    title = String(title).trim(); category = String(category).trim();
    if (!title || title.length > 200 || category.length > 200) throw new Error('请输入有效的标题和分类（最多 200 字）');
    if (this.metadata && category && category.split('/').some(c => !c.trim())) throw new Error('分类无效');
    if (!['markdown', 'excalidraw'].includes(format)) throw new Error('不支持的文件格式');
    const id = randomUUID(), now = new Date().toISOString();
    const note = { id, filename: id + (format === 'excalidraw' && !this.metadata ? '.excalidraw' : '.md'), title, category, createdAt: now, updatedAt: now, ...(sourcePath ? { sourcePath } : {}) };
    content ??= format === 'excalidraw' ? JSON.stringify({ type: 'excalidraw', version: 2, source: 'Fever', elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }, null, 2) : `# ${title}\n\n`;
    if (format === 'excalidraw') {
      validateDrawing(content);
      if (this.metadata) {
        content = ['---', 'excalidraw-plugin: parsed', '---', '', '## Drawing', '```json', content, '```', ''].join('\n');
        note.sourcePath = `${id}.excalidraw.md`;
      }
    }
    await fs.writeFile(await this.safe(`notes/${note.filename}`), content, { flag: 'wx' });
    this.manifest.notes.push(note);
    if (category && !this.manifest.categories.includes(category)) this.manifest.categories.push(category);
    await this.persist(); return structuredClone(note);
  }
  create(title, category, format) { return this.mutate(() => this.createInternal(title, category, undefined, format)); }
  async read(id) { return fs.readFile(await this.safe(`notes/${this.note(id).filename}`), 'utf8'); }
  save(id, content) {
    const manifest = this.manifest;
    return this.mutate(async () => {
      if (typeof content !== 'string' || Buffer.byteLength(content) > 10 * 1024 * 1024) throw new Error('笔记最大为 10 MB');
      const note = this.note(id), file = await this.safe(`notes/${note.filename}`);
      if (note.filename.endsWith('.excalidraw')) validateDrawing(content);
      const temp = await this.safe(`notes/.${randomUUID()}.tmp`);
      await fs.writeFile(temp, content); await fs.rename(temp, file);
      note.updatedAt = new Date().toISOString(); await this.persist();
      // Include a snapshot only when mutate loaded metadata changed by another app.
      return { updatedAt: note.updatedAt, ...(manifest !== this.manifest ? { vault: this.snapshot() } : {}) };
    });
  }
  update(id, title, category) { return this.mutate(async () => {
    if (typeof title !== 'string' || !title.trim() || title.length > 200 || typeof category !== 'string' || category.length > 200) throw new Error('标题或分类无效');
    if (this.metadata && category && category.split('/').some(c => !c.trim())) throw new Error('分类无效');
    const note = this.note(id); Object.assign(note, { title: title.trim(), category: category.trim(), updatedAt: new Date().toISOString() });
    if (category && !this.manifest.categories.includes(category)) this.manifest.categories.push(category);
    await this.persist(); return structuredClone(note);
  }); }
  remove(id) { return this.mutate(async () => { const note = this.note(id); if (!this.metadata) await fs.unlink(await this.safe(`notes/${note.filename}`)); this.manifest.notes = this.manifest.notes.filter(n => n.id !== id); await this.persist(); }); }
  category(category) { return this.mutate(async () => { if (typeof category !== 'string' || !category.trim() || category.length > 200 || category.split('/').some(c => !c.trim())) throw new Error('分类无效'); if (!this.manifest.categories.includes(category.trim())) this.manifest.categories.push(category.trim()); await this.persist(); }); }
  importFile(file) { return this.mutate(async () => {
    const content = await fs.readFile(file, 'utf8');
    if (Buffer.byteLength(content) > 10 * 1024 * 1024) throw new Error('导入文件最大为 10 MB');
    const drawing = /\.excalidraw$/i.test(file);
    const title = (!drawing && content.match(/^#\s+(.+)$/m)?.[1]) || path.basename(file, path.extname(file));
    return this.createInternal(title.slice(0, 200), '收件箱', content, drawing ? 'excalidraw' : 'markdown', path.basename(file));
  }); }
  image(bytes, name) { return this.queued(() => this.writeImage(bytes, name)); }
  async writeImage(bytes, name) {
    if (!this.lfs) throw new Error('请先安装 Git LFS 后重新打开笔记库，确保图片通过 LFS 管理');
    const ext = typeof name === 'string' ? path.extname(name).toLowerCase() : '';
    const size = ArrayBuffer.isView(bytes) ? bytes.byteLength : Array.isArray(bytes) ? bytes.length : 0;
    if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'].includes(ext) || size > 20 * 1024 * 1024 || !size) throw new Error('支持 PNG/JPEG/GIF/WebP/AVIF 图片，最大 20 MB');
    const buffer = ArrayBuffer.isView(bytes) ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : Buffer.from(bytes);
    const filename = randomUUID() + ext;
    await fs.writeFile(await this.safe(`images/${filename}`), buffer, { flag: 'wx' }); return `../images/${filename}`;
  }
  async localizeImages(urls) {
    if (!this.root) throw new Error('请先打开笔记库');
    if (!this.lfs) throw new Error('请先安装 Git LFS 后重新打开笔记库，确保图片通过 LFS 管理');
    if (!Array.isArray(urls) || urls.length > 500 || urls.some(url => typeof url !== 'string' || !/^https?:\/\//i.test(url))) throw new Error('外部图片链接无效，一次最多转换 500 张图片');
    const root = this.root, replacements = {}, failed = [];
    for (const url of new Set(urls)) {
      try {
        const { bytes, extension } = await downloadImage(url);
        // Network requests must not hold up autosaves or note navigation.
        replacements[url] = await this.queued(() => {
          if (this.root !== root) throw new Error('笔记库已变化，请重新转换');
          return this.writeImage(bytes, `image${extension}`);
        });
      } catch (e) { failed.push({ url, message: e.name === 'TimeoutError' ? '下载超时' : e.message }); }
    }
    return { replacements, failed };
  }
  async status() {
    const raw = await this.git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    const fields = raw.split('\0').filter(Boolean), changes = [];
    for (let i = 0; i < fields.length; i++) {
      const code = fields[i].slice(0, 2), file = fields[i].slice(3);
      const originalPath = /[RC]/.test(code) ? fields[++i] : undefined;
      changes.push({ status: code.trim(), path: file, staged: code !== '??' && code[0] !== ' ', unstaged: code === '??' || code[1] !== ' ', ...(originalPath ? { originalPath } : {}) });
    }
    const counts = (await this.git(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], true)).trim().split(/\s+/);
    return { branch: (await this.git(['branch', '--show-current'])).trim() || 'HEAD', changes, ahead: Number(counts[0]) || 0, behind: Number(counts[1]) || 0, remote: (await this.git(['remote', 'get-url', 'origin'], true)).trim(), lfs: this.lfs };
  }
  async changeFile(relative) {
    if (typeof relative !== 'string' || !relative || relative.includes('\0') || relative.split(/[\\/]/).some(part => /^\.git$/i.test(part) || part === '..') || path.isAbsolute(relative)) throw new Error('文件路径无效');
    return this.safe(relative);
  }
  openFile(relative) { return this.queued(async () => {
    const file = await this.changeFile(relative), stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('请选择文件');
    if (stat.size > 20 * 1024 * 1024) throw new Error('文件最大为 20 MB');
    const bytes = await fs.readFile(file), ext = path.extname(relative).toLowerCase();
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' }[ext];
    const binary = Boolean(mime) || bytes.includes(0) || !isUtf8(bytes);
    if (!binary && bytes.length > 10 * 1024 * 1024) throw new Error('文本文件最大为 10 MB');
    return { path: relative, content: binary ? '' : bytes.toString('utf8'), binary, ...(mime ? { image: `data:${mime};base64,${bytes.toString('base64')}` } : {}) };
  }); }
  saveFile(relative, content) {
    const note = this.manifest?.notes.find(n => `notes/${n.filename}` === relative);
    if (note) return this.save(note.id, content);
    return this.mutate(async () => {
      const file = await this.changeFile(relative);
      if (typeof content !== 'string' || Buffer.byteLength(content) > 10 * 1024 * 1024) throw new Error('文本文件最大为 10 MB');
      const bytes = await fs.readFile(file);
      if (bytes.includes(0) || !isUtf8(bytes) || /\.(png|jpe?g|gif|webp|avif)$/i.test(relative)) throw new Error('二进制文件不能作为文本保存');
      let manifest;
      if (relative === this.manifestFile) {
        const parsed = JSON.parse(content);
        if (this.metadata) metadataView(parsed); else { validateManifest(parsed); manifest = parsed; }
      }
      if (relative.endsWith('.excalidraw')) validateDrawing(content);
      await this.assertMetadataUnchanged();
      const temp = await this.safe(`${path.dirname(relative)}/.fever-${randomUUID()}.tmp`);
      try { await fs.writeFile(temp, content); await fs.rename(temp, file); }
      finally { await fs.rm(temp, { force: true }); }
      if (relative === this.manifestFile) this.manifest = this.metadata ? await this.loadMetadata(content) : manifest;
    });
  }
  async change(relative) {
    await this.changeFile(relative);
    const change = (await this.status()).changes.find(c => c.path === relative);
    if (!change) throw new Error('文件已没有变更，请刷新 Git 状态');
    if (change.originalPath) await this.changeFile(change.originalPath);
    if (/^(DD|AU|UD|UA|DU|AA|UU)$/.test(change.status)) throw new Error('请先解决文件的合并冲突');
    return change;
  }
  diff(relative, staged = false) { return this.queued(async () => {
    const change = await this.change(relative);
    if (change.status === '??') {
      const file = await this.changeFile(relative), stat = await fs.stat(file);
      if (stat.size > 10 * 1024 * 1024) return { path: relative, patch: '文件过大，请打开文件查看内容。' };
      const bytes = await fs.readFile(file);
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
  discard(relative) { return this.mutate(async () => {
    const change = await this.change(relative), hasHead = Boolean((await this.git(['rev-parse', '--verify', 'HEAD'], true)).trim());
    const paths = [relative, ...(change.originalPath ? [change.originalPath] : [])];
    const tracked = [], added = [];
    for (const file of paths) {
      if (hasHead && (await this.git(['ls-tree', '--name-only', 'HEAD', '--', `:(literal)${file}`])).trim()) tracked.push(file);
      else added.push(file);
    }
    if (added.includes(this.manifestFile)) throw new Error('请先提交初始笔记库，不能撤销未提交的笔记清单');
    await this.assertMetadataUnchanged();
    if (relative === this.manifestFile) {
      // Validate the restored snapshot before changing either the index or the file.
      const restored = JSON.parse(await this.git(['show', `HEAD:${relative}`]));
      if (this.metadata) metadataView(restored);
      else if (restored.version !== 1 || !Array.isArray(restored.notes) || !Array.isArray(restored.categories) || restored.notes.some(n => !UUID_FILE.test(n.filename))) throw new Error('历史笔记清单无效');
    }
    if (tracked.length) await this.git(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...tracked.map(p => `:(literal)${p}`)]);
    for (const file of added) {
      if ((await this.git(['ls-files', '--', `:(literal)${file}`])).trim()) await this.git(['rm', '--cached', '-f', '--', `:(literal)${file}`]);
      await fs.rm(await this.changeFile(file), { force: true });
    }
    this.cancelSearch();
    if (relative === this.manifestFile) {
      const text = await fs.readFile(await this.safe(this.manifestFile), 'utf8');
      this.manifest = this.metadata ? await this.loadMetadata(text) : JSON.parse(text);
    } else if (added.some(file => this.manifest.notes.some(n => `notes/${n.filename}` === file))) {
      // Discarding a new note must not leave a dangling entry in the library.
      this.manifest.notes = this.manifest.notes.filter(n => !added.includes(`notes/${n.filename}`));
      await this.persist();
    }
  }); }
  commit(message, stagedOnly = false) { return this.queued(async () => {
    if (typeof message !== 'string' || !message.trim()) throw new Error('请填写提交说明');
    if (!(await this.git(['config', 'user.name'], true)).trim() || !(await this.git(['config', 'user.email'], true)).trim()) throw new Error('请先在设置中配置 Git 用户名和邮箱');
    if (!this.lfs && (await fs.readdir(await this.safe('images'))).length) throw new Error('图片提交需要安装 Git LFS');
    if (!stagedOnly) await this.git(['add', '--', this.manifestFile, 'notes', 'images', '.gitattributes']);
    const staged = await this.git(['diff', '--cached', '--name-only', '-z']);
    if (!staged.trim()) throw new Error('没有需要提交的变更');
    if (!stagedOnly && staged.split('\0').filter(Boolean).some(p => ![this.manifestFile, '.gitattributes'].includes(p) && !p.startsWith('notes/') && !p.startsWith('images/'))) throw new Error('仓库中有其他已暂存文件，请先处理它们再提交笔记');
    await this.git(['commit', '-m', message.trim()]);
  }); }
  pull() { return this.queued(async () => {
    const status = await this.status();
    if (!status.remote) throw new Error('请先在设置中配置远程仓库');
    if (status.changes.length) throw new Error('请先提交本地变更再拉取');
    await this.git(['pull', '--ff-only', 'origin', status.branch]);
    this.cancelSearch();
    const text = await fs.readFile(await this.safe(this.manifestFile), 'utf8');
    const manifest = this.metadata ? await this.loadMetadata(text) : JSON.parse(text);
    if (manifest.version !== 1 || !Array.isArray(manifest.notes) || !Array.isArray(manifest.categories) || manifest.notes.some(n => !UUID_FILE.test(n.filename))) throw new Error('远程笔记清单无效');
    this.manifest = manifest;
  }); }
  push() { return this.queued(async () => { const s = await this.status(); if (!s.remote) throw new Error('请先在设置中配置远程仓库'); if (s.branch === 'HEAD') throw new Error('请先切换到分支再推送'); await this.git(['push', '--set-upstream', 'origin', s.branch]); }); }
  async history(id) {
    const args = ['log', '-80', '--format=%H%x00%an%x00%aI%x00%s'];
    if (id) args.push('--follow', '--', `notes/${this.note(id).filename}`);
    const raw = await this.git(args, true);
    return raw.trim().split('\n').filter(Boolean).map(line => { const [hash, author, date, message] = line.split('\0'); return { hash, author, date, message }; });
  }
  async revision(id, hash) {
    if (!/^[0-9a-f]{40,64}$/.test(hash)) throw new Error('提交标识无效');
    const currentPath = `notes/${this.note(id).filename}`;
    const exists = await this.git(['ls-tree', '--name-only', hash, '--', currentPath]);
    if (exists.trim()) return this.git(['show', `${hash}:${currentPath}`]);
    // A migrated note keeps its Git lineage even though its original filename changed.
    const lineage = await this.git(['-c', 'core.quotepath=false', 'log', '--follow', '--format=%H', '--name-only', '--', currentPath]);
    let commit;
    for (const line of lineage.split('\n').filter(Boolean)) {
      if (/^[0-9a-f]{40,64}$/.test(line)) commit = line;
      else if (commit === hash && /\.(md|markdown|txt|fountain|excalidraw)$/i.test(line)) return this.git(['show', `${hash}:${line}`]);
    }
    throw new Error('这个版本中找不到笔记文件');
  }
  async restore(id, hash) { const content = await this.revision(id, hash); await this.save(id, content); return content; }
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
