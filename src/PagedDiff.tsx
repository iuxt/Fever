import { useMemo, useState } from 'react';
import { DIFF_PAGE_SIZE, type DiffRow } from './diffRows';

export function DiffPages({ rows, label }: { rows: DiffRow[]; label: string }) {
 const [page, setPage] = useState(0);
 const pages = Math.max(1, Math.ceil(rows.length / DIFF_PAGE_SIZE)), current = Math.min(page, pages - 1);
 return <><PageButtons current={current} pages={pages} onChange={setPage} label={label} />
  <pre className="git-diff" aria-label={label}>{rows.slice(current * DIFF_PAGE_SIZE, (current + 1) * DIFF_PAGE_SIZE).map((row, index) => <span key={index} className={`diff-line ${row.style}`}>{row.text}{'\n'}</span>)}{!rows.length && <span className="diff-line diff-header">此版本内容为空。{'\n'}</span>}</pre>
 </>;
}

function PageButtons({ current, pages, onChange, label }: { current: number; pages: number; onChange: (page: number) => void; label: string }) {
 return pages > 1 ? <nav className="diff-pagination" aria-label={`${label}分页`}>
  <button className="text-button" disabled={current === 0} onClick={() => onChange(current - 1)}>上一页</button>
  <span>第 {current + 1} / {pages} 页</span>
  <button className="text-button" disabled={current + 1 === pages} onClick={() => onChange(current + 1)}>下一页</button>
 </nav> : null;
}

// Store line offsets, not millions of React nodes, even in the fallback view.
export function PagedText({ text, label, patch = false }: { text: string; label: string; patch?: boolean }) {
 const offsets = useMemo(() => {
  const offsets = [0];
  for (let pos = text.indexOf('\n'); pos >= 0 && pos + 1 < text.length; pos = text.indexOf('\n', pos + 1)) offsets.push(pos + 1);
  return offsets;
 }, [text]);
 const [page, setPage] = useState(0);
 const pages = Math.max(1, Math.ceil(offsets.length / DIFF_PAGE_SIZE)), current = Math.min(page, pages - 1);
 const start = current * DIFF_PAGE_SIZE, end = Math.min(offsets.length, start + DIFF_PAGE_SIZE);
 const visible = text.slice(offsets[start], offsets[end] ?? text.length);
 const lines = patch ? visible.replace(/\n$/, '').split('\n') : [];
 return <section className="diff-fallback"><PageButtons current={current} pages={pages} onChange={setPage} label={label} />
  <pre className="git-diff" aria-label={label}>{patch ? lines.map((line, index) => <span key={index} className={`diff-line ${line.startsWith('@@') ? 'diff-hunk' : /^(diff |index |--- |\+\+\+ )/.test(line) ? 'diff-header' : line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-remove' : ''}`}>{line || ' '}{'\n'}</span>) : visible}</pre>
 </section>;
}
