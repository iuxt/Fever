import { useEffect, useState } from 'react';
import { DiffPages, PagedText } from './PagedDiff';
import type { DiffRow } from './diffRows';
import type { RevisionComparison } from './types';

export default function RevisionDiff({ comparison, hash }: { comparison: RevisionComparison; hash: string }) {
 const [result, setResult] = useState<{ comparison: RevisionComparison; rows: DiffRow[] | null } | null>(null);
 useEffect(() => {
  let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined, cancelled = false;
  const finish = (rows: DiffRow[] | null) => { if (!cancelled) setResult({ comparison, rows }); clearTimeout(timer); worker?.terminate(); };
  try {
   worker = new Worker(new URL('./revisionDiff.worker.ts', import.meta.url), { type: 'module' });
   worker.onmessage = event => finish(event.data);
   worker.onerror = () => finish(null);
   timer = setTimeout(() => finish(null), 1500);
   worker.postMessage({ before: comparison.previousContent, after: comparison.content });
  } catch { finish(null); }
  return () => { cancelled = true; clearTimeout(timer); worker?.terminate(); };
 }, [comparison]);
 const ready = result?.comparison === comparison;
 return <div className="revision-diff">
  <div className="diff-meta"><span>{comparison.previousHash ? `上一版本（${comparison.previousHash.slice(0, 7)}）` : '空白版本'} → 此版本（{hash.slice(0, 7)}）</span><span>绿色新增 · 红色删除</span>{comparison.previousContent === comparison.content && <span>内容无变化</span>}</div>
  {!ready ? <p role="status">正在计算差异…</p> : result.rows ? <DiffPages key={hash} rows={result.rows} label="历史版本差异" /> : <>
   <p role="status">差异较大，已改为分页查看两个版本的内容。</p>
   <PagedText key={`${hash}:before`} text={comparison.previousContent} label="上一版本内容" />
   <PagedText key={`${hash}:after`} text={comparison.content} label="此版本内容" />
  </>}
 </div>;
}
