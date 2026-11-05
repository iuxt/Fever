import type { DragEvent } from 'react';

export type NoteDragItem = { kind: 'folder'; path: string } | { kind: 'note'; ids: string[] };
export type NoteDragProps = {
 dragItem: NoteDragItem | null;
 onDragItemChange: (item: NoteDragItem | null) => void;
 disabled?: boolean;
};
const dragType = (item: NoteDragItem) => `application/x-fever-${item.kind}`;
const dragData = (item: NoteDragItem) => item.kind === 'folder' ? item.path : JSON.stringify(item.ids);
export function startNoteDrag(event: DragEvent<HTMLElement>, item: NoteDragItem, onChange: NoteDragProps['onDragItemChange']) {
 event.dataTransfer.setData(dragType(item), dragData(item));
 event.dataTransfer.effectAllowed = 'move';
 onChange(item);
}
export function matchesNoteDrag(event: DragEvent<HTMLElement>, item: NoteDragItem) {
 return event.dataTransfer.getData(dragType(item)) === dragData(item);
}
