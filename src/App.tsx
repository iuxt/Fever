import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowRight, ArrowUp, BookOpen, Check, CheckCheck, ChevronRight, Circle, Clock3, Code2, Copy, FilePlus2, FileText, Flame, Folder, FolderOpen, FolderPlus, GitBranch, GitCommitHorizontal, History, ImagePlus, LayoutList, LoaderCircle, MoreHorizontal, PanelLeftClose, PanelRightClose, PenLine, Shapes, Plus, Search, Settings2, Trash2, Upload, X } from 'lucide-react';
import GitChanges, { GitDiff } from './GitChanges';
import NoteTree, { type NoteTreeTarget } from './NoteTree';
import ContextMenu, { useContextMenu, type MenuItem } from './ContextMenu';
import { writeClipboard } from './clipboard';
import { fontSizes, useAppearance, type ThemeMode } from './appearance';
const MarkdownEditor = lazy(() => import('./MarkdownEditor'));
const SourceEditor = lazy(() => import('./SourceEditor'));
import type { MarkdownEditorHandle } from './MarkdownEditor';
import ReactMarkdown from 'react-markdown';
import { HighlightedCode } from './codeHighlight';
import remarkGfm from 'remark-gfm';
import remarkLegacyImages, { resolveAsset } from './legacyImages';
import { resolveNoteLink } from './noteLinks';
import { demo } from './demo';
import remarkDrawingEmbeds, { drawingJSON, isDrawingNote, isLegacyDrawing, resolveDrawing } from './drawings';
const DrawingEditor = lazy(() => import('./Drawing'));
const DrawingPreview = lazy(() => import('./Drawing').then(module => ({ default: module.DrawingPreview })));
const DrawingLoading = () => <span className="drawing-placeholder">正在加载绘图…</span>;
import type { Change, Commit, FileDiff, GitStatus, Note, Settings, Vault, VaultFile } from './types';

const api = window.fever || demo;
type Modal = 'drawing' | 'embed' | 'note' | 'folder' | 'rename' | 'delete' | 'settings' | 'discard' | null;
type EditorTab = { key: string; path: string } & ({ kind: 'diff'; diff: FileDiff; staged: boolean } | { kind: 'file'; file: VaultFile });
const time = (date: string) => new Date(date).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const defaultCommitMessage = () => {
 const date = new Date();
 return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const headingId = (text: string) => `heading-${text.replace(/[^\p{L}\p{N}]/gu, '-')}`;
const collapsedFolders = (vault: Vault) => {
 const folders = new Set<string>();
 const addPath = (category: string) => {
  const parts = category ? category.split('/') : [];
  for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'));
 };
 vault.manifest.categories.forEach(addPath);
 vault.manifest.notes.forEach(note => addPath(note.category));
 return folders;
};

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

const Markdown = memo(function Markdown({ content, assets, notes = [], onOpen, onNavigate }: { content: string; assets?: Record<string, string>; notes?: Note[]; onOpen?: (id: string) => void; onNavigate?: (href: string) => boolean }) {
 const plugins = useMemo(() => [remarkGfm, [remarkDrawingEmbeds, notes], [remarkLegacyImages, assets || {}]] as import('unified').PluggableList, [notes, assets]);
 const components = useMemo<import('react-markdown').Components>(() => ({
  h1: ({ children }) => <h1 id={headingId(String(children))}>{children}</h1>,
  h2: ({ children }) => <h2 id={headingId(String(children))}>{children}</h2>,
  h3: ({ children }) => <h3 id={headingId(String(children))}>{children}</h3>,
  img: ({ src, alt }) => /\.excalidraw(?:\.md)?$/i.test(src || '') || resolveDrawing(src || '', notes) ? <DrawingReference source={src || ''} notes={notes} onOpen={onOpen} /> : <img src={api.asset(resolveAsset(src || '', assets)) || undefined} alt={alt || '笔记图片'} loading="lazy" decoding="async" />,
  pre: ({ node, children }) => {
   const code = node?.children[0];
   if (code?.type === 'element' && Array.isArray(code.properties.className) && code.properties.className.includes('language-excalidraw')) {
    const json = code.children.map(child => child.type === 'text' ? child.value : '').join('');
    return <Suspense fallback={<DrawingLoading />}><DrawingPreview content={json} /></Suspense>;
   }
   if (code?.type === 'element' && code.tagName === 'code') {
    const classes = Array.isArray(code.properties.className) ? code.properties.className.map(String) : [];
    const language = classes.find(value => value.startsWith('language-'))?.slice('language-'.length);
    const text = code.children.map(child => child.type === 'text' ? child.value : '').join('');
    return <pre><HighlightedCode text={text} language={language} className={classes.join(' ')} /></pre>;
   }
   return <pre>{children}</pre>;
  },
  a: ({ href, children }) => {
   const internal = Boolean(href && onNavigate && resolveNoteLink(href, notes));
   return <a href={internal || /^(https?:|mailto:|#)/.test(href || '') ? href : undefined} target={internal || href?.startsWith('#') ? undefined : '_blank'} rel="noreferrer" onClick={event => { if (internal) { event.preventDefault(); onNavigate?.(href!); } }}>{children}</a>;
  },
 }), [notes, assets, onOpen, onNavigate]);
 return <ReactMarkdown remarkPlugins={plugins} components={components}>{content}</ReactMarkdown>;
});

export default function App() {
 const [vault, setVault] = useState<Vault | null>(null), [loading, setLoading] = useState(true);
 const [activeId, setActiveId] = useState(''), [tabs, setTabs] = useState<string[]>([]), [content, setContent] = useState('');
 const [mode, setMode] = useState<'edit' | 'split'>('edit');
 const [panel, setPanel] = useState<'outline' | 'history' | 'git'>('outline');
 const [rightOpen, setRightOpen] = useState(true), [leftOpen, setLeftOpen] = useState(true);
 const [query, setQuery] = useState(''), [textMatches, setTextMatches] = useState<string[]>([]);
 const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
 const [status, setStatus] = useState<GitStatus | null>(null), [history, setHistory] = useState<Commit[]>([]);
 const [modal, setModal] = useState<Modal>(null), [field, setField] = useState(''), [category, setCategory] = useState('');
 const [modalNoteId, setModalNoteId] = useState<string | null>(null);
 const contextMenu = useContextMenu();
 const [settings, setSettings] = useState<Settings>({ autoCommit: false, interval: 10, author: '', email: '', remote: '' });
 const [embedId, setEmbedId] = useState(''), [editorVersion, setEditorVersion] = useState(0);
 const [revision, setRevision] = useState(''), [selectedCommit, setSelectedCommit] = useState<Commit | null>(null);
 const [editorTabs, setEditorTabs] = useState<EditorTab[]>([]), [activeEditorKey, setActiveEditorKey] = useState<string | null>(null);
 const activeEditor = editorTabs.find(tab => tab.key === activeEditorKey);
 const [discardChange, setDiscardChange] = useState<Change | null>(null);
 const stagedCount = status?.changes.filter(change => change.staged).length || 0;
 const [commitMessage, setCommitMessage] = useState(defaultCommitMessage), [busy, setBusy] = useState(false), [saved, setSaved] = useState(true);
 const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null), [menu, setMenu] = useState(false);
 const { dark, themeMode, fontSize, setThemeMode, setFontSize } = useAppearance();
 const pending = useRef(new Map<string, string>()), saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null), readToken = useRef(0);
 const editVersion = useRef(0);
 const currentDocument = useRef({ id: activeId, content });
 currentDocument.current = { id: activeId, content };
 const editorRef = useRef<MarkdownEditorHandle | null>(null);
 const searchRef = useRef<HTMLInputElement>(null), imageRef = useRef<HTMLInputElement>(null);
 const active = vault?.manifest.notes.find(n => n.id === activeId);
 const modalNote = vault?.manifest.notes.find(n => n.id === (modalNoteId ?? activeId));
 const drawing = Boolean(active && (isDrawingNote(active) || isLegacyDrawing(content)));
 const displayedContent = selectedCommit ? revision : content;
 const displayedDrawing = selectedCommit ? Boolean(active && (isDrawingNote(active) || isLegacyDrawing(revision))) : drawing;
 const drawings = vault?.manifest.notes.filter(isDrawingNote) || [];
 const notify = useCallback((message: string, error = false) => setNotice({ message, error }), []);
 const refresh = useCallback(async () => {
  const v = await api.current(); setVault(v); setStatus(v ? await api.status() : null);
 }, []);
 const flush = useCallback(async () => {
  if (saveTimer.current) clearTimeout(saveTimer.current);
  for (const [id, value] of [...pending.current]) {
   if (id.startsWith('file:')) await api.saveFile(id.slice(5), value); else await api.save(id, value);
   if (pending.current.get(id) === value) pending.current.delete(id);
  }
  setSaved(pending.current.size === 0);
 }, []);
 const select = useCallback(async (id: string, preserveEditor = false) => {
  const token = ++readToken.current, version = editVersion.current;
  setSelectedCommit(null); setRevision('');
  try {
   await flush();
   const value = await api.read(id);
   if (token !== readToken.current) return;
   // An autosave may already have cleared pending while this older read was in
   // flight. Preserve both the current text and undo history in that case.
   const editedDuringRead = version !== editVersion.current && currentDocument.current.id === id;
   const latest = pending.current.get(id) ?? (editedDuringRead ? currentDocument.current.content : value);
   if (!preserveEditor) setActiveEditorKey(null);
   setActiveId(id); setContent(latest);
   if (!editedDuringRead) setEditorVersion(version => version + 1);
   setTabs(t => t.includes(id) ? t : [...t, id]); setSaved(pending.current.size === 0); setMenu(false);
  }
  catch (e) { notify(String((e as Error).message), true); }
 }, [flush, notify]);
 const clearDocument = useCallback(() => {
  // Cancel old reads before starting the next selection, never in a later effect.
  ++readToken.current;
  setActiveId(''); setContent(''); setSelectedCommit(null); setRevision('');
 }, []);
 const navigateNote = useCallback((href: string) => {
  const note = resolveNoteLink(href, vault?.manifest.notes || []);
  if (!note) return false;
  void select(note.id);
  return true;
 }, [vault?.manifest.notes, select]);
 const openDrawing = useCallback((id: string) => { void select(id); setMode('edit'); }, [select]);
 const editorMedia = useMemo(() => ({
  image: (src: string, alt: string) => /\.excalidraw(?:\.md)?$/i.test(src) || resolveDrawing(src, vault?.manifest.notes || []) ? <DrawingReference source={src} notes={vault?.manifest.notes || []} onOpen={openDrawing} /> : <img src={api.asset(resolveAsset(src, vault?.manifest.assets)) || undefined} alt={alt || '笔记图片'} loading="lazy" decoding="async" />,
  drawing: (value: string) => <Suspense fallback={<DrawingLoading />}><DrawingPreview content={value} /></Suspense>,
 }), [vault?.manifest.notes, vault?.manifest.assets, openDrawing]);
 const toggleFolder = useCallback((path: string) => setCollapsed(prev => { const next = new Set(prev); next.has(path) ? next.delete(path) : next.add(path); return next; }), []);
 useEffect(() => { let mounted = true; api.current().then(async v => { if (!mounted) return; setVault(v); if (v) { setCollapsed(collapsedFolders(v)); const id = v.manifest.notes[0]?.id; if (id) await select(id); setStatus(await api.status()); setSettings(await api.settings()); } }).catch(e => notify(e.message, true)).finally(() => setLoading(false)); return () => { mounted = false; }; }, [select, notify]);
 useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(timer); }, [notice]);
 useEffect(() => { if (!modal) setModalNoteId(null); }, [modal]);
 useEffect(() => { setHistory([]); }, [activeId]);
 useEffect(() => { if (modal !== 'discard') setDiscardChange(null); }, [modal]);
 useEffect(() => api.onBackupError?.(message => notify(`自动备份失败：${message}`, true)), [notify]);
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
    if (e.key.toLowerCase() === 'k') { e.preventDefault(); setLeftOpen(true); setTimeout(() => searchRef.current?.focus(), 0); }
    if (e.key.toLowerCase() === 'n') { e.preventDefault(); setField(''); setCategory(active?.category || vault?.manifest.categories[0] || '收件箱'); setModal('note'); }
    if (e.key.toLowerCase() === 's') { e.preventDefault(); flush().then(refresh).then(() => notify('笔记已保存')).catch(err => notify(err.message, true)); }
    if (!activeEditorKey && !selectedCommit && e.key.toLowerCase() === 'e') { e.preventDefault(); setMode(m => drawing || m === 'split' ? 'edit' : 'split'); }
   }
   if (e.key === 'Escape') { setModal(null); setMenu(false); setQuery(''); }
  };
  window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
 }, [active, vault, flush, refresh, notify, activeEditorKey, drawing, selectedCommit]);
 useEffect(() => {
  const unload = (e: BeforeUnloadEvent) => { if (pending.current.size) { e.preventDefault(); e.returnValue = ''; void flush(); } };
  window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload);
 }, [flush]);
 async function run(fn: () => Promise<void>, success?: string) { setBusy(true); try { await flush(); await fn(); await refresh(); if (success) notify(success); } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); } }
 function showEditorTab(tab: EditorTab) {
  ++readToken.current;
  setSelectedCommit(null); setRevision('');
  setEditorTabs(previous => previous.some(item => item.key === tab.key) ? previous.map(item => item.key === tab.key ? tab : item) : [...previous, tab]);
  setActiveEditorKey(tab.key); setMenu(false);
 }
 function leaveRevision() {
  ++readToken.current; setSelectedCommit(null); setRevision('');
 }
 async function openRevision(commit: Commit) {
  if (!activeId) return;
  const id = activeId, token = ++readToken.current;
  try {
   await flush();
   const value = await api.revision(id, commit.hash);
   if (token !== readToken.current) return;
   setActiveEditorKey(null); setRevision(value); setSelectedCommit(commit); setMenu(false); contextMenu.close();
  } catch (e) { if (token === readToken.current) notify((e as Error).message, true); }
 }
 async function restoreRevision() {
  if (!active || !selectedCommit) return;
  const id = active.id, hash = selectedCommit.hash;
  await run(async () => {
   await api.restore(id, hash);
   await select(id); setMode('edit');
  }, '已恢复到当前工作区，可提交为新的版本');
 }
 async function openDiff(change: Change, staged: boolean) {
  await run(async () => { const diff = await api.diff(change.path, staged); showEditorTab({ key: `diff:${staged}:${change.path}`, path: change.path, kind: 'diff', diff, staged }); });
 }
 async function openChangedFile(change: Change) {
  await run(async () => {
   const note = vault?.manifest.notes.find(n => `notes/${n.filename}` === change.path);
   if (note) { await select(note.id); setMode('edit'); }
   else { const file = await api.openFile(change.path); showEditorTab({ key: `file:${change.path}`, path: change.path, kind: 'file', file }); }
  });
 }
 async function activateEditor(tab: EditorTab) {
  await run(async () => { if (tab.kind === 'file') showEditorTab({ ...tab, file: await api.openFile(tab.path) }); else showEditorTab(tab); });
 }
 async function closeNote(id: string) {
  await run(async () => {
   const remaining = tabs.filter(tab => tab !== id); setTabs(remaining);
   if (id === activeId && !activeEditorKey) {
    if (remaining.length) await select(remaining.at(-1)!);
    else {
     clearDocument();
     if (editorTabs.length) setActiveEditorKey(editorTabs.at(-1)!.key);
    }
   }
  });
 }
 async function closeEditor(tab: EditorTab) {
  await run(async () => {
   const remaining = editorTabs.filter(item => item.key !== tab.key); setEditorTabs(remaining);
   if (activeEditorKey === tab.key) {
    if (remaining.length) setActiveEditorKey(remaining.at(-1)!.key);
    else {
     setActiveEditorKey(null);
     const next = tabs.includes(activeId) ? activeId : tabs.at(-1);
     if (next) await select(next); else clearDocument();
    }
   }
  });
 }
 useEffect(() => {
  const closeActiveTab = () => {
   if (busy || modal || loading) return;
   contextMenu.close(); setMenu(false);
   const tab = editorTabs.find(tab => tab.key === activeEditorKey);
   if (tab) void closeEditor(tab);
   else if (tabs.includes(activeId)) void closeNote(activeId);
  };
  const unsubscribe = api.onCloseTab?.(closeActiveTab);
  const keydown = (event: KeyboardEvent) => {
   if (!api.desktop && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'w') {
    event.preventDefault(); event.stopPropagation(); closeActiveTab();
   }
  };
  window.addEventListener('keydown', keydown, true);
  return () => { unsubscribe?.(); window.removeEventListener('keydown', keydown, true); };
 });
 function editFile(tab: EditorTab, value: string) {
  if (tab.kind !== 'file' || tab.file.binary) return;
  setEditorTabs(previous => previous.map(item => item.key === tab.key ? { ...tab, file: { ...tab.file, content: value } } : item));
  pending.current.set(`file:${tab.path}`, value); setSaved(false);
  if (saveTimer.current) clearTimeout(saveTimer.current);
  saveTimer.current = setTimeout(() => { flush().then(refresh).catch(e => notify(e.message, true)); }, 650);
 }
 async function discardFile() {
  if (!discardChange) return;
  await run(async () => {
   await api.discard(discardChange.path);
   const v = await api.current(); setVault(v);
   setTabs(previous => previous.filter(id => v?.manifest.notes.some(note => note.id === id)));
   const next = v?.manifest.notes.find(note => note.id === activeId) || v?.manifest.notes[0];
   if (next) await select(next.id, true); else clearDocument();
   if (activeEditor?.kind === 'file') {
    try { showEditorTab({ ...activeEditor, file: await api.openFile(activeEditor.path) }); }
    catch { setEditorTabs(previous => previous.filter(tab => tab.key !== activeEditor.key)); setActiveEditorKey(null); }
   } else if (activeEditor?.kind === 'diff' && activeEditor.path === discardChange.path) {
    setEditorTabs(previous => previous.filter(tab => tab.path !== discardChange.path)); setActiveEditorKey(null);
   }
   setModal(null); setDiscardChange(null);
  }, '已撤销文件变更');
 }
 async function openVault() { await run(async () => { const v = await api.open(); if (!v) return; setVault(v); setCollapsed(collapsedFolders(v)); setTabs([]); setEditorTabs([]); setActiveEditorKey(null); clearDocument(); if (v.manifest.notes[0]) await select(v.manifest.notes[0].id); setSettings(await api.settings()); }); }
 const edit = useCallback((value: string) => { ++editVersion.current; currentDocument.current = { id: activeId, content: value }; setContent(value); pending.current.set(activeId, value); setSaved(false); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => { flush().then(refresh).catch(e => notify(e.message, true)); }, 650); }, [activeId, flush, refresh, notify]);
 function showNew(kind: 'note' | 'folder' | 'drawing' | 'embed', path = active?.category || vault?.manifest.categories[0] || '收件箱') { setField(''); setCategory(path); if (kind === 'embed') setEmbedId(drawings[0]?.id || ''); setModal(kind); }
 const showNoteAction = useCallback((kind: 'rename' | 'delete', note: Note) => {
  setModalNoteId(note.id); setField(note.title); setCategory(note.category); setModal(kind); setMenu(false);
 }, []);
 const showTreeMenu = useCallback((event: MouseEvent<HTMLElement>, target: NoteTreeTarget) => {
  event.preventDefault(); event.stopPropagation(); setMenu(false);
  const path = target.kind === 'note' ? target.note.category : target.kind === 'folder' ? target.path : '';
  const createInCategory = (kind: 'note' | 'drawing') => { setField(''); setCategory(path); setModal(kind); };
  const items: MenuItem[] = [];
  if (target.kind === 'note') {
   const note = target.note;
   items.push(
    { label: '打开笔记', icon: <FileText size={14} />, action: () => select(note.id) },
    { label: '编辑笔记', icon: <PenLine size={14} />, action: async () => { await select(note.id); setMode('edit'); } },
    { label: '重命名 / 移动笔记', icon: <PenLine size={14} />, disabled: busy, action: () => showNoteAction('rename', note) },
    { label: isDrawingNote(note) ? '复制绘图数据' : '复制 Markdown', icon: <Copy size={14} />, action: async () => {
     const value = currentDocument.current.id === note.id ? currentDocument.current.content : pending.current.get(note.id) ?? await api.read(note.id);
     await writeClipboard({ text: value }); notify(isDrawingNote(note) ? '已复制绘图数据' : '已复制 Markdown');
    } },
    { label: '查看版本历史', icon: <History size={14} />, action: async () => { await select(note.id); setPanel('history'); setRightOpen(true); } },
    { separator: true },
   );
  }
  items.push(
   { label: '新建笔记', icon: <FilePlus2 size={14} />, disabled: busy, action: () => createInCategory('note') },
   { label: '新建绘图', icon: <Shapes size={14} />, disabled: busy, action: () => createInCategory('drawing') },
   { label: target.kind === 'folder' ? '新建子分类' : '新建分类', icon: <FolderPlus size={14} />, disabled: busy, action: () => { setField(target.kind === 'folder' ? `${path}/` : ''); setModal('folder'); } },
  );
  if (target.kind === 'folder') items.push({ label: collapsed.has(path) ? '展开分类' : '折叠分类', icon: <Folder size={14} />, action: () => toggleFolder(path) });
  if (target.kind === 'note') items.push({ separator: true }, { label: '删除笔记', icon: <Trash2 size={14} />, danger: true, disabled: busy, action: () => showNoteAction('delete', target.note) });
  const bounds = event.currentTarget.getBoundingClientRect();
  contextMenu.open({ x: event.clientX || bounds.left, y: event.clientY || bounds.bottom, label: '笔记列表菜单', items, returnFocus: event.currentTarget });
 }, [busy, collapsed, contextMenu.open, notify, select, showNoteAction, toggleFolder]);
 function showDocumentMenu(event: MouseEvent<HTMLElement>) {
  event.preventDefault(); event.stopPropagation(); setMenu(false);
  const selectedText = window.getSelection()?.toString() || '';
  contextMenu.open({ x: event.clientX, y: event.clientY, label: '笔记正文菜单', returnFocus: event.currentTarget, items: [
   { label: '复制', icon: <Copy size={14} />, disabled: !selectedText, action: () => writeClipboard({ text: selectedText }) },
   { label: '复制 Markdown', icon: <Copy size={14} />, action: () => writeClipboard({ text: content }) },
   { separator: true },
   { label: '编辑笔记', icon: <PenLine size={14} />, action: () => setMode('edit') },
   { label: 'Markdown 源码与预览', icon: <Code2 size={14} />, action: () => setMode('split') },
   { label: '查看版本历史', icon: <History size={14} />, action: () => { setPanel('history'); setRightOpen(true); } },
  ] });
 }
 async function insertMarkdown(markdown: string, targetId = activeId) {
  if (targetId === currentDocument.current.id) {
   if (!editorRef.current?.insertMarkdown(markdown)) edit(currentDocument.current.content + markdown);
  } else {
   const value = pending.current.get(targetId) ?? await api.read(targetId);
   pending.current.set(targetId, value + markdown);
   await flush();
  }
 }
 async function addImages(files: FileList | File[]) {
  if (!activeId) return;
  const selectedFiles = Array.from(files);
  await run(async () => { let markdown = ''; for (const file of selectedFiles) { if (file.size > 20 * 1024 * 1024) throw new Error('图片最大为 20 MB'); const src = await api.image(new Uint8Array(await file.arrayBuffer()), file.name); markdown += `\n\n![${file.name.replace(/[\[\]]/g, '')}](${src})\n`; } await insertMarkdown(markdown); await flush(); }, '图片已添加到 images/');
 }
 async function submitModal() {
  await run(async () => {
   if (modal === 'note' || modal === 'drawing') { const note = await api.create(field.trim(), category.trim(), modal === 'drawing' ? 'excalidraw' : 'markdown'); await refresh(); await select(note.id); setMode('edit'); }
   if (modal === 'embed') {
    const note = embedId ? vault?.manifest.notes.find(n => n.id === embedId) : await api.create(field.trim(), category.trim(), 'excalidraw');
    if (!note) throw new Error('请选择绘图');
    const label = note.title.replace(/[\[\]\r\n]/g, '');
    const markdown = `\n\n![${label}](../notes/${note.filename})\n`;
    await insertMarkdown(markdown);
    await flush();
   }
   if (modal === 'folder') await api.category(field.trim());
   if (modal === 'rename' && modalNote) await api.update(modalNote.id, field.trim(), category.trim());
   if (modal === 'delete' && modalNote) {
    await api.remove(modalNote.id); setTabs(t => t.filter(id => id !== modalNote.id));
    const v = await api.current(); setVault(v);
    if (modalNote.id === activeId) { const next = v?.manifest.notes[0]; if (next) await select(next.id); else clearDocument(); }
   }
   if (modal === 'settings') { await api.configure(settings); notify('设置已保存'); }
   setModal(null);
  });
 }
 const headings = useMemo(() => (displayedDrawing ? '' : displayedContent).split('\n').filter(l => /^#{1,3}\s/.test(l)).map(l => ({ level: l.match(/^#+/)![0].length, text: l.replace(/^#+\s+/, '').replace(/[*`]/g, '') })), [displayedContent, displayedDrawing]);
 const drawingCount = useMemo(() => { if (!displayedDrawing) return 0; try { return JSON.parse(drawingJSON(displayedContent)).elements.filter((element: { isDeleted?: boolean }) => !element.isDeleted).length; } catch { return 0; } }, [displayedContent, displayedDrawing]);
 const counts = useMemo(() => {
  if (displayedDrawing) return { chars: 0, words: 0 };
  let chars = displayedContent.length, words = 0;
  // Count without retaining an array for every word/Chinese character.
  for (const match of displayedContent.matchAll(/\s+/g)) chars -= match[0].length;
  for (const _match of displayedContent.matchAll(/[\u4e00-\u9fff]|[a-zA-Z0-9]+/g)) words++;
  return { chars, words };
 }, [displayedContent, displayedDrawing]);
 const filtered = useMemo(() => { const matches = new Set(textMatches), needle = query.toLowerCase(); return vault?.manifest.notes.filter(n => n.title.toLowerCase().includes(needle) || n.category.toLowerCase().includes(needle) || matches.has(n.id)) || []; }, [vault, query, textMatches]);

 if (loading) return <div className="welcome"><LoaderCircle className="spin" /><p>正在打开笔记库…</p></div>;
 if (!vault) return <div className="welcome"><div className="welcome-art"><Flame size={56} strokeWidth={1.3} /><span className="orbit one" /><span className="orbit two" /></div><h1>Fever</h1><button className="primary large" onClick={() => void openVault()} disabled={busy}><FolderOpen size={18} />选择笔记库文件夹<ArrowRight size={17} /></button>{notice && <div className="toast error">{notice.message}</div>}</div>;

 return <div className="app-shell">
  {leftOpen && <aside className="sidebar"><div className="sidebar-brand"><span>fever<span className="brand-period">.</span></span><button className="icon-button" title="设置" onClick={() => { api.settings().then(setSettings); setModal('settings'); }}><Settings2 size={18} /></button></div><div className="sidebar-search"><Search size={15} /><input ref={searchRef} value={query} placeholder="搜索你的笔记…" onChange={e => setQuery(e.target.value)} /><kbd>⌘ K</kbd></div><button className="new-note" onClick={() => showNew('note')}><Plus size={17} /><span>新建笔记</span><kbd>⌘ N</kbd></button><div className="tree-label"><span>{query ? `搜索结果 · ${filtered.length}` : '我的笔记'}</span><div><button title="新建绘图" onClick={() => showNew('drawing')}><Shapes size={15} /></button><button title="新建分类" onClick={() => showNew('folder')}><FolderPlus size={15} /></button><button title="导入 Markdown / Excalidraw" onClick={() => void run(async () => { const notes = await api.importNotes(); if (notes.length) { await refresh(); await select(notes[0].id); } else if (!api.desktop) notify('Markdown / Excalidraw 导入请使用桌面应用'); })}><Upload size={15} /></button></div></div><NoteTree notes={vault.manifest.notes} categories={vault.manifest.categories} results={query ? filtered : null} activeId={activeEditor ? '' : activeId} collapsed={collapsed} onToggle={toggleFolder} onSelect={select} onContextMenu={showTreeMenu} /><div className="sidebar-bottom"><div className="sidebar-foot"><span>{vault.manifest.notes.length} 篇笔记</span></div></div></aside>}
  <main className="workspace"><header className="tab-bar"><button className="icon-button toggle-left" title="切换侧栏" onClick={() => setLeftOpen(!leftOpen)}><PanelLeftClose size={17} /></button><div className="tabs">{tabs.map(id => { const n = vault.manifest.notes.find(n => n.id === id); return n && <div key={id} className={`tab ${!activeEditor && id === activeId ? 'current' : ''}`}><button onClick={() => void select(id)}>{isDrawingNote(n) ? <Shapes size={14} /> : <FileText size={14} />}<span>{n.title}</span></button><button title="关闭标签" disabled={busy} onClick={() => void closeNote(id)}><X size={13} /></button></div>; })}{editorTabs.map(tab => <div key={tab.key} className={`tab ${activeEditorKey === tab.key ? 'current' : ''}`}><button title={tab.path} disabled={busy} onClick={() => void activateEditor(tab)}>{tab.kind === 'diff' ? <GitBranch size={14} /> : <FileText size={14} />}<span>{vault.manifest.notes.find(note => `notes/${note.filename}` === tab.path)?.title || tab.path.split('/').pop()}{tab.kind === 'diff' ? ` · ${tab.staged ? '已暂存' : '工作区'}对比` : ''}</span></button><button title={`关闭${tab.kind === 'diff' ? '对比' : '文件'}：${tab.path}`} disabled={busy} onClick={() => void closeEditor(tab)}><X size={13} /></button></div>)}<button className="icon-button tab-add" title="新建笔记" onClick={() => showNew('note')}><Plus size={17} /></button></div><button className="icon-button toggle-right" title="切换右侧面板" onClick={() => setRightOpen(!rightOpen)}><PanelRightClose size={17} /></button></header>
   <div className="editor-toolbar"><div className="breadcrumbs"><Folder size={14} />{!activeEditor && active?.category.split('/').map(c => <span key={c}>{c}<ChevronRight size={12} /></span>)}<span className="breadcrumb-title">{activeEditor?.path || active?.title || '我的笔记'}</span></div>{selectedCommit ? <div className="editor-actions revision-actions"><span className="revision-readonly">只读</span><button className="text-button" disabled={busy} onClick={leaveRevision}>返回当前版本</button><button className="text-button" disabled={busy} onClick={() => void restoreRevision()}><History size={14} />恢复这个版本</button></div> : activeEditor ? <div className="editor-actions"><span className="editor-kind">{activeEditor.kind === 'diff' ? '文件变更对比' : activeEditor.file.binary ? '文件预览' : '源码编辑'}</span>{activeEditor.kind === 'diff' && <button className="text-button" disabled={busy} onClick={() => void openChangedFile({ path: activeEditor.path, status: '', staged: false, unstaged: false })}><PenLine size={14} />打开文件</button>}</div> : <div className="editor-actions">{!drawing && <div className="mode-switch"><button className={mode === 'edit' ? 'chosen' : ''} title="编辑模式 · ⌘ E" onClick={() => setMode('edit')}><PenLine size={15} /></button><button className={mode === 'split' ? 'chosen' : ''} title="Markdown 源码与预览" onClick={() => setMode('split')}><Code2 size={16} /></button></div>}<button className="icon-button" title="笔记历史" onClick={() => { setPanel('history'); setRightOpen(true); }}><History size={17} /></button><div className="more-wrap"><button className="icon-button" title="更多笔记操作" onClick={() => setMenu(!menu)}><MoreHorizontal size={19} /></button>{menu && <div className="dropdown"><button disabled={!active} onClick={() => { if (active) showNoteAction('rename', active); }}><PenLine size={14} />重命名 / 移动笔记</button><button disabled={!active || drawing} onClick={() => imageRef.current?.click()}><ImagePlus size={14} />插入图片</button><button disabled={!active || drawing} onClick={() => { showNew('embed'); setMenu(false); }}><Shapes size={14} />插入 Excalidraw</button><button disabled={!active} onClick={() => { writeClipboard({ text: content }).then(() => notify(drawing ? '已复制绘图数据' : '已复制 Markdown')).catch(() => notify('复制失败', true)); setMenu(false); }}><Copy size={14} />{drawing ? '复制绘图数据' : '复制 Markdown'}</button>{drawing && <button onClick={() => { try { const blob = new Blob([drawingJSON(content)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${active?.title || 'drawing'}.excalidraw`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setMenu(false); } catch (e) { notify((e as Error).message, true); } }}><ArrowDownToLine size={14} />导出 .excalidraw</button>}<button className="danger-text" disabled={!active} onClick={() => { if (active) showNoteAction('delete', active); }}><Trash2 size={14} />删除笔记</button></div>}</div></div>}</div>
   <div className={`document-space ${selectedCommit ? 'revision-view' : activeEditor ? 'repository-document' : mode}`} onPaste={e => { if (selectedCommit || activeEditor || drawing) return; const files = Array.from(e.clipboardData.files).filter(file => file.type.startsWith('image/')); if (files.length) { e.preventDefault(); void addImages(files); } }} onDragOver={e => { if (!selectedCommit && !activeEditor && !drawing) e.preventDefault(); }} onDrop={e => { if (selectedCommit || activeEditor || drawing) return; e.preventDefault(); if (e.dataTransfer.files.length) void addImages(e.dataTransfer.files); }}>
    {selectedCommit && active ? <article key={selectedCommit.hash} className="document revision-document" aria-label="历史版本（只读）" tabIndex={0}><div className="revision-meta"><GitCommitHorizontal size={15} /><strong title={selectedCommit.message}>{selectedCommit.message}</strong><code>{selectedCommit.hash.slice(0, 7)}</code><span>{selectedCommit.author} · {time(selectedCommit.date)}</span></div><div className="prose"><Suspense fallback={<DrawingLoading />}>{displayedDrawing ? <DrawingPreview content={revision} label={active.title} /> : <Markdown onNavigate={navigateNote} content={revision} assets={vault.manifest.assets} notes={vault.manifest.notes} />}</Suspense></div></article> : activeEditor ? activeEditor.kind === 'diff' ? <section className="diff-editor" aria-label="文件变更对比"><GitDiff diff={activeEditor.diff} staged={activeEditor.staged} /></section> : activeEditor.file.binary ? <div className="file-preview">{activeEditor.file.image ? <img src={activeEditor.file.image} alt={activeEditor.path} /> : <p>二进制文件，无法显示文本内容。</p>}</div> : <div className="source-editor file-editor"><div className="source-label"><span><Code2 size={13} />{activeEditor.path}</span><span>UTF-8</span></div><Suspense fallback={<span className="drawing-placeholder">正在加载编辑器…</span>}><SourceEditor key={activeEditor.key} filename={activeEditor.path} content={activeEditor.file.content} dark={dark} onChange={value => editFile(activeEditor, value)} onError={message => notify(message, true)} /></Suspense></div> : !active ? <div className="empty-workspace"><BookOpen size={40} strokeWidth={1} /><h2>未打开笔记</h2><button className="primary" onClick={() => showNew('note')}><Plus size={16} />新建笔记</button></div> : drawing ? <Suspense fallback={<DrawingLoading />}><DrawingEditor key={`${activeId}:${editorVersion}`} content={content} dark={dark} onChange={edit} /></Suspense> : <>
     {mode === 'split' && <article className="document" tabIndex={-1} onContextMenu={showDocumentMenu}><div className="document-meta"><span className="category-pill"><Folder size={12} />{active.category || '未分类'}</span><span><Clock3 size={12} />更新于 {time(active.updatedAt)}</span></div><div className="prose"><Markdown onNavigate={navigateNote} content={content} assets={vault.manifest.assets} notes={vault.manifest.notes} onOpen={openDrawing} /></div></article>}
     {mode === 'edit' && <div className="wysiwyg-editor"><Suspense fallback={<span className="drawing-placeholder">正在加载编辑器…</span>}><MarkdownEditor onNavigate={navigateNote} ref={editorRef} key={`${activeId}:${editorVersion}`} content={content} onChange={edit} media={editorMedia} onError={message => notify(message, true)} onInsertImage={() => imageRef.current?.click()} onInsertDrawing={() => showNew('embed')} /></Suspense></div>}
     {mode === 'split' && <div className="source-editor"><div className="source-label"><span><PenLine size={13} />MARKDOWN</span><span><button className="text-button" onClick={() => showNew('embed')}><Shapes size={14} />插入 Excalidraw</button><button className="text-button" onClick={() => imageRef.current?.click()}><ImagePlus size={14} />插入图片</button></span></div><Suspense fallback={<span className="drawing-placeholder">正在加载编辑器…</span>}><SourceEditor key={activeId} content={content} dark={dark} onChange={edit} onError={message => notify(message, true)} /></Suspense></div>}
    </>}
   </div><footer className="status-bar"><div><span className="saved-state">{saved ? <CheckCheck size={13} /> : <LoaderCircle className="spin" size={13} />}{saved ? '所有更改已保存' : '正在保存…'}</span>{!api.desktop && <span className="demo-label">浏览器演示</span>}</div><div>{activeEditor ? <span>{activeEditor.kind === 'diff' ? '文件变更对比' : activeEditor.path.split('/').pop()}</span> : displayedDrawing ? <span>{drawingCount} 个元素</span> : <><span>{counts.words.toLocaleString()} 字</span><span>{counts.chars.toLocaleString()} 字符</span></>}{!activeEditor && <span>{displayedDrawing ? 'Excalidraw' : 'Markdown'}</span>}<span>UTF-8</span><button title="Git 状态" onClick={() => { setPanel('git'); setRightOpen(true); }}><GitBranch size={12} />{status?.branch || 'main'}</button></div></footer>
  </main>
  {rightOpen && <aside className="inspector"><div className="inspector-tabs"><button className={panel === 'outline' ? 'active' : ''} onClick={() => setPanel('outline')}><LayoutList size={16} />大纲</button><button className={panel === 'history' ? 'active' : ''} onClick={() => setPanel('history')}><History size={16} />历史</button><button className={panel === 'git' ? 'active' : ''} onClick={() => setPanel('git')}><GitBranch size={16} />Git</button></div>
   {panel === 'outline' && <><div className="inspector-title">本篇目录<span>{headings.length}</span></div><nav className="outline">{headings.map((h, i) => <button key={i} className={`${i === 0 ? 'outline-first' : ''} level-${h.level}`} onClick={() => { if (!selectedCommit && mode === 'edit') { Array.from(document.querySelectorAll('.wysiwyg-content h1, .wysiwyg-content h2, .wysiwyg-content h3')).find(node => node.textContent === h.text)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } else { document.getElementById(headingId(h.text))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }}>{h.level === 1 ? <span className="outline-bullet" /> : <span className="outline-dash" />}<span>{h.text}</span></button>)}{!headings.length && <p className="muted">暂无大纲</p>}</nav><div className="note-info"><div className="inspector-title">笔记信息<FileText size={14} /></div><dl><dt>创建时间</dt><dd>{active ? time(active.createdAt) : '—'}</dd><dt>最后更新</dt><dd>{active ? time(active.updatedAt) : '—'}</dd><dt>存储位置</dt><dd className="mono">notes/</dd><dt>文件名称</dt><dd className="filename" title={active?.filename}>{active?.filename || '—'}</dd></dl></div></>}
   {panel === 'history' && <><div className="inspector-title history-title">版本历史<span>{history.length}</span></div><div className="history-note"><FileText size={14} /><span>{active?.title || '选择一篇笔记'}</span></div><div className="history-list">{history.map((c, i) => <button key={c.hash} className={`history-item ${selectedCommit?.hash === c.hash ? 'selected' : ''}`} aria-pressed={selectedCommit?.hash === c.hash} title={`${c.message}\n${c.author} · ${time(c.date)} · ${c.hash}`} disabled={busy} onClick={() => void openRevision(c)}><GitCommitHorizontal size={16} /><span className="history-details"><span className="history-heading"><strong>{c.message}</strong>{i === 0 && <span className="latest-badge">最新</span>}</span><span className="history-summary"><span>{time(c.date)}</span><code>{c.hash.slice(0, 7)}</code></span></span>{selectedCommit?.hash === c.hash && <span className="selected-dot" />}</button>)}{!history.length && <div className="panel-empty"><History size={30} /><p>还没有提交记录</p><button className="text-button" onClick={() => setPanel('git')}>前往 Git 面板<ArrowRight size={13} /></button></div>}</div></>}
   {panel === 'git' && <><div className="inspector-title">源代码管理<button className="icon-button" title="刷新 Git 状态" onClick={() => void run(refresh)}><History size={14} /></button></div><div className="git-branch-card"><div><GitBranch size={17} /><strong>{status?.branch}</strong><span className="branch-badge">当前分支</span></div><p>{status?.remote ? status.remote : '本地仓库 · 未配置远程'}</p><div className="sync-counts"><span><ArrowUp size={12} />{status?.ahead || 0} 待推送</span><span><ArrowDown size={12} />{status?.behind || 0} 待拉取</span></div></div><div className="git-actions"><button disabled={busy} onClick={() => void run(async () => { await api.pull(); const v = await api.current(); setVault(v); if (v?.manifest.notes.some(n => n.id === activeId)) await select(activeId); else if (v?.manifest.notes[0]) await select(v.manifest.notes[0].id); else clearDocument(); }, '已拉取远程更新')}><ArrowDownToLine size={15} />拉取</button><button disabled={busy} onClick={() => void run(() => api.push(), '已推送到远程仓库')}><Upload size={15} />推送</button></div><GitChanges status={status} notes={vault.manifest.notes} busy={busy} onDiff={(change, staged) => void openDiff(change, staged)} onStage={change => void run(() => api.stage(change.path), '已暂存文件变更')} onUnstage={change => void run(() => api.unstage(change.path), '已取消暂存')} onDiscard={change => { setDiscardChange(change); setModal('discard'); }} onOpen={change => void openChangedFile(change)} /><div className="lfs-indicator"><span className={status?.lfs ? 'green-dot' : 'amber-dot'} />Git LFS {status?.lfs ? '已启用' : '未安装'}<span>images/</span></div><div className="commit-box"><textarea placeholder="这次记录了什么？" value={commitMessage} onChange={e => setCommitMessage(e.target.value)} /><button className="primary" disabled={busy || !commitMessage.trim() || !status?.changes.length} onClick={() => void run(async () => { await api.commit(commitMessage, stagedCount > 0); setCommitMessage(defaultCommitMessage()); }, '已创建 Git 提交')}><GitCommitHorizontal size={17} />{busy ? '正在处理…' : stagedCount ? `提交已暂存变更 (${stagedCount})` : '提交所有笔记变更'}</button></div></>}
  </aside>}
  <ContextMenu menu={contextMenu.menu} onClose={contextMenu.close} onError={message => notify(message, true)} />
  <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" multiple hidden onChange={e => { if (e.target.files) void addImages(e.target.files); e.target.value = ''; }} />
  {notice && <div className={`toast ${notice.error ? 'error' : ''}`}>{notice.error ? <Circle size={16} /> : <CheckCheck size={17} />}<span>{notice.message}</span><button onClick={() => setNotice(null)}><X size={14} /></button></div>}
  {modal && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setModal(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><span className="modal-icon">{modal === 'settings' ? <Settings2 size={20} /> : modal === 'folder' ? <FolderPlus size={20} /> : <FilePlus2 size={20} />}</span><h2 id="modal-title">{{ drawing: '新建 Excalidraw 绘图', embed: '插入 Excalidraw', note: '新建笔记', folder: '新建分类', rename: '重命名 / 移动笔记', delete: '删除这篇笔记？', settings: '笔记库设置', discard: '撤销这个文件的变更？' }[modal]}</h2></div><button className="icon-button" disabled={busy} onClick={() => setModal(null)}><X size={18} /></button></div>
   <div className="modal-body">{modal === 'discard' && discardChange && <p className="delete-description">将「{discardChange.path}」恢复到上次提交，并取消该文件的暂存。新增文件会被删除，未提交的修改无法恢复。</p>}{['note', 'folder', 'rename', 'drawing'].includes(modal) && <><label>{modal === 'folder' ? '分类名称' : modal === 'drawing' ? '绘图标题' : '笔记标题'}<input autoFocus value={field} placeholder={modal === 'folder' ? '例如：项目/Fever' : modal === 'drawing' ? '绘图标题' : '笔记标题'} onChange={e => setField(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && field.trim()) void submitModal(); }} maxLength={200} /></label>{modal !== 'folder' && <label>所属分类<input list="category-options" value={category} onChange={e => setCategory(e.target.value)} placeholder="收件箱" maxLength={200} /><datalist id="category-options">{vault.manifest.categories.map(c => <option key={c}>{c}</option>)}</datalist></label>}</>}
    {modal === 'embed' && <><label>选择绘图<select value={embedId} onChange={e => setEmbedId(e.target.value)}><option value="">新建绘图并插入</option>{drawings.map(note => <option key={note.id} value={note.id}>{note.category ? `${note.category} / ` : ''}{note.title}</option>)}</select></label>{!embedId && <><label>绘图标题<input autoFocus value={field} onChange={e => setField(e.target.value)} maxLength={200} placeholder="给绘图起个名字" /></label><label>所属分类<input value={category} onChange={e => setCategory(e.target.value)} maxLength={200} /></label></>}</>}
    {modal === 'delete' && <p className="delete-description">{vault.format === 'fsnotes' ? `「${modalNote?.title}」将移至 FSNotes 废纸篓，正文与图片会保留。` : `「${modalNote?.title}」将从当前工作区移除。已提交的内容仍保留在 Git 历史中。`}</p>}
    {modal === 'settings' && <><div className="settings-vault"><FolderOpen size={17} /><div><strong>{vault.name}</strong><span>{vault.path}</span></div><button className="text-button" onClick={() => { setModal(null); void openVault(); }}>切换</button></div>{!api.desktop && <div className="demo-info">当前是浏览器演示，数据保存在此浏览器中。真实文件、Git、LFS 和定时备份请在桌面应用中使用。</div>}<div className="form-section-title">外观</div><div className="form-columns"><label>颜色模式<select value={themeMode} onChange={e => setThemeMode(e.target.value as ThemeMode)}><option value="system">跟随系统</option><option value="light">亮色模式</option><option value="dark">暗色模式</option></select></label><label>字体大小<select value={fontSize} onChange={e => setFontSize(Number(e.target.value))}>{fontSizes.map(size => <option key={size} value={size}>{size} px{size === 16 ? '（默认）' : ''}</option>)}</select></label></div><p className="form-hint">外观调整立即生效，并在此设备上记住。字体大小同时调整正文、源码和界面文字；跟随系统会自动切换亮色与暗色。</p><div className="font-preview" aria-label="字体预览">让每一个想法，都有迹可循。<span>Fever · Markdown 0123456789</span></div><div className="form-section-title">GIT 提交身份</div><div className="form-columns"><label>用户名<input value={settings.author} onChange={e => setSettings({ ...settings, author: e.target.value })} placeholder="你的名字" /></label><label>邮箱<input type="email" value={settings.email} onChange={e => setSettings({ ...settings, email: e.target.value })} placeholder="you@example.com" /></label></div><label>远程仓库（origin）<input value={settings.remote} onChange={e => setSettings({ ...settings, remote: e.target.value })} placeholder="git@github.com:you/notes.git" /></label><p className="form-hint">使用系统 Git 的 SSH 密钥或凭据管理器进行认证。</p><div className="setting-toggle"><div><strong>定时自动备份</strong><small>自动创建本地 Git 提交，推送由你手动操作。</small></div><button className={`switch ${settings.autoCommit ? 'on' : ''}`} role="switch" aria-checked={settings.autoCommit} aria-label="定时自动备份" disabled={!api.desktop} onClick={() => setSettings({ ...settings, autoCommit: !settings.autoCommit })}><span /></button></div>{settings.autoCommit && <label>备份间隔（分钟）<input type="number" min={1} max={1440} value={settings.interval} onChange={e => setSettings({ ...settings, interval: Number(e.target.value) })} /></label>}<div className="settings-lfs"><Check size={15} />笔记目录 <code>notes/</code> · 图片目录 <code>images/</code> · Git LFS {status?.lfs ? '已启用' : '待安装'}</div></>}
   </div><div className="modal-footer">{modal === 'discard' ? <><button className="secondary" disabled={busy} onClick={() => setModal(null)}>取消</button><button className="danger" disabled={busy} onClick={() => void discardFile()}>撤销变更</button></> : <><button className="secondary" disabled={busy} onClick={() => setModal(null)}>取消</button><button className={modal === 'delete' ? 'danger' : 'primary'} disabled={busy || (['note', 'folder', 'rename', 'drawing'].includes(modal) && !field.trim()) || (modal === 'embed' && !embedId && !field.trim())} onClick={() => void submitModal()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{modal === 'settings' ? '保存设置' : modal === 'delete' ? '删除笔记' : modal === 'folder' ? '创建分类' : modal === 'rename' ? '保存更改' : modal === 'drawing' ? '创建绘图' : modal === 'embed' ? '插入绘图' : '创建笔记'}</button></>}</div>
  </section></div>}
 </div>;
}
