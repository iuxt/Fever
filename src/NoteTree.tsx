import { memo, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Folder, FolderOpen } from 'lucide-react';
import type { Note } from './types';
import { keyboardContextMenu } from './ContextMenu';

type FolderNode = { path: string; name: string; children: Map<string, FolderNode>; notes: Note[]; total: number };
type Row = { depth: number; folder: FolderNode };
const ROW_HEIGHT = 36, OVERSCAN = 6;

export type NoteTreeTarget = { kind: 'note'; note: Note } | { kind: 'folder'; path: string } | { kind: 'blank' };

type NoteTreeProps = {
 notes: Note[]; categories: string[]; selectedFolder: string | null; collapsed: Set<string>;
 onSelect: (path: string) => void;
 onContextMenu: (event: MouseEvent<HTMLElement>, target: NoteTreeTarget) => void;
};
// Saving content only changes timestamps; neither the rows nor their actions use them.
const sameRows = (previous: Note[] | null, next: Note[] | null) => previous === next || Boolean(previous && next && previous.length === next.length && previous.every((note, index) => {
 const other = next[index];
 return note.id === other.id && note.title === other.title && note.category === other.category && note.filename === other.filename && note.sourcePath === other.sourcePath;
}));

function useStableRows<T extends Note[] | null>(notes: T): T {
 const previous = useRef(notes);
 return useMemo(() => {
  if (!sameRows(previous.current, notes)) previous.current = notes;
  return previous.current;
 }, [notes]);
}

export default memo(function NoteTree(props: NoteTreeProps) {
 const notes = useStableRows(props.notes);
 return <TreeRows {...props} notes={notes} />;
});

const TreeRows = memo(function TreeRows({ notes, categories, selectedFolder, collapsed, onSelect, onContextMenu }: NoteTreeProps) {
 const container = useRef<HTMLDivElement>(null);
 const previous = useRef<string | null>(null);
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
  const rows: Row[] = [];
  const walk = (folder: FolderNode, depth: number) => {
   for (const child of folder.children.values()) {
    rows.push({ folder: child, depth });
    if (!collapsed.has(child.path)) walk(child, depth + 1);
   }
  };
  walk(root, 0); return rows;
 }, [root, collapsed]);
 useLayoutEffect(() => {
  const element = container.current!;
  const update = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
  const observer = new ResizeObserver(update); observer.observe(element); update();
  return () => observer.disconnect();
 }, []);
 useLayoutEffect(() => {
  const element = container.current!;
  const index = previous.current !== selectedFolder ? rows.findIndex(row => row.folder.path === selectedFolder) : -1;
  previous.current = selectedFolder;
  if (index >= 0) {
   const top = index * ROW_HEIGHT;
   if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top;
  } else element.scrollTop = Math.min(element.scrollTop, Math.max(0, rows.length * ROW_HEIGHT - element.clientHeight));
  setViewport({ top: element.scrollTop, height: element.clientHeight });
 }, [selectedFolder, rows]);
 const start = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN);
 const end = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN);
 return <div ref={container} className="note-tree virtual-note-tree" onKeyDown={keyboardContextMenu} onContextMenu={event => onContextMenu(event, { kind: 'blank' })} onScroll={e => setViewport({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
  <div className="note-tree-rows" style={{ height: rows.length * ROW_HEIGHT }}>
   {rows.slice(start, end).map((row, offset) => <div className="note-tree-row folder-tree-row" key={row.folder.path} style={{ top: (start + offset) * ROW_HEIGHT, paddingLeft: row.depth * 12 }}>
    <button className={`folder-row ${selectedFolder === row.folder.path ? 'selected' : ''}`} aria-pressed={selectedFolder === row.folder.path} title={row.folder.path} onContextMenu={event => onContextMenu(event, { kind: 'folder', path: row.folder.path })} onClick={() => onSelect(row.folder.path)}>
     {selectedFolder === row.folder.path ? <FolderOpen size={16} /> : <Folder size={16} />}<span>{row.folder.name}</span><small>{row.folder.total}</small>
    </button>
   </div>)}
  </div>
 </div>;
});
