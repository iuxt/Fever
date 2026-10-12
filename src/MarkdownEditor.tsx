import { createContext, memo, useContext, useEffect, useImperativeHandle, useRef, useState, type MouseEvent, type ReactNode, type Ref } from 'react';
import { EditorContent, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Paragraph from '@tiptap/extension-paragraph';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Code2, Heading2, Italic, List, ListChecks, ListOrdered, Quote, Redo2, Table2, Undo2 } from 'lucide-react';
import type { Editor } from '@tiptap/core';
import ContextMenu, { keyboardContextMenu, modifier, useContextMenu, type MenuItem } from './ContextMenu';
import { readClipboard, writeClipboard } from './clipboard';
import { InteractiveTable } from './InteractiveTable';
import { codeLanguages, lowlight } from './codeHighlight';

export type MarkdownEditorHandle = { insertMarkdown: (markdown: string) => boolean };
type Media = { image: (src: string, alt: string) => ReactNode; drawing: (content: string) => ReactNode };
const MediaContext = createContext<Media | null>(null);

function ImageView({ node, selected }: NodeViewProps) {
 const media = useContext(MediaContext)!;
 return <NodeViewWrapper as="span" className={`editor-image${selected ? ' selected' : ''}`} contentEditable={false}>{media.image(node.attrs.src, node.attrs.alt || '')}</NodeViewWrapper>;
}

const EditorImage = Image.extend({ addNodeView() { return ReactNodeViewRenderer(ImageView); } }).configure({ inline: true });
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
  const [src, alt] = (token.text || '').split('|');
  return helpers.createNode('wikiImage', { src, alt: alt || src, source: token.raw });
 },
 renderMarkdown: node => node.attrs?.source || `![[${node.attrs?.src}]]`,
});

function CodeView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
 const media = useContext(MediaContext)!;
 const [source, setSource] = useState(false);
 const drawing = node.attrs.language === 'excalidraw';
 const language = node.attrs.language || '';
 function setLanguage(value: string) {
  const position = getPos();
  if (typeof position !== 'number') return;
  // Select this block so language changes also refresh its highlight decorations.
  const { from, to } = editor.state.selection;
  if (from < position + 1 || to > position + node.nodeSize - 1) editor.commands.setTextSelection(position + 1);
  updateAttributes({ language: value || null });
 }
 return <NodeViewWrapper className="editor-code-block">
  <div className="editor-code-label" contentEditable={false}>
   <select aria-label="代码块语言" title="代码块语言" value={language} onChange={event => setLanguage(event.target.value)}>
    <option value="">自动识别</option>
    {language && !codeLanguages.includes(language) && <option value={language}>{language}</option>}
    {codeLanguages.map(value => <option key={value} value={value}>{value === 'plaintext' ? '纯文本' : value}</option>)}
   </select>
   {drawing && <button type="button" onClick={() => setSource(!source)}>{source ? '查看绘图' : '编辑数据'}</button>}
  </div>
  {drawing && !source ? <div contentEditable={false}>{media.drawing(node.textContent)}</div> : <pre><NodeViewContent<'code'> as="code" className={language ? `language-${language}` : undefined} /></pre>}
 </NodeViewWrapper>;
}
const EditorCodeBlock = CodeBlockLowlight.extend({
 addNodeView() { return ReactNodeViewRenderer(CodeView); },
 renderMarkdown(node) {
  const text = (node.content || []).map(child => child.text || '').join('');
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), match => match[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${node.attrs?.language || ''}\n${text}\n${fence}`;
 },
}).configure({ lowlight });
const EditorParagraph = Paragraph.extend({
 parseMarkdown(token, helpers) {
  // Tiptap's default parser unwraps lone images as blocks; ours stay inline.
  if (token.tokens?.length === 1 && token.tokens[0].type === 'image') {
   return helpers.createNode('paragraph', undefined, helpers.parseInline(token.tokens));
  }
  return this.parent?.(token, helpers) || helpers.createNode('paragraph', undefined, helpers.parseInline(token.tokens || []));
 },
});
const extensions = [
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

export default memo(function MarkdownEditor({ content, onChange, media, ref, onError }: {
 content: string; onChange: (value: string) => void; media: Media; ref?: Ref<MarkdownEditorHandle>; onError: (message: string) => void;
}) {
 const contextMenu = useContextMenu();
 const initial = useRef(splitContent(content));
 const prefix = useRef(initial.current.prefix), lastContent = useRef(content);
 const editor: Editor | null = useEditor({
  extensions,
  content: initial.current.body, contentType: 'markdown',
  editorProps: {
   attributes: { class: 'prose wysiwyg-content', role: 'textbox', 'aria-label': '笔记正文', 'aria-multiline': 'true', spellcheck: 'false' },
   handlePaste(view, event): boolean {
    if (event.clipboardData?.files.length || event.clipboardData?.getData('text/html')) return false;
    const text = event.clipboardData?.getData('text/plain') || '';
    if (view.state.selection.$from.parent.type.spec.code || !/(^|\n)(?:#{1,6} |[-*+] |\d+\. |>|```|\|)|\*\*[^*]+\*\*|!\[|\[[^\]]+\]\(/.test(text)) return false;
    return editor?.commands.insertContent(text, { contentType: 'markdown' }) || false;
   },
  },
  onUpdate({ editor, transaction }) {
   if (!transaction.docChanged) return;
   const markdown = editor.getMarkdown();
   const value = prefix.current + markdown + (markdown ? '\n' : '');
   lastContent.current = value;
   onChange(value);
  },
 });
 useEffect(() => {
  if (!editor || content === lastContent.current) return;
  const next = splitContent(content);
  prefix.current = next.prefix;
  lastContent.current = content;
  editor.commands.setContent(next.body, { contentType: 'markdown', emitUpdate: false });
 }, [content, editor]);
 useImperativeHandle(ref, () => ({ insertMarkdown: markdown => editor && !editor.isDestroyed ? editor.chain().focus().insertContent(markdown, { contentType: 'markdown' }).run() : false }), [editor]);
 const state = useEditorState({ editor, selector: ({ editor }) => editor ? {
  bold: editor.isActive('bold'), italic: editor.isActive('italic'), heading: editor.isActive('heading', { level: 2 }),
  bullet: editor.isActive('bulletList'), ordered: editor.isActive('orderedList'), task: editor.isActive('taskList'),
  quote: editor.isActive('blockquote'), code: editor.isActive('codeBlock'), table: editor.isActive('table'),
  undo: editor.can().undo(), redo: editor.can().redo(),
 } : null });
 if (!editor) return null;
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
   { label: '二级标题', checked: editor.isActive('heading', { level: 2 }), action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
   { label: '无序列表', checked: editor.isActive('bulletList'), action: () => editor.chain().focus().toggleBulletList().run() },
   { label: '任务列表', checked: editor.isActive('taskList'), action: () => editor.chain().focus().toggleTaskList().run() },
   { label: '引用', checked: editor.isActive('blockquote'), action: () => editor.chain().focus().toggleBlockquote().run() },
   { label: '代码块', checked: editor.isActive('codeBlock'), action: () => editor.chain().focus().toggleCodeBlock().run() },
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
 const button = (label: string, icon: ReactNode, action: () => void, active = false, disabled = false) =>
  <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={action} className={active ? 'active' : ''}>{icon}</button>;
 return <MediaContext.Provider value={media}>
  <div className="wysiwyg-toolbar" role="toolbar" aria-label="正文格式">
   {button('加粗 · ⌘ B', <Bold size={15} />, () => { editor.chain().focus().toggleBold().run(); }, state?.bold)}
   {button('斜体 · ⌘ I', <Italic size={15} />, () => { editor.chain().focus().toggleItalic().run(); }, state?.italic)}
   {button('二级标题', <Heading2 size={17} />, () => { editor.chain().focus().toggleHeading({ level: 2 }).run(); }, state?.heading)}
   <span className="format-divider" />
   {button('无序列表', <List size={16} />, () => { editor.chain().focus().toggleBulletList().run(); }, state?.bullet)}
   {button('有序列表', <ListOrdered size={16} />, () => { editor.chain().focus().toggleOrderedList().run(); }, state?.ordered)}
   {button('任务列表', <ListChecks size={16} />, () => { editor.chain().focus().toggleTaskList().run(); }, state?.task)}
   {button('引用', <Quote size={15} />, () => { editor.chain().focus().toggleBlockquote().run(); }, state?.quote)}
   {button('代码块', <Code2 size={16} />, () => { editor.chain().focus().toggleCodeBlock().run(); }, state?.code)}
   {button('插入表格', <Table2 size={16} />, () => { editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run(); }, false, state?.table)}
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
  <article className="document wysiwyg-document">
   {prefix.current && <details className="editor-frontmatter"><summary>文档属性 · 在源码中编辑</summary><pre>{prefix.current}</pre></details>}
   <EditorContent editor={editor} onContextMenu={showContextMenu} onKeyDown={keyboardContextMenu} />
  </article>
  <ContextMenu menu={contextMenu.menu} onClose={contextMenu.close} onError={onError} />
 </MediaContext.Provider>;
});
