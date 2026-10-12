import { Table, TableView } from '@tiptap/extension-table';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { CellSelection, TableMap, addColumnBefore, addColumnAfter, addRowBefore, addRowAfter, moveTableColumn, moveTableRow } from '@tiptap/pm/tables';

type Axis = 'row' | 'column';
type Line = { axis: Axis; index: number };
type Drag = Line & { x: number; y: number; moving: boolean; boundary: number | null; doc: ProseMirrorNode };

// Controls live outside contentDOM so they never enter the document or clipboard.
class InteractiveTableView extends TableView {
 private controls = document.createElement('div');
 private insert = document.createElement('button');
 private marker = document.createElement('div');
 private handles: HTMLButtonElement[] = [];
 private columns: number[] = [];
 private rows: number[] = [];
 private selected: Line | null = null;
 private insertion: Line | null = null;
 private drag: Drag | null = null;
 private frame = 0;
 private observer: ResizeObserver;

 constructor(node: ProseMirrorNode, private editor: Editor, private getPos: () => number | undefined) {
  super(node, 70, editor.view);
  this.dom.classList.add('interactive-table');
  this.controls.className = 'table-controls';
  this.controls.contentEditable = 'false';
  this.insert.type = 'button';
  this.insert.className = 'table-insert';
  this.insert.textContent = '+';
  this.insert.hidden = true;
  this.marker.className = 'table-drop-marker';
  this.marker.hidden = true;
  this.controls.append(this.insert, this.marker);
  this.dom.append(this.controls);
  this.insert.addEventListener('pointerdown', event => event.preventDefault());
  this.insert.addEventListener('click', this.insertAtBoundary);
  this.dom.addEventListener('pointermove', this.hover);
  this.dom.addEventListener('pointerleave', this.leave);
  this.dom.addEventListener('pointerdown', this.startFromCell);
  this.editor.on('selectionUpdate', this.syncSelection);
  this.editor.on('transaction', this.syncSelection);
  this.observer = new ResizeObserver(this.scheduleLayout);
  this.observer.observe(this.table);
  this.rebuildHandles();
 }

 private button(axis: Axis, index: number) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `table-handle table-${axis}-handle`;
  button.setAttribute('aria-label', `选中第 ${index + 1} ${axis === 'row' ? '行' : '列'}`);
  button.title = `选中并拖动第 ${index + 1} ${axis === 'row' ? '行' : '列'}`;
  button.textContent = axis === 'row' ? '⋮' : '⋯';
  button.addEventListener('pointerdown', event => this.startDrag(event, { axis, index }));
  button.addEventListener('click', () => { this.select({ axis, index }); this.editor.view.focus(); });
  this.controls.append(button);
  return button;
 }

 private rebuildHandles() {
  this.handles.forEach(handle => handle.remove());
  const map = TableMap.get(this.node);
  this.handles = [
   ...Array.from({ length: map.width }, (_, index) => this.button('column', index)),
   ...Array.from({ length: map.height }, (_, index) => this.button('row', index)),
  ];
  this.hideInsert();
  this.scheduleLayout();
 }

 private scheduleLayout = () => {
  cancelAnimationFrame(this.frame);
  this.frame = requestAnimationFrame(() => { this.layout(); this.syncSelection(); });
 };

 private layout() {
  const origin = this.dom.getBoundingClientRect();
  const table = this.table.getBoundingClientRect();
  const firstRow = this.table.rows[0];
  if (!firstRow) return;
  this.columns = [table.left - origin.left, ...Array.from(firstRow.cells, cell => cell.getBoundingClientRect().right - origin.left)];
  this.rows = [table.top - origin.top, ...Array.from(this.table.rows, row => row.getBoundingClientRect().bottom - origin.top)];
  const width = this.columns.length - 1;
  this.handles.forEach((handle, index) => {
   const column = index < width;
   const i = column ? index : index - width;
   handle.style.left = `${column ? (this.columns[i] + this.columns[i + 1]) / 2 : this.columns[0] - 14}px`;
   handle.style.top = `${column ? this.rows[0] - 14 : (this.rows[i] + this.rows[i + 1]) / 2}px`;
  });
 }

 private select(line: Line) {
  const pos = this.getPos();
  if (pos === undefined) return;
  const map = TableMap.get(this.node);
  const start = pos + 1;
  const first = line.axis === 'row' ? line.index * map.width : line.index;
  const last = line.axis === 'row' ? first + map.width - 1 : (map.height - 1) * map.width + line.index;
  const selection = new CellSelection(this.editor.state.doc.resolve(start + map.map[first]), this.editor.state.doc.resolve(start + map.map[last]));
  this.selected = line;
  this.editor.view.dispatch(this.editor.state.tr.setSelection(selection));
  this.syncSelection();
 }

 private syncSelection = () => {
  const selection = this.editor.state.selection;
  const pos = this.getPos();
  if (selection instanceof CellSelection && pos !== undefined && selection.$anchorCell.start(-1) === pos + 1) {
   const map = TableMap.get(this.node);
   const rect = map.rectBetween(selection.$anchorCell.pos - pos - 1, selection.$headCell.pos - pos - 1);
   // Remember the handle's axis for one-cell and single-row/column tables.
   if (rect.bottom - rect.top === 1 && rect.left === 0 && rect.right === map.width && this.selected?.axis !== 'column') this.selected = { axis: 'row', index: rect.top };
   else if (rect.right - rect.left === 1 && rect.top === 0 && rect.bottom === map.height) this.selected = { axis: 'column', index: rect.left };
   else if (rect.bottom - rect.top === 1 && rect.left === 0 && rect.right === map.width) this.selected = { axis: 'row', index: rect.top };
   else this.selected = null;
  } else this.selected = null;
  this.dom.classList.toggle('table-axis-selected', !!this.selected);
  const width = TableMap.get(this.node).width;
  this.handles.forEach((handle, i) => handle.setAttribute('aria-pressed', String(!!this.selected && (i < width ? this.selected.axis === 'column' && this.selected.index === i : this.selected.axis === 'row' && this.selected.index === i - width))));
 };

 private startFromCell = (event: PointerEvent) => {
  const cell = (event.target as HTMLElement).closest('td, th');
  if (this.selected && cell?.classList.contains('selectedCell') && cell.closest('table') === this.table) this.startDrag(event, this.selected);
 };

 private startDrag(event: PointerEvent, line: Line) {
  if (event.button !== 0 || !this.editor.isEditable) return;
  event.preventDefault();
  this.select(line);
  this.hideInsert();
  this.layout();
  this.drag = { ...line, x: event.clientX, y: event.clientY, moving: false, boundary: null, doc: this.editor.state.doc };
  document.addEventListener('pointermove', this.moveDrag);
  document.addEventListener('pointerup', this.endDrag);
  document.addEventListener('pointercancel', this.cancelDrag);
  document.addEventListener('keydown', this.escapeDrag);
  window.addEventListener('blur', this.cancelDrag);
 }

 private moveDrag = (event: PointerEvent) => {
  const drag = this.drag;
  if (!drag) return;
  if (!this.editor.state.doc.eq(drag.doc)) { this.cancelDrag(); return; }
  if (!drag.moving && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5) return;
  drag.moving = true;
  this.dom.classList.add('table-dragging');
  document.body.classList.add('table-drag-active');
  const box = this.table.getBoundingClientRect();
  if (event.clientX < box.left - 40 || event.clientX > box.right + 40 || event.clientY < box.top - 40 || event.clientY > box.bottom + 40) {
   drag.boundary = null; this.marker.hidden = true; return;
  }
  this.layout();
  const origin = this.dom.getBoundingClientRect();
  const boundaries = drag.axis === 'row' ? this.rows : this.columns;
  const coordinate = drag.axis === 'row' ? event.clientY - origin.top : event.clientX - origin.left;
  drag.boundary = boundaries.reduce((best, value, index) => Math.abs(value - coordinate) < Math.abs(boundaries[best] - coordinate) ? index : best, 0);
  this.showMarker({ axis: drag.axis, index: drag.boundary });
 };

 private showMarker(line: Line) {
  const row = line.axis === 'row';
  this.marker.hidden = false;
  this.marker.className = `table-drop-marker ${row ? 'horizontal' : 'vertical'}`;
  this.marker.style.left = `${row ? this.columns[0] : this.columns[line.index]}px`;
  this.marker.style.top = `${row ? this.rows[line.index] : this.rows[0]}px`;
  this.marker.style.width = `${row ? this.columns.at(-1)! - this.columns[0] : 2}px`;
  this.marker.style.height = `${row ? 2 : this.rows.at(-1)! - this.rows[0]}px`;
 }

 private endDrag = () => {
  const drag = this.drag;
  this.cancelDrag();
  if (!drag?.moving || drag.boundary === null || !this.editor.state.doc.eq(drag.doc)) return;
  const to = drag.boundary > drag.index ? drag.boundary - 1 : drag.boundary;
  if (to === drag.index) return;
  const command = drag.axis === 'row' ? moveTableRow : moveTableColumn;
  this.selected = { axis: drag.axis, index: to };
  command({ from: drag.index, to })(this.editor.state, this.editor.view.dispatch);
  this.editor.view.focus();
 };

 private escapeDrag = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); this.cancelDrag(); } };
 private cancelDrag = () => {
  this.drag = null;
  this.marker.hidden = true;
  this.dom.classList.remove('table-dragging');
  document.body.classList.remove('table-drag-active');
  document.removeEventListener('pointermove', this.moveDrag);
  document.removeEventListener('pointerup', this.endDrag);
  document.removeEventListener('pointercancel', this.cancelDrag);
  document.removeEventListener('keydown', this.escapeDrag);
  window.removeEventListener('blur', this.cancelDrag);
 };

 private hover = (event: PointerEvent) => {
  if (this.drag || !this.editor.isEditable || this.controls.contains(event.target as Node)) return;
  const origin = this.dom.getBoundingClientRect();
  const x = event.clientX - origin.left, y = event.clientY - origin.top;
  const nearest = (values: number[], coordinate: number) => values.findIndex(value => Math.abs(value - coordinate) <= 5);
  const column = nearest(this.columns, x), row = nearest(this.rows, y);
  let line: Line | null = null;
  if (column >= 0 && y >= this.rows[0] && y <= this.rows.at(-1)!) line = { axis: 'column', index: column };
  else if (row >= 0 && x >= this.columns[0] && x <= this.columns.at(-1)!) line = { axis: 'row', index: row };
  if (!line) { this.hideInsert(); return; }
  this.insertion = line;
  this.insert.hidden = false;
  this.insert.style.left = `${line.axis === 'column' ? this.columns[column] : x}px`;
  this.insert.style.top = `${line.axis === 'row' ? this.rows[row] : y}px`;
  const name = line.axis === 'column' ? '列' : '行';
  const label = `在第 ${line.index + 1} ${name}前插入${name}`;
  this.insert.setAttribute('aria-label', label);
  this.insert.title = `插入${name}`;
 };
 private leave = () => { if (!this.drag) this.hideInsert(); };
 private hideInsert() { this.insert.hidden = true; this.insertion = null; }

 private insertAtBoundary = () => {
  const line = this.insertion;
  if (!line) return;
  const count = line.axis === 'row' ? TableMap.get(this.node).height : TableMap.get(this.node).width;
  this.select({ axis: line.axis, index: Math.min(line.index, count - 1) });
  const after = line.index === count;
  const command = line.axis === 'row' ? (after ? addRowAfter : addRowBefore) : (after ? addColumnAfter : addColumnBefore);
  command(this.editor.state, this.editor.view.dispatch);
  this.hideInsert();
  this.editor.view.focus();
 };

 update(node: ProseMirrorNode) {
  const previous = TableMap.get(this.node);
  if (!super.update(node)) return false;
  const next = TableMap.get(node);
  if (previous.width !== next.width || previous.height !== next.height) this.rebuildHandles();
  else this.scheduleLayout();
  return true;
 }
 stopEvent(event: Event) { return this.controls.contains(event.target as Node) || (!!this.drag && event.type.startsWith('pointer')); }
 destroy() {
  this.cancelDrag();
  cancelAnimationFrame(this.frame);
  this.observer.disconnect();
  this.editor.off('selectionUpdate', this.syncSelection);
  this.editor.off('transaction', this.syncSelection);
 }
}

export const InteractiveTable = Table.extend({
 addNodeView() {
  return ({ node, getPos, editor }) => new InteractiveTableView(node, editor, getPos);
 },
}).configure({ resizable: false });
