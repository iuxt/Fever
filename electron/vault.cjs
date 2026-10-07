const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const MANIFEST = 'fever.json';
const UUID_FILE = /^[a-zA-Z0-9_-]+\.(md|excalidraw)$/;
function validateDrawing(content) {
  let scene;
  try { scene = JSON.parse(content); } catch { throw new Error('Excalidraw 文件不是有效的 JSON'); }
  if (!scene || scene.type !== 'excalidraw' || !Array.isArray(scene.elements) || scene.elements.some(e => !e || typeof e.id !== 'string' || typeof e.type !== 'string' || !Number.isFinite(e.x) || !Number.isFinite(e.y)) || (scene.appState != null && (typeof scene.appState !== 'object' || Array.isArray(scene.appState))) || (scene.files != null && (typeof scene.files !== 'object' || Array.isArray(scene.files)))) throw new Error('Excalidraw 绘图格式无效');
}
const defaults = { autoCommit: false, interval: 10, author: '', email: '', remote: '' };

class VaultStore {
  constructor() {
    this.root = null; this.manifest = null; this.lfs = false; this.tail = Promise.resolve();
    this.environment = { ...process.env };
    // Finder-launched macOS apps do not inherit an interactive shell's Homebrew PATH.
    if (process.platform === 'darwin') this.environment.PATH = [...new Set([...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'])].join(path.delimiter);
  }
  queued(fn) { const next = this.tail.then(fn); this.tail = next.catch(() => {}); return next; }
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
    const temp = await this.safe(`.fever-${randomUUID()}.tmp`);
    await fs.writeFile(temp, JSON.stringify(this.manifest, null, 2) + '\n');
    await fs.rename(temp, await this.safe(MANIFEST));
  }
  snapshot() { return { path: this.root, name: path.basename(this.root), manifest: structuredClone(this.manifest), lfs: this.lfs }; }
  async open(folder) {
    return this.queued(async () => {
      this.cancelSearch();
      const root = await fs.realpath(folder);
      const previous = { root: this.root, manifest: this.manifest, lfs: this.lfs };
      this.root = root;
      try {
        let manifest, isNew = false;
        try {
          manifest = JSON.parse(await fs.readFile(await this.safe(MANIFEST), 'utf8'));
          if (manifest.version !== 1 || !Array.isArray(manifest.notes) || !Array.isArray(manifest.categories)) throw new Error('不支持的笔记清单格式');
          const ids = new Set(), files = new Set();
          for (const n of manifest.notes) {
            if (!n || typeof n.id !== 'string' || !UUID_FILE.test(n.filename) || typeof n.title !== 'string' || typeof n.category !== 'string' || ids.has(n.id) || files.has(n.filename)) throw new Error('笔记清单含有无效或重复的文件记录');
            ids.add(n.id); files.add(n.filename);
          }
          if (!manifest.categories.every(c => typeof c === 'string')) throw new Error('分类格式无效');
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
          // Never silently index or overwrite an unrelated notes directory.
          const entries = await fs.readdir(await this.safe('notes')).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
          if (entries.length) throw new Error('此文件夹包含 notes 文件但没有 fever.json，请选择空文件夹或已有 Fever 笔记库');
          manifest = { version: 1, categories: ['收件箱'], notes: [] };
          isNew = true;
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
    content ??= format === 'excalidraw' ? JSON.stringify({ type: 'excalidraw', version: 2, source: 'Fever', elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }, null, 2) : `# ${title}\n\n`;
    if (format === 'excalidraw') validateDrawing(content);
    await fs.writeFile(await this.safe(`notes/${note.filename}`), content, { flag: 'wx' });
    this.manifest.notes.push(note);
    if (category && !this.manifest.categories.includes(category)) this.manifest.categories.push(category);
    await this.persist(); return structuredClone(note);
  }
  create(title, category, format) { return this.queued(() => this.createInternal(title, category, undefined, format)); }
  async read(id) { return fs.readFile(await this.safe(`notes/${this.note(id).filename}`), 'utf8'); }
  save(id, content) { return this.queued(async () => {
    if (typeof content !== 'string' || Buffer.byteLength(content) > 10 * 1024 * 1024) throw new Error('笔记最大为 10 MB');
    const note = this.note(id), file = await this.safe(`notes/${note.filename}`);
    if (note.filename.endsWith('.excalidraw')) validateDrawing(content);
    const temp = await this.safe(`notes/.${randomUUID()}.tmp`);
    await fs.writeFile(temp, content); await fs.rename(temp, file);
    note.updatedAt = new Date().toISOString(); await this.persist();
  }); }
  update(id, title, category) { return this.queued(async () => {
    if (typeof title !== 'string' || !title.trim() || title.length > 200 || typeof category !== 'string' || category.length > 200) throw new Error('标题或分类无效');
    const note = this.note(id); Object.assign(note, { title: title.trim(), category: category.trim(), updatedAt: new Date().toISOString() });
    if (category && !this.manifest.categories.includes(category)) this.manifest.categories.push(category);
    await this.persist(); return structuredClone(note);
  }); }
  remove(id) { return this.queued(async () => { await fs.unlink(await this.safe(`notes/${this.note(id).filename}`)); this.manifest.notes = this.manifest.notes.filter(n => n.id !== id); await this.persist(); }); }
  category(category) { return this.queued(async () => { if (typeof category !== 'string' || !category.trim() || category.length > 200 || category.split('/').some(c => !c.trim())) throw new Error('分类无效'); if (!this.manifest.categories.includes(category.trim())) this.manifest.categories.push(category.trim()); await this.persist(); }); }
  importFile(file) { return this.queued(async () => {
    const content = await fs.readFile(file, 'utf8');
    if (Buffer.byteLength(content) > 10 * 1024 * 1024) throw new Error('导入文件最大为 10 MB');
    const drawing = /\.excalidraw$/i.test(file);
    const title = (!drawing && content.match(/^#\s+(.+)$/m)?.[1]) || path.basename(file, path.extname(file));
    return this.createInternal(title.slice(0, 200), '收件箱', content, drawing ? 'excalidraw' : 'markdown', path.basename(file));
  }); }
  image(bytes, name) { return this.queued(async () => {
    if (!this.lfs) throw new Error('请先安装 Git LFS 后重新打开笔记库，确保图片通过 LFS 管理');
    const ext = typeof name === 'string' ? path.extname(name).toLowerCase() : '';
    const size = ArrayBuffer.isView(bytes) ? bytes.byteLength : Array.isArray(bytes) ? bytes.length : 0;
    if (!['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif'].includes(ext) || size > 20 * 1024 * 1024 || !size) throw new Error('支持 PNG/JPEG/GIF/WebP/AVIF 图片，最大 20 MB');
    const buffer = ArrayBuffer.isView(bytes) ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : Buffer.from(bytes);
    const filename = randomUUID() + ext;
    await fs.writeFile(await this.safe(`images/${filename}`), buffer, { flag: 'wx' }); return `../images/${filename}`;
  }); }
  async status() {
    const raw = await this.git(['status', '--porcelain=v1', '-z']);
    const fields = raw.split('\0').filter(Boolean), changes = [];
    for (let i = 0; i < fields.length; i++) { const code = fields[i].slice(0, 2); changes.push({ status: code.trim(), path: fields[i].slice(3) }); if (/[RC]/.test(code)) i++; }
    const counts = (await this.git(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], true)).trim().split(/\s+/);
    return { branch: (await this.git(['branch', '--show-current'])).trim() || 'HEAD', changes, ahead: Number(counts[0]) || 0, behind: Number(counts[1]) || 0, remote: (await this.git(['remote', 'get-url', 'origin'], true)).trim(), lfs: this.lfs };
  }
  commit(message) { return this.queued(async () => {
    if (typeof message !== 'string' || !message.trim()) throw new Error('请填写提交说明');
    if (!(await this.git(['config', 'user.name'], true)).trim() || !(await this.git(['config', 'user.email'], true)).trim()) throw new Error('请先在设置中配置 Git 用户名和邮箱');
    if (!this.lfs && (await fs.readdir(await this.safe('images'))).length) throw new Error('图片提交需要安装 Git LFS');
    await this.git(['add', '--', MANIFEST, 'notes', 'images', '.gitattributes']);
    const staged = await this.git(['diff', '--cached', '--name-only']);
    if (!staged.trim()) throw new Error('没有需要提交的变更');
    if (staged.trim().split('\n').some(p => ![MANIFEST, '.gitattributes'].includes(p) && !p.startsWith('notes/') && !p.startsWith('images/'))) throw new Error('仓库中有其他已暂存文件，请先处理它们再提交笔记');
    await this.git(['commit', '-m', message.trim()]);
  }); }
  pull() { return this.queued(async () => {
    const status = await this.status();
    if (!status.remote) throw new Error('请先在设置中配置远程仓库');
    if (status.changes.length) throw new Error('请先提交本地变更再拉取');
    await this.git(['pull', '--ff-only', 'origin', status.branch]);
    this.cancelSearch();
    const manifest = JSON.parse(await fs.readFile(await this.safe(MANIFEST), 'utf8'));
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
      else if (commit === hash && /\.md$/i.test(line)) return this.git(['show', `${hash}:${line}`]);
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
