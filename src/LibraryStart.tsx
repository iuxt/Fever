import { useMemo } from 'react';
import { ArrowUpRight, FileText, Plus, Search, Shapes } from 'lucide-react';
import { displayNoteTitle, isDrawingNote } from './drawings';
import { modifier } from './ContextMenu';
import { sortNotes } from './NoteSort';
import type { Vault } from './types';

const date = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' });

export default function LibraryStart({ vault, onCreate, onSearch, onOpen }: {
 vault: Vault; onCreate: () => void; onSearch: () => void; onOpen: (id: string) => void;
}) {
 const recent = useMemo(() => sortNotes(vault.manifest.notes, { field: 'updatedAt', direction: 'desc' }).slice(0, 4), [vault.manifest.notes]);
 return <section className="library-start">
  <h1>{vault.name}</h1>
  <div className="library-actions">
   <button className="primary" onClick={onCreate}><Plus size={16} />新建笔记</button>
   <button className="secondary" onClick={onSearch}><Search size={15} />搜索笔记<kbd>{modifier}K</kbd></button>
  </div>
  {recent.length > 0 && <section className="recent-notes" aria-label="最近更新">
   <h2>最近更新</h2>
   {recent.map(note => <button key={note.id} onClick={() => onOpen(note.id)}>
    {isDrawingNote(note) ? <Shapes size={18} /> : <FileText size={18} />}
    <span><strong>{displayNoteTitle(note)}</strong><small>{note.category || '未分类'}</small></span>
    <time dateTime={note.updatedAt}>{Number.isFinite(Date.parse(note.updatedAt)) && date.format(new Date(note.updatedAt))}</time>
    <ArrowUpRight size={14} aria-hidden="true" />
   </button>)}
  </section>}
 </section>;
}
