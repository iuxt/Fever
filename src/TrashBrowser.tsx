import { useEffect, useState, type MouseEvent } from 'react';
import { ChevronLeft, ChevronRight, FileText, History, Shapes, Trash2 } from 'lucide-react';
import { keyboardContextMenu } from './ContextMenu';
import { isDrawingNote } from './drawings';
import type { Note } from './types';

const PAGE_SIZE = 20;

export default function TrashBrowser({ notes, query, activeId, busy, onSelect, onRestore, onContextMenu }: {
 notes: Note[]; query: string; activeId: string; busy: boolean;
 onSelect: (id: string) => void; onRestore: (note: Note) => void;
 onContextMenu: (event: MouseEvent<HTMLElement>, note: Note) => void;
}) {
 const [requestedPage, setPage] = useState(1);
 const pages = Math.max(1, Math.ceil(notes.length / PAGE_SIZE));
 const page = Math.min(requestedPage, pages);
 useEffect(() => { setPage(1); }, [query]);
 useEffect(() => { setPage(previous => Math.min(previous, pages)); }, [pages]);
 return <section className="trash-browser" aria-label="回收站文件列表">
  <div className="trash-results">
   <ul className="trash-list">{notes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(note => <li className={`trash-item ${activeId === note.id ? 'selected' : ''}`} key={note.id}>
    <button className="trash-note" onKeyDown={keyboardContextMenu} onContextMenu={event => onContextMenu(event, note)} onClick={() => onSelect(note.id)} title={`${note.title}\n原位置：${note.category || '未分类'}`}>
     {isDrawingNote(note) ? <Shapes size={16} /> : <FileText size={16} />}<span><strong>{note.title}</strong><small>{note.category || '未分类'}</small></span>
    </button>
    <button className="icon-button" aria-label={`恢复：${note.title}`} title="还原到原位置" disabled={busy} onClick={() => onRestore(note)}><History size={15} /></button>
   </li>)}</ul>
   {!notes.length && <div className="trash-empty"><Trash2 size={28} /><span>{query.trim() ? '没有找到相关笔记' : '回收站是空的'}</span></div>}
  </div>
  <nav className="trash-pagination" aria-label="回收站分页">
   <span>共 {notes.length} 篇</span><div>
    <button className="icon-button" aria-label="上一页" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={15} /></button>
    <span aria-live="polite">{page} / {pages}</span>
    <button className="icon-button" aria-label="下一页" disabled={page === pages} onClick={() => setPage(page + 1)}><ChevronRight size={15} /></button>
   </div>
  </nav>
 </section>;
}
