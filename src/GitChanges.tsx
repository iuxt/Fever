import { notePath } from './notePaths.ts';
import { displayNoteTitle } from './drawings';
import { FileText, Minus, Plus, RotateCcw, FilePenLine, CheckCheck } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PagedText } from './PagedDiff';
import type { Change, FileDiff, GitFileChange, GitStatus, Note, PullRecord } from './types';

type Props = {
 status: GitStatus | null;
 notes: Note[];
 trash?: Note[];
 busy: boolean;
 ignoreWhitespace: boolean;
 lastPull: PullRecord | null;
 onRemoteDiff: (change: GitFileChange) => void;
 onDiff: (change: Change, staged: boolean) => void;
 onStage: (change: Change) => void;
 onUnstage: (change: Change) => void;
 onDiscard: (change: Change) => void;
 onStageAll: () => void;
 onDiscardAll: () => void;
 onOpen: (change: Change) => void;
};
const emptyChanges: Change[] = [];

export default function GitChanges({ status, notes, trash = [], busy, ignoreWhitespace, lastPull, onRemoteDiff, onDiff, onStage, onUnstage, onDiscard, onStageAll, onDiscardAll, onOpen }: Props) {
 const container = useRef<HTMLDivElement>(null);
 const [viewport, setViewport] = useState({ top: 0, height: 600 });
 const titles = useMemo(() => new Map(notes.map(note => [notePath(note), displayNoteTitle(note)])), [notes]);
 const trashedPaths = useMemo(() => new Set(trash.map(note => notePath(note))), [trash]);
 const changes = useMemo(() => {
  const raw = status?.changes || emptyChanges;
  return ignoreWhitespace ? raw.map(change => ({ ...change, staged: change.staged && !change.stagedWhitespaceOnly, unstaged: change.unstaged && !change.unstagedWhitespaceOnly })).filter(change => change.staged || change.unstaged) : raw;
 }, [status?.changes, ignoreWhitespace]);
 const hiddenCount = (status?.changes || emptyChanges).reduce((count, change) => count + Number(change.staged && Boolean(change.stagedWhitespaceOnly)) + Number(change.unstaged && Boolean(change.unstagedWhitespaceOnly)), 0);
 const remoteChanges = useMemo(() => lastPull?.changes.map(change => ({ ...change, staged: false, unstaged: false })) || emptyChanges, [lastPull]);
 const groups = [
  { title: '已暂存变更', staged: true, remote: false, changes: changes.filter(c => c.staged) },
  { title: '工作区变更', staged: false, remote: false, changes: changes.filter(c => c.unstaged) },
  { title: '远端变更', staged: false, remote: true, changes: remoteChanges },
 ];
 useLayoutEffect(() => {
  const element = container.current!;
  const update = () => setViewport({ top: element.scrollTop, height: element.clientHeight });
  const observer = new ResizeObserver(update); observer.observe(element); update();
  return () => observer.disconnect();
 }, []);
 useLayoutEffect(() => { const element = container.current!; setViewport({ top: element.scrollTop, height: element.clientHeight }); }, [changes, remoteChanges]);
 let top = 0;
 return <div ref={container} className="git-changes" onScroll={event => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight })}>{groups.map(group => {
  const rowTop = top + 34 + (group.remote ? 30 : 0);
  top = rowTop + group.changes.length * 34 + 16;
  const start = Math.max(0, Math.floor((viewport.top - rowTop) / 34) - 6);
  const end = Math.max(0, Math.min(group.changes.length, Math.ceil((viewport.top + viewport.height - rowTop) / 34) + 6));
  return <section className="changes-group" key={group.title} aria-label={group.title}>
  <div className="changes-title"><span className="changes-heading">{group.title}</span><span className="changes-count">{group.changes.length}</span>{!group.staged && !group.remote && <div className="changes-group-actions">
   <button className="icon-button" title="全部还原" aria-label="全部还原" disabled={busy || !group.changes.length} onClick={onDiscardAll}><RotateCcw size={14} /></button>
   <button className="icon-button" title="全部暂存" aria-label="全部暂存" disabled={busy || !group.changes.length} onClick={onStageAll}><Plus size={16} /></button>
  </div>}</div>
  {group.remote && <p className="remote-changes-meta" title={lastPull ? `${lastPull.before.slice(0, 7)} → ${lastPull.after.slice(0, 7)}` : undefined}>{lastPull ? `${new Date(lastPull.pulledAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · ${lastPull.commitCount} 个提交` : '尚无拉取记录'}</p>}
  <div className="changes-list virtual-changes-list" style={{ height: group.changes.length * 34 }}>{group.changes.slice(start, end).map((change, index) => {
   const name = titles.get(change.path) || change.path;
   const trashed = trashedPaths.has(change.path) || Boolean(change.originalPath && trashedPaths.has(change.originalPath));
   return <div className="change" key={change.path} style={{ top: (start + index) * 34 }}>
    <button className="change-file" title={change.originalPath ? `${change.originalPath} → ${change.path}` : change.path} aria-label={`查看${group.remote ? '远端' : group.staged ? '已暂存' : '工作区'}差异：${name}`} disabled={busy} onClick={() => group.remote ? onRemoteDiff(change) : onDiff(change, group.staged)}><FileText size={13} /><span>{name}</span><code>{change.status === '??' ? 'U' : change.status}</code></button>
    <div className="change-actions">
     <button className="icon-button change-secondary-action" title={`打开${group.remote ? '远端变更' : '文件'}：${change.path}`} disabled={busy || change.status === 'D' || change.status === 'AD'} onClick={() => onOpen(change)}><FilePenLine size={13} /></button>
     {!group.remote && <><button className="icon-button change-secondary-action" title={`撤销变更：${change.path}`} disabled={busy || trashed} onClick={() => onDiscard(change)}><RotateCcw size={13} /></button>
     {group.staged ? <button className="icon-button" title={`取消暂存：${change.path}`} disabled={busy} onClick={() => onUnstage(change)}><Minus size={15} /></button> : <button className="icon-button" title={`暂存变更：${change.path}`} disabled={busy} onClick={() => onStage(change)}><Plus size={15} /></button>}</>}
    </div>
   </div>;
  })}</div>
 </section>; })}{!changes.length && <div className="clean-state"><CheckCheck size={26} /><span>{ignoreWhitespace && hiddenCount ? `已隐藏 ${hiddenCount} 项空白变更` : '无待提交变更'}</span></div>}{changes.length > 0 && ignoreWhitespace && hiddenCount > 0 && <p className="git-filter-summary">已隐藏 {hiddenCount} 项空白变更</p>}</div>;
}

export function GitDiff({ diff, staged, ignoreWhitespace, label }: { diff: FileDiff; staged: boolean; ignoreWhitespace: boolean; label?: string }) {
 const patch = ignoreWhitespace ? diff.whitespaceIgnoredPatch ?? diff.patch : diff.patch;
 return <><div className="diff-meta"><code>{diff.path}</code><span>{label || (staged ? '上次提交 → 暂存版本' : '暂存版本（或上次提交）→ 工作区')}</span></div><PagedText key={`${staged}:${diff.path}:${ignoreWhitespace}`} text={patch} label="文件变更对比" patch /></>;
}
