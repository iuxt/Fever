import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowRight, ArrowUp, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronRight, ChevronsUpDown, Circle, Clock3, Code2, Copy, FilePlus2, FileText, Flame, Folder, FolderOpen, FolderPlus, GitBranch, GitCommitHorizontal, History, ImagePlus, LayoutList, LoaderCircle, MoreHorizontal, PanelLeftClose, PanelRightClose, PenLine, Shapes, Plus, Search, Settings2, Sparkles, Trash2, Upload, X } from 'lucide-react';
import NoteTree from './NoteTree';
const MarkdownEditor = lazy(() => import('./MarkdownEditor'));
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkLegacyImages, { resolveAsset } from './legacyImages';
import { demo } from './demo';
import remarkDrawingEmbeds, { drawingJSON, isDrawingNote, isLegacyDrawing, resolveDrawing } from './drawings';
const DrawingEditor = lazy(() => import('./Drawing'));
const DrawingPreview = lazy(() => import('./Drawing').then(module => ({ default: module.DrawingPreview })));
const DrawingLoading = () => <span className="drawing-placeholder">正在加载绘图…</span>;
import type { Commit, GitStatus, Note, Settings, Vault } from './types';

const api = window.fever || demo;
type Modal = 'drawing' | 'embed' | 'note' | 'folder' | 'rename' | 'delete' | 'settings' | 'revision' | null;
const time = (date: string) => new Date(date).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const headingId = (text: string) => `heading-${text.replace(/[^\p{L}\p{N}]/gu, '-')}`;

function DrawingReference({ source, notes, onOpen }: { source: string; notes: Note[]; onOpen?: (id: string) => void }) {
 const note = resolveDrawing(source, notes);
 const [value, setValue] = useState(''), [error, setError] = useState('');
 useEffect(() => {
  let cancelled = false; setValue(''); setError('');
  if (!note) { setError('找不到绘图文件，或名称重复。请使用 notes/ 中的文件名引用。'); return; }
  api.read(note.id).then(value => { if (!cancelled) setValue(value); }).catch(e => { if (!cancelled) setError(e.message); });
  return () => { cancelled = true; };
 }, [note?.id, note?.updatedAt]);
 if (error) return <span role="alert" className="drawing-error">{error}</span>;
 return value ? <Suspense fallback={<DrawingLoading />}><DrawingPreview content={value} label={note?.title} onEdit={onOpen && note ? () => onOpen(note.id) : undefined} /></Suspense> : <DrawingLoading />;
}

const Markdown = memo(function Markdown({ content, assets, notes = [], onOpen }: { content: string; assets?: Record<string, string>; notes?: Note[]; onOpen?: (id: string) => void }) {
 const plugins = useMemo(() => [remarkGfm, [remarkDrawingEmbeds, notes], [remarkLegacyImages, assets || {}]] as import('unified').PluggableList, [notes, assets]);
 const components = useMemo<import('react-markdown').Components>(() => ({
  h1: ({ children }) => <h1 id={headingId(String(children))}>{children}</h1>,
  h2: ({ children }) => <h2 id={headingId(String(children))}>{children}</h2>,
  h3: ({ children }) => <h3 id={headingId(String(children))}>{children}</h3>,
  img: ({ src, alt }) => /\.excalidraw(?:\.md)?$/i.test(src || '') || resolveDrawing(src || '', notes) ? <DrawingReference source={src || ''} notes={notes} onOpen={onOpen} /> : <img src={api.asset(resolveAsset(src || '', assets))} alt={alt || '笔记图片'} loading="lazy" decoding="async" />,
  pre: ({ node, children }) => {
   const code = node?.children[0];
   if (code?.type === 'element' && Array.isArray(code.properties.className) && code.properties.className.includes('language-excalidraw')) {
    const json = code.children.map(child => child.type === 'text' ? child.value : '').join('');
    return <Suspense fallback={<DrawingLoading />}><DrawingPreview content={json} /></Suspense>;
   }
   return <pre>{children}</pre>;
  },
  a: ({ href, children }) => <a href={/^(https?:|mailto:|#)/.test(href || '') ? href : undefined} target={href?.startsWith('#') ? undefined : '_blank'} rel="noreferrer">{children}</a>,
 }), [notes, assets, onOpen]);
 return <ReactMarkdown remarkPlugins={plugins} components={components}>{content}</ReactMarkdown>;
});

export default function App() {
 const [vault, setVault] = useState<Vault | null>(null), [loading, setLoading] = useState(true);
 const [activeId, setActiveId] = useState(''), [tabs, setTabs] = useState<string[]>([]), [content, setContent] = useState('');
 const [mode, setMode] = useState<'read' | 'edit' | 'split'>('read');
 const [panel, setPanel] = useState<'outline' | 'history' | 'git'>('outline');
 const [rightOpen, setRightOpen] = useState(true), [leftOpen, setLeftOpen] = useState(true);
 const [query, setQuery] = useState(''), [searching, setSearching] = useState(false), [textMatches, setTextMatches] = useState<string[]>([]);
 const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
 const [status, setStatus] = useState<GitStatus | null>(null), [history, setHistory] = useState<Commit[]>([]);
 const [modal, setModal] = useState<Modal>(null), [field, setField] = useState(''), [category, setCategory] = useState('');
 const [settings, setSettings] = useState<Settings>({ autoCommit: false, interval: 10, author: '', email: '', remote: '' });
 const [embedId, setEmbedId] = useState(''), [editorVersion, setEditorVersion] = useState(0);
 const [revision, setRevision] = useState(''), [selectedCommit, setSelectedCommit] = useState<Commit | null>(null);
 const [commitMessage, setCommitMessage] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(true);
 const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null), [menu, setMenu] = useState(false);
 const [dark, setDark] = useState(localStorage.getItem('fever-theme') === 'dark');
 const pending = useRef(new Map<string, string>()), saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null), readToken = useRef(0);
 const searchRef = useRef<HTMLInputElement>(null), imageRef = useRef<HTMLInputElement>(null);
 const active = vault?.manifest.notes.find(n => n.id === activeId);
 const drawing = Boolean(active && (isDrawingNote(active) || isLegacyDrawing(content)));
 const drawings = vault?.manifest.notes.filter(isDrawingNote) || [];
 const notify = useCallback((message: string, error = false) => setNotice({ message, error }), []);
 const refresh = useCallback(async () => {
  const v = await api.current(); setVault(v); setStatus(v ? await api.status() : null);
 }, []);
 const flush = useCallback(async () => {
  if (saveTimer.current) clearTimeout(saveTimer.current);
  for (const [id, value] of [...pending.current]) {
   await api.save(id, value);
   if (pending.current.get(id) === value) pending.current.delete(id);
  }
  setSaved(pending.current.size === 0);
 }, []);
 const select = useCallback(async (id: string) => {
  const token = ++readToken.current;
  try { await flush(); const value = await api.read(id); if (token !== readToken.current) return; setActiveId(id); setContent(value); setEditorVersion(version => version + 1); setTabs(t => t.includes(id) ? t : [...t, id]); setSaved(true); setMenu(false); }
  catch (e) { notify(String((e as Error).message), true); }
 }, [flush, notify]);
 const openDrawing = useCallback((id: string) => { void select(id); setMode('edit'); }, [select]);
 const toggleFolder = useCallback((path: string) => setCollapsed(prev => { const next = new Set(prev); next.has(path) ? next.delete(path) : next.add(path); return next; }), []);
 useEffect(() => { let mounted = true; api.current().then(async v => { if (!mounted) return; setVault(v); if (v) { const id = v.manifest.notes[0]?.id; if (id) await select(id); setStatus(await api.status()); setSettings(await api.settings()); } }).catch(e => notify(e.message, true)).finally(() => setLoading(false)); return () => { mounted = false; }; }, [select, notify]);
 useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(timer); }, [notice]);
 useEffect(() => { if (modal !== 'revision') { setRevision(''); setSelectedCommit(null); } }, [modal]);
 useEffect(() => api.onBackupError?.(message => notify(`自动备份失败：${message}`, true)), [notify]);
 useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('fever-theme', dark ? 'dark' : 'light'); }, [dark]);
 useEffect(() => {
  if (!vault) return;
  const timer = setInterval(() => { api.status().then(setStatus).catch(() => {}); }, 5000);
  return () => clearInterval(timer);
 }, [vault?.path]);
 useEffect(() => { if (panel !== 'history' || !activeId) return; let cancelled = false; api.history(activeId).then(h => { if (!cancelled) setHistory(h); }).catch(e => notify(e.message, true)); return () => { cancelled = true; }; }, [panel, activeId, status, notify]);
 useEffect(() => {
  setTextMatches([]);
  if (!query.trim() || !vault) { void api.cancelSearch().catch(() => {}); return; }
  let cancelled = false;
  const timer = setTimeout(() => { api.search(query).then(result => { if (!cancelled) setTextMatches(result); }).catch(e => { if (!cancelled) notify(e.message, true); }); }, 250);
  return () => { cancelled = true; clearTimeout(timer); void api.cancelSearch().catch(() => {}); };
 }, [query, vault]);
 useEffect(() => {
  const keydown = (e: KeyboardEvent) => {
   if (e.metaKey || e.ctrlKey) {
    if (e.key.toLowerCase() === 'k') { e.preventDefault(); setLeftOpen(true); setSearching(true); searchRef.current?.focus(); }
    if (e.key.toLowerCase() === 'n') { e.preventDefault(); setField(''); setCategory(active?.category || vault?.manifest.categories[0] || '收件箱'); setModal('note'); }
    if (e.key.toLowerCase() === 's') { e.preventDefault(); flush().then(refresh).then(() => notify('笔记已保存')).catch(err => notify(err.message, true)); }
    if (e.key.toLowerCase() === 'e') { e.preventDefault(); setMode(m => m === 'read' ? 'edit' : 'read'); }
   }
   if (e.key === 'Escape') { setModal(null); setMenu(false); setSearching(false); setQuery(''); }
  };
  window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
 }, [active, vault, flush, refresh, notify]);
 useEffect(() => {
  const unload = (e: BeforeUnloadEvent) => { if (pending.current.size) { e.preventDefault(); e.returnValue = ''; void flush(); } };
  window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload);
 }, [flush]);
 async function run(fn: () => Promise<void>, success?: string) { setBusy(true); try { await flush(); await fn(); await refresh(); if (success) notify(success); } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); } }
 async function openVault() { await run(async () => { const v = await api.open(); if (!v) return; setVault(v); setTabs([]); setActiveId(''); setContent(''); if (v.manifest.notes[0]) await select(v.manifest.notes[0].id); setSettings(await api.settings()); }); }
 const edit = useCallback((value: string) => { setContent(value); pending.current.set(activeId, value); setSaved(false); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => { flush().then(refresh).catch(e => notify(e.message, true)); }, 650); }, [activeId, flush, refresh, notify]);
 function showNew(kind: 'note' | 'folder' | 'drawing' | 'embed') { setField(''); setCategory(active?.category || vault?.manifest.categories[0] || '收件箱'); if (kind === 'embed') setEmbedId(drawings[0]?.id || ''); setModal(kind); }
 async function addImages(files: FileList | File[]) {
  if (!activeId) return;
  const selectedFiles = Array.from(files);
  await run(async () => { let value = content; for (const file of selectedFiles) { if (file.size > 20 * 1024 * 1024) throw new Error('图片最大为 20 MB'); const src = await api.image(new Uint8Array(await file.arrayBuffer()), file.name); value += `\n\n![${file.name.replace(/[\[\]]/g, '')}](${src})\n`; } edit(value); await flush(); }, '图片已添加到 images/');
 }
 async function submitModal() {
  await run(async () => {
   if (modal === 'note' || modal === 'drawing') { const note = await api.create(field.trim(), category.trim(), modal === 'drawing' ? 'excalidraw' : 'markdown'); await refresh(); await select(note.id); setMode('edit'); }
   if (modal === 'embed') {
    const note = embedId ? vault?.manifest.notes.find(n => n.id === embedId) : await api.create(field.trim(), category.trim(), 'excalidraw');
    if (!note) throw new Error('请选择绘图');
    const label = note.title.replace(/[\[\]\r\n]/g, '');
    edit(`${content}\n\n![${label}](../notes/${note.filename})\n`); await flush();
   }
   if (modal === 'folder') await api.category(field.trim());
   if (modal === 'rename' && active) await api.update(active.id, field.trim(), category.trim());
   if (modal === 'delete' && active) { await api.remove(active.id); setTabs(t => t.filter(id => id !== active.id)); const v = await api.current(); setVault(v); const next = v?.manifest.notes[0]; if (next) await select(next.id); else { setActiveId(''); setContent(''); } }
   if (modal === 'settings') { await api.configure(settings); notify('设置已保存'); }
   if (modal === 'revision' && active && selectedCommit) { const value = await api.restore(active.id, selectedCommit.hash); setContent(value); setMode('read'); notify('已恢复到当前工作区，可提交为新的版本'); }
   setModal(null);
  });
 }
 const headings = useMemo(() => (drawing ? '' : content).split('\n').filter(l => /^#{1,3}\s/.test(l)).map(l => ({ level: l.match(/^#+/)![0].length, text: l.replace(/^#+\s+/, '').replace(/[*`]/g, '') })), [content, drawing]);
 const drawingCount = useMemo(() => { if (!drawing) return 0; try { return JSON.parse(drawingJSON(content)).elements.filter((element: { isDeleted?: boolean }) => !element.isDeleted).length; } catch { return 0; } }, [content, drawing]);
 const counts = useMemo(() => {
  if (drawing) return { chars: 0, words: 0 };
  let chars = content.length, words = 0;
  // Count without retaining an array for every word/Chinese character.
  for (const match of content.matchAll(/\s+/g)) chars -= match[0].length;
  for (const _match of content.matchAll(/[\u4e00-\u9fff]|[a-zA-Z0-9]+/g)) words++;
  return { chars, words };
 }, [content, drawing]);
 const filtered = useMemo(() => { const matches = new Set(textMatches), needle = query.toLowerCase(); return vault?.manifest.notes.filter(n => n.title.toLowerCase().includes(needle) || n.category.toLowerCase().includes(needle) || matches.has(n.id)) || []; }, [vault, query, textMatches]);

 if (loading) return <div className="welcome"><LoaderCircle className="spin" /><p>正在打开你的知识空间…</p></div>;
 if (!vault) return <div className="welcome"><div className="welcome-art"><Flame size={56} strokeWidth={1.3} /><span className="orbit one" /><span className="orbit two" /></div><div className="eyebrow">A HOME FOR YOUR THOUGHTS</div><h1>让想法，有一个家。</h1><p>本地优先的 Markdown 笔记。<br />用 Git 留住思考的每一次生长。</p><button className="primary large" onClick={() => void openVault()} disabled={busy}><FolderOpen size={18} />选择笔记库文件夹<ArrowRight size={17} /></button><small>选择空文件夹创建笔记库，或打开已有 Fever 笔记库</small><div className="welcome-details"><span><FileText size={15} />开放的 Markdown</span><span><GitBranch size={15} />Git 版本管理</span><span><CheckCheck size={15} />数据始终属于你</span></div>{notice && <div className="toast error">{notice.message}</div>}</div>;

 return <div className="app-shell">
  <aside className="rail"><button className="brand-mark" title="Fever" onClick={() => { setPanel('outline'); setLeftOpen(true); }}><Flame size={26} fill="currentColor" strokeWidth={1.4} /></button><div className="rail-main"><button className={panel !== 'git' && !searching ? 'rail-button active' : 'rail-button'} title="笔记" onClick={() => { setSearching(false); setLeftOpen(true); setPanel('outline'); }}><BookOpen size={21} /></button><button className={searching ? 'rail-button active' : 'rail-button'} title="搜索 · ⌘ K" onClick={() => { setLeftOpen(true); setSearching(true); setTimeout(() => searchRef.current?.focus(), 0); }}><Search size={21} /></button><button className={panel === 'git' ? 'rail-button active' : 'rail-button'} title="Git 管理" onClick={() => { setPanel('git'); setRightOpen(true); }}><GitBranch size={21} />{Boolean(status?.changes.length) && <i className="notification-dot" />}</button><button className={panel === 'history' ? 'rail-button active' : 'rail-button'} title="笔记历史" onClick={() => { setPanel('history'); setRightOpen(true); }}><History size={21} /></button></div><div className="rail-bottom"><button className="rail-button" title="切换主题" onClick={() => setDark(!dark)}><Sparkles size={20} /></button><button className="rail-button" title="设置" onClick={() => { api.settings().then(setSettings); setModal('settings'); }}><Settings2 size={20} /></button><div className="avatar" title="本地笔记库">F</div></div></aside>
  {leftOpen && <aside className="sidebar"><div className="sidebar-brand"><span>fever<span className="brand-period">.</span></span><span className="local-tag">LOCAL FIRST</span></div><button className="vault-select" onClick={() => void openVault()} title={`切换笔记库 · ${vault.path}`}><span className="vault-icon"><BookOpen size={18} /></span><span><strong>{vault.name}</strong><small>你的私人知识空间</small></span><ChevronsUpDown size={14} /></button><div className="sidebar-search"><Search size={15} /><input ref={searchRef} value={query} placeholder="搜索你的笔记…" onFocus={() => setSearching(true)} onChange={e => setQuery(e.target.value)} /><kbd>⌘ K</kbd></div><button className="new-note" onClick={() => showNew('note')}><Plus size={17} /><span>新建笔记</span><kbd>⌘ N</kbd></button><div className="tree-label"><span>{query ? `搜索结果 · ${filtered.length}` : '我的笔记'}</span><div><button title="新建绘图" onClick={() => showNew('drawing')}><Shapes size={15} /></button><button title="新建分类" onClick={() => showNew('folder')}><FolderPlus size={15} /></button><button title="导入 Markdown / Excalidraw" onClick={() => void run(async () => { const notes = await api.importNotes(); if (notes.length) { await refresh(); await select(notes[0].id); } else if (!api.desktop) notify('Markdown / Excalidraw 导入请使用桌面应用'); })}><Upload size={15} /></button></div></div><NoteTree notes={vault.manifest.notes} categories={vault.manifest.categories} results={query ? filtered : null} activeId={activeId} collapsed={collapsed} onToggle={toggleFolder} onSelect={select} /><div className="sidebar-bottom"><div className="local-note"><span className="little-leaf">✧</span><div><strong>让知识慢慢生长</strong><small>每一个想法，都值得被记住。</small></div></div><button className="repo-chip" onClick={() => { setPanel('git'); setRightOpen(true); }}><GitBranch size={14} /><span>{status?.branch || 'main'}</span><span className="repo-state"><i />{status?.changes.length ? `${status.changes.length} 项变更` : '工作区已同步'}</span></button><div className="sidebar-foot"><span>{vault.manifest.notes.length} 篇笔记</span><span>本地存储 <Check size={11} /></span></div></div></aside>}
  <main className="workspace"><header className="tab-bar"><button className="icon-button toggle-left" title="切换侧栏" onClick={() => setLeftOpen(!leftOpen)}><PanelLeftClose size={17} /></button><div className="tabs">{tabs.map(id => { const n = vault.manifest.notes.find(n => n.id === id); return n && <div key={id} className={`tab ${id === activeId ? 'current' : ''}`}><button onClick={() => void select(id)}>{isDrawingNote(n) ? <Shapes size={14} /> : <FileText size={14} />}<span>{n.title}</span></button><button title="关闭标签" onClick={() => void run(async () => { const remaining = tabs.filter(t => t !== id); setTabs(remaining); if (id === activeId) { if (remaining.length) await select(remaining[remaining.length - 1]); else { setActiveId(''); setContent(''); } } })}><X size={13} /></button></div>; })}<button className="icon-button tab-add" title="新建笔记" onClick={() => showNew('note')}><Plus size={17} /></button></div><button className="icon-button toggle-right" title="切换右侧面板" onClick={() => setRightOpen(!rightOpen)}><PanelRightClose size={17} /></button></header>
   <div className="editor-toolbar"><div className="breadcrumbs"><Folder size={14} />{active?.category.split('/').map(c => <span key={c}>{c}<ChevronRight size={12} /></span>)}<span className="breadcrumb-title">{active?.title || '我的笔记'}</span></div><div className="editor-actions"><div className="mode-switch"><button className={mode === 'edit' ? 'chosen' : ''} title="编辑模式 · ⌘ E" onClick={() => setMode('edit')}><PenLine size={15} /></button>{!drawing && <button className={mode === 'split' ? 'chosen' : ''} title="编辑与预览" onClick={() => setMode('split')}><Code2 size={16} /></button>}<button className={mode === 'read' ? 'chosen' : ''} title="阅读模式" onClick={() => setMode('read')}><BookOpen size={15} /></button></div><button className="icon-button" title="笔记历史" onClick={() => { setPanel('history'); setRightOpen(true); }}><History size={17} /></button><div className="more-wrap"><button className="icon-button" title="更多笔记操作" onClick={() => setMenu(!menu)}><MoreHorizontal size={19} /></button>{menu && <div className="dropdown"><button disabled={!active} onClick={() => { if (active) { setField(active.title); setCategory(active.category); setModal('rename'); setMenu(false); } }}><PenLine size={14} />重命名 / 移动笔记</button><button disabled={!active || drawing} onClick={() => imageRef.current?.click()}><ImagePlus size={14} />插入图片</button><button disabled={!active || drawing} onClick={() => { showNew('embed'); setMenu(false); }}><Shapes size={14} />插入 Excalidraw</button><button disabled={!active} onClick={() => { navigator.clipboard.writeText(content).then(() => notify(drawing ? '已复制绘图数据' : '已复制 Markdown')).catch(() => notify('复制失败', true)); setMenu(false); }}><Copy size={14} />{drawing ? '复制绘图数据' : '复制 Markdown'}</button>{drawing && <button onClick={() => { try { const blob = new Blob([drawingJSON(content)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${active?.title || 'drawing'}.excalidraw`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setMenu(false); } catch (e) { notify((e as Error).message, true); } }}><ArrowDownToLine size={14} />导出 .excalidraw</button>}<button className="danger-text" disabled={!active} onClick={() => { setModal('delete'); setMenu(false); }}><Trash2 size={14} />删除笔记</button></div>}</div></div></div>
   <div className={`document-space ${mode}`} onDragOver={e => { if (!drawing) e.preventDefault(); }} onDrop={e => { if (drawing) return; e.preventDefault(); if (e.dataTransfer.files.length) void addImages(e.dataTransfer.files); }}>
    {!active ? <div className="empty-workspace"><BookOpen size={40} strokeWidth={1} /><h2>给下一个想法留一点空间</h2><p>打开一篇笔记，或从新的一页开始。</p><button className="primary" onClick={() => showNew('note')}><Plus size={16} />新建笔记</button></div> : drawing ? <Suspense fallback={<DrawingLoading />}>{mode === 'read' ? <div className="drawing-document"><DrawingPreview key={activeId} content={content} label={active.title} onEdit={() => setMode('edit')} /></div> : <DrawingEditor key={`${activeId}:${editorVersion}`} content={content} dark={dark} onChange={edit} />}</Suspense> : <>
     {mode !== 'edit' && <article className="document"><div className="document-meta"><span className="category-pill"><Folder size={12} />{active.category || '未分类'}</span><span><Clock3 size={12} />更新于 {time(active.updatedAt)}</span></div><div className="prose"><Markdown content={content} assets={vault.manifest.assets} notes={vault.manifest.notes} onOpen={openDrawing} /></div><div className="document-end"><span />✧<span /></div></article>}
     {mode !== 'read' && <div className="source-editor"><div className="source-label"><span><PenLine size={13} />MARKDOWN</span><span><button className="text-button" onClick={() => showNew('embed')}><Shapes size={14} />插入 Excalidraw</button><button className="text-button" onClick={() => imageRef.current?.click()}><ImagePlus size={14} />插入图片</button></span></div><Suspense fallback={<span className="drawing-placeholder">正在加载编辑器…</span>}><MarkdownEditor key={activeId} content={content} dark={dark} onChange={edit} /></Suspense></div>}
    </>}
   </div><footer className="status-bar"><div><span className="saved-state">{saved ? <CheckCheck size={13} /> : <LoaderCircle className="spin" size={13} />}{saved ? '所有更改已保存' : '正在保存…'}</span>{!api.desktop && <span className="demo-label">浏览器演示</span>}</div><div>{drawing ? <span>{drawingCount} 个元素</span> : <><span>{counts.words.toLocaleString()} 字</span><span>{counts.chars.toLocaleString()} 字符</span></>}<span>{drawing ? 'Excalidraw' : 'Markdown'}</span><span>UTF-8</span><button title="Git 状态" onClick={() => { setPanel('git'); setRightOpen(true); }}><GitBranch size={12} />{status?.branch || 'main'}</button></div></footer>
  </main>
  {rightOpen && <aside className="inspector"><div className="inspector-tabs"><button className={panel === 'outline' ? 'active' : ''} onClick={() => setPanel('outline')}><LayoutList size={16} />大纲</button><button className={panel === 'history' ? 'active' : ''} onClick={() => setPanel('history')}><History size={16} />历史</button><button className={panel === 'git' ? 'active' : ''} onClick={() => setPanel('git')}><GitBranch size={16} />Git</button></div>
   {panel === 'outline' && <><div className="inspector-title">本篇目录<span>{headings.length}</span></div><nav className="outline">{headings.map((h, i) => <button key={i} className={`${i === 0 ? 'outline-first' : ''} level-${h.level}`} onClick={() => { setMode('read'); setTimeout(() => document.getElementById(headingId(h.text))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }}>{h.level === 1 ? <span className="outline-bullet" /> : <span className="outline-dash" />}<span>{h.text}</span></button>)}{!headings.length && <p className="muted">{drawing ? '绘图可在编辑模式中修改' : '添加 Markdown 标题来生成大纲'}</p>}</nav><div className="note-info"><div className="inspector-title">笔记信息<FileText size={14} /></div><dl><dt>创建时间</dt><dd>{active ? time(active.createdAt) : '—'}</dd><dt>最后更新</dt><dd>{active ? time(active.updatedAt) : '—'}</dd><dt>存储位置</dt><dd className="mono">notes/</dd><dt>文件名称</dt><dd className="filename" title={active?.filename}>{active?.filename || '—'}</dd></dl><div className="git-notice"><span className="git-notice-icon"><GitBranch size={18} /></span><div><strong>每一版，都有迹可循</strong><p>通过 Git 记录笔记的变化，<br />随时回到过去的某个想法。</p><button onClick={() => setPanel('history')}>查看版本历史<ArrowUpRight size={13} /></button></div></div></div><div className="inspector-bottom"><span>✧</span><p>记录此刻，连接未来。</p></div></>}
   {panel === 'history' && <><div className="inspector-title">版本历史<span>{history.length}</span></div><div className="history-note"><FileText size={14} /><span>{active?.title || '选择一篇笔记'}</span></div><div className="history-list">{history.map((c, i) => <button key={c.hash} className="history-item" onClick={() => void run(async () => { if (!activeId) return; setRevision(await api.revision(activeId, c.hash)); setSelectedCommit(c); setModal('revision'); })}><span className="timeline-node"><GitCommitHorizontal size={19} /></span><div>{i === 0 && <span className="latest-badge">最新提交</span>}<strong>{c.message}</strong><span>{time(c.date)}</span><small>{c.author} <code>{c.hash.slice(0, 7)}</code></small></div><ChevronRight size={13} /></button>)}{!history.length && <div className="panel-empty"><History size={30} /><p>还没有提交记录</p><small>在 Git 面板提交笔记后，<br />这里会记录它的每一次变化。</small><button className="text-button" onClick={() => setPanel('git')}>前往 Git 面板<ArrowRight size={13} /></button></div>}</div><div className="panel-tip"><CheckCheck size={15} />恢复版本会保留完整 Git 历史</div></>}
   {panel === 'git' && <><div className="inspector-title">源代码管理<button className="icon-button" title="刷新 Git 状态" onClick={() => void run(refresh)}><History size={14} /></button></div><div className="git-branch-card"><div><GitBranch size={17} /><strong>{status?.branch}</strong><span className="branch-badge">当前分支</span></div><p>{status?.remote ? status.remote : '本地仓库 · 未配置远程'}</p><div className="sync-counts"><span><ArrowUp size={12} />{status?.ahead || 0} 待推送</span><span><ArrowDown size={12} />{status?.behind || 0} 待拉取</span></div></div><div className="git-actions"><button disabled={busy} onClick={() => void run(async () => { await api.pull(); const v = await api.current(); setVault(v); if (v?.manifest.notes.some(n => n.id === activeId)) await select(activeId); else if (v?.manifest.notes[0]) await select(v.manifest.notes[0].id); else { setActiveId(''); setContent(''); } }, '已拉取远程更新')}><ArrowDownToLine size={15} />拉取</button><button disabled={busy} onClick={() => void run(() => api.push(), '已推送到远程仓库')}><Upload size={15} />推送</button></div><div className="changes-title"><span>工作区变更</span><span>{status?.changes.length || 0}</span></div><div className="changes-list">{status?.changes.map(c => <div className="change" key={c.path}><FileText size={14} /><span title={c.path}>{vault.manifest.notes.find(n => `notes/${n.filename}` === c.path)?.title || c.path}</span><code>{c.status === '??' ? 'U' : c.status}</code></div>)}{!status?.changes.length && <div className="clean-state"><CheckCheck size={26} /><span>工作区很干净</span><small>所有想法都已妥善保存</small></div>}</div><div className="commit-box"><textarea placeholder="这次记录了什么？" value={commitMessage} onChange={e => setCommitMessage(e.target.value)} /><button className="primary" disabled={busy || !commitMessage.trim() || !status?.changes.length} onClick={() => void run(async () => { await api.commit(commitMessage); setCommitMessage(''); }, '已创建 Git 提交')}><GitCommitHorizontal size={17} />{busy ? '正在处理…' : '提交所有笔记变更'}</button></div><div className="lfs-indicator"><span className={status?.lfs ? 'green-dot' : 'amber-dot'} />Git LFS {status?.lfs ? '已启用' : '未安装'}<span>images/</span></div><button className="git-settings-link" onClick={() => { api.settings().then(setSettings); setModal('settings'); }}><Settings2 size={14} />配置远程仓库与自动备份<ChevronRight size={13} /></button><div className="panel-tip"><Circle size={12} />拉取使用 fast-forward，保留你的历史</div></>}
  </aside>}
  <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" multiple hidden onChange={e => { if (e.target.files) void addImages(e.target.files); e.target.value = ''; }} />
  {notice && <div className={`toast ${notice.error ? 'error' : ''}`}>{notice.error ? <Circle size={16} /> : <CheckCheck size={17} />}<span>{notice.message}</span><button onClick={() => setNotice(null)}><X size={14} /></button></div>}
  {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setModal(null); }}><section className={`modal ${modal === 'revision' ? 'revision-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><span className="modal-icon">{modal === 'settings' ? <Settings2 size={20} /> : modal === 'revision' ? <History size={20} /> : modal === 'folder' ? <FolderPlus size={20} /> : <FilePlus2 size={20} />}</span><h2 id="modal-title">{{ drawing: '新建 Excalidraw 绘图', embed: '插入 Excalidraw', note: '写下一个新想法', folder: '新建分类', rename: '整理这篇笔记', delete: '删除这篇笔记？', settings: '笔记库设置', revision: '回看过去的想法' }[modal]}</h2></div><button className="icon-button" disabled={busy} onClick={() => setModal(null)}><X size={18} /></button></div>
   <div className="modal-body">{['note', 'folder', 'rename', 'drawing'].includes(modal) && <><label>{modal === 'folder' ? '分类名称' : modal === 'drawing' ? '绘图标题' : '笔记标题'}<input autoFocus value={field} placeholder={modal === 'folder' ? '例如：项目/Fever' : '给这个想法起个名字'} onChange={e => setField(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && field.trim()) void submitModal(); }} maxLength={200} /></label>{modal !== 'folder' && <label>所属分类<input list="category-options" value={category} onChange={e => setCategory(e.target.value)} placeholder="收件箱" maxLength={200} /><datalist id="category-options">{vault.manifest.categories.map(c => <option key={c}>{c}</option>)}</datalist></label>}<p className="form-hint">{modal === 'folder' ? '使用 / 创建嵌套分类，例如「项目/Fever」。' : modal === 'drawing' ? '绘图保存为 .excalidraw 文件，自动保存并纳入 Git 历史。' : '笔记使用唯一文件名保存，标题和分类记录在清单中。'}</p></>}
    {modal === 'embed' && <><label>选择绘图<select value={embedId} onChange={e => setEmbedId(e.target.value)}><option value="">新建绘图并插入</option>{drawings.map(note => <option key={note.id} value={note.id}>{note.category ? `${note.category} / ` : ''}{note.title}</option>)}</select></label>{!embedId && <><label>绘图标题<input autoFocus value={field} onChange={e => setField(e.target.value)} maxLength={200} placeholder="给绘图起个名字" /></label><label>所属分类<input value={category} onChange={e => setCategory(e.target.value)} maxLength={200} /></label></>}<p className="form-hint">绘图作为文件引用插入 Markdown，预览中点击「编辑绘图」即可修改。</p></>}
    {modal === 'delete' && <p className="delete-description">「{active?.title}」将从当前工作区移除。已提交的内容仍保留在 Git 历史中。</p>}
    {modal === 'settings' && <><div className="settings-vault"><FolderOpen size={17} /><div><strong>{vault.name}</strong><span>{vault.path}</span></div><button className="text-button" onClick={() => { setModal(null); void openVault(); }}>切换</button></div>{!api.desktop && <div className="demo-info">当前是浏览器演示，数据保存在此浏览器中。真实文件、Git、LFS 和定时备份请在桌面应用中使用。</div>}<div className="form-section-title">GIT 提交身份</div><div className="form-columns"><label>用户名<input value={settings.author} onChange={e => setSettings({ ...settings, author: e.target.value })} placeholder="你的名字" /></label><label>邮箱<input type="email" value={settings.email} onChange={e => setSettings({ ...settings, email: e.target.value })} placeholder="you@example.com" /></label></div><label>远程仓库（origin）<input value={settings.remote} onChange={e => setSettings({ ...settings, remote: e.target.value })} placeholder="git@github.com:you/notes.git" /></label><p className="form-hint">使用系统 Git 的 SSH 密钥或凭据管理器进行认证。</p><div className="setting-toggle"><div><strong>定时自动备份</strong><small>自动创建本地 Git 提交，推送由你手动操作。</small></div><button className={`switch ${settings.autoCommit ? 'on' : ''}`} role="switch" aria-checked={settings.autoCommit} aria-label="定时自动备份" disabled={!api.desktop} onClick={() => setSettings({ ...settings, autoCommit: !settings.autoCommit })}><span /></button></div>{settings.autoCommit && <label>备份间隔（分钟）<input type="number" min={1} max={1440} value={settings.interval} onChange={e => setSettings({ ...settings, interval: Number(e.target.value) })} /></label>}<div className="settings-lfs"><Check size={15} />笔记目录 <code>notes/</code> · 图片目录 <code>images/</code> · Git LFS {status?.lfs ? '已启用' : '待安装'}</div></>}
    {modal === 'revision' && <><div className="revision-meta"><GitCommitHorizontal size={16} /><code>{selectedCommit?.hash.slice(0, 7)}</code><strong>{selectedCommit?.message}</strong><span>{selectedCommit && time(selectedCommit.date)}</span></div><article className="prose revision-content"><Suspense fallback={<DrawingLoading />}>{active && (isDrawingNote(active) || isLegacyDrawing(revision)) ? <DrawingPreview content={revision} label={active.title} /> : <Markdown content={revision} assets={vault.manifest.assets} notes={vault.manifest.notes} />}</Suspense></article></>}
   </div><div className="modal-footer"><button className="secondary" disabled={busy} onClick={() => setModal(null)}>取消</button><button className={modal === 'delete' ? 'danger' : 'primary'} disabled={busy || (['note', 'folder', 'rename', 'drawing'].includes(modal) && !field.trim()) || (modal === 'embed' && !embedId && !field.trim())} onClick={() => void submitModal()}>{busy ? <LoaderCircle size={15} className="spin" /> : modal === 'revision' ? <History size={15} /> : <Check size={15} />}{modal === 'settings' ? '保存设置' : modal === 'revision' ? '恢复这个版本' : modal === 'delete' ? '删除笔记' : modal === 'folder' ? '创建分类' : modal === 'rename' ? '保存更改' : modal === 'drawing' ? '创建绘图' : modal === 'embed' ? '插入绘图' : '创建笔记'}</button></div>
  </section></div>}
 </div>;
}
