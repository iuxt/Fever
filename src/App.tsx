import { notePath } from './notePaths.ts';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { ArrowDown, ArrowDownToLine, ArrowRight, ArrowUp, BookOpen, Check, CheckCheck, ChevronRight, Circle, Clock3, Code2, Copy, FilePlus2, FileText, Flame, Folder, FolderOpen, FolderPlus, GitBranch, GitCommitHorizontal, History, ImagePlus, Eye, LayoutList, LoaderCircle, MoreHorizontal, PanelLeftClose, PanelRightClose, PenLine, Shapes, Plus, Minus, RefreshCw, Search, Settings2, Trash2, Upload, X } from 'lucide-react';
import GitChanges, { GitDiff } from './GitChanges';
import RevisionDiff from './RevisionDiff';
import EditorWidthButton from './EditorWidth';
import SettingsPanel from './SettingsPanel';
import TrashBrowser from './TrashBrowser';
import CategoryPicker from './CategoryPicker';
import NoteList from './NoteList';
import NoteSort, { sortNotes, useNoteSort } from './NoteSort';
import NoteTree, { type NoteTreeTarget } from './NoteTree';
import ContextMenu, { useContextMenu, type MenuItem } from './ContextMenu';
import { writeClipboard } from './clipboard';
import { modifier } from './ContextMenu';
import { useAppearance } from './appearance';
const MarkdownEditor = lazy(() => import('./MarkdownEditor'));
const SourceEditor = lazy(() => import('./SourceEditor'));
import type { MarkdownEditorHandle } from './MarkdownEditor';
import Markdown, { DrawingReference } from './Markdown';
import { resolveAsset } from './legacyImages';
import { exportNote, exportFormatLabel } from './noteExport';
import ExportDialog from './ExportDialog';
import type { ExportOptions } from './types';
import { resolveNoteLink } from './noteLinks';
import { externalImageUrls, replaceExternalImages } from './externalImages';
import { demo } from './demo';
import { drawingJSON, isDrawingNote, isLegacyDrawing, resolveDrawing } from './drawings';
const DrawingEditor = lazy(() => import('./Drawing'));
const DrawingPreview = lazy(() => import('./Drawing').then(module => ({ default: module.DrawingPreview })));
const DrawingLoading = () => <span className="drawing-placeholder">正在加载绘图…</span>;
import type { Change, Commit, FileDiff, GitStatus, Note, RevisionComparison, Settings, Vault, VaultFile } from './types';

const api = window.fever || demo;
type Modal = 'export' | 'drawing' | 'embed' | 'note' | 'folder' | 'rename' | 'delete' | 'deleteFolder' | 'settings' | 'discard' | 'discardAll' | null;
type EditorTab = { key: string; path: string } & ({ kind: 'diff'; diff: FileDiff; staged: boolean } | { kind: 'file'; file: VaultFile });
const time = (date: string) => new Date(date).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const sameStatus = (a: GitStatus | null, b: GitStatus) => Boolean(a && a.branch === b.branch && a.head === b.head && a.ahead === b.ahead && a.behind === b.behind && a.remote === b.remote && a.lfs === b.lfs && a.changes.length === b.changes.length && a.changes.every((change, index) => {
 const other = b.changes[index];
 return change.path === other.path && change.originalPath === other.originalPath && change.status === other.status && change.staged === other.staged && change.unstaged === other.unstaged;
}));
const defaultCommitMessage = () => {
 const date = new Date();
 return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const headingId = (text: string) => `heading-${text.replace(/[^\p{L}\p{N}]/gu, '-')}`;
const lastOpenedNoteKey = (path: string) => `fever-last-opened-note:${path}`;
const lastOpenedNote = (vault: Vault) => {
 try {
  const id = localStorage.getItem(lastOpenedNoteKey(vault.path));
  if (id && vault.manifest.notes.some(note => note.id === id)) return id;
 } catch { /* Keep the workspace empty when storage is unavailable. */ }
 return undefined;
};
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


export default function App() {
 const [vault, setVault] = useState<Vault | null>(null), [loading, setLoading] = useState(true);
 const [activeId, setActiveId] = useState(''), [tabs, setTabs] = useState<string[]>([]), [content, setContent] = useState('');
 const [mode, setMode] = useState<'edit' | 'split'>('edit');
 const [articleFindRequest, setArticleFindRequest] = useState<string | null>(null);
 const [panel, setPanel] = useState<'outline' | 'history' | 'git'>('outline');
 const [rightOpen, setRightOpen] = useState(false), [leftOpen, setLeftOpen] = useState(true);
 const [trashView, setTrashView] = useState(false);
 const [query, setQuery] = useState(''), [textMatches, setTextMatches] = useState<string[]>([]);
 const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
 const [noteSort, setNoteSort] = useNoteSort();
 const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
 const [status, setStatus] = useState<GitStatus | null>(null), [history, setHistory] = useState<Commit[]>([]);
 const [modal, setModal] = useState<Modal>(null), [field, setField] = useState(''), [category, setCategory] = useState('');
 const [modalNoteId, setModalNoteId] = useState<string | null>(null);
 const contextMenu = useContextMenu();
 const [settings, setSettings] = useState<Settings>({ autoCommit: false, interval: 10, autoPull: false, pullInterval: 10, author: '', email: '', remote: '' });
 const loadSettings = useCallback(async () => { setSettings(await api.settings()); }, []);
 const [embedId, setEmbedId] = useState(''), [editorVersion, setEditorVersion] = useState(0);
 const [revisionComparison, setRevisionComparison] = useState<RevisionComparison | null>(null), [selectedCommit, setSelectedCommit] = useState<Commit | null>(null);
 const [revisionMode, setRevisionMode] = useState<'diff' | 'preview'>('diff');
 const revision = revisionComparison?.content ?? '';
 const [editorTabs, setEditorTabs] = useState<EditorTab[]>([]), [activeEditorKey, setActiveEditorKey] = useState<string | null>(null);
 const activeEditor = editorTabs.find(tab => tab.key === activeEditorKey);
 const [discardChange, setDiscardChange] = useState<Change | null>(null);
 const stagedCount = status?.changes.filter(change => change.staged).length || 0;
 const [commitMessage, setCommitMessage] = useState(defaultCommitMessage), [busy, setBusy] = useState(false), [saved, setSaved] = useState(true);
 const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null), [menu, setMenu] = useState(false);
 const { dark, themeMode, fontSize, editorWidth, editorFullWidth, setThemeMode, setFontSize, setEditorWidth, setEditorFullWidth } = useAppearance();
 const pending = useRef(new Map<string, string>()), saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null), readToken = useRef(0);
 const editVersion = useRef(0);
 const saving = useRef<Promise<void> | null>(null);
 const statusToken = useRef(0);
 const importingImages = useRef(false);
 const workspaceLock = useRef(false);
 const closingTab = useRef(false);
 const [workspaceLocked, setWorkspaceLocked] = useState(false);
 const [searchVersion, setSearchVersion] = useState(0);
 const editorWidthProps = { width: editorWidth, fullWidth: editorFullWidth, onWidthChange: setEditorWidth, onFullWidthChange: setEditorFullWidth };
 const currentDocument = useRef({ id: activeId, content });
 currentDocument.current = { id: activeId, content };
 const editorRef = useRef<MarkdownEditorHandle | null>(null);
 const moreMenuRef = useRef<HTMLDivElement>(null);
 const articleFindKey = activeEditor?.key ?? `${activeId}:${mode}:${editorVersion}`;
 const articleFind = { requested: articleFindRequest === articleFindKey, onHandled: () => setArticleFindRequest(null) };
 const searchRef = useRef<HTMLInputElement>(null), imageRef = useRef<HTMLInputElement>(null);
 const vaultRef = useRef(vault);
 vaultRef.current = vault;
 const allNotes = useMemo(() => [...(vault?.manifest.notes || []), ...(vault?.manifest.trash || [])], [vault?.manifest.notes, vault?.manifest.trash]);
 const active = allNotes.find(n => n.id === activeId);
 const trashed = Boolean(active && vault?.manifest.trash?.some(note => note.id === activeId));
 const modalNote = vault?.manifest.notes.find(n => n.id === (modalNoteId ?? activeId));
 const drawing = Boolean(active && (isDrawingNote(active) || isLegacyDrawing(content)));
 const displayedContent = selectedCommit ? revision : content;
 const displayedDrawing = selectedCommit ? Boolean(active && (isDrawingNote(active) || isLegacyDrawing(revision))) : drawing;
 const drawings = vault?.manifest.notes.filter(isDrawingNote) || [];
 const notify = useCallback((message: string, error = false) => setNotice({ message, error }), []);
 const refreshStatus = useCallback(async () => {
  const path = vaultRef.current?.path, token = ++statusToken.current;
  const next = await api.status();
  if (token === statusToken.current && vaultRef.current?.path === path) setStatus(previous => sameStatus(previous, next) ? previous : next);
 }, []);
 const refresh = useCallback(async () => {
  const v = await api.current(); vaultRef.current = v; setVault(v); if (v) await refreshStatus(); else setStatus(null);
 }, [refreshStatus]);
 const flush = useCallback((): Promise<void> => {
  if (saveTimer.current) clearTimeout(saveTimer.current);
  if (saving.current) return saving.current;
  // Share one drain across autosave, navigation and manual save. New edits made
  // while a write is in flight must reach disk before any caller continues.
  const task = (async () => {
   while (pending.current.size) {
    const [id, value] = pending.current.entries().next().value!;
    if (id.startsWith('file:')) {
     await api.saveFile(id.slice(5), value);
     // Repository files can include the manifest, so their saves may change the tree.
     setVault(await api.current());
    } else {
     const result = await api.save(id, value);
     if (result) setVault(previous => previous ? { ...previous, manifest: { ...previous.manifest, notes: previous.manifest.notes.map(note => note.id === id ? { ...note, updatedAt: result.updatedAt } : note) } } : previous);
    }
    setSearchVersion(version => version + 1);
    if (pending.current.get(id) === value) pending.current.delete(id);
   }
   setSaved(true);
  })();
  saving.current = task.finally(() => { saving.current = null; });
  return saving.current;
 }, []);
 const select = useCallback(async (id: string, preserveEditor = false) => {
  const token = ++readToken.current, version = editVersion.current;
  setSelectedCommit(null); setRevisionComparison(null);
  try {
   await flush();
   const inTrash = Boolean(vaultRef.current?.manifest.trash?.some(note => note.id === id));
   const value = await api.read(id, inTrash ? 'trash' : undefined);
   if (token !== readToken.current) return;
   // An autosave may already have cleared pending while this older read was in
   // flight. Preserve both the current text and undo history in that case.
   const editedDuringRead = version !== editVersion.current && currentDocument.current.id === id;
   const latest = pending.current.get(id) ?? (editedDuringRead ? currentDocument.current.content : value);
   if (!preserveEditor) { setActiveEditorKey(null); setTrashView(inTrash); }
   if (!inTrash) {
    const note = vaultRef.current?.manifest.notes.find(note => note.id === id);
    if (note) {
     setSelectedFolder(previous => previous === null || note.category === previous || note.category.startsWith(`${previous}/`) ? previous : note.category);
     setCollapsed(previous => { const next = new Set(previous), parts = note.category.split('/'); for (let i = 1; i < parts.length; i++) next.delete(parts.slice(0, i).join('/')); return next; });
    }
   }
   setActiveId(id); setContent(latest);
   if (!editedDuringRead) setEditorVersion(version => version + 1);
   setTabs(t => t.includes(id) ? t : [...t, id]); setSaved(pending.current.size === 0); setMenu(false);
  }
  catch (e) { notify(String((e as Error).message), true); }
 }, [flush, notify]);
 const clearDocument = useCallback(() => {
  // Cancel old reads before starting the next selection, never in a later effect.
  ++readToken.current;
  setActiveId(''); setContent(''); setSelectedCommit(null); setRevisionComparison(null);
 }, []);
 const navigateNote = useCallback((href: string) => {
  const note = resolveNoteLink(href, allNotes);
  if (!note) return false;
  void select(note.id);
  return true;
 }, [allNotes, select]);
 const openDrawing = useCallback((id: string) => { void select(id); setMode('edit'); }, [select]);
 const editorMedia = useMemo(() => ({
  image: (src: string, alt: string, width?: number) => /\.excalidraw(?:\.md)?$/i.test(src) || resolveDrawing(src, vault?.manifest.notes || []) ? <DrawingReference source={src} notes={vault?.manifest.notes || []} onOpen={openDrawing} /> : <img src={api.asset(resolveAsset(src, vault?.manifest.assets)) || undefined} alt={alt || '笔记图片'} style={width ? { width, height: 'auto' } : undefined} draggable={false} loading="lazy" decoding="async" />,
  drawing: (value: string) => <Suspense fallback={<DrawingLoading />}><DrawingPreview content={value} /></Suspense>,
 }), [vault?.manifest.notes, vault?.manifest.assets, openDrawing]);
 const toggleFolder = useCallback((path: string) => setCollapsed(prev => { const next = new Set(prev); next.has(path) ? next.delete(path) : next.add(path); return next; }), []);
 useEffect(() => { let mounted = true; api.current().then(async v => { if (!mounted) return; vaultRef.current = v; setVault(v); if (v) { setCollapsed(collapsedFolders(v)); const id = lastOpenedNote(v); if (id) await select(id); await refreshStatus(); await loadSettings(); } }).catch(e => notify(e.message, true)).finally(() => setLoading(false)); return () => { mounted = false; }; }, [select, notify, refreshStatus, loadSettings]);
 useEffect(() => {
  if (!vault || !vault.manifest.notes.some(note => note.id === activeId)) return;
  try { localStorage.setItem(lastOpenedNoteKey(vault.path), activeId); }
  catch { /* Keep navigation working when storage is unavailable. */ }
 }, [vault, activeId]);
 useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(timer); }, [notice]);
 useEffect(() => {
  if (!menu) return;
  const outside = (event: PointerEvent) => { if (!moreMenuRef.current?.contains(event.target as Node)) setMenu(false); };
  document.addEventListener('pointerdown', outside, true);
  return () => document.removeEventListener('pointerdown', outside, true);
 }, [menu]);
 useEffect(() => { if (!modal) setModalNoteId(null); }, [modal]);
 useEffect(() => {
  if (!modal) return;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
  const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') || []).filter(element => element.tabIndex >= 0 && element.getClientRects().length);
  const firstField = dialog?.querySelector<HTMLElement>('.modal-body input, .modal-body select, .modal-body textarea');
  (dialog?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') || firstField || focusable()[0])?.focus();
  const trapFocus = (event: KeyboardEvent) => {
   if (event.key !== 'Tab') return;
   const elements = focusable(), first = elements[0], last = elements.at(-1);
   if (!first || !last) return;
   if (!dialog?.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
    event.preventDefault(); (event.shiftKey ? last : first).focus();
   }
  };
  window.addEventListener('keydown', trapFocus);
  return () => { window.removeEventListener('keydown', trapFocus); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
 }, [modal]);
 useEffect(() => { setHistory([]); }, [activeId]);
 useEffect(() => { if (modal !== 'discard') setDiscardChange(null); }, [modal]);
 useEffect(() => api.onBackupError?.(message => notify(`自动备份失败：${message}`, true)), [notify]);
 useEffect(() => {
  if (!vault) return;
  let cancelled = false, inFlight = false, timer: ReturnType<typeof setTimeout>;
  const schedule = () => { clearTimeout(timer); if (!cancelled) timer = setTimeout(tick, document.hidden ? 60000 : 15000); };
  const tick = async () => {
   if (cancelled || inFlight) return;
   inFlight = true;
   try { await refreshStatus(); } catch { /* Retry after the next interval. */ }
   finally { inFlight = false; schedule(); }
  };
  const visibility = () => { if (!document.hidden) { clearTimeout(timer); void tick(); } else schedule(); };
  schedule(); document.addEventListener('visibilitychange', visibility);
  return () => { cancelled = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
 }, [vault?.path, refreshStatus]);
 useEffect(() => { if (!rightOpen || panel !== 'history' || !activeId) return; let cancelled = false; api.history(activeId).then(h => { if (!cancelled) setHistory(h); }).catch(e => { if (!cancelled) notify(e.message, true); }); return () => { cancelled = true; }; }, [rightOpen, panel, activeId, status?.head, vault?.path, notify]);
 useEffect(() => { setTextMatches([]); }, [query, vault?.path, trashView]);
 useEffect(() => {
  if (!query.trim() || !vault) { void api.cancelSearch().catch(() => {}); return; }
  let cancelled = false;
  const timer = setTimeout(() => { api.search(query, trashView ? 'trash' : undefined).then(result => { if (!cancelled) setTextMatches(previous => previous.length === result.length && previous.every((id, index) => id === result[index]) ? previous : result); }).catch(e => { if (!cancelled) notify(e.message, true); }); }, 250);
  return () => { cancelled = true; clearTimeout(timer); void api.cancelSearch().catch(() => {}); };
 }, [query, vault, searchVersion, trashView, notify]);
 const openSettings = useCallback(() => {
  if (!vault || loading || workspaceLock.current || modal) return;
  loadSettings().catch(e => notify(e.message, true)); setModal('settings');
 }, [vault, loading, modal, loadSettings, notify]);
 useEffect(() => {
  const keydown = (e: KeyboardEvent) => {
   if (e.isComposing || e.defaultPrevented) return;
   if (workspaceLock.current) { e.preventDefault(); return; }
   if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
    const key = e.key.toLowerCase();
    if (!['k', 'n', 's', 'e', ','].includes(key)) return;
    e.preventDefault(); e.stopPropagation();
    if (modal || loading || !vault) return;
    if (key === ',') openSettings();
    if (key === 'k') { setLeftOpen(true); setTimeout(() => searchRef.current?.focus(), 0); }
    if (key === 'n') { setField(''); setCategory(selectedFolder ?? active?.category ?? vault.manifest.categories[0] ?? '收件箱'); setModal('note'); }
    if (key === 's') flush().then(refreshStatus).then(() => notify('笔记已保存')).catch(err => notify(err.message, true));
    if (key === 'e' && !trashed && !activeEditorKey && !selectedCommit) setMode(m => drawing || m === 'split' ? 'edit' : 'split');
   }
   if (e.key === 'Escape' && document.querySelector('.find-widget') && !modal) return;
   if (e.key === 'Escape' && (e.target as HTMLElement).closest('[data-select-open="true"]')) return;
   if (e.key === 'Escape' && !busy) { setModal(null); setMenu(false); setQuery(''); }
  };
  // Handle application commands before editor keymaps (which also bind Mod-E).
  window.addEventListener('keydown', keydown, true); return () => window.removeEventListener('keydown', keydown, true);
 }, [active, selectedFolder, vault, flush, refreshStatus, notify, activeEditorKey, drawing, selectedCommit, trashed, modal, loading, busy, openSettings]);
 useEffect(() => {
  const unload = (e: BeforeUnloadEvent) => { if (pending.current.size || workspaceLock.current || importingImages.current) { e.preventDefault(); e.returnValue = ''; void flush(); } };
  window.addEventListener('beforeunload', unload); return () => window.removeEventListener('beforeunload', unload);
 }, [flush]);
 const stageAll = () => void run(() => api.stageAll(), '已暂存全部变更');
 const unstageAll = () => void run(() => api.unstageAll(), '已取消全部暂存');
 async function runLocked(fn: () => Promise<void>, success?: string, refreshAfter = true) {
  if (workspaceLock.current || busy) return;
  workspaceLock.current = true; setWorkspaceLocked(true); contextMenu.close();
  try { await run(fn, success, refreshAfter); }
  finally { workspaceLock.current = false; setWorkspaceLocked(false); }
 }
 async function run(fn: () => Promise<void>, success?: string, refreshAfter = true) { setBusy(true); try { await flush(); await fn(); if (refreshAfter) await refresh(); if (success) notify(success); } catch (e) { notify((e as Error).message, true); } finally { setBusy(false); } }
 async function pull(automatic = false) {
  if (automatic && (!vault || loading || busy || modal || workspaceLock.current || importingImages.current || pending.current.size || saving.current)) return;
  await runLocked(async () => {
   try {
    const before = automatic ? await api.status() : null;
    if (before && (!before.remote || before.changes.length || before.branch === 'HEAD')) return;
    await api.pull();
    if (before?.head && (await api.status()).head === before.head) return;
    const v = await api.current(); vaultRef.current = v; setVault(v);
    setSearchVersion(version => version + 1);
    setEditorTabs([]); setActiveEditorKey(null);
    setTabs(previous => previous.filter(id => v?.manifest.notes.some(note => note.id === id) || v?.manifest.trash?.some(note => note.id === id)));
    if (v?.manifest.notes.some(note => note.id === activeId) || v?.manifest.trash?.some(note => note.id === activeId)) await select(activeId);
    else if ((!automatic || activeId) && v?.manifest.notes[0]) await select(v.manifest.notes[0].id);
    else clearDocument();
    notify(automatic ? '已自动拉取远程更新' : '已拉取远程更新');
   } catch (e) { throw new Error(`${automatic ? '自动拉取失败：' : ''}${(e as Error).message}`); }
  });
 }
 const autoPullRef = useRef(() => {});
 autoPullRef.current = () => { void pull(true); };
 useEffect(() => api.onAutoPull?.(() => autoPullRef.current()), []);
 function showEditorTab(tab: EditorTab, token?: number) {
  if (token !== undefined && token !== readToken.current) return;
  ++readToken.current;
  setSelectedCommit(null); setRevisionComparison(null);
  setEditorTabs(previous => previous.some(item => item.key === tab.key) ? previous.map(item => item.key === tab.key ? tab : item) : [...previous, tab]);
  setActiveEditorKey(tab.key); setMenu(false);
 }
 function leaveRevision() {
  ++readToken.current; setSelectedCommit(null); setRevisionComparison(null);
 }
 async function openRevision(commit: Commit) {
  if (!activeId) return;
  const id = activeId, token = ++readToken.current;
  try {
   await flush();
   const comparison = await api.revisionComparison(id, commit.hash);
   if (token !== readToken.current) return;
   setActiveEditorKey(null); setRevisionComparison(comparison); setRevisionMode('diff'); setSelectedCommit(commit); setMenu(false); contextMenu.close();
  } catch (e) { if (token === readToken.current) notify((e as Error).message, true); }
 }
 async function restoreRevision() {
  if (!active || trashed || !selectedCommit) return;
  const id = active.id, hash = selectedCommit.hash;
  await run(async () => {
   await api.restore(id, hash);
   await select(id); setMode('edit');
  }, '已恢复到当前工作区，可提交为新的版本');
 }
 async function openDiff(change: Change, staged: boolean) {
  const token = ++readToken.current;
  await run(async () => { const diff = await api.diff(change.path, staged); showEditorTab({ key: `diff:${staged}:${change.path}`, path: change.path, kind: 'diff', diff, staged }, token); });
 }
 async function openChangedFile(change: Change) {
  const token = ++readToken.current;
  await run(async () => {
   if (token !== readToken.current) return;
   const note = allNotes.find(n => notePath(n) === change.path);
   if (note) { await select(note.id); setMode('edit'); }
   else { const file = await api.openFile(change.path); showEditorTab({ key: `file:${change.path}`, path: change.path, kind: 'file', file }, token); }
  });
 }
 async function activateEditor(tab: EditorTab) {
  const token = ++readToken.current;
  await run(async () => { if (tab.kind === 'file') showEditorTab({ ...tab, file: await api.openFile(tab.path) }, token); else showEditorTab(tab, token); });
 }
 async function closeNoteTab(id: string) {
  const remaining = tabs.filter(tab => tab !== id); setTabs(remaining);
  if (id === activeId && !activeEditorKey) {
   if (remaining.length) await select(remaining.at(-1)!);
   else {
    clearDocument();
    if (editorTabs.length) setActiveEditorKey(editorTabs.at(-1)!.key);
   }
  }
 }
 async function closeNote(id: string) {
  await closeTab(() => closeNoteTab(id));
 }
 async function closeTab(fn: () => Promise<void>) {
  if (workspaceLock.current || closingTab.current) return;
  closingTab.current = true;
  // Closing tabs only needs saved content, not a repository refresh or Git's busy state.
  try { await flush(); await fn(); }
  catch (e) { notify((e as Error).message, true); }
  finally { closingTab.current = false; }
 }
 async function closeEditor(tab: EditorTab) {
  await closeTab(async () => {
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
   if (workspaceLock.current || modal || loading) return;
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
  saveTimer.current = setTimeout(() => { flush().then(refreshStatus).catch(e => notify(e.message, true)); }, 650);
 }
 async function discardFile(all = false) {
  if (!all && !discardChange) return;
  await runLocked(async () => {
   const changes = all ? (status?.changes || []).filter(change => change.unstaged) : [discardChange!];
   const paths = new Set(changes.flatMap(change => [change.path, ...(change.originalPath ? [change.originalPath] : [])]));
   try {
    if (all) for (const path of await api.discardAll()) paths.add(path);
    else await api.discard(discardChange!.path);
   } finally {
    // Refresh even if one file fails after earlier files have been restored.
    const v = await api.current(); vaultRef.current = v; setVault(v);
    setTabs(previous => previous.filter(id => v?.manifest.notes.some(note => note.id === id)));
    const next = v?.manifest.notes.find(note => note.id === activeId) || v?.manifest.notes[0];
    if (next) await select(next.id, true); else clearDocument();
    if (activeEditor?.kind === 'file') {
     try { showEditorTab({ ...activeEditor, file: await api.openFile(activeEditor.path) }); }
     catch { setEditorTabs(previous => previous.filter(tab => tab.key !== activeEditor.key)); setActiveEditorKey(null); }
    } else if (activeEditor?.kind === 'diff' && paths.has(activeEditor.path)) {
     setActiveEditorKey(null);
    }
    setEditorTabs(previous => previous.filter(tab => !paths.has(tab.path) || (tab.kind === 'file' && tab.key === activeEditor?.key)));
    await refreshStatus();
   }
   setModal(null); setDiscardChange(null);
  }, all ? '已还原全部工作区变更' : '已撤销文件变更', false);
 }
 async function restoreTrashedNote(note: Note) {
  await run(async () => {
   await api.restoreTrash(note.id);
   await refresh();
   setCollapsed(previous => {
    const next = new Set(previous), parts = note.category.split('/');
    for (let i = 1; i <= parts.length; i++) next.delete(parts.slice(0, i).join('/'));
    return next;
   });
   setQuery(''); setModal(null); await select(note.id); setMode('edit');
  }, '笔记已从回收站恢复');
 }
 async function openVault() { await runLocked(async () => { const v = await api.open(); if (!v) return; vaultRef.current = v; setVault(v); setTrashView(false); setQuery(''); setSelectedFolder(null); setCollapsed(collapsedFolders(v)); setTabs([]); setEditorTabs([]); setActiveEditorKey(null); clearDocument(); const id = lastOpenedNote(v); if (id) await select(id); await loadSettings(); }); }
 const edit = useCallback((value: string) => { if (trashed) return; ++editVersion.current; currentDocument.current = { id: activeId, content: value }; setContent(value); pending.current.set(activeId, value); setSaved(false); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => { flush().then(refreshStatus).catch(e => notify(e.message, true)); }, 650); }, [activeId, trashed, flush, refreshStatus, notify]);
 function showNew(kind: 'note' | 'folder' | 'drawing' | 'embed', path = selectedFolder ?? active?.category ?? vault?.manifest.categories[0] ?? '收件箱') { setField(''); setCategory(kind === 'drawing' || kind === 'embed' ? 'Excalidraw' : path); if (kind === 'embed') setEmbedId(drawings[0]?.id || ''); setModal(kind); }
 const showNoteAction = useCallback((kind: 'rename' | 'delete', note: Note) => {
  setModalNoteId(note.id); setField(note.title); setCategory(note.category); setModal(kind); setMenu(false);
 }, []);
 const showTreeMenu = useCallback((event: MouseEvent<HTMLElement>, target: NoteTreeTarget) => {
  event.preventDefault(); event.stopPropagation(); setMenu(false);
  const path = target.kind === 'note' ? target.note.category : target.kind === 'folder' ? target.path : selectedFolder ?? '';
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
  if (target.kind === 'folder') items.push(
   { label: collapsed.has(path) ? '展开分类' : '折叠分类', icon: <Folder size={14} />, action: () => toggleFolder(path) },
   { separator: true },
   { label: '删除文件夹', icon: <Trash2 size={14} />, danger: true, disabled: busy, action: () => { setCategory(path); setModal('deleteFolder'); } },
  );
  if (target.kind === 'note') items.push({ separator: true }, { label: '删除笔记', icon: <Trash2 size={14} />, danger: true, disabled: busy, action: () => showNoteAction('delete', target.note) });
  const bounds = event.currentTarget.getBoundingClientRect();
  contextMenu.open({ x: event.clientX || bounds.left, y: event.clientY || bounds.bottom, label: '笔记列表菜单', items, returnFocus: event.currentTarget });
 }, [busy, collapsed, selectedFolder, contextMenu.open, notify, select, showNoteAction, toggleFolder]);
 function showTrashMenu(event: MouseEvent<HTMLElement>, note: Note) {
  event.preventDefault(); event.stopPropagation(); setMenu(false);
  contextMenu.open({ x: event.clientX, y: event.clientY, label: '回收站笔记菜单', returnFocus: event.currentTarget, items: [
   { label: '打开笔记', icon: <FileText size={14} />, action: () => select(note.id) },
   { label: '查看版本历史', icon: <History size={14} />, action: async () => { await select(note.id); setPanel('history'); setRightOpen(true); } },
   { label: '复制 Markdown', icon: <Copy size={14} />, action: async () => { await writeClipboard({ text: await api.read(note.id, 'trash') }); notify('已复制 Markdown'); } },
   { separator: true },
   { label: '还原到原位置', icon: <History size={14} />, disabled: busy, action: () => restoreTrashedNote(note) },
  ] });
 }
 async function openTrash() {
  await run(async () => {
   clearDocument(); setActiveEditorKey(null); setMenu(false); contextMenu.close(); setQuery(''); setTrashView(true);
  });
 }
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
 async function insertMarkdown(markdown: string, targetId = activeId, onInserted?: () => void) {
  if (targetId === currentDocument.current.id) {
   if (!editorRef.current?.insertMarkdown(markdown)) edit(currentDocument.current.content + markdown);
   onInserted?.();
  } else {
   const value = pending.current.get(targetId) ?? await api.read(targetId);
   pending.current.set(targetId, value + markdown);
   onInserted?.();
   await flush();
  }
 }
 async function addImages(files: FileList | File[]) {
  if (!activeId || trashed || busy || importingImages.current || workspaceLock.current) return;
  const targetId = activeId;
  const selectedFiles = Array.from(files);
  importingImages.current = true;
  try { await run(async () => {
   for (const file of selectedFiles) {
    if (!/\.(png|jpe?g|gif|webp|avif)$/i.test(file.name) || !file.size) throw new Error('支持 PNG/JPEG/GIF/WebP/AVIF 图片，最大 20 MB');
    if (file.size > 20 * 1024 * 1024) throw new Error('图片最大为 20 MB');
   }
   const importId = crypto.randomUUID(); let markdown = '', inserted = false;
   try {
    for (const file of selectedFiles) {
     const src = await api.image(new Uint8Array(await file.arrayBuffer()), file.name, targetId, importId);
     markdown += `\n\n![${file.name.replace(/[\[\]]/g, '')}](${src})\n`;
    }
    await insertMarkdown(markdown, targetId, () => { inserted = true; });
    await flush();
   } finally { await api.completeImageImport(importId, inserted); }
  }, '图片已添加到 images/'); }
  finally { importingImages.current = false; }
 }
 async function exportCurrentNote(options: ExportOptions) {
  if (!active || !vault || busy) return;
  const note = active, value = currentDocument.current.content, notes = allNotes, assets = vault.manifest.assets;
  setMenu(false); setBusy(true);
  try {
   notify('正在准备导出…');
   await flush();
   const result = await exportNote(api, note, value, options, notes, assets);
   if (result === 'canceled') setNotice(null);
   else { setModal(null); notify(result === 'print' ? '请在打印窗口中选择「另存为 PDF」' : `已导出 ${exportFormatLabel(options.format)}`); }
  } catch (error) { notify(`导出失败：${(error as Error).message}`, true); }
  finally { setBusy(false); }
 }
 async function localizeImages() {
  if (!activeId || trashed || !vault || busy) return;
  const targetId = activeId, vaultPath = vault.path;
  const urls = externalImageUrls(currentDocument.current.content);
  if (!urls.length) { notify('当前笔记没有外部图片'); return; }
  await run(async () => {
   notify(`正在下载 ${urls.length} 张外部图片…`);
   const result = await api.localizeImages(urls, targetId);
   const currentVault = await api.current();
   if (currentVault?.path !== vaultPath || !currentVault.manifest.notes.some(note => note.id === targetId)) throw new Error('笔记库或笔记已变化，请重新打开原笔记后转换');
   const stored = pending.current.get(targetId) ?? await api.read(targetId);
   // Apply replacements to the latest text, retaining edits made during download.
   const latest = currentDocument.current.id === targetId ? currentDocument.current.content : pending.current.get(targetId) ?? stored;
   const next = replaceExternalImages(latest, result.replacements);
   if (next.replaced) {
    if (currentDocument.current.id === targetId) edit(next.content);
    else pending.current.set(targetId, next.content);
    await flush();
   }
   const downloaded = Object.keys(result.replacements).length;
   notify(result.failed.length ? `已转换 ${downloaded} 张图片，${result.failed.length} 张失败，原链接已保留：${result.failed[0].message}` : `已将 ${downloaded} 张外部图片保存到 images/`, result.failed.length > 0);
  });
 }
 async function submitModal() {
  await run(async () => {
   if (modal === 'note' || modal === 'drawing') { const note = await api.create(field.trim(), category.trim(), modal === 'drawing' ? 'excalidraw' : 'markdown'); await refresh(); await select(note.id); setMode('edit'); }
   if (modal === 'embed') {
    const note = embedId ? vault?.manifest.notes.find(n => n.id === embedId) : await api.create(field.trim(), category.trim(), 'excalidraw');
    if (!note) throw new Error('请选择绘图');
    const label = note.title.replace(/[\[\]\r\n]/g, '');
    const markdown = `\n\n![${label}](../${notePath(note)})\n`;
    await insertMarkdown(markdown);
    await flush();
   }
   if (modal === 'folder') { await api.category(field.trim()); setSelectedFolder(field.trim()); setCollapsed(previous => new Set([...previous].filter(path => !field.trim().startsWith(`${path}/`)))); }
   if (modal === 'deleteFolder') {
    await api.removeCategory(category);
    setSelectedFolder(previous => previous === category || previous?.startsWith(`${category}/`) ? null : previous);
    ++readToken.current;
    const v = await api.current(); setVault(v);
    const ids = new Set(v?.manifest.notes.map(note => note.id));
    const remaining = tabs.filter(id => ids.has(id));
    setTabs(previous => previous.filter(id => ids.has(id)));
    setCollapsed(previous => new Set([...previous].filter(path => path !== category && !path.startsWith(`${category}/`))));
    if (!ids.has(activeId)) {
     clearDocument();
     if (!activeEditorKey) {
      if (remaining.length) await select(remaining.at(-1)!);
      else if (editorTabs.length) setActiveEditorKey(editorTabs.at(-1)!.key);
     }
    }
    notify('文件夹已删除，其中的笔记已移入回收站');
   }
   if (modal === 'rename' && modalNote) {
    await api.update(modalNote.id, field.trim(), category.trim());
    setSelectedFolder(category.trim());
    setCollapsed(previous => {
     const next = new Set(previous), parts = category.trim().split('/');
     for (let i = 1; i <= parts.length; i++) next.delete(parts.slice(0, i).join('/'));
     return next;
    });
   }
   if (modal === 'delete' && modalNote) {
    await api.remove(modalNote.id);
    const v = await api.current(); setVault(v);
    await closeNoteTab(modalNote.id);
    notify('笔记已移入回收站');
    if (modalNote.id === activeId && activeEditorKey) clearDocument();
   }
   if (modal === 'settings') { await api.configure(settings); await loadSettings(); notify('设置已保存'); }
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
 const filtered = useMemo(() => { const matches = new Set(textMatches), needle = query.toLowerCase(); const notes = trashView ? [...(vault?.manifest.trash || [])].reverse() : vault?.manifest.notes; return notes?.filter(n => n.title.toLowerCase().includes(needle) || n.category.toLowerCase().includes(needle) || matches.has(n.id)) || []; }, [vault, query, textMatches, trashView]);

 const folderNotes = useMemo(() => sortNotes(query.trim() ? filtered : (vault?.manifest.notes || []).filter(note => selectedFolder === null || note.category === selectedFolder || note.category.startsWith(`${selectedFolder}/`)), noteSort), [filtered, query, selectedFolder, vault?.manifest.notes, noteSort]);
 const selectFolder = (path: string | null) => {
  setSelectedFolder(path); setQuery(''); setTrashView(false);
  if (path !== null) setCollapsed(previous => { const next = new Set(previous); next.delete(path); return next; });
 };
 const listTitle = trashView ? '回收站' : query.trim() ? '搜索结果' : selectedFolder === null ? '全部笔记' : selectedFolder.split('/').at(-1) || '未分类';

 if (loading) return <div className="welcome"><LoaderCircle className="spin" /><p>正在打开笔记库…</p></div>;
 if (!vault) return <div className="welcome"><div className="welcome-art"><Flame size={56} strokeWidth={1.3} /><span className="orbit one" /><span className="orbit two" /></div><h1>Fever</h1><button className="primary large" onClick={() => void openVault()} disabled={busy}><FolderOpen size={18} />选择笔记库文件夹<ArrowRight size={17} /></button>{notice && <div className="toast error">{notice.message}</div>}</div>;

 return <div className="app-shell" inert={workspaceLocked} aria-busy={workspaceLocked}>
  {leftOpen && <>
   <aside className="sidebar" aria-label="文件夹栏">
    <div className="sidebar-brand"><span>fever<span className="brand-period">.</span></span><button className="icon-button" title="设置" onClick={openSettings} aria-keyshortcuts="Meta+, Control+,"><Settings2 size={18} /></button></div>
    <div className="sidebar-search"><Search size={15} /><input ref={searchRef} value={query} placeholder={trashView ? '搜索回收站…' : '搜索你的笔记…'} onChange={e => setQuery(e.target.value)} /><kbd>⌘ K</kbd></div>
    <button className="new-note" onClick={() => showNew('note')}><Plus size={17} /><span>新建笔记</span><kbd>⌘ N</kbd></button>
    <button className={`all-notes ${!trashView && selectedFolder === null && !query ? 'selected' : ''}`} aria-pressed={!trashView && selectedFolder === null && !query} onClick={() => selectFolder(null)}><BookOpen size={16} /><span>全部笔记</span><small>{vault.manifest.notes.length}</small></button>
    <div className="tree-label"><span>文件夹</span><div><button title="新建绘图" onClick={() => showNew('drawing')}><Shapes size={15} /></button><button title="新建分类" onClick={() => showNew('folder')}><FolderPlus size={15} /></button><button title="导入 Markdown / Excalidraw" onClick={() => void run(async () => { const notes = await api.importNotes(); if (notes.length) { await refresh(); await select(notes[0].id); } else if (!api.desktop) notify('Markdown / Excalidraw 导入请使用桌面应用'); })}><Upload size={15} /></button></div></div>
    <NoteTree notes={vault.manifest.notes} categories={vault.manifest.categories} selectedFolder={trashView || query ? null : selectedFolder} collapsed={collapsed} onSelect={selectFolder} onToggle={toggleFolder} onContextMenu={showTreeMenu} />
    {vault.manifest.notes.some(note => !note.category) && <button className={`all-notes ${selectedFolder === '' && !trashView ? 'selected' : ''}`} onClick={() => selectFolder('')}><Folder size={16} /><span>未分类</span><small>{vault.manifest.notes.filter(note => !note.category).length}</small></button>}
    <div className="sidebar-bottom"><button className={`trash-entry ${trashView ? 'selected' : ''}`} disabled={busy} onClick={() => void openTrash()}><Trash2 size={16} /><span>回收站</span><span className="trash-count">{vault.manifest.trash?.length || 0}</span></button><div className="sidebar-foot"><FolderOpen size={13} /><span title={vault.path}>{vault.name}</span></div></div>
   </aside>
   <section className="file-list-panel" aria-label="笔记列表栏">
    <header className="file-list-header"><div><h2 title={selectedFolder || listTitle}>{listTitle}</h2><span>{trashView ? filtered.length : folderNotes.length} 篇笔记{!trashView && selectedFolder && !query ? ' · 含子文件夹' : ''}</span></div>{!trashView && <button className="icon-button" title="在当前文件夹新建笔记" onClick={() => showNew('note')}><FilePlus2 size={18} /></button>}</header>
    {!trashView && <NoteSort sort={noteSort} onChange={setNoteSort} />}
    {trashView ? <TrashBrowser key={vault.path} notes={filtered} query={query} activeId={activeEditor ? '' : activeId} busy={busy} onSelect={id => void select(id)} onRestore={note => void restoreTrashedNote(note)} onContextMenu={showTrashMenu} /> : folderNotes.length ? <NoteList key={vault.path} notes={folderNotes} activeId={activeEditor ? '' : activeId} scope={`${selectedFolder}:${query}:${noteSort.field}:${noteSort.direction}`} api={api} draftId={activeId} draft={content} onSelect={select} onContextMenu={showTreeMenu} /> : <div className="file-list-empty"><FileText size={28} strokeWidth={1.2} /><p>{query.trim() ? '没有找到相关笔记' : '这个文件夹还是空的'}</p>{!query.trim() && <button className="text-button" onClick={() => showNew('note')}><Plus size={14} />写下第一篇笔记</button>}</div>}
    <footer className="file-list-footer">{query.trim() ? '搜索整个笔记库' : '选择笔记，开始阅读与记录'}</footer>
   </section>
  </>}

  <main className="workspace"><header className="tab-bar"><button className="icon-button toggle-left" title="切换侧栏" onClick={() => setLeftOpen(!leftOpen)}><PanelLeftClose size={17} /></button><div className="tabs">{tabs.map(id => { const n = allNotes.find(n => n.id === id); return n && <div key={id} className={`tab ${!activeEditor && id === activeId ? 'current' : ''}`}><button onClick={() => void select(id)}>{isDrawingNote(n) ? <Shapes size={14} /> : <FileText size={14} />}<span>{n.title}</span></button><button title="关闭标签" disabled={workspaceLocked} onClick={() => void closeNote(id)}><X size={13} /></button></div>; })}{editorTabs.map(tab => <div key={tab.key} className={`tab ${activeEditorKey === tab.key ? 'current' : ''}`}><button title={tab.path} disabled={busy} onClick={() => void activateEditor(tab)}>{tab.kind === 'diff' ? <GitBranch size={14} /> : <FileText size={14} />}<span>{vault.manifest.notes.find(note => notePath(note) === tab.path)?.title || tab.path.split('/').pop()}{tab.kind === 'diff' ? ` · ${tab.staged ? '已暂存' : '工作区'}对比` : ''}</span></button><button title={`关闭${tab.kind === 'diff' ? '对比' : '文件'}：${tab.path}`} disabled={workspaceLocked} onClick={() => void closeEditor(tab)}><X size={13} /></button></div>)}<button className="icon-button tab-add" title="新建笔记" onClick={() => showNew('note')}><Plus size={17} /></button></div>{!rightOpen && <div className="inspector-shortcuts"><button className="icon-button" aria-label="大纲" title="大纲" onClick={() => { setPanel('outline'); setRightOpen(true); }}><LayoutList size={16} /></button><button className="icon-button" aria-label="历史" title="历史" onClick={() => { setPanel('history'); setRightOpen(true); }}><History size={16} /></button><button className="icon-button" aria-label="Git" title="Git" onClick={() => { setPanel('git'); setRightOpen(true); }}><GitBranch size={16} /></button></div>}<button className="icon-button toggle-right" title="切换右侧面板" onClick={() => setRightOpen(!rightOpen)}><PanelRightClose size={17} /></button></header>
   <div className="editor-toolbar"><div className="breadcrumbs"><Folder size={14} />{!activeEditor && active?.category.split('/').map(c => <span key={c}>{c}<ChevronRight size={12} /></span>)}<span className="breadcrumb-title">{activeEditor?.path || active?.title || (trashView ? '回收站' : '我的笔记')}</span></div>{!selectedCommit && !trashed && ((!activeEditor && active && !drawing) || (activeEditor?.kind === 'file' && !activeEditor.file.binary)) && <button className="icon-button article-find-button" title={`文章内查找 · ${modifier}F`} aria-label="文章内查找" onMouseDown={event => event.preventDefault()} onClick={() => setArticleFindRequest(articleFindKey)}><Search size={17} /></button>}{selectedCommit ? <div className="editor-actions revision-actions"><span className="revision-readonly">只读</span>{revisionMode === 'preview' && !displayedDrawing && <EditorWidthButton {...editorWidthProps} />}<button className="text-button" disabled={busy} onClick={() => setRevisionMode(value => value === 'diff' ? 'preview' : 'diff')}>{revisionMode === 'diff' ? <Eye size={14} /> : <GitBranch size={14} />}{revisionMode === 'diff' ? '预览此版本' : '查看 diff'}</button><button className="text-button" disabled={busy} onClick={leaveRevision}>返回当前版本</button>{!trashed && <button className="text-button" disabled={busy} onClick={() => void restoreRevision()}><History size={14} />恢复这个版本</button>}</div> : activeEditor ? <div className="editor-actions"><span className="editor-kind">{activeEditor.kind === 'diff' ? '文件变更对比' : activeEditor.file.binary ? '文件预览' : '源码编辑'}</span>{activeEditor.kind === 'diff' && <button className="text-button" disabled={busy} onClick={() => void openChangedFile({ path: activeEditor.path, status: '', staged: false, unstaged: false })}><PenLine size={14} />打开文件</button>}</div> : trashed ? <div className="editor-actions"><span className="revision-readonly">回收站 · 只读</span>{!drawing && <EditorWidthButton {...editorWidthProps} />}<button className="icon-button" title="笔记历史" onClick={() => { setPanel('history'); setRightOpen(true); }}><History size={17} /></button><button className="text-button" disabled={busy} onClick={() => void restoreTrashedNote(active!)}><History size={14} />还原到原位置</button></div> : <div className="editor-actions">{!drawing && <div className="mode-switch"><button className={mode === 'edit' ? 'chosen' : ''} title="编辑模式 · ⌘ E" onClick={() => setMode('edit')}><PenLine size={15} /></button><button className={mode === 'split' ? 'chosen' : ''} title="Markdown 源码与预览" onClick={() => setMode('split')}><Code2 size={16} /></button></div>}{!drawing && <EditorWidthButton {...editorWidthProps} />}<button className="icon-button" title="笔记历史" onClick={() => { setPanel('history'); setRightOpen(true); }}><History size={17} /></button><div className="more-wrap" ref={moreMenuRef}><button className="icon-button" title="更多笔记操作" onClick={() => setMenu(!menu)}><MoreHorizontal size={19} /></button>{menu && <div className="dropdown"><button disabled={!active} onClick={() => { if (active) showNoteAction('rename', active); }}><PenLine size={14} />重命名 / 移动笔记</button><button disabled={!active || drawing} onClick={() => imageRef.current?.click()}><ImagePlus size={14} />插入图片</button><button title="外部图片转为本地文件" disabled={!active || drawing || busy} onClick={() => { setMenu(false); void localizeImages(); }}><ArrowDownToLine size={14} />外部图片转为本地文件</button><button disabled={!active || drawing} onClick={() => { showNew('embed'); setMenu(false); }}><Shapes size={14} />插入 Excalidraw</button><button disabled={!active} onClick={() => { writeClipboard({ text: content }).then(() => notify(drawing ? '已复制绘图数据' : '已复制 Markdown')).catch(() => notify('复制失败', true)); setMenu(false); }}><Copy size={14} />{drawing ? '复制绘图数据' : '复制 Markdown'}</button><button disabled={!active || busy} onClick={() => { setMenu(false); setModal('export'); }}><ArrowDownToLine size={14} />导出…</button><button className="danger-text" disabled={!active} onClick={() => { if (active) showNoteAction('delete', active); }}><Trash2 size={14} />删除笔记</button></div>}</div></div>}</div>
   <div className="document-area"><div className={`document-space ${selectedCommit ? 'revision-view' : activeEditor ? 'repository-document' : trashed ? 'trash-document-space' : mode}`} onPaste={e => { if (trashed || selectedCommit || activeEditor || drawing) return; const files = Array.from(e.clipboardData.files).filter(file => file.type.startsWith('image/')); if (files.length) { e.preventDefault(); void addImages(files); } }} onDragOver={e => { if (!trashed && !selectedCommit && !activeEditor && !drawing) e.preventDefault(); }} onDrop={e => { if (trashed || selectedCommit || activeEditor || drawing) return; e.preventDefault(); if (e.dataTransfer.files.length) void addImages(e.dataTransfer.files); }}>
    {selectedCommit && active ? <article key={`${selectedCommit.hash}:${revisionMode}`} className={`document revision-document ${revisionMode === 'diff' ? 'revision-diff-document' : ''}`} aria-label="历史版本（只读）" tabIndex={0}><div className="revision-meta"><GitCommitHorizontal size={15} /><strong title={selectedCommit.message}>{selectedCommit.message}</strong><code>{selectedCommit.hash.slice(0, 7)}</code><span>{selectedCommit.author} · {time(selectedCommit.date)}</span></div>{revisionMode === 'diff' && revisionComparison ? <RevisionDiff comparison={revisionComparison} hash={selectedCommit.hash} /> : <div className="prose"><Suspense fallback={<DrawingLoading />}>{displayedDrawing ? <DrawingPreview content={revision} label={active.title} /> : <Markdown onNavigate={navigateNote} content={revision} assets={vault.manifest.assets} notes={allNotes} />}</Suspense></div>}</article> : activeEditor ? activeEditor.kind === 'diff' ? <section className="diff-editor" aria-label="文件变更对比"><GitDiff diff={activeEditor.diff} staged={activeEditor.staged} /></section> : activeEditor.file.binary ? <div className="file-preview">{activeEditor.file.image ? <img src={activeEditor.file.image} alt={activeEditor.path} /> : <p>二进制文件，无法显示文本内容。</p>}</div> : <div className="source-editor file-editor"><div className="source-label"><span><Code2 size={13} />{activeEditor.path}</span><span>UTF-8</span></div><Suspense fallback={<span className="drawing-placeholder">正在加载编辑器…</span>}><SourceEditor findRequest={articleFind} key={activeEditor.key} filename={activeEditor.path} content={activeEditor.file.content} dark={dark} onChange={value => editFile(activeEditor, value)} onError={message => notify(message, true)} /></Suspense></div> : !active ? <div className="empty-workspace"><BookOpen size={40} strokeWidth={1} /><h2>{trashView ? '选择回收站中的笔记' : '未打开笔记'}</h2>{trashView ? <p>查看正文和历史，或还原到原位置</p> : <button className="primary" onClick={() => showNew('note')}><Plus size={16} />新建笔记</button>}</div> : trashed ? <article className="document trash-document" aria-label="回收站笔记（只读）" tabIndex={0} onContextMenu={event => showTrashMenu(event, active)}><div className="document-meta"><span className="category-pill"><Folder size={12} />原位置：{active.category || '未分类'}</span><span>只读</span></div><div className="prose"><Suspense fallback={<DrawingLoading />}>{drawing ? <DrawingPreview content={content} label={active.title} /> : <Markdown onNavigate={navigateNote} content={content} assets={vault.manifest.assets} notes={allNotes} />}</Suspense></div></article> : drawing ? <Suspense fallback={<DrawingLoading />}><DrawingEditor key={`${activeId}:${editorVersion}`} content={content} dark={dark} onChange={edit} /></Suspense> : <>
     {mode === 'split' && <article className="document" tabIndex={-1} onContextMenu={showDocumentMenu}><div className="document-meta"><span className="category-pill"><Folder size={12} />{active.category || '未分类'}</span><span><Clock3 size={12} />更新于 {time(active.updatedAt)}</span></div><div className="prose"><Markdown onNavigate={navigateNote} content={content} assets={vault.manifest.assets} notes={vault.manifest.notes} onOpen={openDrawing} /></div></article>}
     {mode === 'edit' && <div className="wysiwyg-editor"><Suspense fallback={<span className="drawing-placeholder">正在加载编辑器…</span>}><MarkdownEditor findRequest={articleFind} onNavigate={navigateNote} ref={editorRef} key={`${activeId}:${editorVersion}`} content={content} onChange={edit} media={editorMedia} onError={message => notify(message, true)} onInsertImage={() => imageRef.current?.click()} onInsertDrawing={() => showNew('embed')} /></Suspense></div>}
     {mode === 'split' && <div className="source-editor"><div className="source-label"><span><PenLine size={13} />MARKDOWN</span><span><button className="text-button" onClick={() => showNew('embed')}><Shapes size={14} />插入 Excalidraw</button><button className="text-button" onClick={() => imageRef.current?.click()}><ImagePlus size={14} />插入图片</button></span></div><Suspense fallback={<span className="drawing-placeholder">正在加载编辑器…</span>}><SourceEditor findRequest={articleFind} key={activeId} content={content} dark={dark} onChange={edit} onError={message => notify(message, true)} /></Suspense></div>}
    </>}
   </div></div><footer className="status-bar"><div><span className="saved-state">{saved ? <CheckCheck size={13} /> : <LoaderCircle className="spin" size={13} />}{saved ? '所有更改已保存' : '正在保存…'}</span>{!api.desktop && <span className="demo-label">浏览器演示</span>}</div><div>{activeEditor ? <span>{activeEditor.kind === 'diff' ? '文件变更对比' : activeEditor.path.split('/').pop()}</span> : displayedDrawing ? <span>{drawingCount} 个元素</span> : <><span>{counts.words.toLocaleString()} 字</span><span>{counts.chars.toLocaleString()} 字符</span></>}{!activeEditor && <span>{displayedDrawing ? 'Excalidraw' : 'Markdown'}</span>}<span>UTF-8</span><button title="Git 状态" onClick={() => { setPanel('git'); setRightOpen(true); }}><GitBranch size={12} />{status?.branch || 'main'}</button></div></footer>
  </main>
  {rightOpen && <aside className={`inspector ${panel === 'git' ? 'git-inspector' : ''}`}><div className="inspector-tabs"><button className="inspector-close icon-button" title="关闭右侧面板" onClick={() => setRightOpen(false)}><X size={15} /></button><button className={panel === 'outline' ? 'active' : ''} onClick={() => setPanel('outline')}><LayoutList size={16} />大纲</button><button className={panel === 'history' ? 'active' : ''} onClick={() => setPanel('history')}><History size={16} />历史</button><button className={panel === 'git' ? 'active' : ''} onClick={() => setPanel('git')}><GitBranch size={16} />Git</button></div>
   {panel === 'outline' && <><div className="inspector-title">本篇目录<span>{headings.length}</span></div><nav className="outline">{headings.map((h, i) => <button key={i} className={`${i === 0 ? 'outline-first' : ''} level-${h.level}`} onClick={() => { if (!trashed && !selectedCommit && mode === 'edit') { Array.from(document.querySelectorAll('.wysiwyg-content h1, .wysiwyg-content h2, .wysiwyg-content h3')).find(node => node.textContent === h.text)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } else { document.getElementById(headingId(h.text))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }}>{h.level === 1 ? <span className="outline-bullet" /> : <span className="outline-dash" />}<span>{h.text}</span></button>)}{!headings.length && <p className="muted">暂无大纲</p>}</nav><div className="note-info"><div className="inspector-title">笔记信息<FileText size={14} /></div><dl><dt>创建时间</dt><dd>{active ? time(active.createdAt) : '—'}</dd><dt>最后更新</dt><dd>{active ? time(active.updatedAt) : '—'}</dd><dt>存储位置</dt><dd className="mono">{active ? `${active.directory || 'notes'}/` : '—'}</dd><dt>文件名称</dt><dd className="filename" title={active?.filename}>{active?.filename || '—'}</dd></dl></div></>}
   {panel === 'history' && <><div className="inspector-title history-title">版本历史<span>{history.length}</span></div><div className="history-note"><FileText size={14} /><span>{active?.title || '选择一篇笔记'}</span></div><div className="history-list">{history.map((c, i) => <button key={c.hash} className={`history-item ${selectedCommit?.hash === c.hash ? 'selected' : ''}`} aria-pressed={selectedCommit?.hash === c.hash} title={`${c.message}\n${c.author} · ${time(c.date)} · ${c.hash}`} disabled={busy} onClick={() => void openRevision(c)}><GitCommitHorizontal size={16} /><span className="history-details"><span className="history-heading"><strong>{c.message}</strong>{i === 0 && <span className="latest-badge">最新</span>}</span><span className="history-summary"><span>{time(c.date)}</span><code>{c.hash.slice(0, 7)}</code></span></span>{selectedCommit?.hash === c.hash && <span className="selected-dot" />}</button>)}{!history.length && <div className="panel-empty"><History size={30} /><p>还没有提交记录</p><button className="text-button" onClick={() => setPanel('git')}>前往 Git 面板<ArrowRight size={13} /></button></div>}</div></>}
   {panel === 'git' && <>
    <div className="inspector-title">源代码管理</div>
    <div className="git-toolbar" role="toolbar" aria-label="Git 全局操作">
     <button className="icon-button" title="推送" aria-label="推送" disabled={busy} onClick={() => void run(() => api.push(), '已推送到远程仓库')}><Upload size={17} /></button>
     <button className="icon-button" title="拉取" aria-label="拉取" disabled={busy} onClick={() => void pull()}><ArrowDownToLine size={17} /></button>
     <span className="git-toolbar-separator" />
     <button className="icon-button" title="全部取消暂存" aria-label="全部取消暂存" disabled={busy || !stagedCount} onClick={unstageAll}><Minus size={19} /></button>
     <button className="icon-button git-refresh" title="刷新 Git 状态" aria-label="刷新 Git 状态" disabled={busy} onClick={() => void run(refresh)}><RefreshCw size={16} /></button>
    </div>
    <div className="git-branch-card"><div><GitBranch size={15} /><strong title={status?.branch}>{status?.branch}</strong><div className="sync-counts"><span title={`${status?.ahead || 0} 个提交待推送`}><ArrowUp size={12} />{status?.ahead || 0}</span><span title={`${status?.behind || 0} 个提交待拉取`}><ArrowDown size={12} />{status?.behind || 0}</span></div></div><p title={status?.remote || '本地仓库 · 未配置远程'}>{status?.remote || '本地仓库 · 未配置远程'}</p></div>
    <div className="commit-box"><textarea aria-label="提交说明" placeholder="这次记录了什么？" value={commitMessage} onChange={e => setCommitMessage(e.target.value)} /><button className="primary" disabled={busy || !commitMessage.trim() || !status?.changes.length} onClick={() => void run(async () => { await api.commit(commitMessage, stagedCount > 0); setCommitMessage(defaultCommitMessage()); }, '已创建 Git 提交')}><GitCommitHorizontal size={17} />{busy ? '正在处理…' : stagedCount ? `提交已暂存变更 (${stagedCount})` : '提交所有笔记变更'}</button></div>
    <GitChanges onStageAll={stageAll} onDiscardAll={() => setModal('discardAll')} status={status} notes={allNotes} trash={vault.manifest.trash} busy={busy} onDiff={(change, staged) => void openDiff(change, staged)} onStage={change => void run(() => api.stage(change.path), '已暂存文件变更')} onUnstage={change => void run(() => api.unstage(change.path), '已取消暂存')} onDiscard={change => { setDiscardChange(change); setModal('discard'); }} onOpen={change => void openChangedFile(change)} />
    <div className="lfs-indicator"><span className={status?.lfs ? 'green-dot' : 'amber-dot'} />Git LFS {status?.lfs ? '已启用' : '未安装'}<span>images/</span></div>
   </>}
  </aside>}
  <ContextMenu menu={contextMenu.menu} onClose={contextMenu.close} onError={message => notify(message, true)} />
  <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif" multiple hidden onChange={e => { if (e.target.files) void addImages(e.target.files); e.target.value = ''; }} />
  {notice && <div className={`toast ${notice.error ? 'error' : ''}`}>{notice.error ? <Circle size={16} /> : <CheckCheck size={17} />}<span>{notice.message}</span><button onClick={() => setNotice(null)}><X size={14} /></button></div>}
  {modal === 'export' && active && <ExportDialog key={active.id} title={active.title} drawing={drawing} busy={busy} returnFocusRef={moreMenuRef} onClose={() => setModal(null)} onExport={options => void exportCurrentNote(options)} />}
  {modal && modal !== 'export' && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setModal(null); }}><section className={`modal ${modal === 'rename' ? 'move-note-modal' : modal === 'settings' ? 'settings-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><span className="modal-icon">{modal === 'settings' ? <Settings2 size={20} /> : modal === 'folder' ? <FolderPlus size={20} /> : modal === 'delete' || modal === 'deleteFolder' ? <Trash2 size={20} /> : <FilePlus2 size={20} />}</span><h2 id="modal-title">{{ drawing: '新建 Excalidraw 绘图', embed: '插入 Excalidraw', note: '新建笔记', folder: '新建分类', rename: '重命名 / 移动笔记', delete: '将这篇笔记移入回收站？', deleteFolder: '删除这个文件夹？', settings: '笔记库设置', discard: '撤销这个文件的变更？', discardAll: '还原全部工作区变更？' }[modal]}</h2></div><button className="icon-button" disabled={busy} onClick={() => setModal(null)}><X size={18} /></button></div>
   <div className="modal-body">{modal === 'discardAll' && <p className="delete-description">将工作区列表中的所有文件恢复到上次提交，并取消这些文件的暂存。新增文件会被删除，未提交的修改无法恢复。</p>}{modal === 'discard' && discardChange && <p className="delete-description">将「{discardChange.path}」恢复到上次提交，并取消该文件的暂存。新增文件会被删除，未提交的修改无法恢复。</p>}{['note', 'folder', 'rename', 'drawing'].includes(modal) && <><label>{modal === 'folder' ? '分类名称' : modal === 'drawing' ? '绘图标题' : '笔记标题'}<input autoFocus value={field} placeholder={modal === 'folder' ? '例如：项目/Fever' : modal === 'drawing' ? '绘图标题' : '笔记标题'} onChange={e => setField(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && field.trim()) void submitModal(); }} maxLength={200} /></label>{modal === 'rename' ? <CategoryPicker categories={vault.manifest.categories} notes={vault.manifest.notes} value={category} current={modalNote?.category || ''} onChange={setCategory} disabled={busy} /> : modal !== 'folder' && <label>所属分类<input list="category-options" value={category} onChange={e => setCategory(e.target.value)} placeholder="收件箱" maxLength={200} /><datalist id="category-options">{vault.manifest.categories.map(c => <option key={c}>{c}</option>)}</datalist></label>}</>}
    {modal === 'embed' && <><label>选择绘图<select value={embedId} onChange={e => setEmbedId(e.target.value)}><option value="">新建绘图并插入</option>{drawings.map(note => <option key={note.id} value={note.id}>{note.category ? `${note.category} / ` : ''}{note.title}</option>)}</select></label>{!embedId && <><label>绘图标题<input autoFocus value={field} onChange={e => setField(e.target.value)} maxLength={200} placeholder="给绘图起个名字" /></label><label>所属分类<input value={category} onChange={e => setCategory(e.target.value)} maxLength={200} /></label></>}</>}
    {modal === 'deleteFolder' && <p className="delete-description">将删除「{category}」及其所有子文件夹，其中的 {vault.manifest.notes.filter(note => note.category === category || note.category.startsWith(`${category}/`)).length} 篇笔记将移入回收站。正文和图片会保留，恢复笔记时会重建原分类。</p>}
    {modal === 'delete' && <p className="delete-description">「{modalNote?.title}」将移入回收站，正文、图片和原分类会保留，可随时恢复。</p>}
    {modal === 'settings' && <SettingsPanel vault={vault} settings={settings} onSettingsChange={setSettings} appearance={{ themeMode, fontSize, editorWidth, editorFullWidth, setThemeMode, setFontSize, setEditorWidth, setEditorFullWidth }} desktop={api.desktop} lfs={Boolean(status?.lfs)} busy={busy} onSwitchVault={() => { setModal(null); void openVault(); }} />}
   </div><div className="modal-footer">{modal === 'discard' || modal === 'discardAll' ? <><button className="secondary" disabled={busy} onClick={() => setModal(null)}>取消</button><button className="danger" disabled={busy} onClick={() => void discardFile(modal === 'discardAll')}>{modal === 'discardAll' ? '全部还原' : '撤销变更'}</button></> : <><button className="secondary" disabled={busy} onClick={() => setModal(null)}>取消</button><button className={modal === 'delete' || modal === 'deleteFolder' ? 'danger' : 'primary'} disabled={busy || (['note', 'folder', 'rename', 'drawing'].includes(modal) && !field.trim()) || (modal === 'embed' && !embedId && !field.trim())} onClick={() => void submitModal()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}{modal === 'settings' ? '保存设置' : modal === 'delete' ? '删除笔记' : modal === 'deleteFolder' ? '删除文件夹' : modal === 'folder' ? '创建分类' : modal === 'rename' ? '保存更改' : modal === 'drawing' ? '创建绘图' : modal === 'embed' ? '插入绘图' : '创建笔记'}</button></>}</div>
  </section></div>}
 </div>;
}
