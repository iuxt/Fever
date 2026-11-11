import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDownWideNarrow, ArrowUpWideNarrow, Check } from 'lucide-react';
import type { Note } from './types';

type SortField = 'updatedAt' | 'createdAt' | 'title';
type Sort = { field: SortField; direction: 'asc' | 'desc' };
const storageKey = 'fever-note-sort';
const options: { value: SortField; label: string }[] = [
 { value: 'updatedAt', label: '更新时间' },
 { value: 'createdAt', label: '创建时间' },
 { value: 'title', label: '标题' },
];
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export function useNoteSort() {
 const [sort, setSort] = useState<Sort>(() => {
  try {
   const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
   if (saved && options.some(option => option.value === saved.field) && ['asc', 'desc'].includes(saved.direction)) return { field: saved.field, direction: saved.direction };
  } catch { /* Use the default when storage is unavailable or invalid. */ }
  return { field: 'updatedAt', direction: 'desc' };
 });
 useEffect(() => {
  try { localStorage.setItem(storageKey, JSON.stringify(sort)); }
  catch { /* Sorting remains available without persistent storage. */ }
 }, [sort]);
 return [sort, setSort] as const;
}

export function sortNotes(notes: Note[], { field, direction }: Sort) {
 const multiplier = direction === 'asc' ? 1 : -1;
 return [...notes].sort((a, b) => multiplier * (field === 'title'
  ? collator.compare(a.title, b.title)
  : (Date.parse(a[field]) || 0) - (Date.parse(b[field]) || 0)));
}

export default function NoteSort({ sort, onChange }: { sort: Sort; onChange: (sort: Sort) => void }) {
 const [open, setOpen] = useState(false);
 const container = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
 const id = useId();
 const ascending = sort.direction === 'asc';
 const description = sort.field === 'title' ? (ascending ? '标题正序' : '标题倒序') : (ascending ? '最早在前' : '最新在前');
 const currentLabel = `${options.find(option => option.value === sort.field)?.label} · ${description}`;
 useEffect(() => {
  if (!open) return;
  menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
  document.addEventListener('pointerdown', outside);
  return () => document.removeEventListener('pointerdown', outside);
 }, [open]);
 const close = () => { setOpen(false); trigger.current?.focus(); };
 const choose = (next: Sort) => { onChange(next); close(); };
 return <div className="note-sort" ref={container} data-select-open={open} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => {
  if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
 }}>
  <button ref={trigger} className="note-sort-trigger" aria-label="排序方式" title={`排序：${currentLabel}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
   onClick={() => setOpen(value => !value)} onKeyDown={event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
   }}>
   {ascending ? <ArrowUpWideNarrow size={16} /> : <ArrowDownWideNarrow size={16} />}
  </button>
  {open && <div ref={menu} id={id} className="note-sort-menu" role="menu" aria-label="文件列表排序" onKeyDown={event => {
   if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
   event.preventDefault(); event.stopPropagation();
   const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
   const index = items.indexOf(document.activeElement as HTMLButtonElement);
   const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
   items[next]?.focus();
  }}>
   <div role="group" aria-labelledby={`${id}-field`}>
    <div className="note-sort-label" id={`${id}-field`}>排序方式</div>
    {options.map(option => <button key={option.value} role="menuitemradio" tabIndex={-1} aria-checked={sort.field === option.value} onClick={() => choose({ field: option.value, direction: option.value === sort.field ? sort.direction : option.value === 'title' ? 'asc' : 'desc' })}>
     <span>{option.label}</span>{sort.field === option.value && <Check size={14} />}
    </button>)}
   </div>
   <div className="note-sort-order" role="group" aria-labelledby={`${id}-order`}>
    <div className="note-sort-label" id={`${id}-order`}>排列顺序</div>
    {(['desc', 'asc'] as const).map(direction => <button key={direction} role="menuitemradio" tabIndex={-1} aria-checked={sort.direction === direction} onClick={() => choose({ ...sort, direction })}>
     <span>{sort.field === 'title' ? (direction === 'asc' ? '标题正序' : '标题倒序') : (direction === 'asc' ? '最早在前' : '最新在前')}</span>{sort.direction === direction && <Check size={14} />}
    </button>)}
   </div>
  </div>}
 </div>;
}
