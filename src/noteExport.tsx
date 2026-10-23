import { lazy, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import Markdown from './Markdown';
import { displayNoteTitle, drawingJSON, isDrawingNote, isLegacyDrawing } from './drawings';
import type { Api, ExportFormat, ExportOptions, Note } from './types';

export const defaultExportOptions: Omit<ExportOptions, 'filename'> = { format: 'pdf', pageSize: 'A4', landscape: false, margin: 18, fontSize: 15, width: 780 };
export const exportFormatLabel = (format: ExportFormat) => format === 'md' ? 'Markdown' : format === 'excalidraw' ? 'Excalidraw' : format.toUpperCase();
const DrawingPreview = lazy(() => import('./Drawing').then(module => ({ default: module.DrawingPreview })));

// Independent of the app theme and editor width; the same document serves HTML and PDF.
const exportStyles = (options: ExportOptions) => `
@page { size: ${options.pageSize} ${options.landscape ? 'landscape' : 'portrait'}; margin: ${options.margin}mm; }
* { box-sizing: border-box; }
body { margin: 0; background: white; color: #202124; font: ${options.fontSize}px/1.8 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; }
article { max-width: ${options.width}px; padding: 36px; margin: auto; overflow-wrap: anywhere; }
h1,h2,h3,h4,h5,h6 { line-height: 1.35; margin: 1.4em 0 .6em; break-after: avoid; }
h1 { font-size: 2em; } h2 { font-size: 1.5em; border-bottom: 1px solid #ddd; padding-bottom: .3em; }
p,ul,ol,blockquote,pre,table { margin: 0 0 1em; }
a { color: #356346; text-decoration: underline; }
img { display: inline-block; max-width: 100%; height: auto; break-inside: avoid; }
pre { padding: 14px 18px; background: #f5f6f4; border: 1px solid #e5e7e3; border-radius: 5px; white-space: pre-wrap; overflow-wrap: anywhere; }
code { font: .88em/1.6 "SFMono-Regular", Consolas, monospace; } :not(pre)>code { background: #f1f2ef; padding: .15em .3em; border-radius: 3px; }
blockquote { border-left: 3px solid #819b72; padding: 4px 16px; color: #596052; }
table { border-collapse: collapse; width: 100%; table-layout: fixed; } th,td { border: 1px solid #d8ddd5; padding: 7px 10px; text-align: left; } th { background: #f3f5f1; } thead { display: table-header-group; } tr { break-inside: avoid; }
input[type=checkbox] { accent-color: #52764b; } hr { border: 0; border-top: 1px solid #ddd; margin: 24px 0; }
.drawing-preview { display: block; margin: 1em 0; } .drawing-preview-header { display: block; color: #596052; font-size: .9em; margin-bottom: 8px; } .drawing-preview img { display: block; }
.hljs-keyword,.hljs-selector-tag,.hljs-built_in { color: #8b409c; } .hljs-string,.hljs-attr { color: #386749; } .hljs-comment { color: #737b70; } .hljs-number,.hljs-literal { color: #a75a20; } .hljs-title,.hljs-function { color: #285e96; }
@media print { article { max-width: none; padding: 0; } body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
`;

export function exportFilename(title: string, format: ExportFormat) {
 const name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 120) || '未命名笔记';
 return `${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? '_' : ''}${name}.${format}`;
}

function download(filename: string, content: string, type: string) {
 const url = URL.createObjectURL(new Blob([content], { type }));
 const link = document.createElement('a');
 link.href = url; link.download = filename; link.click();
 setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function renderDocument(children: ReactNode, title: string, options: ExportOptions): Promise<string> {
 const host = document.createElement('div');
 host.style.cssText = `position:fixed;left:-10000px;top:0;width:${options.width}px;pointer-events:none`;
 host.setAttribute('aria-hidden', 'true');
 document.body.append(host);
 let renderError: Error | undefined;
 const root = createRoot(host, { onUncaughtError: error => { renderError = error instanceof Error ? error : new Error(String(error)); } });
 try {
  root.render(<Suspense fallback={<span data-export-pending="true" />}><article>{children}</article></Suspense>);
  const deadline = Date.now() + 60000;
  while (!host.querySelector('article') || host.querySelector('[data-export-pending="true"]')) {
   if (renderError) throw renderError;
   if (Date.now() > deadline) throw new Error('导出超时，请检查绘图是否能正常预览后重试');
   await new Promise(resolve => setTimeout(resolve, 50));
  }
  const error = host.querySelector('[role="alert"]');
  if (error) throw new Error(error.textContent || '绘图加载失败');
  const article = host.querySelector('article')!.cloneNode(true) as HTMLElement;
  article.querySelectorAll('[data-export-ignore]').forEach(element => element.remove());
  // Freeze all image bytes, including vault attachments and generated drawing SVGs.
  // Do not silently produce an export with missing images.
  await Promise.all(Array.from(article.querySelectorAll('img')).map(async image => {
   const source = image.getAttribute('src');
   if (!source) throw new Error(`无法导出图片：${image.alt}`);
   image.removeAttribute('loading'); image.removeAttribute('decoding');
   if (source.startsWith('data:')) return;
   try {
    const response = await fetch(source, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('图片读取失败');
    const blob = await response.blob();
    image.src = await new Promise<string>((resolve, reject) => {
     const reader = new FileReader();
     reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(blob);
    });
   } catch { throw new Error(`无法导出图片「${image.alt}」，请先将外部图片转为本地文件后重试`); }
  }));
  const doc = document.implementation.createHTMLDocument(title);
  doc.documentElement.lang = 'zh-CN';
  const charset = doc.createElement('meta'); charset.setAttribute('charset', 'utf-8'); doc.head.prepend(charset);
  const csp = doc.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy';
  csp.content = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'";
  doc.head.append(csp);
  const style = doc.createElement('style'); style.textContent = exportStyles(options); doc.head.append(style);
  doc.body.append(article);
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
 } finally { root.unmount(); host.remove(); }
}

async function printDocument(html: string) {
 const frame = document.createElement('iframe');
 frame.title = '笔记 PDF 导出'; frame.style.cssText = 'position:fixed;width:0;height:0;border:0;';
 try {
  await new Promise<void>((resolve, reject) => {
   frame.onload = () => resolve(); frame.onerror = () => reject(new Error('打印文档加载失败'));
   frame.srcdoc = html; document.body.append(frame);
  });
  const target = frame.contentWindow!;
  await target.document.fonts.ready;
  await Promise.all(Array.from(target.document.images).map(image => image.decode()));
  // Keep the document alive until print preview has closed.
  target.addEventListener('afterprint', () => frame.remove(), { once: true });
  target.focus(); target.print();
 } catch (error) { frame.remove(); throw error; }
}

export async function exportNote(api: Api, note: Note, content: string, options: ExportOptions, notes: Note[]) {
 const { format } = options;
 const filename = exportFilename(options.filename, format);
 const html = format === 'md' ? content : format === 'excalidraw' ? drawingJSON(content) : await renderDocument(
  isDrawingNote(note) || isLegacyDrawing(content)
   ? <><h1>{displayNoteTitle(note)}</h1><DrawingPreview content={content} label={displayNoteTitle(note)} /></>
   : <Markdown content={content} notes={notes} />, displayNoteTitle(note), options);
 if (api.exportNote) return api.exportNote({ format, filename, content: html, pageSize: options.pageSize, landscape: options.landscape });
 if (format === 'pdf') { await printDocument(html); return 'print' as const; }
 download(filename, html, format === 'md' ? 'text/markdown;charset=utf-8' : format === 'excalidraw' ? 'application/json' : 'text/html;charset=utf-8');
 return 'saved' as const;
}
