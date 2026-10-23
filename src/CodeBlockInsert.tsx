import { useEffect, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { Plus } from 'lucide-react';

type Gap = { position: number; top: number; left: number; width: number };

export default function CodeBlockInsert({ editor, surfaceRef }: { editor: Editor; surfaceRef: RefObject<HTMLElement | null> }) {
 const [gap, setGap] = useState<Gap | null>(null);
 useEffect(() => {
  const surface = surfaceRef.current;
  if (!surface) return;
  let boundaries: { position: number; previous: number }[] = [];
  const hide = () => setGap(null);
  const findBoundaries = () => {
   boundaries = [];
   editor.state.doc.descendants((node, position, parent, index) => {
    const previous = parent?.maybeChild(index - 1);
    if (node.type.name === 'codeBlock' && previous?.type === node.type) {
     boundaries.push({ position, previous: position - previous.nodeSize });
    }
   });
  };
  findBoundaries();
  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
   if (!transaction.docChanged) return;
   hide();
   findBoundaries();
  };
  const move = (event: PointerEvent) => {
   if (editor.isDestroyed || event.buttons || editor.view.composing) { hide(); return; }
   if (event.target instanceof Element) {
    if (event.target.closest('.code-block-insert')) return;
    if (event.target.closest('.editor-code-block')) { hide(); return; }
   }
   for (const boundary of boundaries) {
    const before = editor.view.nodeDOM(boundary.previous), after = editor.view.nodeDOM(boundary.position);
    if (!(before instanceof HTMLElement) || !(after instanceof HTMLElement)) continue;
    const first = before.getBoundingClientRect(), second = after.getBoundingClientRect();
    if (event.clientY < first.bottom || event.clientY > second.top || event.clientX < first.left - 28 || event.clientX > first.right) continue;
    const bounds = surface.getBoundingClientRect();
    const next = { position: boundary.position, top: (first.bottom + second.top) / 2 - bounds.top, left: first.left - bounds.left - 28, width: first.width + 28 };
    setGap(current => current && current.position === next.position && current.top === next.top && current.left === next.left && current.width === next.width ? current : next);
    return;
   }
   hide();
  };
  surface.addEventListener('pointermove', move);
  surface.addEventListener('pointerleave', hide);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  const resize = new ResizeObserver(hide);
  resize.observe(surface);
  editor.on('transaction', onTransaction);
  return () => {
   surface.removeEventListener('pointermove', move);
   surface.removeEventListener('pointerleave', hide);
   window.removeEventListener('scroll', hide, true);
   window.removeEventListener('resize', hide);
   resize.disconnect();
   editor.off('transaction', onTransaction);
  };
 }, [editor, surfaceRef]);

 function insert() {
  if (!gap || editor.isDestroyed || gap.position > editor.state.doc.content.size) return;
  const { view, state } = editor;
  const position = state.doc.resolve(gap.position);
  // The document may have changed since the hover; only insert at a code gap.
  if (position.nodeBefore?.type.name !== 'codeBlock' || position.nodeAfter?.type.name !== 'codeBlock') { setGap(null); return; }
  const tr = closeHistory(state.tr).insert(gap.position, state.schema.nodes.paragraph.create());
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, gap.position + 1)).scrollIntoView());
  view.dispatch(closeHistory(view.state.tr));
  view.focus();
 }

 return gap && <div className="code-block-insert" style={{ top: gap.top, left: gap.left, width: gap.width }}>
  <button type="button" aria-label="在代码块之间插入空行" title="插入空行" onMouseDown={event => event.preventDefault()} onClick={insert}><Plus size={14} aria-hidden="true" /></button>
  <span aria-hidden="true" />
 </div>;
}
