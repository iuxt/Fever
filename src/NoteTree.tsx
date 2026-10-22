import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { Folder, FolderOpen } from 'lucide-react';
import type { FolderPlacement, Note } from './types';
import { keyboardContextMenu } from './ContextMenu';
import { matchesNoteDrag, startNoteDrag, type NoteDragProps } from './noteDrag';

type FolderNode = { path: string; name: string; children: Map<string, FolderNode>; notes: Note[]; total: number };
type Row = { depth: number; folder: FolderNode };
const ROW_HEIGHT = 36, OVERSCAN = 6;
type DropTarget = { parent: string; path: string; position: 'inside' | 'before' | 'after' };

export type NoteTreeTarget = { kind: 'note'; note: Note } | { kind: 'folder'; path: string } | { kind: 'blank' };

type NoteTreeProps = NoteDragProps & {
 notes: Note[]; categories: string[]; selectedFolder: string | null; revealRequest: number; collapsed: Set<string>;
 onSelect: (path: string) => void;
 onToggle: (path: string) => void;
 onContextMenu: (event: MouseEvent<HTMLElement>, target: NoteTreeTarget) => void;
 onMove: (from: string, parent: string, placement?: FolderPlacement) => void;
 onMoveNote: (id: string, parent: string) => void;
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

const TreeRows = memo(function TreeRows({ notes, categories, selectedFolder, revealRequest, collapsed, onSelect, onToggle, onContextMenu, onMove, onMoveNote, dragItem, onDragItemChange, disabled }: NoteTreeProps) {
 const container = useRef<HTMLDivElement>(null);
 const previous = useRef<{ selectedFolder: string | null; revealRequest: number }>({ selectedFolder: null, revealRequest: -1 });
 const [viewport, setViewport] = useState({ top: 0, height: 600 });
 const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
 const [hoverFolder, setHoverFolder] = useState<string | null>(null);
 const canDrop = (target: DropTarget) => {
  if (!dragItem || disabled) return false;
  if (dragItem.kind === 'note') {
   const note = notes.find(note => note.id === dragItem.id);
   return Boolean(note && note.category !== target.parent);
  }
  const from = dragItem.path;
  return target.path !== from && target.parent !== from && !target.parent.startsWith(`${from}/`) && (target.position !== 'inside' || target.parent !== from.split('/').slice(0, -1).join('/'));
 };
 const getTarget = (event: DragEvent<HTMLElement>, path: string): DropTarget => {
  if (path && dragItem?.kind === 'folder') {
   const bounds = event.currentTarget.getBoundingClientRect(), y = event.clientY - bounds.top;
   const position = y < 9 ? 'before' : y > bounds.height - 9 ? 'after' : 'inside';
   if (position !== 'inside') return { path, parent: path.split('/').slice(0, -1).join('/'), position };
  }
  return { path, parent: path, position: 'inside' };
 };
 const dragOver = (event: DragEvent<HTMLElement>, path: string) => {
  if (!dragItem) return;
  event.preventDefault(); event.stopPropagation();
  const target = getTarget(event, path), allowed = canDrop(target);
  event.dataTransfer.dropEffect = allowed ? 'move' : 'none';
  const next = allowed ? target : null;
  setDropTarget(previous => previous?.path === next?.path && previous?.position === next?.position ? previous : next);
  setHoverFolder(!disabled && target.position === 'inside' && (allowed || dragItem.kind === 'note') ? path : null);
 };
 const dragLeave = (event: DragEvent<HTMLElement>) => {
  if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) { setDropTarget(null); setHoverFolder(null); }
 };
 const drop = (event: DragEvent<HTMLElement>, path: string) => {
  if (!dragItem) return;
  event.preventDefault(); event.stopPropagation();
  const target = getTarget(event, path);
  if (canDrop(target) && matchesNoteDrag(event, dragItem)) {
   if (dragItem.kind === 'note') onMoveNote(dragItem.id, target.parent);
   else onMove(dragItem.path, target.parent, target.position === 'inside' ? undefined : { target: target.path, position: target.position });
  }
  onDragItemChange(null); setDropTarget(null); setHoverFolder(null);
 };
 useEffect(() => { if (!dragItem) { setDropTarget(null); setHoverFolder(null); } }, [dragItem]);
 useEffect(() => {
  if (!dragItem || !hoverFolder || !collapsed.has(hoverFolder)) return;
  const timer = setTimeout(() => onToggle(hoverFolder), 650);
  return () => clearTimeout(timer);
 }, [dragItem, hoverFolder, collapsed, onToggle]);
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
  const shouldReveal = previous.current.selectedFolder !== selectedFolder || previous.current.revealRequest !== revealRequest;
  const index = shouldReveal ? rows.findIndex(row => row.folder.path === selectedFolder) : -1;
  previous.current = { selectedFolder, revealRequest };
  if (index >= 0) {
   const top = index * ROW_HEIGHT;
   if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top;
  } else element.scrollTop = Math.min(element.scrollTop, Math.max(0, rows.length * ROW_HEIGHT - element.clientHeight));
  setViewport({ top: element.scrollTop, height: element.clientHeight });
 }, [selectedFolder, revealRequest, rows]);
 const start = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN);
 const end = Math.min(rows.length, Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN);
 return <div ref={container} className="note-tree virtual-note-tree" onKeyDown={keyboardContextMenu} onContextMenu={event => onContextMenu(event, { kind: 'blank' })} onScroll={e => setViewport({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
  <div className="note-tree-rows" style={{ height: rows.length * ROW_HEIGHT }}>
   {rows.slice(start, end).map((row, offset) => <div className={`note-tree-row folder-tree-row${dragItem?.kind === 'folder' && dragItem.path === row.folder.path ? ' dragging' : ''}${dropTarget?.path === row.folder.path ? dropTarget.position === 'inside' ? ' folder-drop-target' : ` folder-drop-${dropTarget.position}` : ''}`} key={row.folder.path} style={{ top: (start + offset) * ROW_HEIGHT, paddingLeft: row.depth * 12 }} onDragOver={event => dragOver(event, row.folder.path)} onDragLeave={dragLeave} onDrop={event => drop(event, row.folder.path)}>
    <button className={`folder-row ${selectedFolder === row.folder.path ? 'selected' : ''}`} aria-pressed={selectedFolder === row.folder.path} aria-expanded={row.folder.children.size > 0 ? !collapsed.has(row.folder.path) : undefined} title={row.folder.path} draggable={!disabled} onDragStart={event => startNoteDrag(event, { kind: 'folder', path: row.folder.path }, onDragItemChange)} onDragEnd={() => onDragItemChange(null)} onContextMenu={event => onContextMenu(event, { kind: 'folder', path: row.folder.path })} onClick={() => onSelect(row.folder.path)}>
     {(row.folder.children.size > 0 ? !collapsed.has(row.folder.path) : selectedFolder === row.folder.path) ? <FolderOpen size={16} /> : <Folder size={16} />}<span>{row.folder.name}</span><small>{row.folder.total}</small>
    </button>
   </div>)}
  </div>
  {dragItem !== null && <div className={`folder-root-drop${dropTarget?.path === '' ? ' folder-drop-target' : ''}`} onDragOver={event => dragOver(event, '')} onDragLeave={dragLeave} onDrop={event => drop(event, '')}><Folder size={15} />{dragItem.kind === 'note' ? '拖到此处移至未分类' : '拖到此处移至最外层'}</div>}
 </div>;
});
