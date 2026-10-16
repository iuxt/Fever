import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';
import type { SearchAdapter, SearchSegment } from './articleSearch';

const key = new PluginKey<DecorationSet>('articleSearch');
export const ArticleSearch = Extension.create({
 name: 'articleSearch',
 addProseMirrorPlugins() {
  return [new Plugin({
   key,
   state: {
    init: () => DecorationSet.empty,
    apply: (tr, value) => tr.getMeta(key) ?? value.map(tr.mapping, tr.doc),
   },
   props: { decorations: state => key.getState(state) },
  })];
 },
});

export function richTextSearchAdapter(editor: Editor): SearchAdapter {
 return {
  element: editor.view.dom,
  segments() {
   const segments: SearchSegment[] = [];
   editor.state.doc.descendants((node, position) => {
    if (!node.isTextblock) return;
    let segment: SearchSegment | null = null;
    // Adjacent text with different marks stays searchable as one phrase. Atoms
    // split a segment so replacement can never remove an embedded image.
    node.descendants((child, offset) => {
     const text = child.isText ? child.text! : child.type.name === 'hardBreak' ? '\n' : null;
     if (text === null) { segment = null; return false; }
     if (!segment) { segment = { from: position + 1 + offset, text: '' }; segments.push(segment); }
     segment.text += text;
    });
    return false;
   });
   return segments;
  },
  selection() {
   const { from, to } = editor.state.selection;
   return { from, to, text: editor.state.doc.textBetween(from, to, '\n') };
  },
  subscribe(listener) {
   const update = ({ transaction }: { transaction: import('@tiptap/pm/state').Transaction }) => {
    if (transaction.docChanged) listener({ mapPosition: (position, association) => transaction.mapping.map(position, association) });
   };
   editor.on('transaction', update);
   return () => { editor.off('transaction', update); };
  },
  highlight(matches, active, reveal) {
   if (editor.isDestroyed) return;
   const decorations = matches.map((match, index) => {
    const className = `article-search-match${index === active ? ' current' : ''}`;
    return match.from === match.to ? Decoration.widget(match.from, () => {
     const mark = document.createElement('span'); mark.className = `${className} search-caret`; return mark;
    }) : Decoration.inline(match.from, match.to, { class: className });
   });
   const tr = editor.state.tr.setMeta(key, DecorationSet.create(editor.state.doc, decorations)).setMeta('addToHistory', false);
   const match = matches[active];
   if (reveal && match) tr.setSelection(TextSelection.create(tr.doc, match.from, match.to));
   editor.view.dispatch(tr);
   if (reveal && match) {
    const scroller = editor.view.dom.closest('.document-space');
    const coords = editor.view.coordsAtPos(match.from);
    if (scroller) {
     const bounds = scroller.getBoundingClientRect();
     const top = bounds.top + 155;
     if (coords.top < top || coords.bottom > bounds.bottom - 30) scroller.scrollTop += coords.top - top;
    }
   }
  },
  replace(changes) {
   if (!changes.length || editor.isDestroyed) return;
   const tr = closeHistory(editor.state.tr);
   for (const change of [...changes].reverse()) tr.insertText(change.text, change.from, change.to);
   editor.view.dispatch(tr);
   editor.view.dispatch(closeHistory(editor.state.tr));
  },
  focus() { if (!editor.isDestroyed) editor.view.focus(); },
 };
}
