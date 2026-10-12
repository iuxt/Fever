import { memo, useEffect, useRef, useState, type MouseEvent } from 'react';
import type { Extension } from '@codemirror/state';
import CodeMirror, { EditorView, Transaction, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { redo, redoDepth, selectAll, undo, undoDepth } from '@codemirror/commands';
import ContextMenu, { keyboardContextMenu, modifier, useContextMenu, type MenuItem } from './ContextMenu';
import { readClipboard, writeClipboard } from './clipboard';

// Reuse the language extension across edits and background status refreshes.
const extensions = [markdown({ codeLanguages: languages })];
const basicSetup = { lineNumbers: true, foldGutter: false, highlightActiveLine: true };
export default memo(function SourceEditor({ content, dark, onChange, onError, filename }: { content: string; dark: boolean; onChange: (value: string) => void; onError: (message: string) => void; filename?: string }) {
 const ref = useRef<ReactCodeMirrorRef>(null), contextMenu = useContextMenu();
 const [fileExtensions, setFileExtensions] = useState<Extension[]>(filename ? [] : extensions);
 useEffect(() => {
  if (!filename) { setFileExtensions(extensions); return; }
  let cancelled = false;
  setFileExtensions([]);
  const language = languages.find(language => language.extensions.includes(filename.split('.').pop()?.toLowerCase() || ''));
  language?.load().then(extension => { if (!cancelled) setFileExtensions([extension]); }).catch(() => {});
  return () => { cancelled = true; };
 }, [filename]);
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
  <CodeMirror ref={ref} value={content} extensions={fileExtensions} theme={dark ? 'dark' : 'light'} basicSetup={basicSetup} onChange={onChange} onContextMenu={showContextMenu} onKeyDown={keyboardContextMenu} height="100%" placeholder="让一个想法，从这里开始…" />
  <ContextMenu menu={contextMenu.menu} onClose={contextMenu.close} onError={onError} />
 </>;
});
