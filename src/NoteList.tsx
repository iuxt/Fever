import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { FileText, Shapes } from 'lucide-react';
import { displayNoteTitle, isDrawingNote } from './drawings';
import { modifier } from './ContextMenu';
import type { NoteTreeTarget } from './NoteTree';
import type { Api, Note } from './types';
import type { NoteViewMode } from './NoteView';
import type { NoteDragProps } from './noteDrag';
import { useNoteSelection } from './useNoteSelection';

const OVERSCAN = 3;
const date = (value: string) => new Date(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
// Limit parsing work and retain only small text summaries, never entire documents.
function summary(markdown: string) {
 return markdown.slice(0, 8192)
  .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
  .replace(/```[^\n]*\n[\s\S]*?(?:```|$)/g, ' ')
  .replace(/^\s*#{1,6}[^\S\n]+([^\n]*)\n?/, (heading, title, _offset, source) => source.slice(heading.length).trim() ? '' : title)
  .replace(/^\s*#{1,6}[^\S\n]+/gm, '')
  .replace(/!\[([^\]]*)\]\([^)]*\)|!\[\[[^\]]*\]\]/g, ' [图片] ')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/<[^>]*>/g, '')
  .replace(/(^|\n)\s*(?:[-*+>]\s*|\d+\.\s*|\[[ xX]\]\s*)+/g, ' ')
  .replace(/[*_`~|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 150);
}
type Props = NoteDragProps & {
 fontSize: number; notes: Note[]; activeId: string; scope: string; selectionScope: string; view: NoteViewMode; api: Api; draftId: string; draft: string; revealRequest?: number;
 onSelect: (id: string) => void;
 onContextMenu: (event: MouseEvent<HTMLElement>, target: NoteTreeTarget) => void;
};
type PreviewCache = Map<string, { updatedAt: string; text: string }>;
const NoteCard = memo(function NoteCard({ note, active, selected, draft, view, api, cache, onSelect, onStartDrag, onContextMenu, dragItem, onDragItemChange, disabled }: NoteDragProps & {
 note: Note; active: boolean; selected: boolean; draft?: string; view: NoteViewMode; api: Api; cache: PreviewCache;
 onSelect: (id: string, event: MouseEvent<HTMLElement>) => void;
 onStartDrag: (event: DragEvent<HTMLElement>, id: string) => void; onContextMenu: Props['onContextMenu'];
}) {
 const [preview, setPreview] = useState<string | null>(null);
 const drawing = isDrawingNote(note);
 const title = displayNoteTitle(note);
 useEffect(() => {
  if (view === 'title' || drawing || draft !== undefined) return;
  const cached = cache.get(note.id);
  if (cached?.updatedAt === note.updatedAt) { setPreview(cached.text); return; }
  let cancelled = false;
  const requestId = crypto.randomUUID();
  setPreview(null);
  (api.preview ? api.preview(note.id, requestId) : api.read(note.id)).then(value => {
   if (cancelled) return;
   const text = summary(value);
   cache.delete(note.id); cache.set(note.id, { updatedAt: note.updatedAt, text });
   if (cache.size > 120) cache.delete(cache.keys().next().value!);
   setPreview(text);
  }).catch(() => { if (!cancelled) setPreview('暂时无法预览，点击打开笔记'); });
  return () => { cancelled = true; void api.cancelPreview?.(requestId).catch(() => {}); };
 }, [note.id, note.updatedAt, drawing, draft, view, api, cache]);
 return <button className={`note-row note-card ${selected ? 'selected' : ''}${dragItem?.kind === 'note' && dragItem.ids.includes(note.id) ? ' dragging' : ''}`} aria-pressed={selected} aria-current={active ? 'page' : undefined} title={title} draggable={!disabled} onDragStart={event => onStartDrag(event, note.id)} onDragEnd={() => onDragItemChange(null)} onClick={event => onSelect(note.id, event)} onContextMenu={event => onContextMenu(event, { kind: 'note', note })}>
  <span className="note-card-title">{drawing ? <Shapes size={15} /> : <FileText size={15} />}<strong>{title}</strong></span>
  {view === 'preview' && <><span className="note-card-preview">{drawing ? 'Excalidraw 绘图' : draft !== undefined ? summary(draft) || '暂无正文' : preview === null ? '' : preview || '暂无正文'}</span>
  <span className="note-card-meta"><time dateTime={note.updatedAt}>{date(note.updatedAt)}</time><span>{note.category.split('/').join(' / ') || '未分类'}</span></span></>}
 </button>;
});

export default function NoteList({ fontSize, notes, activeId, scope, selectionScope, view, api, draftId, draft, onSelect, onContextMenu, revealRequest = 0, dragItem, onDragItemChange, disabled }: Props) {
 // Card padding/gaps plus title, two preview lines and metadata at the active font size.
 const rowHeight = view === 'title' ? Math.max(42, Math.ceil(fontSize * 1.5 + 14)) : Math.ceil(fontSize * 5 + 28);
 const container = useRef<HTMLDivElement>(null), cache = useRef<PreviewCache>(new Map());
 const selection = useRef<{ activeId: string; revealRequest: number; scope: string; rowHeight: number } | null>(null);
 const [viewport, setViewport] = useState({ top: 0, height: 600 });
 const ids = useMemo(() => notes.map(note => note.id), [notes]);
 const { selectedIds, allSelected, toggleAll, clearSelection, selectNote, startDrag, keyDown } = useNoteSelection({ ids, activeId, scope: selectionScope, revealRequest, onSelect, onDragItemChange, disabled });
 useLayoutEffect(() => {
  const element = container.current!;
  const update = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
  const observer = new ResizeObserver(update); observer.observe(element); update();
  return () => observer.disconnect();
 }, []);
 useLayoutEffect(() => {
  const element = container.current!; element.scrollTop = 0;
  setViewport({ top: 0, height: element.clientHeight });
 }, [scope]);
 useLayoutEffect(() => {
  const changed = selection.current?.activeId !== activeId || selection.current?.revealRequest !== revealRequest || selection.current?.scope !== scope || selection.current?.rowHeight !== rowHeight;
  selection.current = { activeId, revealRequest, scope, rowHeight };
  if (!changed) return;
  const element = container.current!, index = notes.findIndex(note => note.id === activeId);
  if (index >= 0) {
   const top = index * rowHeight;
   if (top < element.scrollTop || top + rowHeight > element.scrollTop + element.clientHeight) element.scrollTop = top;
  }
  setViewport({ top: element.scrollTop, height: element.clientHeight });
 }, [activeId, notes, scope, revealRequest, rowHeight]);
 const start = Math.max(0, Math.floor(viewport.top / rowHeight) - OVERSCAN);
 const end = Math.min(notes.length, Math.ceil((viewport.top + viewport.height) / rowHeight) + OVERSCAN);
 return <><div className="note-selection-bar" role="group" aria-label="文件选择" onKeyDown={keyDown}>
  <label title={`${modifier}A 全选 · ${modifier}点击多选 · Shift 点击连选`}><input type="checkbox" aria-label="全选当前列表" aria-keyshortcuts="Meta+A Control+A" checked={allSelected} ref={element => { if (element) element.indeterminate = selectedIds.size > 0 && !allSelected; }} disabled={disabled} onChange={toggleAll} /><span>全选</span></label>
  <span role="status">已选 {selectedIds.size} 项</span>
  {selectedIds.size > 0 && <button disabled={disabled} onClick={clearSelection}>取消选择</button>}
 </div><div ref={container} className={`note-tree note-list note-list-${view}`} style={{ '--note-row-height': `${rowHeight}px` } as import('react').CSSProperties} aria-label="文件列表" tabIndex={0} onKeyDown={keyDown} onContextMenu={event => onContextMenu(event, { kind: 'blank' })} onScroll={event => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>
  <div className="note-list-rows" style={{ height: notes.length * rowHeight }}>
   {notes.slice(start, end).map((note, offset) => <div className="note-list-row" key={note.id} style={{ top: (start + offset) * rowHeight, height: rowHeight }}><NoteCard note={note} active={note.id === activeId} selected={selectedIds.has(note.id)} draft={note.id === draftId ? draft : undefined} view={view} api={api} cache={cache.current} onSelect={selectNote} onStartDrag={startDrag} onContextMenu={onContextMenu} dragItem={dragItem} onDragItemChange={onDragItemChange} disabled={disabled} /></div>)}
  </div>
 </div></>;
}
