import { notePath } from './notePaths.ts';
import { FileText, Minus, Plus, RotateCcw, FilePenLine, CheckCheck } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PagedText } from './PagedDiff';
import type { Change, FileDiff, GitStatus, Note } from './types';

type Props = {
 status: GitStatus | null;
 notes: Note[];
 trash?: Note[];
 busy: boolean;
 onDiff: (change: Change, staged: boolean) => void;
 onStage: (change: Change) => void;
 onUnstage: (change: Change) => void;
 onDiscard: (change: Change) => void;
 onStageAll: () => void;
 onDiscardAll: () => void;
 onOpen: (change: Change) => void;
};
const emptyChanges: Change[] = [];

export default function GitChanges({ status, notes, trash = [], busy, onDiff, onStage, onUnstage, onDiscard, onStageAll, onDiscardAll, onOpen }: Props) {
 const container = useRef<HTMLDivElement>(null);
 const [viewport, setViewport] = useState({ top: 0, height: 600 });
 const titles = useMemo(() => new Map(notes.map(note => [notePath(note), note.title])), [notes]);
 const trashedPaths = useMemo(() => new Set(trash.map(note => notePath(note))), [trash]);
 const changes = status?.changes || emptyChanges;
 const groups = [
  { title: '已暂存变更', staged: true, changes: changes.filter(c => c.staged) },
  { title: '工作区变更', staged: false, changes: changes.filter(c => c.unstaged) },
 ];
 useLayoutEffect(() => {
  const element = container.current!;
  const update = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
  const observer = new ResizeObserver(update); observer.observe(element); update();
  return () => observer.disconnect();
 }, []);
 useLayoutEffect(() => { const element = container.current!; setViewport({ top: element.scrollTop, height: element.clientHeight }); }, [changes]);
 let top = 0;
 return <div ref={container} className="git-changes" onScroll={event => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>{groups.map(group => {
  const rowTop = top + 34;
  top = rowTop + group.changes.length * 34 + 16;
  const start = Math.max(0, Math.floor((viewport.top - rowTop) / 34) - 6);
  const end = Math.max(0, Math.min(group.changes.length, Math.ceil((viewport.top + viewport.height - rowTop) / 34) + 6));
  return <section className="changes-group" key={group.title} aria-label={group.title}>
  <div className="changes-title"><span className="changes-heading">{group.title}</span><span className="changes-count">{group.changes.length}</span>{!group.staged && <div className="changes-group-actions">
   <button className="icon-button" title="全部还原" aria-label="全部还原" disabled={busy || !group.changes.length} onClick={onDiscardAll}><RotateCcw size={14} /></button>
   <button className="icon-button" title="全部暂存" aria-label="全部暂存" disabled={busy || !group.changes.length} onClick={onStageAll}><Plus size={16} /></button>
  </div>}</div>
  <div className="changes-list virtual-changes-list" style={{ height: group.changes.length * 34 }}>{group.changes.slice(start, end).map((change, index) => {
   const name = titles.get(change.path) || change.path;
   const trashed = trashedPaths.has(change.path) || Boolean(change.originalPath && trashedPaths.has(change.originalPath));
   return <div className="change" key={change.path} style={{ top: (start + index) * 34 }}>
    <button className="change-file" title={change.path} aria-label={`查看${group.staged ? '已暂存' : '工作区'}差异：${name}`} disabled={busy} onClick={() => onDiff(change, group.staged)}><FileText size={13} /><span>{name}</span><code>{change.status === '??' ? 'U' : change.status}</code></button>
    <div className="change-actions">
     <button className="icon-button change-secondary-action" title={`打开文件：${change.path}`} disabled={busy || change.status === 'D' || change.status === 'AD'} onClick={() => onOpen(change)}><FilePenLine size={13} /></button>
     <button className="icon-button change-secondary-action" title={`撤销变更：${change.path}`} disabled={busy || trashed} onClick={() => onDiscard(change)}><RotateCcw size={13} /></button>
     {group.staged ? <button className="icon-button" title={`取消暂存：${change.path}`} disabled={busy} onClick={() => onUnstage(change)}><Minus size={15} /></button> : <button className="icon-button" title={`暂存变更：${change.path}`} disabled={busy} onClick={() => onStage(change)}><Plus size={15} /></button>}
    </div>
   </div>;
  })}</div>
 </section>; })}{!changes.length && <div className="clean-state"><CheckCheck size={26} /><span>无待提交变更</span></div>}</div>;
}

export function GitDiff({ diff, staged }: { diff: FileDiff; staged: boolean }) {
 return <><div className="diff-meta"><code>{diff.path}</code><span>{staged ? '上次提交 → 暂存版本' : '暂存版本（或上次提交）→ 工作区'}</span></div><PagedText key={`${staged}:${diff.path}`} text={diff.patch} label="文件变更对比" patch /></>;
}
