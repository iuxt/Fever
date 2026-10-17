import { memo, useEffect, useState } from 'react';

// Mermaid has global configuration: serialize initialization and rendering so
// simultaneous diagrams cannot overwrite each other's theme or render state.
let rendering: Promise<unknown> = Promise.resolve();
let nextId = 0;

export default memo(function Mermaid({ content }: { content: string }) {
 const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');
 const [result, setResult] = useState<{ content: string; dark: boolean; url?: string; error?: string }>();
 useEffect(() => {
  const observer = new MutationObserver(() => setDark(document.documentElement.dataset.theme === 'dark'));
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
 }, []);
 useEffect(() => {
  let cancelled = false;
  const timer = setTimeout(() => {
   const task = rendering.then(async () => {
    if (cancelled) return;
    const { default: mermaid } = await import('mermaid');
    await document.fonts.ready;
    if (cancelled) return;
    mermaid.initialize({
     startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
     theme: dark ? 'dark' : 'default', fontFamily: 'Arial, sans-serif',
     htmlLabels: false, flowchart: { htmlLabels: false },
     secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'htmlLabels', 'flowchart'],
    });
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;visibility:hidden;pointer-events:none';
    host.setAttribute('aria-hidden', 'true');
    document.body.append(host);
    try {
     const { svg } = await mermaid.render(`fever-mermaid-${++nextId}`, content, host);
     // Give the SVG image intrinsic dimensions instead of a percentage width.
     const svgDocument = new DOMParser().parseFromString(svg, 'image/svg+xml');
     const element = svgDocument.documentElement;
     const bounds = element.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
     if (bounds?.length === 4 && bounds.every(Number.isFinite) && bounds[2] > 0 && bounds[3] > 0) {
      element.setAttribute('width', String(bounds[2]));
      element.setAttribute('height', String(bounds[3]));
     }
     const image = new XMLSerializer().serializeToString(element);
     // An SVG image isolates diagram markup from the application DOM and keeps
     // the rendered graph self-contained when notes are exported.
     if (!cancelled) setResult({ content, dark, url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(image)}` });
    } finally { host.remove(); }
   });
   rendering = task.catch(error => {
    if (!cancelled) setResult({ content, dark, error: error instanceof Error ? error.message : String(error) });
   });
  }, 180);
  return () => { cancelled = true; clearTimeout(timer); };
 }, [content, dark]);
 const current = result?.content === content && result.dark === dark ? result : undefined;
 return <div className="mermaid-preview" role="group" aria-label="Mermaid 图表" data-export-pending={!current ? 'true' : undefined}>
  {!current ? <span role="status">正在渲染 Mermaid 图表…</span> : current.error ? <>
   <div className="mermaid-error" role="alert">Mermaid 图表渲染失败，请检查源码。<details><summary>错误详情</summary><pre>{current.error}</pre></details></div>
   <pre><code className="language-mermaid">{content}</code></pre>
  </> : <img src={current.url} alt="Mermaid 图表" />}
 </div>;
});
