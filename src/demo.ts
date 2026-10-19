import { createTwoFilesPatch, formatPatch, structuredPatch } from 'diff';
import { notePath } from './notePaths.ts';
import { readManifest, manifestView, noteView, noteCategory, folderPaths, ensureFolder, moveCategory, removeCategory } from '../electron/manifest.mjs';
import type { Api, Commit, StoredManifest, StoredNote, Settings } from './types';
const welcome = `# 让每一个想法，都有迹可循。\n\n欢迎来到 **Fever**，一个安静、自由、属于你的知识空间。\n\n在这里，零散的灵感可以慢慢长成系统。用 Markdown 记录，用文件夹整理，用 Git 留住每一次思考的轨迹。\n\n## 一个为长期思考准备的地方\n\n好的笔记工具应该让你专注于内容，而不是工具本身。Fever 把熟悉的编辑体验和可靠的版本管理放在一起，让记录成为一件自然的事。\n\n> 写下来，是思考的开始。\n> 每一次修改，都是理解向前的一小步。\n\n## 从一个小小的想法开始\n\n- [x] 创建你的第一个笔记库\n- [x] 认识 Markdown 的基本语法\n- [ ] 写下今天值得记住的一个想法\n- [ ] 提交一次 Git 备份\n\n### 你的笔记，始终属于你\n\n所有内容都保存在本地，没有专有格式，也没有迁移的负担。\n\n| 内容 | 存储位置 | 管理方式 |\n| --- | --- | --- |\n| 笔记正文 | \`notes/\` | Markdown · UUID 文件名 |\n| 图片附件 | \`images/\` | Git LFS |\n| 标题与分类 | \`fever.json\` | JSON 清单 |\n\n---\n\n不必一次整理好所有东西。先写下第一行，剩下的交给时间。\n`;
const seeds = [
 ['欢迎使用 Fever', '开始使用', welcome],
 ['Markdown 语法指南', '开始使用', '# Markdown 语法指南\n\n用简单的标记，表达清晰的想法。\n\n## 基础语法\n\n**粗体**、*斜体*、`行内代码`。\n\n```typescript\nconst thought = "写下第一个想法";\nconsole.log(thought);\n```\n\n## 待办事项\n\n- [ ] 开始记录\n- [x] 学会 Markdown\n'],
 ['构建我的第二大脑', '知识管理', '# 构建我的第二大脑\n\n把记忆交给笔记，把注意力留给思考。\n\n## 捕获 → 整理 → 连接 → 表达\n\n1. 随时捕捉有价值的信息\n2. 按主题而非来源整理\n3. 定期回顾，发现知识之间的联系\n4. 把输入转化为自己的表达\n\n> 你不需要记住所有事情，你需要知道去哪里找到它。\n'],
 ['关于渐进式总结', '知识管理', '# 关于渐进式总结\n\n每次重新阅读，都让重点更加清晰。\n\n- 第一层：保存原始材料\n- 第二层：标记重要段落\n- 第三层：提取核心观点\n- 第四层：用自己的话总结\n'],
 ['Fever 产品构想', '项目/Fever', '# Fever 产品构想\n\n## 核心原则\n\n- 本地优先，数据自由\n- 安静的编辑体验\n- 开放的 Markdown 格式\n- 可靠的 Git 版本管理\n\n## 下一步\n\n- [ ] 完成跨平台打包\n- [ ] 建立自己的笔记习惯\n'],
 ['Git 工作流笔记', '项目/Fever', '# Git 工作流笔记\n\n## 日常工作流\n\n```bash\ngit pull --ff-only\ngit add notes/ drawings/ images/ fever.json\ngit commit -m "整理今天的笔记"\ngit push\n```\n\n图片使用 Git LFS 跟踪；每篇笔记可独立查看历史。\n'],
 ['十月，慢一点也没关系', '日记/2026', '# 十月，慢一点也没关系\n\n今天整理了桌面，也整理了一点思绪。\n\n有些事情不必急着找到答案。持续记录，答案会在回看时慢慢浮现。\n\n## 今天的小确幸\n\n- 一杯温热的咖啡\n- 读完了搁置已久的文章\n- 给一个新想法写了第一行\n'],
 ['值得反复阅读的书', '阅读', '# 值得反复阅读的书\n\n| 书籍 | 一句话收获 |\n| --- | --- |\n| 原子习惯 | 让改变小到无法拒绝 |\n| 深度工作 | 把注意力放在真正重要的事情上 |\n| 如何阅读一本书 | 带着问题阅读 |\n'],
];
const key = 'fever-demo-v1';
type State = { manifest: StoredManifest; contents: Record<string, string>; versions: Record<string, { commit: Commit; content: string }[]>; settings: Settings; dirty: string[]; images: Record<string, string>; baseFiles?: Record<string, string>; stagedFiles?: Record<string, string | null>; filenames?: Record<string, string>; paths?: Record<string, string> };
const initial: State = { manifest: readManifest({ version: 1, categories: ['开始使用', '知识管理', '项目/Fever', '日记/2026', '阅读'], notes: [] }), contents: {}, versions: {}, settings: { autoCommit: false, interval: 10, autoPull: false, pullInterval: 10, author: 'Fever', email: 'hello@example.com', remote: '' }, dirty: [], images: {} };
seeds.forEach(([title, category, content], i) => {
 const id = `demo-${i + 1}`; initial.manifest.notes.push({ id, title, folderId: ensureFolder(initial.manifest, category), filename: `${id}.md`, createdAt: '2026-10-06T08:00:00Z', updatedAt: '2026-10-06T10:24:00Z' }); initial.contents[id] = content;
 initial.versions[id] = [{ commit: { hash: 'a83c2d4' + '0'.repeat(33), author: 'Fever', date: '2026-10-06T10:24:00Z', message: '完善笔记内容与目录结构' }, content }, { commit: { hash: '7f6b91e' + '0'.repeat(33), author: 'Fever', date: '2026-10-05T08:30:00Z', message: '创建笔记，记录最初的想法' }, content: `# ${title}\n\n从一个想法开始。\n` }];
});
let state: State;
try { state = JSON.parse(localStorage.getItem(key) || 'null') || initial; } catch { state = initial; }
state.manifest = readManifest(state.manifest);
state.settings = { ...initial.settings, ...state.settings };
state.filenames = { ...state.filenames, ...Object.fromEntries([...initial.manifest.notes, ...state.manifest.notes, ...(state.manifest.trash || [])].map(note => [note.id, note.filename])) };
state.paths = { ...Object.fromEntries(Object.entries(state.filenames).map(([id, filename]) => [id, `notes/${filename}`])), ...state.paths, ...Object.fromEntries([...state.manifest.notes, ...(state.manifest.trash || [])].map(note => [note.id, notePath(note)])) };
const workingFiles = (): Record<string, string> => ({
 'fever.json': JSON.stringify(state.manifest, null, 2),
 ...Object.fromEntries(Object.entries(state.contents).filter(([id]) => state.filenames![id]).map(([id, content]) => [state.paths![id], content])),
 ...Object.fromEntries(Object.entries(state.images).map(([file, data]) => [file.slice(3), data])),
});
state.baseFiles ||= {
 'fever.json': JSON.stringify({ ...state.manifest, notes: state.manifest.notes.filter(note => state.versions[note.id]?.length) }, null, 2),
 ...Object.fromEntries(Object.entries(state.versions).filter(([, versions]) => versions.length).map(([id, versions]) => [state.paths![id], versions[0].content])),
 ...Object.fromEntries(Object.entries(state.images).filter(([file]) => !state.dirty.includes(file.slice(3))).map(([file, data]) => [file.slice(3), data])),
};
state.stagedFiles ||= {};
const withoutWhitespace = (text: string) => text.split('\n').map(line => line.replace(/[ \t\r\v\f]/g, '')).filter(Boolean).join('\n');
const fileChanges = (inspectWhitespace = false) => {
 const files = workingFiles(), base = state.baseFiles!, staged = state.stagedFiles!;
 return [...new Set([...Object.keys(base), ...Object.keys(files), ...Object.keys(staged)])].flatMap(path => {
  const before = base[path] ?? null, index = Object.hasOwn(staged, path) ? staged[path] : before, after = files[path] ?? null;
  const isStaged = index !== before, unstaged = after !== index;
  const text = inspectWhitespace && !path.startsWith('images/');
  return isStaged || unstaged ? [{ path, staged: isStaged, unstaged, status: before === null ? (isStaged ? 'A' : '??') : after === null ? 'D' : 'M',
   ...(text && isStaged && before !== null && index !== null && withoutWhitespace(before) === withoutWhitespace(index) ? { stagedWhitespaceOnly: true } : {}),
   ...(text && unstaged && index !== null && after !== null && withoutWhitespace(index) === withoutWhitespace(after) ? { unstagedWhitespaceOnly: true } : {}),
  }] : [];
 });
};
const noteIdFor = (path: string) => Object.keys(state.filenames!).find(id => state.paths![id] === path);
const persist = () => localStorage.setItem(key, JSON.stringify(state));
const dirty = (file: string) => { if (!state.dirty.includes(file)) state.dirty.push(file); persist(); };
const snapshot = () => ({ path: '浏览器演示 / 我的知识库', name: '我的知识库', manifest: manifestView(state.manifest), lfs: true });
function discardPaths(paths: string[]) {
 const selected = new Set(paths), trashPaths = new Set((state.manifest.trash || []).map(notePath));
 if (paths.some(path => trashPaths.has(path))) throw new Error('回收站中的笔记为只读，请先还原到原位置');
 const manifest = selected.has('fever.json') ? readManifest(JSON.parse(state.baseFiles!['fever.json']), state.manifest) : undefined;
 for (const path of paths) {
  const before = state.baseFiles![path], id = noteIdFor(path);
  if (path === 'fever.json') continue;
  if (id) {
   if (before === undefined) { delete state.contents[id]; state.manifest.notes = state.manifest.notes.filter(note => note.id !== id); }
   else state.contents[id] = before;
  } else if (path.startsWith('images/')) {
   if (before === undefined) delete state.images[`../${path}`]; else state.images[`../${path}`] = before;
  }
 }
 if (manifest) state.manifest = manifest;
 for (const path of paths) delete state.stagedFiles![path];
 state.dirty = state.dirty.filter(file => !selected.has(file)); persist();
}
persist();
const imageImports = new Map<string, string[]>();
export const demo: Api = {
 preview: async id => (state.contents[id] || '').slice(0, 8192),
 cancelPreview: async () => {},
 desktop: false, current: async () => snapshot(), open: async () => snapshot(),
 read: async (id, scope) => { if (!(scope === 'trash' ? state.manifest.trash || [] : state.manifest.notes).some(note => note.id === id)) throw new Error('笔记不存在'); return state.contents[id] || ''; },
 search: async (query, scope) => { const needle = query.toLowerCase(), paths = folderPaths(state.manifest); return query.trim() ? (scope === 'trash' ? state.manifest.trash || [] : state.manifest.notes).filter(note => note.title.toLowerCase().includes(needle) || noteCategory(state.manifest, note, paths).toLowerCase().includes(needle) || (state.contents[note.id] || '').toLowerCase().includes(needle)).map(note => note.id) : []; },
 cancelSearch: async () => {},
 save: async (id, content) => { const note = state.manifest.notes.find(n => n.id === id); if (!note) throw new Error('笔记不存在'); state.contents[id] = content; note.updatedAt = new Date().toISOString(); dirty(notePath(note)); return { updatedAt: note.updatedAt }; },
 create: async (title, category, format = 'markdown') => { const id = crypto.randomUUID(), now = new Date().toISOString(); const note: StoredNote = { id, title, folderId: ensureFolder(state.manifest, category), ...(format === 'excalidraw' ? { directory: 'drawings' } : {}), filename: `${id}.${format === 'excalidraw' ? 'excalidraw' : 'md'}`, createdAt: now, updatedAt: now }; state.manifest.notes.push(note); state.filenames![id] = note.filename; state.paths![id] = notePath(note); state.contents[id] = format === 'excalidraw' ? JSON.stringify({ type: 'excalidraw', version: 2, source: 'Fever', elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }, null, 2) : `# ${title}\n\n`; dirty('fever.json'); dirty(notePath(note)); return noteView(state.manifest, note); },
 update: async (id, title, category) => { const note = state.manifest.notes.find(n => n.id === id)!; Object.assign(note, { title, folderId: ensureFolder(state.manifest, category) }); dirty('fever.json'); return noteView(state.manifest, note); },
 remove: async id => { const note = state.manifest.notes.find(n => n.id === id); if (!note) throw new Error('笔记不存在'); state.manifest.notes = state.manifest.notes.filter(n => n.id !== id); (state.manifest.trash ||= []).push({ ...note, originalCategory: noteCategory(state.manifest, note) }); dirty('fever.json'); },
 restoreTrash: async id => { const note = state.manifest.trash?.find(n => n.id === id); if (!note) throw new Error('回收站中找不到这篇笔记'); if (!Object.hasOwn(state.contents, id)) throw new Error('笔记正文文件不存在'); state.manifest.trash = state.manifest.trash!.filter(n => n.id !== id); note.folderId = ensureFolder(state.manifest, noteCategory(state.manifest, note)); delete note.originalCategory; state.manifest.notes.push(note); dirty('fever.json'); return noteView(state.manifest, note); },
 category: async path => { ensureFolder(state.manifest, path); dirty('fever.json'); },
 moveCategory: async (from, to) => {
  const previous = state.manifest;
  state.manifest = moveCategory(previous, from, to);
  try { dirty('fever.json'); }
  catch (error) { state.manifest = previous; throw error; }
 },
 removeCategory: async path => {
  const previous = state.manifest;
  state.manifest = removeCategory(previous, path);
  try { dirty('fever.json'); }
  catch (error) { state.manifest = previous; throw error; }
 },
 importNotes: async () => [],
 localizeImages: async () => { throw new Error('请在桌面版中转换外部图片'); },
 image: async (bytes, name, noteId, importId) => {
  if (!state.manifest.notes.some(note => note.id === noteId)) throw new Error('笔记不存在');
  const ext = name.match(/\.[^.]+$/)?.[0] || '';
  if (!/^\.(png|jpe?g|gif|webp|avif)$/i.test(ext) || !bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('支持 PNG/JPEG/GIF/WebP/AVIF 图片，最大 20 MB');
  const blob = new Blob([new Uint8Array(bytes)]);
  const data = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(blob); });
  const now = new Date(), pad = (value: number, width = 2) => String(value).padStart(width, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
  let file = `../images/${noteId}/${date}${ext}`;
  for (let suffix = 1; Object.hasOwn(state.images, file); suffix++) file = `../images/${noteId}/${date}-${suffix}${ext}`;
  state.images[file] = data; dirty(file.slice(3));
  if (importId) imageImports.set(importId, [...(imageImports.get(importId) || []), file]);
  return file;
 },
 completeImageImport: async (importId, keep) => {
  if (!keep) for (const src of imageImports.get(importId) || []) {
   if (Object.values(state.contents).some(content => content.includes(src))) continue;
   delete state.images[src]; state.dirty = state.dirty.filter(file => file !== src.slice(3));
  }
  imageImports.delete(importId); persist();
 },
 asset: src => state.images[src] || '',
 status: async (inspectWhitespace = false) => ({ branch: 'main', head: Object.values(state.versions).flat().reduce((latest, version) => !latest || version.commit.date >= latest.date ? version.commit : latest, null as Commit | null)?.hash || '', changes: fileChanges(inspectWhitespace), ahead: 0, behind: 0, remote: state.settings.remote, lfs: true }),
 diff: async (path, staged = false) => {
  const beforeFile = (staged ? state.baseFiles![path] : Object.hasOwn(state.stagedFiles!, path) ? state.stagedFiles![path] : state.baseFiles![path]) ?? null;
  const afterFile = (staged ? state.stagedFiles![path] : workingFiles()[path]) ?? null;
  const before = beforeFile ?? '', after = afterFile ?? '';
  if (path.startsWith('images/')) return { path, patch: '二进制文件发生变化，无法显示文本差异。' };
  const patch = createTwoFilesPatch(`a/${path}`, `b/${path}`, before, after, '', '', { context: 3, timeout: 250 }) || '差异过大，无法显示。';
  // Keep file additions/deletions visible even when their content is blank.
  if (beforeFile === null || afterFile === null) return { path, patch };
  const options = {
   context: 3, timeout: 250, comparator: (left: string, right: string) => left.replace(/[ \t\r\v\f]/g, '') === right.replace(/[ \t\r\v\f]/g, ''),
  };
  const filtered = structuredPatch(`a/${path}`, `b/${path}`, before, after, '', '', options);
  if (!filtered) return { path, patch };
  filtered.hunks = filtered.hunks.filter(hunk => hunk.lines.some(line => /^[+-]/.test(line) && line.slice(1).trim()));
  return { path, patch, whitespaceIgnoredPatch: filtered.hunks.length ? formatPatch(filtered) : '已忽略空格和空行变化，没有其他文本差异。' };
 },
 stage: async path => { state.stagedFiles![path] = workingFiles()[path] ?? null; persist(); },
 unstage: async path => { delete state.stagedFiles![path]; persist(); },
 stageAll: async () => {
  const files = workingFiles();
  for (const change of fileChanges().filter(change => change.unstaged)) state.stagedFiles![change.path] = files[change.path] ?? null;
  persist();
 },
 unstageAll: async () => { state.stagedFiles = {}; persist(); },
 discard: async path => { discardPaths([path]); },
 discardAll: async () => {
  const paths = fileChanges().filter(change => change.unstaged).map(change => change.path);
  if (paths.length) discardPaths(paths);
  return paths;
 },
 openFile: async path => {
  const content = workingFiles()[path];
  if (content === undefined) throw new Error('文件不存在');
  return { path, content: path.startsWith('images/') ? '' : content, binary: path.startsWith('images/'), ...(path.startsWith('images/') ? { image: content } : {}) };
 },
 saveFile: async (path, content) => {
  const id = noteIdFor(path);
  if (id) return demo.save(id, content);
  if (path !== 'fever.json') throw new Error('文件不存在或不支持文本编辑');
  const manifest = readManifest(JSON.parse(content), state.manifest);
  const notes = [...manifest.notes, ...(manifest.trash || [])];
  state.manifest = manifest;
  state.filenames = { ...state.filenames, ...Object.fromEntries(notes.map(note => [note.id, note.filename])) };
  state.paths = { ...state.paths, ...Object.fromEntries(notes.map(note => [note.id, notePath(note)])) };
  dirty(path);
 },
 commit: async (message, stagedOnly = false, ignoreWhitespace = false) => {
  if (!message.trim()) throw new Error('请填写提交说明');
  const restoredPaths: string[] = [];
  if (ignoreWhitespace) {
   if (!stagedOnly) for (const change of fileChanges()) state.stagedFiles![change.path] = workingFiles()[change.path] ?? null;
   const changes = fileChanges(true).filter(change => change.stagedWhitespaceOnly || change.unstagedWhitespaceOnly);
   const trashPaths = new Set((state.manifest.trash || []).map(notePath));
   if (changes.some(change => trashPaths.has(change.path))) throw new Error('回收站中的笔记为只读，请先还原到原位置');
   for (const change of changes) {
    const base = state.baseFiles![change.path], id = noteIdFor(change.path);
    if (change.unstagedWhitespaceOnly || (change.stagedWhitespaceOnly && !change.unstaged)) {
     const content = change.stagedWhitespaceOnly ? base : state.stagedFiles![change.path] ?? base;
     if (change.path === 'fever.json') state.manifest = readManifest(JSON.parse(content), state.manifest);
     else if (id) state.contents[id] = content;
    }
    if (change.stagedWhitespaceOnly) delete state.stagedFiles![change.path];
    restoredPaths.push(change.path);
   }
   state.dirty = fileChanges().map(change => change.path); persist();
  }
  const files = stagedOnly ? { ...state.stagedFiles! } : Object.fromEntries(fileChanges().map(change => [change.path, workingFiles()[change.path] ?? null]));
  if (!Object.keys(files).length) {
   if (restoredPaths.length) return { committed: false, restoredPaths };
   throw new Error('没有需要提交的变更');
  }
  const commit = { hash: crypto.randomUUID().replaceAll('-', '') + '12345678', author: state.settings.author, date: new Date().toISOString(), message };
  for (const [path, content] of Object.entries(files)) {
   const id = noteIdFor(path);
   if (id && content !== null) (state.versions[id] ||= []).unshift({ commit, content });
   if (content === null) delete state.baseFiles![path]; else state.baseFiles![path] = content;
   delete state.stagedFiles![path];
  }
  state.dirty = fileChanges().map(change => change.path); persist();
  return { committed: true, restoredPaths };
 },
 pull: async () => { throw new Error('浏览器演示不连接远程仓库，请使用 Electron 桌面应用'); },
 push: async () => { throw new Error('浏览器演示不连接远程仓库，请使用 Electron 桌面应用'); },
 history: async id => id ? (state.versions[id] || []).map(v => v.commit) : Array.from(new Map(Object.values(state.versions).flat().map(v => [v.commit.hash, v.commit])).values()),
 revision: async (id, hash) => state.versions[id]?.find(v => v.commit.hash === hash)?.content || '',
 revisionComparison: async (id, hash) => {
  const versions = state.versions[id] || [], index = versions.findIndex(version => version.commit.hash === hash);
  if (index < 0) throw new Error('这个版本中找不到笔记文件');
  const previous = versions[index + 1];
  return { content: versions[index].content, previousContent: previous?.content ?? '', previousHash: previous?.commit.hash };
 },
 restore: async (id, hash) => { const content = await demo.revision(id, hash); await demo.save(id, content); return content; },
 settings: async () => ({ ...state.settings }), configure: async settings => {
  state.settings = { ...settings }; persist();
 },
};
