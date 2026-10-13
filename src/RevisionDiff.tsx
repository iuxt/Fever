import { useMemo } from 'react';
import { diffLines } from 'diff';
import type { RevisionComparison } from './types';

export default function RevisionDiff({ comparison, hash }: { comparison: RevisionComparison; hash: string }) {
 const changes = useMemo(() => diffLines(comparison.previousContent, comparison.content), [comparison.previousContent, comparison.content]);
 const unchanged = comparison.previousContent === comparison.content;
 return <div className="revision-diff">
  <div className="diff-meta"><span>{comparison.previousHash ? `上一版本（${comparison.previousHash.slice(0, 7)}）` : '空白版本'} → 此版本（{hash.slice(0, 7)}）</span><span>完整内容 · 绿色新增 · 红色删除</span>{unchanged && <span>内容无变化</span>}</div>
  <pre className="git-diff" aria-label="历史版本差异">{changes.flatMap((change, index) => {
   const lines = change.value.split('\n');
   if (lines.at(-1) === '') lines.pop();
   const prefix = change.added ? '+' : change.removed ? '-' : ' ';
   const style = change.added ? 'diff-add' : change.removed ? 'diff-remove' : 'diff-context';
   const rendered = lines.map((line, lineIndex) => <span key={`${index}:${lineIndex}`} className={`diff-line ${style}`}>{prefix}{line}{'\n'}</span>);
   if (!change.value.endsWith('\n')) rendered.push(<span key={`${index}:eof`} className="diff-line diff-header">末行无换行符{'\n'}</span>);
   return rendered;
  })}{!changes.length && <span className="diff-line diff-header">此版本内容为空。{'\n'}</span>}</pre>
 </div>;
}
