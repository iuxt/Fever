import { EditorSelection, Prec, Transaction } from '@codemirror/state';
import { keymap, type EditorView } from '@codemirror/view';
import { isolateHistory } from '@codemirror/commands';
import { formattingShortcuts, type FormattingAction } from './editorShortcuts';

function formatSource(view: EditorView, action: FormattingAction) {
 const { state } = view;
 // A single transaction keeps multiple selections and undo/redo intact.
 const inlineMarkers: Partial<Record<FormattingAction, string>> = { bold: '**', italic: '*', strike: '~~', code: '`' };
 const transaction = state.changeByRange(range => {
  const { from, to } = range;
  const text = state.sliceDoc(from, to);
  const marker = inlineMarkers[action];
  if (marker) {
   const before = state.sliceDoc(Math.max(0, from - marker.length), from);
   const after = state.sliceDoc(to, to + marker.length);
   if (before === marker && after === marker) return {
    changes: [{ from: from - marker.length, to: from, insert: '' }, { from: to, to: to + marker.length, insert: '' }],
    range: EditorSelection.range(from - marker.length, to - marker.length),
   };
   if (text.length >= marker.length * 2 && text.startsWith(marker) && text.endsWith(marker)) return {
    changes: { from, to, insert: text.slice(marker.length, -marker.length) },
    range: EditorSelection.range(from, to - marker.length * 2),
   };
   return { changes: { from, to, insert: marker + text + marker }, range: EditorSelection.range(from + marker.length, to + marker.length) };
  }
  const first = state.doc.lineAt(from), last = state.doc.lineAt(to > from && state.doc.lineAt(to).from === to ? to - 1 : to);
  const body = state.sliceDoc(first.from, last.to);
  if (action === 'codeBlock') {
   const lines = body.split('\n');
   const opening = /^(`{3,}|~{3,})[^`~]*$/.exec(lines[0]);
   const closing = lines.at(-1)?.trim();
   const wrapped = lines.length >= 2 && opening && closing && closing[0] === opening[1][0] && closing.length >= opening[1].length && new Set(closing).size === 1;
   const preceding = first.number > 1 ? state.doc.line(first.number - 1) : null;
   const following = last.number < state.doc.lines ? state.doc.line(last.number + 1) : null;
   const outer = preceding && following && /^(`{3,}|~{3,})[^`~]*$/.exec(preceding.text);
   if (wrapped) {
    const insert = lines.slice(1, -1).join('\n');
    return { changes: { from: first.from, to: last.to, insert }, range: EditorSelection.range(first.from, first.from + insert.length) };
   }
   if (outer && following!.text.trim()[0] === outer[1][0] && following!.text.trim().length >= outer[1].length && new Set(following!.text.trim()).size === 1) return {
    changes: [{ from: preceding!.from, to: first.from, insert: '' }, { from: last.to, to: following!.to, insert: '' }],
    range: EditorSelection.range(from - (first.from - preceding!.from), to - (first.from - preceding!.from)),
   };
   const fence = '`'.repeat(Math.max(3, ...Array.from(body.matchAll(/`+/g), match => match[0].length + 1)));
   return { changes: { from: first.from, to: last.to, insert: `${fence}\n${body}\n${fence}` }, range: EditorSelection.range(from + fence.length + 1, to + fence.length + 1) };
  }
  const lines = body.split('\n');
  const heading = action.startsWith('heading') ? Number(action.slice(-1)) : 0;
  const pattern = heading || action === 'paragraph' ? /^#{1,6}\s+/ : action === 'blockquote' ? /^>\s?/ : action === 'taskList' ? /^[-*+] \[[ xX]\]\s/ : action === 'orderedList' ? /^\d+[.)]\s/ : /^[-*+]\s(?!\[[ xX]\]\s)/;
  const prefix = heading ? '#'.repeat(heading) + ' ' : action === 'blockquote' ? '> ' : action === 'taskList' ? '- [ ] ' : action === 'bulletList' ? '- ' : '';
  const remove = action === 'paragraph' || lines.every(line => !line.trim() || (heading ? line.startsWith(prefix) : pattern.test(line)));
  const edits = lines.map((line, index) => {
   const existing = line.match(pattern)?.[0] || '';
   const replacement = remove ? '' : action === 'orderedList' ? `${index + 1}. ` : prefix;
   return { existing, replacement };
  });
  let offset = first.from;
  const changes = lines.map((line, index) => {
   const { existing, replacement } = edits[index];
   const change = { from: offset, to: offset + existing.length, insert: replacement };
   offset += line.length + 1;
   return change;
  });
  const selectionOffset = (position: number) => {
   let delta = 0;
   for (const change of changes) {
    if (position < change.from) break;
    if (position <= change.to) return change.from + delta + change.insert.length;
    delta += change.insert.length - (change.to - change.from);
   }
   return position + delta;
  };
  return { changes, range: EditorSelection.range(selectionOffset(from), selectionOffset(to)) };
 });
 view.dispatch({ ...transaction, annotations: [Transaction.userEvent.of('input.format'), isolateHistory.of('full')], scrollIntoView: true });
 return true;
}
export const sourceFormatting = Prec.highest(keymap.of(formattingShortcuts.map(({ action, key }) => ({ key, run: view => formatSource(view, action), preventDefault: true }))));
