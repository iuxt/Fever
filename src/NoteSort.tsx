import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import Select from './Select';
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
 const ascending = sort.direction === 'asc';
 const description = sort.field === 'title' ? (ascending ? '标题正序' : '标题倒序') : (ascending ? '最早在前' : '最新在前');
 return <div className="note-sort" aria-label="文件列表排序">
  <Select label="排序方式" value={sort.field} options={options} onChange={field => onChange({ field, direction: field === 'title' ? 'asc' : 'desc' })} />
  <button className="note-sort-direction" title={`${description}，点击切换为${ascending ? '降序' : '升序'}`} aria-label={ascending ? '切换为降序' : '切换为升序'} onClick={() => onChange({ ...sort, direction: ascending ? 'desc' : 'asc' })}>
   {ascending ? <ArrowUp size={14} /> : <ArrowDown size={14} />}<span>{ascending ? '升序' : '降序'}</span>
  </button>
 </div>;
}
