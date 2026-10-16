import { memo, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { FileText, Shapes } from 'lucide-react';
import { isDrawingNote } from './drawings';
import { keyboardContextMenu } from './ContextMenu';
import type { NoteTreeTarget } from './NoteTree';
import type { Api, Note } from './types';

const ROW_HEIGHT = 126, OVERSCAN = 3;
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
type Props = {
 notes: Note[]; activeId: string; scope: string; api: Api; draftId: string; draft: string;
 onSelect: (id: string) => void;
 onContextMenu: (event: MouseEvent<HTMLElement>, target: NoteTreeTarget) => void;
};
type PreviewCache = Map<string, { updatedAt: string; text: string }>;
const NoteCard = memo(function NoteCard({ note, active, draft, api, cache, onSelect, onContextMenu }: {
 note: Note; active: boolean; draft?: string; api: Api; cache: PreviewCache;
 onSelect: Props['onSelect']; onContextMenu: Props['onContextMenu'];
}) {
 const [preview, setPreview] = useState('');
 const drawing = isDrawingNote(note);
 useEffect(() => {
  if (drawing || draft !== undefined) return;
  const cached = cache.get(note.id);
  if (cached?.updatedAt === note.updatedAt) { setPreview(cached.text); return; }
  let cancelled = false;
  setPreview('');
  api.read(note.id).then(value => {
   if (cancelled) return;
   const text = summary(value);
   cache.delete(note.id); cache.set(note.id, { updatedAt: note.updatedAt, text });
   if (cache.size > 120) cache.delete(cache.keys().next().value!);
   setPreview(text);
  }).catch(() => { if (!cancelled) setPreview('暂时无法预览，点击打开笔记'); });
  return () => { cancelled = true; };
 }, [note.id, note.updatedAt, drawing, draft, api, cache]);
 return <button className={`note-row note-card ${active ? 'selected' : ''}`} aria-pressed={active} title={note.title} onClick={() => onSelect(note.id)} onContextMenu={event => onContextMenu(event, { kind: 'note', note })}>
  <span className="note-card-title">{drawing ? <Shapes size={15} /> : <FileText size={15} />}<strong>{note.title}</strong>{active && <span className="selected-dot" />}</span>
  <span className="note-card-preview">{drawing ? 'Excalidraw 绘图 · 点击打开画布' : draft !== undefined ? summary(draft) || '还没有正文，写下第一个想法…' : preview || '还没有正文，写下第一个想法…'}</span>
  <span className="note-card-meta"><time dateTime={note.updatedAt}>{date(note.updatedAt)}</time><span>{note.category.split('/').join(' / ') || '未分类'}</span></span>
 </button>;
});

export default function NoteList({ notes, activeId, scope, api, draftId, draft, onSelect, onContextMenu }: Props) {
 const container = useRef<HTMLDivElement>(null), cache = useRef<PreviewCache>(new Map());
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
  const element = container.current!, index = notes.findIndex(note => note.id === activeId);
  if (index >= 0) {
   const top = index * ROW_HEIGHT;
   if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = top;
  }
  setViewport({ top: element.scrollTop, height: element.clientHeight });
 }, [activeId, notes]);
 const start = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN);
 const end = Math.min(notes.length, Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN);
 return <div ref={container} className="note-tree note-list" aria-label="文件列表" onKeyDown={keyboardContextMenu} onContextMenu={event => onContextMenu(event, { kind: 'blank' })} onScroll={event => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>
  <div className="note-list-rows" style={{ height: notes.length * ROW_HEIGHT }}>
   {notes.slice(start, end).map((note, offset) => <div className="note-list-row" key={note.id} style={{ top: (start + offset) * ROW_HEIGHT }}><NoteCard note={note} active={note.id === activeId} draft={note.id === draftId ? draft : undefined} api={api} cache={cache.current} onSelect={onSelect} onContextMenu={onContextMenu} /></div>)}
  </div>
 </div>;
}
