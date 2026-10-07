import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Shapes } from 'lucide-react';
import { isDrawingNote } from './drawings';
import type { Note } from './types';

type FolderNode = { path: string; name: string; children: Map<string, FolderNode>; notes: Note[]; total: number };
type Row = { depth: number } & ({ kind: 'note'; note: Note } | { kind: 'folder'; folder: FolderNode });
const ROW_HEIGHT = 36, OVERSCAN = 6;

export default memo(function NoteTree({ notes, categories, results, activeId, collapsed, onToggle, onSelect }: {
 notes: Note[]; categories: string[]; results: Note[] | null; activeId: string; collapsed: Set<string>;
 onToggle: (path: string) => void; onSelect: (id: string) => void;
}) {
 const container = useRef<HTMLDivElement>(null);
 const previous = useRef({ activeId: '', searching: false });
 const [viewport, setViewport] = useState({ top: 0, height: 600 });
 const root = useMemo(() => {
  const makeFolder = (path = '', name = ''): FolderNode => ({ path, name, children: new Map(), notes: [], total: 0 });
  const root = makeFolder();
  const addPath = (path: string, note?: Note) => {
   let parent = root;
   if (note) parent.total++;
   for (const name of path ? path.split('/') : []) {
    let child = parent.children.get(name);
    if (!child) { child = makeFolder(parent.path ? `${parent.path}/${name}` : name, name); parent.children.set(name, child); }
    if (note) child.total++;
    parent = child;
   }
   if (note) parent.notes.push(note);
  };
  categories.forEach(path => addPath(path)); notes.forEach(note => addPath(note.category, note));
  return root;
 }, [notes, categories]);
 const rows = useMemo(() => {
  if (results) return results.map(note => ({ kind: 'note', note, depth: 0 } as Row));
  const rows: Row[] = [];
  const walk = (folder: FolderNode, depth: number) => {
   folder.notes.forEach(note => rows.push({ kind: 'note', note, depth }));
   for (const child of folder.children.values()) {
    rows.push({ kind: 'folder', folder: child, depth });
    if (!collapsed.has(child.path)) walk(child, depth + 1);
   }
  };
  walk(root, 0); return rows;
 }, [root, collapsed, results]);
 useLayoutEffect(() => {
  const element = container.current!;
  const update = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
  const observer = new ResizeObserver(update); observer.observe(element); update();
  return () => observer.disconnect();
 }, []);
 useLayoutEffect(() => {
  const element = container.current!;
  const selectionChanged = previous.current.activeId !== activeId;
  const searchClosed = previous.current.searching && !results;
  if (results && !previous.current.searching) element.scrollTop = 0;
  previous.current = { activeId, searching: Boolean(results) };
  const index = selectionChanged || searchClosed ? rows.findIndex(row => row.kind === 'note' && row.note.id === activeId) : -1;
  if (index >= 0) {
   const top = index * ROW_HEIGHT;
   if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top;
  } else element.scrollTop = Math.min(element.scrollTop, Math.max(0, rows.length * ROW_HEIGHT - element.clientHeight));
  setViewport({ top: element.scrollTop, height: element.clientHeight });
 }, [activeId, rows]);
 const start = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN);
 const end = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN);
 return <div ref={container} className="note-tree virtual-note-tree" onScroll={e => setViewport({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
  <div className="note-tree-rows" style={{ height: rows.length * ROW_HEIGHT }}>
   {rows.slice(start, end).map((row, offset) => <div className="note-tree-row" key={row.kind === 'note' ? `note:${row.note.id}` : `folder:${row.folder.path}`} style={{ top: (start + offset) * ROW_HEIGHT, paddingLeft: row.depth * 12 }}>
    {row.kind === 'note' ? <button className={`note-row ${row.note.id === activeId ? 'selected' : ''}`} onClick={() => onSelect(row.note.id)} title={row.note.title}>
     {isDrawingNote(row.note) ? <Shapes size={15} /> : <FileText size={15} />}<span>{row.note.title}</span>{row.note.id === activeId && <span className="selected-dot" />}
    </button> : <button className="folder-row" onClick={() => onToggle(row.folder.path)} aria-expanded={!collapsed.has(row.folder.path)}>
     {collapsed.has(row.folder.path) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}{collapsed.has(row.folder.path) ? <Folder size={15} /> : <FolderOpen size={15} />}<span>{row.folder.name}</span><small>{row.folder.total}</small>
    </button>}
   </div>)}
  </div>
  {results && !results.length && <p className="search-empty">没有找到相关笔记</p>}
 </div>;
});
