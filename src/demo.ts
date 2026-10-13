import type { Api, Commit, Manifest, Settings } from './types';
const welcome = `# 让每一个想法，都有迹可循。\n\n欢迎来到 **Fever**，一个安静、自由、属于你的知识空间。\n\n在这里，零散的灵感可以慢慢长成系统。用 Markdown 记录，用文件夹整理，用 Git 留住每一次思考的轨迹。\n\n## 一个为长期思考准备的地方\n\n好的笔记工具应该让你专注于内容，而不是工具本身。Fever 把熟悉的编辑体验和可靠的版本管理放在一起，让记录成为一件自然的事。\n\n> 写下来，是思考的开始。\n> 每一次修改，都是理解向前的一小步。\n\n## 从一个小小的想法开始\n\n- [x] 创建你的第一个笔记库\n- [x] 认识 Markdown 的基本语法\n- [ ] 写下今天值得记住的一个想法\n- [ ] 提交一次 Git 备份\n\n### 你的笔记，始终属于你\n\n所有内容都保存在本地，没有专有格式，也没有迁移的负担。\n\n| 内容 | 存储位置 | 管理方式 |\n| --- | --- | --- |\n| 笔记正文 | \`notes/\` | Markdown · UUID 文件名 |\n| 图片附件 | \`images/\` | Git LFS |\n| 标题与分类 | \`fever.json\` | JSON 清单 |\n\n---\n\n不必一次整理好所有东西。先写下第一行，剩下的交给时间。\n`;
const seeds = [
 ['欢迎使用 Fever', '开始使用', welcome],
 ['Markdown 语法指南', '开始使用', '# Markdown 语法指南\n\n用简单的标记，表达清晰的想法。\n\n## 基础语法\n\n**粗体**、*斜体*、`行内代码`。\n\n```typescript\nconst thought = "写下第一个想法";\nconsole.log(thought);\n```\n\n## 待办事项\n\n- [ ] 开始记录\n- [x] 学会 Markdown\n'],
 ['构建我的第二大脑', '知识管理', '# 构建我的第二大脑\n\n把记忆交给笔记，把注意力留给思考。\n\n## 捕获 → 整理 → 连接 → 表达\n\n1. 随时捕捉有价值的信息\n2. 按主题而非来源整理\n3. 定期回顾，发现知识之间的联系\n4. 把输入转化为自己的表达\n\n> 你不需要记住所有事情，你需要知道去哪里找到它。\n'],
 ['关于渐进式总结', '知识管理', '# 关于渐进式总结\n\n每次重新阅读，都让重点更加清晰。\n\n- 第一层：保存原始材料\n- 第二层：标记重要段落\n- 第三层：提取核心观点\n- 第四层：用自己的话总结\n'],
 ['Fever 产品构想', '项目/Fever', '# Fever 产品构想\n\n## 核心原则\n\n- 本地优先，数据自由\n- 安静的编辑体验\n- 开放的 Markdown 格式\n- 可靠的 Git 版本管理\n\n## 下一步\n\n- [ ] 完成跨平台打包\n- [ ] 建立自己的笔记习惯\n'],
 ['Git 工作流笔记', '项目/Fever', '# Git 工作流笔记\n\n## 日常工作流\n\n```bash\ngit pull --ff-only\ngit add notes/ images/ fever.json\ngit commit -m "整理今天的笔记"\ngit push\n```\n\n图片使用 Git LFS 跟踪；每篇笔记可独立查看历史。\n'],
 ['十月，慢一点也没关系', '日记/2026', '# 十月，慢一点也没关系\n\n今天整理了桌面，也整理了一点思绪。\n\n有些事情不必急着找到答案。持续记录，答案会在回看时慢慢浮现。\n\n## 今天的小确幸\n\n- 一杯温热的咖啡\n- 读完了搁置已久的文章\n- 给一个新想法写了第一行\n'],
 ['值得反复阅读的书', '阅读', '# 值得反复阅读的书\n\n| 书籍 | 一句话收获 |\n| --- | --- |\n| 原子习惯 | 让改变小到无法拒绝 |\n| 深度工作 | 把注意力放在真正重要的事情上 |\n| 如何阅读一本书 | 带着问题阅读 |\n'],
];
const key = 'fever-demo-v1';
type State = { manifest: Manifest; contents: Record<string, string>; versions: Record<string, { commit: Commit; content: string }[]>; settings: Settings; dirty: string[]; images: Record<string, string>; baseFiles?: Record<string, string>; stagedFiles?: Record<string, string | null>; filenames?: Record<string, string> };
const initial: State = { manifest: { version: 1, categories: ['开始使用', '知识管理', '项目/Fever', '日记/2026', '阅读'], notes: [] }, contents: {}, versions: {}, settings: { autoCommit: false, interval: 10, author: 'Fever', email: 'hello@example.com', remote: '' }, dirty: [], images: {} };
seeds.forEach(([title, category, content], i) => {
 const id = `demo-${i + 1}`; initial.manifest.notes.push({ id, title, category, filename: `${id}.md`, createdAt: '2026-10-06T08:00:00Z', updatedAt: '2026-10-06T10:24:00Z' }); initial.contents[id] = content;
 initial.versions[id] = [{ commit: { hash: 'a83c2d4' + '0'.repeat(33), author: 'Fever', date: '2026-10-06T10:24:00Z', message: '完善笔记内容与目录结构' }, content }, { commit: { hash: '7f6b91e' + '0'.repeat(33), author: 'Fever', date: '2026-10-05T08:30:00Z', message: '创建笔记，记录最初的想法' }, content: `# ${title}\n\n从一个想法开始。\n` }];
});
let state: State;
try { state = JSON.parse(localStorage.getItem(key) || 'null') || initial; } catch { state = initial; }
state.filenames = { ...state.filenames, ...Object.fromEntries([...initial.manifest.notes, ...state.manifest.notes].map(note => [note.id, note.filename])) };
const workingFiles = (): Record<string, string> => ({
 'fever.json': JSON.stringify(state.manifest, null, 2),
 ...Object.fromEntries(Object.entries(state.contents).filter(([id]) => state.filenames![id]).map(([id, content]) => [`notes/${state.filenames![id]}`, content])),
 ...Object.fromEntries(Object.entries(state.images).map(([file, data]) => [file.slice(3), data])),
});
state.baseFiles ||= {
 'fever.json': JSON.stringify({ ...state.manifest, notes: state.manifest.notes.filter(note => state.versions[note.id]?.length) }, null, 2),
 ...Object.fromEntries(Object.entries(state.versions).filter(([, versions]) => versions.length).map(([id, versions]) => [`notes/${state.filenames![id]}`, versions[0].content])),
 ...Object.fromEntries(Object.entries(state.images).filter(([file]) => !state.dirty.includes(file.slice(3))).map(([file, data]) => [file.slice(3), data])),
};
state.stagedFiles ||= {};
const fileChanges = () => {
 const files = workingFiles(), base = state.baseFiles!, staged = state.stagedFiles!;
 return [...new Set([...Object.keys(base), ...Object.keys(files), ...Object.keys(staged)])].flatMap(path => {
  const before = base[path] ?? null, index = Object.hasOwn(staged, path) ? staged[path] : before, after = files[path] ?? null;
  const isStaged = index !== before, unstaged = after !== index;
  return isStaged || unstaged ? [{ path, staged: isStaged, unstaged, status: before === null ? (isStaged ? 'A' : '??') : after === null ? 'D' : 'M' }] : [];
 });
};
const noteIdFor = (path: string) => Object.keys(state.filenames!).find(id => `notes/${state.filenames![id]}` === path);
const persist = () => localStorage.setItem(key, JSON.stringify(state));
const dirty = (file: string) => { if (!state.dirty.includes(file)) state.dirty.push(file); persist(); };
const snapshot = () => ({ path: '浏览器演示 / 我的知识库', name: '我的知识库', manifest: structuredClone(state.manifest), lfs: true });
export const demo: Api = {
 desktop: false, current: async () => snapshot(), open: async () => snapshot(),
 read: async id => state.contents[id] || '',
 search: async query => { const needle = query.toLowerCase(); return query.trim() ? state.manifest.notes.filter(note => note.title.toLowerCase().includes(needle) || note.category.toLowerCase().includes(needle) || (state.contents[note.id] || '').toLowerCase().includes(needle)).map(note => note.id) : []; },
 cancelSearch: async () => {},
 save: async (id, content) => { state.contents[id] = content; const note = state.manifest.notes.find(n => n.id === id); if (note) { note.updatedAt = new Date().toISOString(); dirty(`notes/${note.filename}`); } },
 create: async (title, category, format = 'markdown') => { const id = crypto.randomUUID(), now = new Date().toISOString(); const note = { id, title, category, filename: `${id}.${format === 'excalidraw' ? 'excalidraw' : 'md'}`, createdAt: now, updatedAt: now }; state.manifest.notes.push(note); state.filenames![id] = note.filename; state.contents[id] = format === 'excalidraw' ? JSON.stringify({ type: 'excalidraw', version: 2, source: 'Fever', elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }, null, 2) : `# ${title}\n\n`; if (!state.manifest.categories.includes(category)) state.manifest.categories.push(category); dirty('fever.json'); dirty(`notes/${note.filename}`); return note; },
 update: async (id, title, category) => { const note = state.manifest.notes.find(n => n.id === id)!; Object.assign(note, { title, category }); if (!state.manifest.categories.includes(category)) state.manifest.categories.push(category); dirty('fever.json'); return { ...note }; },
 remove: async id => { const note = state.manifest.notes.find(n => n.id === id)!; state.manifest.notes = state.manifest.notes.filter(n => n.id !== id); delete state.contents[id]; dirty(`notes/${note.filename}`); dirty('fever.json'); },
 category: async path => { if (!state.manifest.categories.includes(path)) state.manifest.categories.push(path); dirty('fever.json'); },
 importNotes: async () => [],
 localizeImages: async () => { throw new Error('请在桌面版中转换外部图片'); },
 image: async (bytes, name) => { const file = `../images/${crypto.randomUUID()}.${name.split('.').pop()}`; const blob = new Blob([new Uint8Array(bytes)]); state.images[file] = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsDataURL(blob); }); dirty(file.slice(3)); return file; },
 asset: src => state.images[src] || '',
 status: async () => ({ branch: 'main', changes: fileChanges(), ahead: 0, behind: 0, remote: state.settings.remote, lfs: true }),
 diff: async (path, staged = false) => {
  const before = (staged ? state.baseFiles![path] : Object.hasOwn(state.stagedFiles!, path) ? state.stagedFiles![path] : state.baseFiles![path]) ?? '';
  const after = (staged ? state.stagedFiles![path] : workingFiles()[path]) ?? '';
  if (path.startsWith('images/')) return { path, patch: '二进制文件发生变化，无法显示文本差异。' };
  const lines = (content: string) => content ? content.replace(/\n$/, '').split('\n') : [];
  const oldLines = lines(before), newLines = lines(after);
  return { path, patch: `--- a/${path}\n+++ b/${path}\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n${[...oldLines.map(line => '-' + line), ...newLines.map(line => '+' + line)].join('\n')}\n` };
 },
 stage: async path => { state.stagedFiles![path] = workingFiles()[path] ?? null; persist(); },
 unstage: async path => { delete state.stagedFiles![path]; persist(); },
 discard: async path => {
  const before = state.baseFiles![path], id = noteIdFor(path);
  if (path === 'fever.json') state.manifest = JSON.parse(before);
  else if (id) {
   if (before === undefined) { delete state.contents[id]; state.manifest.notes = state.manifest.notes.filter(note => note.id !== id); }
   else state.contents[id] = before;
  } else if (path.startsWith('images/')) {
   if (before === undefined) delete state.images[`../${path}`]; else state.images[`../${path}`] = before;
  }
  delete state.stagedFiles![path]; state.dirty = state.dirty.filter(file => file !== path); persist();
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
  const manifest = JSON.parse(content) as Manifest;
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.notes) || !Array.isArray(manifest.categories) || !manifest.categories.every(category => typeof category === 'string') || manifest.notes.some(note => !note || typeof note.id !== 'string' || typeof note.title !== 'string' || typeof note.category !== 'string' || !/^[a-zA-Z0-9_-]+\.(md|markdown|txt|fountain|excalidraw)$/.test(note.filename))) throw new Error('笔记清单无效');
  state.manifest = manifest;
  state.filenames = { ...state.filenames, ...Object.fromEntries(manifest.notes.map(note => [note.id, note.filename])) };
  dirty(path);
 },
 commit: async (message, stagedOnly = false) => {
  const files = stagedOnly ? { ...state.stagedFiles! } : Object.fromEntries(fileChanges().map(change => [change.path, workingFiles()[change.path] ?? null]));
  if (!Object.keys(files).length) throw new Error('没有需要提交的变更');
  const commit = { hash: crypto.randomUUID().replaceAll('-', '') + '12345678', author: state.settings.author, date: new Date().toISOString(), message };
  for (const [path, content] of Object.entries(files)) {
   const id = noteIdFor(path);
   if (id && content !== null) (state.versions[id] ||= []).unshift({ commit, content });
   if (content === null) delete state.baseFiles![path]; else state.baseFiles![path] = content;
   delete state.stagedFiles![path];
  }
  state.dirty = fileChanges().map(change => change.path); persist();
 },
 pull: async () => { throw new Error('浏览器演示不连接远程仓库，请使用 Electron 桌面应用'); },
 push: async () => { throw new Error('浏览器演示不连接远程仓库，请使用 Electron 桌面应用'); },
 history: async id => id ? (state.versions[id] || []).map(v => v.commit) : Array.from(new Map(Object.values(state.versions).flat().map(v => [v.commit.hash, v.commit])).values()),
 revision: async (id, hash) => state.versions[id]?.find(v => v.commit.hash === hash)?.content || '',
 restore: async (id, hash) => { const content = await demo.revision(id, hash); await demo.save(id, content); return content; },
 settings: async () => ({ ...state.settings }), configure: async settings => { state.settings = settings; persist(); },
};
