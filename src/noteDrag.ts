import type { DragEvent } from 'react';

export type NoteDragItem = { kind: 'folder'; path: string } | { kind: 'note'; id: string };
export type NoteDragProps = {
 dragItem: NoteDragItem | null;
 onDragItemChange: (item: NoteDragItem | null) => void;
 disabled?: boolean;
};
const dragType = (item: NoteDragItem) => `application/x-fever-${item.kind}`;
export function startNoteDrag(event: DragEvent<HTMLElement>, item: NoteDragItem, onChange: NoteDragProps['onDragItemChange']) {
 event.dataTransfer.setData(dragType(item), item.kind === 'folder' ? item.path : item.id);
 event.dataTransfer.effectAllowed = 'move';
 onChange(item);
}
export function matchesNoteDrag(event: DragEvent<HTMLElement>, item: NoteDragItem) {
 return event.dataTransfer.getData(dragType(item)) === (item.kind === 'folder' ? item.path : item.id);
}
