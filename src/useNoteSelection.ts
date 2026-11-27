import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { keyboardContextMenu } from './ContextMenu';
import { startNoteDrag, type NoteDragProps } from './noteDrag';

export function useNoteSelection({ ids, activeId, scope, revealRequest, onSelect, onDragItemChange, disabled }: Pick<NoteDragProps, 'disabled' | 'onDragItemChange'> & {
 ids: string[]; activeId: string; scope?: string; revealRequest: number;
 onSelect?: (id: string) => void;
}) {
 const [chosen, setChosen] = useState({ scope, ids: new Set(activeId ? [activeId] : []) });
 const anchor = useRef<string | null>(activeId || null);
 const selectedIds = new Set(ids.filter(id => chosen.scope === scope ? chosen.ids.has(id) : id === activeId));
 const allSelected = ids.length > 0 && selectedIds.size === ids.length;
 useEffect(() => {
  setChosen({ scope, ids: new Set(activeId ? [activeId] : []) });
  anchor.current = activeId || null;
 }, [activeId, revealRequest, scope]);
 const choose = (next: Set<string>) => setChosen({ scope, ids: next });
 const clearSelection = () => { choose(new Set()); anchor.current = null; };
 const selectAll = () => {
  choose(new Set(ids));
  if (!anchor.current || !ids.includes(anchor.current)) anchor.current = ids[0] ?? null;
 };
 const selectNote = (id: string, event: MouseEvent<HTMLElement>) => {
  if (disabled) return;
  if (event.shiftKey) {
   const from = ids.indexOf(anchor.current ?? ''), to = ids.indexOf(id);
   const range = ids.slice(Math.min(from < 0 ? to : from, to), Math.max(from, to) + 1);
   choose(new Set(event.metaKey || event.ctrlKey ? [...selectedIds, ...range] : range));
   if (from < 0) anchor.current = id;
  } else if (event.metaKey || event.ctrlKey) {
   const next = new Set(selectedIds);
   if (next.has(id)) next.delete(id); else next.add(id);
   choose(next); anchor.current = id;
  } else {
   choose(new Set([id])); anchor.current = id; onSelect?.(id);
  }
 };
 const startDrag = (event: DragEvent<HTMLElement>, id: string) => {
  if (disabled) { event.preventDefault(); return; }
  const draggedIds = selectedIds.has(id) ? [...selectedIds] : [id];
  choose(new Set(draggedIds));
  startNoteDrag(event, { kind: 'note', ids: draggedIds }, onDragItemChange);
 };
 const keyDown = (event: KeyboardEvent<HTMLElement>) => {
  if (!disabled && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
   event.preventDefault(); event.stopPropagation(); selectAll();
  } else if (event.key === 'Escape') {
   event.preventDefault(); event.stopPropagation(); clearSelection();
  } else keyboardContextMenu(event);
 };
 const toggleAll = () => allSelected ? choose(new Set()) : selectAll();
 return { selectedIds, allSelected, toggleAll, clearSelection, selectNote, startDrag, keyDown };
}
