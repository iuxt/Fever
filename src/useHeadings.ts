import { useEffect, useState } from 'react';
import type { DocumentHeading } from './headings';

export function useHeadings(content: string, enabled: boolean, documentKey: string) {
 const [result, setResult] = useState<{ documentKey: string; content: string; headings: DocumentHeading[]; error: boolean } | null>(null);
 useEffect(() => {
  if (!enabled) return;
  let cancelled = false;
  let worker: Worker | undefined;
  try {
   worker = new Worker(new URL('./headings.worker.ts', import.meta.url), { type: 'module' });
   worker.onmessage = event => { if (!cancelled) setResult({ documentKey, content, headings: event.data, error: false }); worker?.terminate(); };
   worker.onerror = () => { if (!cancelled) setResult({ documentKey, content, headings: [], error: true }); worker?.terminate(); };
   worker.postMessage(content);
  } catch { setResult({ documentKey, content, headings: [], error: true }); }
  return () => { cancelled = true; worker?.terminate(); };
 }, [content, enabled, documentKey]);
 const currentDocument = enabled && result?.documentKey === documentKey;
 const ready = currentDocument && result.content === content;
 return { headings: currentDocument ? result.headings : [], loading: enabled && !currentDocument, error: ready && result.error };
}
