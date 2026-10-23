import { useEffect, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import { Plus } from 'lucide-react';

type Gap = { position: number; top: number; left: number; width: number };
type Boundary = { position: number; before?: number; after?: number };

function isStructuredBlock(node: ProseMirrorNode | null) {
 if (!node) return false;
 if (['codeBlock', 'table', 'blockquote', 'bulletList', 'orderedList', 'taskList', 'horizontalRule'].includes(node.type.name)) return true;
 // Images, wiki images and drawing references live in inline-image paragraphs.
 return node.type.name === 'paragraph' && !node.textContent && node.childCount > 0 && Array.from({ length: node.childCount }, (_, index) => node.child(index)).every(child => ['image', 'wikiImage'].includes(child.type.name));
}

function canInsert(position: ResolvedPos) {
 const before = position.nodeBefore, after = position.nodeAfter;
 const emptyParagraph = (node: ProseMirrorNode | null) => node?.type.name === 'paragraph' && node.content.size === 0;
 if (emptyParagraph(before) || emptyParagraph(after)) return false;
 if (!before || !after) {
  if (position.parent.type.name !== 'doc') return false;
 }
 return (isStructuredBlock(before) || isStructuredBlock(after)) && position.parent.canReplaceWith(position.index(), position.index(), position.doc.type.schema.nodes.paragraph);
}

export default function BlockInsert({ editor, surfaceRef }: { editor: Editor; surfaceRef: RefObject<HTMLElement | null> }) {
 const [gap, setGap] = useState<Gap | null>(null);
 useEffect(() => {
  const surface = surfaceRef.current;
  if (!surface) return;
  let boundaries: Boundary[] = [];
  const hide = () => setGap(null);
  const findBoundaries = () => {
   boundaries = [];
   const doc = editor.state.doc;
   doc.descendants((node, position, parent, index) => {
    const previous = parent?.maybeChild(index - 1);
    if (node.isBlock && canInsert(doc.resolve(position))) {
     boundaries.push({ position, before: previous ? position - previous.nodeSize : undefined, after: position });
    }
    // Table cells retain their own row/column controls and normal text editing.
    return node.type.name !== 'table';
   });
   if (doc.lastChild && canInsert(doc.resolve(doc.content.size))) boundaries.push({ position: doc.content.size, before: doc.content.size - doc.lastChild.nodeSize });
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
    if (event.target.closest('.block-insert')) return;
    if (event.target.closest('button, input, textarea, select')) { hide(); return; }
   }
   for (const boundary of boundaries) {
    const before = boundary.before === undefined ? null : editor.view.nodeDOM(boundary.before);
    const after = boundary.after === undefined ? null : editor.view.nodeDOM(boundary.after);
    const first = before instanceof HTMLElement ? before.getBoundingClientRect() : null;
    const second = after instanceof HTMLElement ? after.getBoundingClientRect() : null;
    const block = first || second;
    if (!block) continue;
    const top = first?.bottom ?? second!.top - 24, bottom = second?.top ?? first!.bottom + 24;
    if (event.clientY < top || event.clientY > bottom || event.clientX < block.left - 28 || event.clientX > block.right) continue;
    const bounds = surface.getBoundingClientRect();
    const next = { position: boundary.position, top: (top + bottom) / 2 - bounds.top, left: block.left - bounds.left - 28, width: block.width + 28 };
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
  // Validate the hovered boundary again after any intervening document changes.
  if (!canInsert(position)) { setGap(null); return; }
  const tr = closeHistory(state.tr).insert(gap.position, state.schema.nodes.paragraph.create());
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, gap.position + 1)).scrollIntoView());
  view.dispatch(closeHistory(view.state.tr));
  view.focus();
 }

 return gap && <div className="block-insert" style={{ top: gap.top, left: gap.left, width: gap.width }}>
  <button type="button" aria-label="插入空行" title="插入空行" onMouseDown={event => event.preventDefault()} onClick={insert}><Plus size={14} aria-hidden="true" /></button>
  <span aria-hidden="true" />
 </div>;
}
