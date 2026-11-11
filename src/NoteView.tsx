import { useEffect, useState } from 'react';

export type NoteViewMode = 'title' | 'preview';
const storageKey = 'fever-note-view';

export function useNoteView() {
 const [view, setView] = useState<NoteViewMode>(() => {
  try { return localStorage.getItem(storageKey) === 'title' ? 'title' : 'preview'; }
  catch { return 'preview'; }
 });
 useEffect(() => {
  try { localStorage.setItem(storageKey, view); }
  catch { /* Switching remains available without persistent storage. */ }
 }, [view]);
 return [view, setView] as const;
}

export default function NoteView({ view, onChange }: { view: NoteViewMode; onChange: (view: NoteViewMode) => void }) {
 return <div className="note-view-switch" role="group" aria-label="文件展示方式">
  <button title="仅显示标题" aria-pressed={view === 'title'} onClick={() => onChange('title')}>仅标题</button>
  <button title="显示正文预览" aria-pressed={view === 'preview'} onClick={() => onChange('preview')}>预览</button>
 </div>;
}
