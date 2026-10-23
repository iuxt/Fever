import { memo, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { FileText, Shapes } from 'lucide-react';
import { isDrawingNote } from './drawings';
import { keyboardContextMenu } from './ContextMenu';
import type { NoteTreeTarget } from './NoteTree';
import type { Api, Note } from './types';
import type { NoteViewMode } from './NoteView';
import { startNoteDrag, type NoteDragProps } from './noteDrag';

const ROW_HEIGHT = { title: 42, preview: 126 }, OVERSCAN = 3;
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
 notes: Note[]; activeId: string; scope: string; view: NoteViewMode; api: Api; draftId: string; draft: string; revealRequest?: number;
 onSelect: (id: string) => void;
 onContextMenu: (event: MouseEvent<HTMLElement>, target: NoteTreeTarget) => void;
};
type PreviewCache = Map<string, { updatedAt: string; text: string }>;
const NoteCard = memo(function NoteCard({ note, active, draft, view, api, cache, onSelect, onContextMenu, dragItem, onDragItemChange, disabled }: NoteDragProps & {
 note: Note; active: boolean; draft?: string; view: NoteViewMode; api: Api; cache: PreviewCache;
 onSelect: Props['onSelect']; onContextMenu: Props['onContextMenu'];
}) {
 const [preview, setPreview] = useState('');
 const drawing = isDrawingNote(note);
 useEffect(() => {
  if (view === 'title' || drawing || draft !== undefined) return;
  const cached = cache.get(note.id);
  if (cached?.updatedAt === note.updatedAt) { setPreview(cached.text); return; }
  let cancelled = false;
  const requestId = crypto.randomUUID();
  setPreview('');
  (api.preview ? api.preview(note.id, requestId) : api.read(note.id)).then(value => {
   if (cancelled) return;
   const text = summary(value);
   cache.delete(note.id); cache.set(note.id, { updatedAt: note.updatedAt, text });
   if (cache.size > 120) cache.delete(cache.keys().next().value!);
   setPreview(text);
  }).catch(() => { if (!cancelled) setPreview('暂时无法预览，点击打开笔记'); });
  return () => { cancelled = true; void api.cancelPreview?.(requestId).catch(() => {}); };
 }, [note.id, note.updatedAt, drawing, draft, view, api, cache]);
 return <button className={`note-row note-card ${active ? 'selected' : ''}${dragItem?.kind === 'note' && dragItem.id === note.id ? ' dragging' : ''}`} aria-pressed={active} title={note.title} draggable={!disabled} onDragStart={event => startNoteDrag(event, { kind: 'note', id: note.id }, onDragItemChange)} onDragEnd={() => onDragItemChange(null)} onClick={() => onSelect(note.id)} onContextMenu={event => onContextMenu(event, { kind: 'note', note })}>
  <span className="note-card-title">{drawing ? <Shapes size={15} /> : <FileText size={15} />}<strong>{note.title}</strong>{active && <span className="selected-dot" />}</span>
  {view === 'preview' && <><span className="note-card-preview">{drawing ? 'Excalidraw 绘图 · 点击打开画布' : draft !== undefined ? summary(draft) || '还没有正文，写下第一个想法…' : preview || '还没有正文，写下第一个想法…'}</span>
  <span className="note-card-meta"><time dateTime={note.updatedAt}>{date(note.updatedAt)}</time><span>{note.category.split('/').join(' / ') || '未分类'}</span></span></>}
 </button>;
});

export default function NoteList({ notes, activeId, scope, view, api, draftId, draft, onSelect, onContextMenu, revealRequest = 0, dragItem, onDragItemChange, disabled }: Props) {
 const rowHeight = ROW_HEIGHT[view];
 const container = useRef<HTMLDivElement>(null), cache = useRef<PreviewCache>(new Map());
 const selection = useRef<{ activeId: string; revealRequest: number; scope: string } | null>(null);
 const [viewport, setViewport] = useState({ top: 0, height: 600 });
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
  const changed = selection.current?.activeId !== activeId || selection.current?.revealRequest !== revealRequest || selection.current?.scope !== scope;
  selection.current = { activeId, revealRequest, scope };
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
 return <div ref={container} className={`note-tree note-list note-list-${view}`} aria-label="文件列表" onKeyDown={keyboardContextMenu} onContextMenu={event => onContextMenu(event, { kind: 'blank' })} onScroll={event => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>
  <div className="note-list-rows" style={{ height: notes.length * rowHeight }}>
   {notes.slice(start, end).map((note, offset) => <div className="note-list-row" key={note.id} style={{ top: (start + offset) * rowHeight, height: rowHeight }}><NoteCard note={note} active={note.id === activeId} draft={note.id === draftId ? draft : undefined} view={view} api={api} cache={cache.current} onSelect={onSelect} onContextMenu={onContextMenu} dragItem={dragItem} onDragItemChange={onDragItemChange} disabled={disabled} /></div>)}
  </div>
 </div>;
}
