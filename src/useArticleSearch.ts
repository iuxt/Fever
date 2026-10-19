import { useEffect, useMemo, useState } from 'react';
import { findMatches, type SearchOptions, type SearchRange, type SearchSegment } from './articleSearch';

const empty = { matches: [], error: '', limited: false };
export function useArticleSearch(segments: SearchSegment[], query: string, options: SearchOptions, scope: SearchRange | null) {
 const request = useMemo(() => ({ segments, query, options, scope }), [segments, query, options, scope]);
 const immediate = useMemo(() => !query || !options.regex ? findMatches(segments, query, options, scope) : null, [request]);
 const [result, setResult] = useState<{ request: typeof request; value: ReturnType<typeof findMatches> }>();
 useEffect(() => {
  setResult(undefined);
  if (immediate) return;
  let worker: Worker | undefined, cancelled = false;
  let deadline: ReturnType<typeof setTimeout>;
  const finish = (value: ReturnType<typeof findMatches>) => {
   if (!cancelled) setResult({ request, value });
   clearTimeout(deadline); worker?.terminate();
  };
  const delay = setTimeout(() => {
   try {
    worker = new Worker(new URL('./articleSearch.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = event => finish(event.data);
    worker.onerror = () => finish({ ...empty, error: '查找失败，请修改表达式后重试' });
    deadline = setTimeout(() => finish({ ...empty, error: '正则查找超时，请简化表达式或缩小查找范围' }), 1000);
    worker.postMessage(request);
   } catch { finish({ ...empty, error: '无法启动正则查找，请重试' }); }
  }, 80);
  return () => { cancelled = true; clearTimeout(delay); clearTimeout(deadline); worker?.terminate(); };
 }, [request, immediate]);
 const ready = !!immediate || result?.request === request;
 return { ...(immediate ?? (ready ? result!.value : empty)), searching: !ready };
}
