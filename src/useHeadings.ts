import { useEffect, useState } from 'react';
import type { DocumentHeading } from './headings';

export function useHeadings(content: string, enabled: boolean) {
 const [result, setResult] = useState<{ content: string; headings: DocumentHeading[]; error: boolean } | null>(null);
 useEffect(() => {
  if (!enabled) { setResult(null); return; }
  let worker: Worker | undefined;
  try {
   worker = new Worker(new URL('./headings.worker.ts', import.meta.url), { type: 'module' });
   worker.onmessage = event => { setResult({ content, headings: event.data, error: false }); worker?.terminate(); };
   worker.onerror = () => { setResult({ content, headings: [], error: true }); worker?.terminate(); };
   worker.postMessage(content);
  } catch { setResult({ content, headings: [], error: true }); }
  return () => worker?.terminate();
 }, [content, enabled]);
 const ready = enabled && result?.content === content;
 return { headings: ready ? result.headings : [], loading: enabled && !ready, error: ready && result.error };
}
