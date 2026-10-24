import { lazy, memo, Suspense, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { HighlightedCode } from './codeHighlight';
import remarkLegacyImages from './legacyImages';
import { resolveNoteLink } from './noteLinks';
import { parseImageAlt } from './imageSize';
import remarkDrawingEmbeds, { displayNoteTitle, resolveDrawing } from './drawings';
import { demo } from './demo';
import type { Note, RevisionAsset } from './types';
import Mermaid from './Mermaid';
import CodeCopyButton from './CodeCopyButton';
import remarkHeadingIds, { headingMarkdown } from './headings';
const api = window.fever || demo;
const DrawingPreview = lazy(() => import('./Drawing').then(module => ({ default: module.DrawingPreview })));
const DrawingLoading = () => <span className="drawing-placeholder" data-export-pending="true">正在加载绘图…</span>;

export function DrawingReference({ source, notes, onOpen }: { source: string; notes: Note[]; onOpen?: (id: string) => void }) {
 const note = resolveDrawing(source, notes);
 const [value, setValue] = useState<string | null>(null), [error, setError] = useState('');
 useEffect(() => {
  let cancelled = false; setValue(null); setError('');
  if (!note) { setError('找不到绘图文件，或名称重复。请使用绘图的完整相对路径引用。'); return; }
  api.read(note.id).catch(() => api.read(note.id, 'trash')).then(value => { if (!cancelled) setValue(value); }).catch(e => { if (!cancelled) setError(e.message); });
  return () => { cancelled = true; };
 }, [note?.id, note?.updatedAt]);
 if (error) return <span role="alert" className="drawing-error">{error}</span>;
 return value !== null ? <Suspense fallback={<DrawingLoading />}><DrawingPreview content={value} label={note ? displayNoteTitle(note) : undefined} onEdit={onOpen && note ? () => onOpen(note.id) : undefined} /></Suspense> : <DrawingLoading />;
}

export default memo(function Markdown({ content, revision, notes = [], onOpen, onNavigate }: { content: string; revision?: RevisionAsset; notes?: Note[]; onOpen?: (id: string) => void; onNavigate?: (href: string) => boolean }) {
 const plugins = useMemo(() => [remarkGfm, [remarkDrawingEmbeds, notes], remarkLegacyImages, remarkHeadingIds] as import('unified').PluggableList, [notes]);
 const components = useMemo<import('react-markdown').Components>(() => ({
  img: ({ src, alt, title, node }) => {
   if (/\.excalidraw(?:\.md)?$/i.test(src || '') || resolveDrawing(src || '', notes)) return <DrawingReference source={src || ''} notes={notes} onOpen={onOpen} />;
   const image = parseImageAlt(alt || '');
   return <img src={api.asset(src || '', revision ? { ...revision, wiki: node?.properties['data-wiki'] === 'true' } : undefined) || undefined} alt={image.alt || '笔记图片'} title={title} style={image.width ? { width: image.width, height: 'auto' } : undefined} loading="lazy" decoding="async" />;
  },
  pre: ({ node, children }) => {
   const code = node?.children[0];
   if (code?.type === 'element' && Array.isArray(code.properties.className) && code.properties.className.includes('language-excalidraw')) {
    const json = code.children.map(child => child.type === 'text' ? child.value : '').join('');
    return <Suspense fallback={<DrawingLoading />}><DrawingPreview content={json} /></Suspense>;
   }
   if (code?.type === 'element' && code.tagName === 'code') {
    const classes = Array.isArray(code.properties.className) ? code.properties.className.map(String) : [];
    const language = classes.find(value => value.startsWith('language-'))?.slice('language-'.length);
    const text = code.children.map(child => child.type === 'text' ? child.value : '').join('');
    if (language?.toLowerCase() === 'mermaid') return <Mermaid content={text} />;
    return <div className="preview-code-block"><div className="code-block-actions" data-export-ignore="true"><CodeCopyButton text={text.replace(/\n$/, '')} /></div><pre><HighlightedCode text={text} language={language} className={classes.join(' ')} /></pre></div>;
   }
   return <pre>{children}</pre>;
  },
  a: ({ href, children }) => {
   const internal = Boolean(href && onNavigate && resolveNoteLink(href, notes));
   return <a href={internal || /^(https?:|mailto:|#)/.test(href || '') ? href : undefined} target={internal || href?.startsWith('#') ? undefined : '_blank'} rel="noreferrer" onClick={event => { if (internal) { event.preventDefault(); onNavigate?.(href!); } }}>{children}</a>;
  },
 }), [notes, revision, onOpen, onNavigate]);
 return <ReactMarkdown remarkPlugins={plugins} components={components}>{headingMarkdown(content)}</ReactMarkdown>;
});
