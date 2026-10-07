import { useEffect, useRef, useState } from 'react';
import { Excalidraw, MainMenu, exportToSvg, loadFromBlob, serializeAsJSON } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawInitialDataState, ExcalidrawProps } from '@excalidraw/excalidraw/types';
import { drawingJSON, replaceDrawing } from './drawings';

// Ship fonts with Fever so canvas text and SVG previews also work offline.
window.EXCALIDRAW_ASSET_PATH = new URL('./excalidraw-assets/', document.baseURI).href;

const load = (content: string) => loadFromBlob(new Blob([drawingJSON(content)], { type: 'application/json' }), null, null);

export function DrawingPreview({ content, label = 'Excalidraw 绘图', onEdit }: { content: string; label?: string; onEdit?: () => void }) {
 const [preview, setPreview] = useState(''), [error, setError] = useState(''), [empty, setEmpty] = useState(false);
 useEffect(() => {
  let cancelled = false, url = '';
  setPreview(''); setError(''); setEmpty(false);
  load(content).then(async scene => {
   if (cancelled) return;
   const elements = scene.elements.filter(element => !element.isDeleted);
   if (!elements.length) { if (!cancelled) setEmpty(true); return; }
   const svg = await exportToSvg({ elements, appState: { ...scene.appState, exportBackground: true, exportWithDarkMode: false }, files: scene.files });
   if (!cancelled) { url = URL.createObjectURL(new Blob([svg.outerHTML], { type: 'image/svg+xml' })); setPreview(url); }
  }).catch(e => { if (!cancelled) setError(`绘图加载失败：${e.message}`); });
  return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
 }, [content]);
 return <span className="drawing-preview"><span className="drawing-preview-header"><strong>{label}</strong>{onEdit && <button className="text-button" onClick={onEdit}>编辑绘图</button>}</span>{error ? <span role="alert" className="drawing-error">{error}</span> : preview ? <img src={preview} alt={label} /> : <span className="drawing-placeholder">{empty ? '空白画布，点击「编辑绘图」开始画图' : '正在加载绘图…'}</span>}</span>;
}

export default function DrawingEditor({ content, dark, onChange }: { content: string; dark: boolean; onChange: (content: string) => void }) {
 const [scene, setScene] = useState<ExcalidrawInitialDataState | null>(null), [error, setError] = useState('');
 const last = useRef(''), original = useRef(content), change = useRef(onChange);
 original.current = content; change.current = onChange;
 useEffect(() => {
  let cancelled = false;
  load(original.current).then(data => {
   if (cancelled) return;
   last.current = serializeAsJSON(data.elements, data.appState, data.files, 'local');
   setScene({ ...data, scrollToContent: true });
  }).catch(e => { if (!cancelled) setError(`绘图加载失败：${e.message}`); });
  return () => { cancelled = true; };
 }, []);
 const changed: ExcalidrawProps['onChange'] = (elements, appState, files) => {
  const json = serializeAsJSON(elements, appState, files, 'local');
  if (json === last.current) return;
  try { const value = replaceDrawing(original.current, json); last.current = json; change.current(value); }
  catch (e) { setError((e as Error).message); }
 };
 if (error) return <div role="alert" className="drawing-error">{error}</div>;
 if (!scene) return <div className="drawing-placeholder">正在加载画布…</div>;
 return <div className="drawing-canvas" onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation(); }}><Excalidraw initialData={scene} theme={dark ? 'dark' : 'light'} langCode="zh-CN" onChange={changed} validateEmbeddable={false} UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: false } }}><MainMenu><MainMenu.DefaultItems.ClearCanvas /><MainMenu.DefaultItems.ChangeCanvasBackground /></MainMenu></Excalidraw></div>;
}
