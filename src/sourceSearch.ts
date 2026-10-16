import { StateEffect, StateField, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { SearchAdapter, SearchRange } from './articleSearch';

const highlights = StateEffect.define<{ matches: SearchRange[]; active: number }>();
class SearchCaret extends WidgetType {
 constructor(readonly active: boolean) { super(); }
 eq(other: SearchCaret) { return other.active === this.active; }
 toDOM() { const span = document.createElement('span'); span.className = `article-search-match search-caret${this.active ? ' current' : ''}`; return span; }
}
export const sourceSearchHighlights = StateField.define<DecorationSet>({
 create: () => Decoration.none,
 update(value, tr) {
  value = value.map(tr.changes);
  for (const effect of tr.effects) if (effect.is(highlights)) {
   value = Decoration.set(effect.value.matches.map((match, index) => match.from === match.to
    ? Decoration.widget({ widget: new SearchCaret(index === effect.value.active) }).range(match.from)
    : Decoration.mark({ class: `article-search-match${index === effect.value.active ? ' current' : ''}` }).range(match.from, match.to)), true);
  }
  return value;
 },
 provide: field => EditorView.decorations.from(field),
});
const listeners = new WeakMap<EditorView, Set<Parameters<SearchAdapter['subscribe']>[0]>>();
export const sourceSearchUpdates = EditorView.updateListener.of(update => {
 if (update.docChanged) for (const listener of listeners.get(update.view) ?? []) listener({ mapPosition: (position, association) => update.changes.mapPos(position, association) });
});
export function sourceSearchAdapter(view: EditorView): SearchAdapter {
 return {
  element: view.dom,
  segments: () => [{ from: 0, text: view.state.doc.toString() }],
  selection() { const { from, to } = view.state.selection.main; return { from, to, text: view.state.sliceDoc(from, to) }; },
  subscribe(listener) {
   let set = listeners.get(view);
   if (!set) { set = new Set(); listeners.set(view, set); }
   set.add(listener);
   return () => { set.delete(listener); };
  },
  highlight(matches, active, reveal) {
   const match = matches[active];
   view.dispatch({
    effects: [highlights.of({ matches, active }), ...(reveal && match ? [EditorView.scrollIntoView(match.from, { y: 'nearest', yMargin: 150 })] : [])],
    ...(reveal && match ? { selection: { anchor: match.from, head: match.to } } : {}),
    annotations: Transaction.addToHistory.of(false),
   });
  },
  replace(changes) {
   view.dispatch({ changes: changes.map(change => ({ from: change.from, to: change.to, insert: change.text })), annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.replace')] });
  },
  focus: () => view.focus(),
 };
}
