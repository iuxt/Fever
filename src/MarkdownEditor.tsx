import { createContext, isValidElement, memo, useCallback, useContext, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode, type Ref } from 'react';
import { EditorContent, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Paragraph from '@tiptap/extension-paragraph';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, ChevronDown, Code2, ImagePlus, Italic, List, ListChecks, ListOrdered, Quote, Redo2, Shapes, Table2, Undo2 } from 'lucide-react';
import { Extension, type Editor } from '@tiptap/core';
import { formattingShortcuts, shortcutLabel, type FormattingAction } from './editorShortcuts';
import { AllSelection, NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import type { EditorView } from '@tiptap/pm/view';
import ContextMenu, { keyboardContextMenu, modifier, useContextMenu, type MenuItem } from './ContextMenu';
import { readClipboard, writeClipboard } from './clipboard';
import { InteractiveTable } from './InteractiveTable';
import { editorLowlight } from './codeHighlight';
import CodeLanguageSelect from './CodeLanguageSelect';
import CodeCopyButton from './CodeCopyButton';
import BlockInsert from './BlockInsert';
import Mermaid from './Mermaid';
import { imageAltWithWidth, parseImageAlt } from './imageSize';
import { selectTextLine } from './editorSelection';
import FindReplace from './FindReplace';
import type { SearchRequest } from './articleSearch';
import { ArticleSearch, richTextSearchAdapter } from './richTextSearch';

export type MarkdownEditorHandle = { insertMarkdown: (markdown: string) => boolean; flush: () => void; isDirty: () => boolean };
type Media = { image: (src: string, alt: string, width?: number) => ReactNode; drawing: (content: string) => ReactNode };
const MediaContext = createContext<(Media & { onError: (message: string) => void }) | null>(null);

function ImageView({ node, selected, editor, getPos, updateAttributes }: NodeViewProps) {
 const media = useContext(MediaContext)!;
 const parsed = parseImageAlt(node.attrs.alt || '');
 const [previewWidth, setPreviewWidth] = useState<number | null>(null);
 const [source, setSource] = useState<string | null>(null);
 const sourceSession = useRef<{ initial: string; draft: string } | null>(null);
 const wrapperRef = useRef<HTMLSpanElement>(null), sourceRef = useRef<HTMLTextAreaElement>(null);
 const drag = useRef<{ pointer: number; x: number; y: number; width: number; ratio: number; max: number; current: number } | null>(null);
 const width = previewWidth ?? node.attrs.width ?? parsed.width;
 const image = media.image(node.attrs.src, parsed.alt, width);
 const resizable = editor.isEditable && isValidElement(image) && image.type === 'img';
 const editingSource = source !== null;
 function openSource() {
  const markdown = editor.markdown?.serialize(node.toJSON());
  if (markdown === undefined) return;
  sourceSession.current = { initial: markdown, draft: markdown };
  setSource(markdown);
 }
 function finishSource(commit: boolean) {
  const session = sourceSession.current;
  if (!session) return;
  sourceSession.current = null;
  setSource(null);
  if (!commit || session.draft === session.initial || editor.isDestroyed) return;
  try {
   const document = editor.markdown?.parse(session.draft.trim());
   const paragraph = document?.content?.[0];
   const imageNode = paragraph?.content?.[0];
   if (document?.content?.length !== 1 || paragraph?.type !== 'paragraph' || paragraph.content?.length !== 1 || !imageNode || !['image', 'wikiImage'].includes(imageNode.type || '')) {
    media.onError('图片 Markdown 格式无效，已保留原图片');
    return;
   }
   const position = getPos();
   if (typeof position !== 'number') return;
   const current = editor.state.doc.nodeAt(position);
   if (!current || current.type !== node.type) return;
   const replacement = editor.schema.nodeFromJSON(imageNode);
   if (current.eq(replacement)) return;
   // Keep this edit separate from adjacent prose typing in the undo history.
   editor.view.dispatch(closeHistory(editor.state.tr).replaceWith(position, position + current.nodeSize, replacement));
   editor.view.dispatch(closeHistory(editor.state.tr));
  } catch {
   media.onError('图片 Markdown 格式无效，已保留原图片');
  }
 }
 const finishSourceRef = useRef(finishSource);
 finishSourceRef.current = finishSource;
 useEffect(() => {
  if (!editingSource) return;
  sourceRef.current?.focus({ preventScroll: true });
  sourceRef.current?.select();
  const outside = (event: Event) => {
   if (!wrapperRef.current?.contains(event.target as globalThis.Node)) finishSourceRef.current(true);
  };
  window.addEventListener('pointerdown', outside, true);
  return () => window.removeEventListener('pointerdown', outside, true);
 }, [editingSource]);
 function startResize(event: PointerEvent<HTMLButtonElement>) {
  if (event.button !== 0) return;
  const wrapper = event.currentTarget.closest('.editor-image')!;
  const img = wrapper.querySelector('img');
  if (!img) return;
  event.preventDefault(); event.stopPropagation();
  const position = getPos();
  if (typeof position !== 'number') return;
  editor.commands.setNodeSelection(position);
  const bounds = img.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const container = wrapper.closest('p, h1, h2, h3, h4, h5, h6, td, th') || editor.view.dom;
  const max = Math.max(32, container.getBoundingClientRect().right - bounds.left);
  drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, width: bounds.width, ratio: bounds.width / bounds.height, max, current: bounds.width };
  setPreviewWidth(bounds.width);
  event.currentTarget.setPointerCapture(event.pointerId);
 }
 function moveResize(event: PointerEvent<HTMLButtonElement>) {
  const start = drag.current;
  if (!start || start.pointer !== event.pointerId) return;
  event.preventDefault(); event.stopPropagation();
  const dx = event.clientX - start.x, dy = (event.clientY - start.y) * start.ratio;
  start.current = Math.round(Math.max(32, Math.min(start.max, start.width + (Math.abs(dx) >= Math.abs(dy) ? dx : dy))));
  setPreviewWidth(start.current);
 }
 function finishResize(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
  const start = drag.current;
  if (!start || start.pointer !== event.pointerId) return;
  event.preventDefault(); event.stopPropagation();
  if (commit) moveResize(event);
  drag.current = null;
  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  setPreviewWidth(null);
  if (commit && Math.abs(start.current - start.width) >= 1) updateAttributes({ alt: parsed.alt, width: start.current, height: null });
 }
 return <NodeViewWrapper ref={wrapperRef} as="span" className={`editor-image${selected ? ' selected' : ''}${previewWidth !== null ? ' resizing' : ''}${editingSource ? ' editing-source' : ''}`} contentEditable={false} style={!editingSource && resizable && width ? { width } : undefined} onMouseDown={(event: MouseEvent<HTMLSpanElement>) => {
  // Image selection must not be replaced by a delayed native caret selection
  // when reopening the source field immediately after it loses focus.
  if (!resizable || editingSource || !(event.target instanceof HTMLImageElement) || event.button !== 0) return;
  const position = getPos();
  if (typeof position !== 'number') return;
  event.preventDefault(); event.stopPropagation();
  editor.commands.setNodeSelection(position);
  editor.view.focus();
 }}>
  {editingSource ? <textarea ref={sourceRef} className="image-markdown-source" aria-label="图片 Markdown" value={source} rows={2} spellCheck={false} onChange={event => {
   if (sourceSession.current) sourceSession.current.draft = event.target.value;
   setSource(event.target.value);
  }} onBlur={() => finishSource(true)} onPaste={event => event.stopPropagation()} onDrop={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()} onKeyDown={event => {
   event.stopPropagation();
   if (event.nativeEvent.isComposing) return;
   if (event.key === 'Escape' || event.key === 'Enter') {
    event.preventDefault(); finishSource(event.key === 'Enter'); editor.view.focus();
   }
  }} /> : image}
  {resizable && selected && !editingSource && <button type="button" className="image-source-toggle" aria-label="编辑图片 Markdown" title="编辑图片 Markdown" onMouseDown={event => event.preventDefault()} onClick={event => { event.preventDefault(); event.stopPropagation(); openSource(); }}><Code2 size={15} /></button>}
  {resizable && !editingSource && <button type="button" className="image-resize-handle" aria-label="拖动调整图片大小" title="拖动调整图片大小" onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={event => finishResize(event, true)} onPointerCancel={event => finishResize(event, false)} onLostPointerCapture={() => { drag.current = null; setPreviewWidth(null); }} onClick={event => { event.preventDefault(); event.stopPropagation(); }} />}
 </NodeViewWrapper>;
}

const EditorImage = Image.extend({
 addNodeView() { return ReactNodeViewRenderer(ImageView); },
 parseMarkdown(token, helpers) {
  const { alt, width } = parseImageAlt(token.text || '');
  return helpers.createNode('image', { src: token.href, title: token.title, alt, width });
 },
 renderMarkdown(node, helpers, context) {
  const alt = imageAltWithWidth(node.attrs?.alt || '', node.attrs?.width);
  // Let the image extension retain its standard URL and title serialization.
  return this.parent?.({ ...node, attrs: { ...node.attrs, alt } }, helpers, context) || '';
 },
}).configure({ inline: true });
// Keep Obsidian references intact when surrounding prose is edited.
const WikiImage = EditorImage.extend({
 name: 'wikiImage',
 addAttributes() { return { ...this.parent?.(), source: { default: '' } }; },
 parseHTML() { return [{ tag: 'img[data-wiki-source]' }]; },
 addInputRules() { return []; },
 markdownTokenizer: {
  name: 'wikiImage', level: 'inline', start: src => src.indexOf('![['),
  tokenize(src) {
   const match = /^!\[\[([^\]\n]+)\]\]/.exec(src);
   return match ? { type: 'wikiImage', raw: match[0], text: match[1] } : undefined;
  },
 },
 parseMarkdown(token, helpers) {
  const [src, ...label] = (token.text || '').split('|');
  const parsed = parseImageAlt(`|${label.join('|')}`);
  return helpers.createNode('wikiImage', { src, alt: parsed.alt.slice(1) || src, width: parsed.width, source: token.raw });
 },
 renderMarkdown(node) {
  const source = node.attrs?.source || `![[${node.attrs?.src}]]`;
  if (!node.attrs?.width) return source;
  const parsed = parseImageAlt(source.slice(3, -2));
  return parsed.width === node.attrs.width ? source : `![[${imageAltWithWidth(parsed.alt, node.attrs.width)}]]`;
 },
});

function CodeView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
 const media = useContext(MediaContext)!;
 const [source, setSource] = useState(false);
 const drawing = node.attrs.language === 'excalidraw';
 const language = node.attrs.language || 'txt';
 const mermaid = language.toLowerCase() === 'mermaid';
 function setLanguage(value: string) {
  const position = getPos();
  if (typeof position !== 'number') return;
  // Select this block so language changes also refresh its highlight decorations.
  const { from, to } = editor.state.selection;
  if (from < position + 1 || to > position + node.nodeSize - 1) editor.commands.setTextSelection(position + 1);
  updateAttributes({ language: value || 'txt' });
 }
 return <NodeViewWrapper className={`editor-code-block${drawing || mermaid ? ' diagram-code-block' : ''}`}>
  <div className="code-block-actions" contentEditable={false}>
   <CodeLanguageSelect value={language} onChange={setLanguage} />
   {drawing && <button type="button" onClick={() => setSource(!source)}>{source ? '查看绘图' : '编辑数据'}</button>}
   {mermaid && <button type="button" aria-pressed={source} onClick={() => setSource(!source)}>{source ? '查看图表' : '编辑源码'}</button>}
   <CodeCopyButton text={node.textContent} onError={media.onError} />
  </div>
  {mermaid && !source && <div contentEditable={false}><Mermaid content={node.textContent} /></div>}
  {drawing && !source ? <div contentEditable={false}>{media.drawing(node.textContent)}</div> : <pre hidden={mermaid && !source}><NodeViewContent<'code'> as="code" className={language ? `language-${language}` : undefined} /></pre>}
 </NodeViewWrapper>;
}
const EditorCodeBlock = CodeBlockLowlight.extend({
 addNodeView() { return ReactNodeViewRenderer(CodeView); },
 renderMarkdown(node) {
  const text = (node.content || []).map(child => child.text || '').join('');
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), match => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${node.attrs?.language || 'txt'}\n${text}\n${fence}`;
 },
}).configure({ lowlight: editorLowlight, defaultLanguage: 'txt', exitOnTripleEnter: false, enableTabIndentation: true, tabSize: 4 });
function deleteParagraphGap(editor: Editor, backward: boolean) {
 const { selection, doc, schema } = editor.state;
 if (editor.view.composing || !(selection instanceof TextSelection) || !selection.empty) return false;
 const cursor = selection.$from;
 // Only join neighboring prose paragraphs. Lists, cells, headings and empty
 // paragraphs keep their normal structural deletion behavior.
 if (cursor.depth !== 1 || cursor.parent.type !== schema.nodes.paragraph || !cursor.parent.textContent.trim()) return false;
 if (cursor.parentOffset !== (backward ? 0 : cursor.parent.content.size)) return false;
 const index = cursor.index(0), adjacent = doc.maybeChild(index + (backward ? -1 : 1));
 if (adjacent?.type !== schema.nodes.paragraph || !adjacent.textContent.trim()) return false;
 const boundary = backward ? cursor.before() : cursor.after();
 // A Markdown paragraph separator contains a blank line. Remove that gap
 // first, keeping a real, editable line break instead of concatenating words.
 const tr = editor.state.tr.join(boundary).insert(boundary - 1, schema.nodes.hardBreak.create());
 editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, backward ? boundary : boundary - 1)).scrollIntoView());
 return true;
}
const EditorParagraph = Paragraph.extend({
 addKeyboardShortcuts() {
  return { ...this.parent?.(), Backspace: () => deleteParagraphGap(this.editor, true), Delete: () => deleteParagraphGap(this.editor, false) };
 },
 renderMarkdown(node, helpers) {
  // Keep blank paragraphs as Markdown spacing; the default emits HTML entities
  // for consecutive empty paragraphs. The Markdown parser restores these gaps.
  return helpers.renderChildren(node.content || []);
 },
 parseMarkdown(token, helpers) {
  // Tiptap's default parser unwraps lone images as blocks; ours stay inline.
  if (token.tokens?.length === 1 && token.tokens[0].type === 'image') {
   return helpers.createNode('paragraph', undefined, helpers.parseInline(token.tokens));
  }
  return this.parent?.(token, helpers) || helpers.createNode('paragraph', undefined, helpers.parseInline(token.tokens || []));
 },
});
function applyFormat(editor: Editor, action: FormattingAction) {
 if (editor.state.selection instanceof AllSelection) {
  const doc = editor.state.doc;
  editor.commands.setTextSelection({ from: Selection.atStart(doc).from, to: Selection.atEnd(doc).to });
 }
 const commands = editor.commands;
 switch (action) {
  case 'bold': return commands.toggleBold();
  case 'italic': return commands.toggleItalic();
  case 'strike': return commands.toggleStrike();
  case 'code': return commands.toggleCode();
  case 'codeBlock': return commands.toggleCodeBlock();
  case 'blockquote': return commands.toggleBlockquote();
  case 'bulletList': return commands.toggleBulletList();
  case 'orderedList': return commands.toggleOrderedList();
  case 'taskList': return commands.toggleTaskList();
  case 'paragraph': return commands.setParagraph();
  default: return commands.toggleHeading({ level: Number(action.slice(-1)) as 1 | 2 | 3 | 4 | 5 | 6 });
 }
}
const FormattingShortcuts = Extension.create({
 name: 'formattingShortcuts', priority: 1000,
 addKeyboardShortcuts() {
  return Object.fromEntries(formattingShortcuts.map(({ key, action }) => [key, () => { applyFormat(this.editor, action); return true; }]));
 },
});
const extensions = [
 FormattingShortcuts, ArticleSearch,
 StarterKit.configure({ paragraph: false, codeBlock: false, underline: false, trailingNode: false, link: { openOnClick: false } }),
 EditorParagraph, EditorCodeBlock, EditorImage, WikiImage,
 TableKit.configure({ table: false }), InteractiveTable,
 TaskList, TaskItem.configure({ nested: true }),
 Markdown.configure({ markedOptions: { gfm: true } }),
 Placeholder.configure({ placeholder: '让一个想法，从这里开始…' }),
];

function splitContent(content: string) {
 // YAML is kept verbatim; it must never turn into headings during rich-text editing.
 const prefix = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)(?:\r?\n)*/)?.[0] || '';
 return { prefix, body: content.slice(prefix.length) };
}

function focusEndParagraph(view: EditorView) {
 const { doc, schema, tr } = view.state;
 const last = doc.lastChild;
 // Reuse an existing empty line when leaving the final block with Enter.
 const reuse = last?.type === schema.nodes.paragraph && last.content.size === 0;
 const position = reuse ? doc.content.size - last.nodeSize + 1 : doc.content.size + 1;
 if (!reuse) tr.insert(doc.content.size, schema.nodes.paragraph.create());
 view.dispatch(tr.setSelection(TextSelection.create(tr.doc, position)).scrollIntoView());
 view.focus();
}

export default memo(function MarkdownEditor({ content, onChange, onDirty, media, ref, onError, onInsertImage, onInsertDrawing, onNavigate, findRequest }: {
 content: string; onChange: (value: string) => void; onDirty: () => void; media: Media; ref?: Ref<MarkdownEditorHandle>; onError: (message: string) => void;
 onInsertImage: () => void; onInsertDrawing: () => void;
 onNavigate?: (href: string) => boolean; findRequest?: SearchRequest;
}) {
 const contextMenu = useContextMenu();
 const navigate = useRef(onNavigate);
 navigate.current = onNavigate;
 const [initial] = useState(() => splitContent(content));
 const prefix = useRef(initial.prefix), lastContent = useRef(content);
 const liveEditor = useRef<Editor | null>(null), dirty = useRef(false);
 const surfaceRef = useRef<HTMLElement>(null);
 const callbacks = useRef({ onChange, onDirty }); callbacks.current = { onChange, onDirty };
 const serializationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
 const publish = useCallback(() => {
  clearTimeout(serializationTimer.current); clearTimeout(deadline.current); deadline.current = undefined;
  const editor = liveEditor.current;
  if (!dirty.current || !editor || editor.isDestroyed) return;
  const markdown = editor.getMarkdown();
  const value = prefix.current + markdown + (markdown ? '\n' : '');
  dirty.current = false; lastContent.current = value;
  callbacks.current.onChange(value);
 }, []);
 const editor: Editor | null = useEditor({
  extensions,
  content: initial.body, contentType: 'markdown',
  editorProps: {
   attributes: { class: 'prose wysiwyg-content', role: 'textbox', 'aria-label': '笔记正文', 'aria-multiline': 'true', spellcheck: 'false' },
   handleClick(view, _position, event) {
    // A fourth or later native click can be ProseMirror's next single click.
    // Keep its mouseup handler from collapsing the line selected on mousedown.
    if (event.detail >= 3 && selectTextLine(view, event)) return true;
    if (!(event.ctrlKey || event.metaKey) || !(event.target instanceof Element)) return false;
    const href = event.target.closest('a')?.getAttribute('href');
    if (!href || !navigate.current?.(href)) return false;
    event.preventDefault();
    return true;
   },
   handleTripleClick(view, _position, event) {
    return selectTextLine(view, event);
   },
   handleKeyDown(view, event) {
    if (event.key !== 'Enter' || event.isComposing || view.composing || event.ctrlKey || event.metaKey || event.altKey) return false;
    const { doc, selection } = view.state;
    // Enter (including repeated Enter and Shift+Enter) always inserts literal
    // newlines inside code. Mod+Enter and ArrowDown can still leave the block.
    if (selection.$from.parent.type.spec.code) return editor?.commands.newlineInCode() || false;
    if (event.shiftKey) return false;
    const last = doc.lastChild;
    const specialEnd = last && (last.type.name === 'codeBlock' || last.type.name === 'table' || last.isAtom || (last.lastChild?.isAtom && !last.lastChild.isText));
    if (!specialEnd) return false;
    const textEnd = selection instanceof TextSelection && selection.empty && selection.from === Selection.atEnd(doc).from;
    const selectedEnd = selection instanceof NodeSelection && selection.to >= doc.content.size - 1;
    const gapEnd = selection.empty && selection.from === doc.content.size;
    if (!textEnd && !selectedEnd && !gapEnd) return false;
    focusEndParagraph(view);
    return true;
   },
   handlePaste(view, event): boolean {
    if (event.clipboardData?.files.length || event.clipboardData?.getData('text/html')) return false;
    const text = event.clipboardData?.getData('text/plain') || '';
    if (view.state.selection.$from.parent.type.spec.code || !/(^|\n)(?:#{1,6} |[-*+] |\d+\. |>|```|\|)|\*\*[^*]+\*\*|!\[|\[[^\]]+\]\(/.test(text)) return false;
    return editor?.commands.insertContent(text, { contentType: 'markdown' }) || false;
   },
  },
  onUpdate({ transaction }) {
   if (!transaction.docChanged) return;
   dirty.current = true; callbacks.current.onDirty();
   clearTimeout(serializationTimer.current);
   serializationTimer.current = setTimeout(publish, 120);
   deadline.current ??= setTimeout(publish, 500);
  },
 });
 liveEditor.current = editor;
 useLayoutEffect(() => () => publish(), [publish]);
 useEffect(() => {
  if (!editor || content === lastContent.current) return;
  const next = splitContent(content);
  prefix.current = next.prefix;
  lastContent.current = content;
  editor.commands.setContent(next.body, { contentType: 'markdown', emitUpdate: false });
 }, [content, editor]);
 const searchAdapter = useMemo(() => editor ? richTextSearchAdapter(editor) : null, [editor]);
 useImperativeHandle(ref, () => ({ flush: publish, isDirty: () => dirty.current, insertMarkdown: markdown => editor && !editor.isDestroyed ? editor.chain().focus().insertContent(markdown, { contentType: 'markdown' }).run() : false }), [editor, publish]);
 const state = useEditorState({ editor, selector: ({ editor }) => editor ? {
  bold: editor.isActive('bold'), italic: editor.isActive('italic'), heading: editor.isActive('heading') ? editor.getAttributes('heading').level as number : null,
  bullet: editor.isActive('bulletList'), ordered: editor.isActive('orderedList'), task: editor.isActive('taskList'),
  quote: editor.isActive('blockquote'), code: editor.isActive('codeBlock'), table: editor.isActive('table'),
  undo: editor.can().undo(), redo: editor.can().redo(),
 } : null });
 if (!editor) return null;
 function selectDocumentLine(event: MouseEvent<HTMLElement>) {
  if (!editor || event.detail < 3) return;
  // Browser click counts keep increasing while ProseMirror cycles after three.
  // Bound both mousedown selection and native mouseup finalization. Mouseup
  // must still reach ProseMirror's document listener to clean up its drag state.
  if (selectTextLine(editor.view, event.nativeEvent)) {
   event.preventDefault();
   if (event.type !== 'mouseup') event.stopPropagation();
  }
 }
 function preventSurfaceMultiClick(event: MouseEvent<HTMLElement>) {
  if (!editor || event.detail <= 1 || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target instanceof HTMLImageElement && event.target.closest('.editor-image')) return;
  const view = editor.view;
  if (event.target instanceof Element && !event.target.closest('input, textarea, button, select')) {
   const uneditable = event.target.closest('[contenteditable="false"]');
   const container = view.dom.contains(event.target) && !event.target.closest('p, h1, h2, h3, h4, h5, h6, pre');
   if (uneditable || container) {
    event.preventDefault();
    event.stopPropagation();
    return;
   }
  }
  const tableEdge = event.target instanceof Element && event.target.classList.contains('table-hover-edge') && (event.target.classList.contains('top') || event.target.classList.contains('bottom'));
  if (event.target !== event.currentTarget && event.target !== view.dom && event.target !== view.dom.parentElement && !tableEdge) return;
  // Native multi-click selection and ProseMirror's coordinate lookup can reach
  // neighboring code even when the pointer is on the document's blank surface.
  event.preventDefault();
  event.stopPropagation();
 }
 function showContextMenu(event: MouseEvent<HTMLElement>) {
  if (!editor) return;
  event.preventDefault(); event.stopPropagation();
  const keyboard = !event.clientX && !event.clientY;
  const position = keyboard ? null : editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (editor.state.selection.empty && position) editor.commands.setTextSelection(position.pos);
  const selection = editor.state.selection;
  const documentSnapshot = editor.state.doc;
  const selected = !selection.empty;
  const restoreSelection = () => {
   if (!editor.state.doc.eq(documentSnapshot)) throw new Error('笔记内容已变化，请重新选择后操作');
   editor.view.dispatch(editor.state.tr.setSelection(selection));
   editor.view.focus();
  };
  const copy = async (cut = false) => {
   const data = editor.view.serializeForClipboard(selection.content());
   await writeClipboard({ text: data.text, html: data.dom.innerHTML });
   if (editor.isDestroyed) return;
   restoreSelection();
   if (cut) editor.commands.deleteSelection();
  };
  const items: MenuItem[] = [
   { label: '撤销', icon: <Undo2 size={14} />, shortcut: `${modifier}Z`, disabled: !editor.can().undo(), action: () => editor.chain().focus().undo().run() },
   { label: '重做', icon: <Redo2 size={14} />, shortcut: `${modifier}⇧Z`, disabled: !editor.can().redo(), action: () => editor.chain().focus().redo().run() },
   { separator: true },
   { label: '剪切', shortcut: `${modifier}X`, disabled: !selected, action: () => copy(true) },
   { label: '复制', shortcut: `${modifier}C`, disabled: !selected, action: () => copy() },
   { label: '粘贴', shortcut: `${modifier}V`, action: async () => {
    const data = await readClipboard();
    if (editor.isDestroyed) return;
    restoreSelection();
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', data.text);
    if (data.html) clipboardData.setData('text/html', data.html);
    const paste = new ClipboardEvent('paste', { clipboardData });
    if (editor.state.selection.$from.parent.type.spec.code) editor.view.pasteText(data.text, paste);
    else if (data.html) editor.view.pasteHTML(data.html, paste);
    else editor.view.pasteText(data.text, paste);
   } },
   { label: '全选', shortcut: `${modifier}A`, action: () => editor.chain().focus().selectAll().run() },
   { separator: true },
   { label: '加粗', checked: editor.isActive('bold'), shortcut: `${modifier}B`, action: () => editor.chain().focus().toggleBold().run() },
   { label: '斜体', checked: editor.isActive('italic'), shortcut: `${modifier}I`, action: () => editor.chain().focus().toggleItalic().run() },
   { label: '二级标题', shortcut: shortcutLabel(formattingShortcuts.find(item => item.action === 'heading2')!.key, modifier), checked: editor.isActive('heading', { level: 2 }), action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
   { label: '无序列表', shortcut: shortcutLabel(formattingShortcuts.find(item => item.action === 'bulletList')!.key, modifier), checked: editor.isActive('bulletList'), action: () => editor.chain().focus().toggleBulletList().run() },
   { label: '任务列表', shortcut: shortcutLabel(formattingShortcuts.find(item => item.action === 'taskList')!.key, modifier), checked: editor.isActive('taskList'), action: () => editor.chain().focus().toggleTaskList().run() },
   { label: '引用', shortcut: shortcutLabel(formattingShortcuts.find(item => item.action === 'blockquote')!.key, modifier), checked: editor.isActive('blockquote'), action: () => editor.chain().focus().toggleBlockquote().run() },
   { label: '代码块', shortcut: shortcutLabel(formattingShortcuts.find(item => item.action === 'codeBlock')!.key, modifier), checked: editor.isActive('codeBlock'), action: () => editor.chain().focus().toggleCodeBlock().run() },
  ];
  if (editor.isActive('table')) items.push({ separator: true },
   { label: '添加行', action: () => editor.chain().focus().addRowAfter().run() },
   { label: '添加列', action: () => editor.chain().focus().addColumnAfter().run() },
   { label: '删除行', action: () => editor.chain().focus().deleteRow().run() },
   { label: '删除列', action: () => editor.chain().focus().deleteColumn().run() },
   { label: '删除表格', danger: true, action: () => editor.chain().focus().deleteTable().run() });
  const coords = editor.view.coordsAtPos(selection.from);
  contextMenu.open({ x: keyboard ? coords.left : event.clientX, y: keyboard ? coords.bottom : event.clientY, label: '编辑器菜单', items, returnFocus: editor.view.dom });
 }
 function showHeadingMenu(trigger: HTMLButtonElement) {
  if (!editor) return;
  const bounds = trigger.getBoundingClientRect();
  contextMenu.open({ x: bounds.left, y: bounds.bottom + 4, label: '标题级别', returnFocus: trigger,
   items: ([1, 2, 3, 4, 5] as const).map(level => ({
    label: `H${level} · ${['一', '二', '三', '四', '五'][level - 1]}级标题`,
    checked: editor.isActive('heading', { level }),
    shortcut: shortcutLabel(formattingShortcuts.find(item => item.action === `heading${level}`)!.key, modifier),
    action: () => editor.chain().focus().toggleHeading({ level }).run(),
   })),
  });
 }
 const button = (label: string, icon: ReactNode, action: () => void, active = false, disabled = false) => {
  const shortcut = formattingShortcuts.find(item => item.label === label || (label === '二级标题' && item.action === 'heading2'));
  const title = shortcut ? `${label} · ${shortcutLabel(shortcut.key, modifier)}` : label;
  return <button type="button" title={title} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={action} className={active ? 'active' : ''}>{icon}</button>;
 };
 return <MediaContext.Provider value={{ ...media, onError }}>
  <FindReplace adapter={searchAdapter} request={findRequest} />
  <div className="wysiwyg-toolbar" role="toolbar" aria-label="正文格式">
   {button('加粗 · ⌘ B', <Bold size={15} />, () => { editor.chain().focus().toggleBold().run(); }, state?.bold)}
   {button('斜体 · ⌘ I', <Italic size={15} />, () => { editor.chain().focus().toggleItalic().run(); }, state?.italic)}
   <button type="button" className={`heading-select${state?.heading ? ' active' : ''}`} title="选择标题级别" aria-label="标题级别" aria-haspopup="menu" aria-expanded={contextMenu.menu?.label === '标题级别'}
    onMouseDown={event => event.preventDefault()} onClick={event => showHeadingMenu(event.currentTarget)} onKeyDown={event => {
     if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); showHeadingMenu(event.currentTarget); }
    }}><span>H{state?.heading || ''}</span><ChevronDown size={12} aria-hidden="true" /></button>
   <span className="format-divider" />
   {button('无序列表', <List size={16} />, () => { editor.chain().focus().toggleBulletList().run(); }, state?.bullet)}
   {button('有序列表', <ListOrdered size={16} />, () => { editor.chain().focus().toggleOrderedList().run(); }, state?.ordered)}
   {button('任务列表', <ListChecks size={16} />, () => { editor.chain().focus().toggleTaskList().run(); }, state?.task)}
   {button('引用', <Quote size={15} />, () => { editor.chain().focus().toggleBlockquote().run(); }, state?.quote)}
   {button('代码块', <Code2 size={16} />, () => { editor.chain().focus().toggleCodeBlock().run(); }, state?.code)}
   {button('插入表格', <Table2 size={16} />, () => { editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run(); }, false, state?.table)}
   {button('插入图片', <ImagePlus size={16} />, onInsertImage)}
   {button('插入 Excalidraw', <Shapes size={16} />, onInsertDrawing)}
   <span className="format-divider" />
   {button('撤销', <Undo2 size={15} />, () => { editor.chain().focus().undo().run(); }, false, !state?.undo)}
   {button('重做', <Redo2 size={15} />, () => { editor.chain().focus().redo().run(); }, false, !state?.redo)}
   {state?.table && <div className="table-actions">
    <button onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().addRowAfter().run()}>添加行</button>
    <button onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().addColumnAfter().run()}>添加列</button>
    <button onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().deleteRow().run()}>删除行</button>
    <button onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().deleteColumn().run()}>删除列</button>
    <button onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().deleteTable().run()}>删除表格</button>
   </div>}
  </div>
  <article ref={surfaceRef} className="document wysiwyg-document" onMouseDownCapture={preventSurfaceMultiClick} onMouseDown={selectDocumentLine} onMouseUp={selectDocumentLine}>
   {prefix.current && <details className="editor-frontmatter"><summary>文档属性 · 在源码中编辑</summary><pre>{prefix.current}</pre></details>}
   <EditorContent editor={editor} onContextMenu={showContextMenu} onKeyDown={keyboardContextMenu} />
   <BlockInsert editor={editor} surfaceRef={surfaceRef} />
  </article>
  <ContextMenu menu={contextMenu.menu} onClose={contextMenu.close} onError={onError} />
 </MediaContext.Provider>;
});
