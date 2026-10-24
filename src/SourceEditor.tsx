import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { indentUnit } from '@codemirror/language';
import { keymap } from '@codemirror/view';
import CodeMirror, { EditorView, Transaction, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { indentLess, indentMore, redo, redoDepth, selectAll, undo, undoDepth } from '@codemirror/commands';
import ContextMenu, { keyboardContextMenu, modifier, useContextMenu, type MenuItem } from './ContextMenu';
import { readClipboard, writeClipboard } from './clipboard';
import { sourceFormatting } from './sourceFormatting';
import FindReplace from './FindReplace';
import type { SearchAdapter, SearchRequest } from './articleSearch';
import { sourceSearchAdapter, sourceSearchHighlights, sourceSearchUpdates } from './sourceSearch';

// Reuse the language extension across edits and background status refreshes.
const extensions = [markdown({ codeLanguages: languages }), sourceFormatting];
const basicSetup = { lineNumbers: true, foldGutter: false, highlightActiveLine: true, searchKeymap: false };
const indentation = [EditorState.tabSize.of(4), indentUnit.of('    '), keymap.of([{
 key: 'Tab', preventDefault: true, shift: indentLess,
 run(view) {
  if (view.state.readOnly) return false;
  if (view.state.selection.ranges.some(range => !range.empty)) return indentMore(view);
  view.dispatch(view.state.update(view.state.replaceSelection('    '), { scrollIntoView: true, userEvent: 'input' }));
  return true;
 },
}])];
export default memo(function SourceEditor({ content, dark, onChange, onError, filename, findRequest, jumpToLine }: { content: string; dark: boolean; onChange: (value: string) => void; onError: (message: string) => void; filename?: string; findRequest?: SearchRequest; jumpToLine?: { line: number; request: number } }) {
 const ref = useRef<ReactCodeMirrorRef>(null), contextMenu = useContextMenu();
 const [searchAdapter, setSearchAdapter] = useState<SearchAdapter | null>(null);
 const [fileExtensions, setFileExtensions] = useState<Extension[]>(filename ? [] : extensions);
 useEffect(() => {
  if (!filename) { setFileExtensions(extensions); return; }
  let cancelled = false;
  setFileExtensions([]);
  const language = languages.find(language => language.extensions.includes(filename.split('.').pop()?.toLowerCase() || ''));
  language?.load().then(extension => { if (!cancelled) setFileExtensions(/\.(md|markdown)$/i.test(filename) ? [extension, sourceFormatting] : [extension]); }).catch(() => {});
  return () => { cancelled = true; };
 }, [filename]);
 useEffect(() => {
  const view = ref.current?.view;
  if (!view || !jumpToLine) return;
  const line = view.state.doc.line(Math.min(jumpToLine.line, view.state.doc.lines));
  view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'start' }) });
  view.focus();
 }, [jumpToLine, searchAdapter]);
 const editorExtensions = useMemo(() => [...indentation, ...fileExtensions, sourceSearchHighlights, sourceSearchUpdates], [fileExtensions]);
 function showContextMenu(event: MouseEvent<HTMLElement>) {
  const view = ref.current?.view;
  if (!view) return;
  event.preventDefault(); event.stopPropagation();
  const keyboard = !event.clientX && !event.clientY;
  const position = keyboard ? null : view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (view.state.selection.main.empty && position !== null) view.dispatch({ selection: { anchor: position } });
  const selection = view.state.selection;
  const documentSnapshot = view.state.doc;
  const selected = selection.ranges.some(range => !range.empty);
  const copy = async (cut = false) => {
   await writeClipboard({ text: selection.ranges.map(range => view.state.sliceDoc(range.from, range.to)).join('\n') });
   if (ref.current?.view !== view) return;
   if (!view.state.doc.eq(documentSnapshot)) throw new Error('笔记内容已变化，请重新选择后操作');
   view.dispatch({ selection });
   view.focus();
   if (cut) view.dispatch({ ...view.state.replaceSelection(''), annotations: Transaction.userEvent.of('delete.cut'), scrollIntoView: true });
  };
  const command = (action: (view: EditorView) => boolean) => { view.focus(); action(view); };
  const items: MenuItem[] = [
   { label: '撤销', shortcut: `${modifier}Z`, disabled: !undoDepth(view.state), action: () => command(undo) },
   { label: '重做', shortcut: `${modifier}⇧Z`, disabled: !redoDepth(view.state), action: () => command(redo) },
   { separator: true },
   { label: '剪切', shortcut: `${modifier}X`, disabled: !selected, action: () => copy(true) },
   { label: '复制', shortcut: `${modifier}C`, disabled: !selected, action: () => copy() },
   { label: '粘贴', shortcut: `${modifier}V`, action: async () => {
    const data = await readClipboard();
    if (ref.current?.view !== view) return;
    if (!view.state.doc.eq(documentSnapshot)) throw new Error('笔记内容已变化，请重新选择后操作');
    view.dispatch({ selection });
    view.focus();
    view.dispatch({ ...view.state.replaceSelection(data.text), annotations: Transaction.userEvent.of('input.paste'), scrollIntoView: true });
   } },
   { label: '全选', shortcut: `${modifier}A`, action: () => command(selectAll) },
  ];
  const coords = view.coordsAtPos(selection.main.head) || view.contentDOM.getBoundingClientRect();
  contextMenu.open({ x: keyboard ? coords.left : event.clientX, y: keyboard ? coords.bottom : event.clientY, label: '源码编辑器菜单', items, returnFocus: view.contentDOM });
 }
 return <>
  <FindReplace adapter={searchAdapter} request={findRequest} />
  <CodeMirror className="source-codemirror" ref={ref} value={content} extensions={editorExtensions} indentWithTab={false} onCreateEditor={view => setSearchAdapter(sourceSearchAdapter(view))} theme={dark ? 'dark' : 'light'} basicSetup={basicSetup} onChange={onChange} onContextMenu={showContextMenu} onKeyDown={keyboardContextMenu} height="100%" placeholder="让一个想法，从这里开始…" />
  <ContextMenu menu={contextMenu.menu} onClose={contextMenu.close} onError={onError} />
 </>;
});
