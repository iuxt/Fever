import { Extension } from '@tiptap/core';
import { NodeSelection, Plugin, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

export const BlockSelection = Extension.create({
 name: 'blockSelection',
 addProseMirrorPlugins() {
  return [new Plugin({
   props: {
    handleDOMEvents: {
     mousedown(view, event) {
      if (!view.editable || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || !(event.target instanceof HTMLHRElement)) return false;
      const position = view.posAtDOM(event.target, 0);
      if (view.state.doc.nodeAt(position)?.type.name !== 'horizontalRule') return false;
      event.preventDefault();
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, position)).setMeta('pointer', true));
      view.focus();
      return true;
     },
    },
    decorations({ doc, selection }) {
     if (selection.empty || selection instanceof NodeSelection) return null;
     const decorations: Decoration[] = [];
     // Native text selection does not paint empty atoms or a table's boundary.
     // Highlight only fully covered blocks so the frame matches what deletion removes.
     doc.nodesBetween(selection.from, selection.to, (node, position) => {
      if (!['horizontalRule', 'table'].includes(node.type.name)) return;
      if (selection.from <= position && selection.to >= position + node.nodeSize) {
       decorations.push(Decoration.node(position, position + node.nodeSize, { class: 'block-range-selected' }));
      }
      return false;
     });
     return DecorationSet.create(doc, decorations);
    },
   },
  })];
 },
});

// Resolve the clicked textblock from the DOM before using coordinates. A hit in
// a node view's padding can otherwise resolve to a neighboring block.
export function selectTextLine(view: EditorView, event: MouseEvent): boolean {
 if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || !(event.target instanceof Element)) return false;
 if (event.target.closest('input, textarea, button, select, [contenteditable="false"]')) return false;
 const block = event.target.closest('p, h1, h2, h3, h4, h5, h6, pre');
 if (!block || !view.dom.contains(block)) return false;
 const content = block.matches('pre') ? block.querySelector('[data-node-view-content]') : block;
 if (!content) return false;
 const $start = view.state.doc.resolve(view.posAtDOM(content, 0));
 if (!$start.parent.isTextblock) return false;
 const start = $start.start(), end = $start.end();
 const first = view.coordsAtPos(start), last = view.coordsAtPos(end);
 const bounds = content.getBoundingClientRect();
 const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
 const hit = view.posAtCoords({
  left: clamp(event.clientX, bounds.left + 1, bounds.right - 1),
  top: clamp(event.clientY, first.top + 1, last.bottom - 1),
 });
 const offset = clamp(hit?.pos ?? start, start, end) - start;
 // Inline atoms occupy one document position; hard breaks delimit prose lines.
 const text = $start.parent.textBetween(0, $start.parent.content.size, '', node => node.type.name === 'hardBreak' ? '\n' : '\ufffc');
 const from = text.slice(0, offset).lastIndexOf('\n') + 1;
 const newline = text.indexOf('\n', offset);
 const to = newline < 0 ? text.length : newline + 1;
 view.focus();
 const selection = TextSelection.create(view.state.doc, start + from, start + to);
 view.dispatch(view.state.tr.setSelection(selection).setMeta('pointer', true));
 return true;
}
