import { FileText, Minus, Plus, RotateCcw, FilePenLine, CheckCheck } from 'lucide-react';
import type { Change, FileDiff, GitStatus, Note } from './types';

type Props = {
 status: GitStatus | null;
 notes: Note[];
 busy: boolean;
 onDiff: (change: Change, staged: boolean) => void;
 onStage: (change: Change) => void;
 onUnstage: (change: Change) => void;
 onDiscard: (change: Change) => void;
 onOpen: (change: Change) => void;
};

export default function GitChanges({ status, notes, busy, onDiff, onStage, onUnstage, onDiscard, onOpen }: Props) {
 const changes = status?.changes || [];
 const groups = [
  { title: '已暂存变更', staged: true, changes: changes.filter(c => c.staged) },
  { title: '工作区变更', staged: false, changes: changes.filter(c => c.unstaged) },
 ];
 return <div className="git-changes">{groups.map(group => <section className="changes-group" key={group.title} aria-label={group.title}>
  <div className="changes-title"><span className="changes-heading">{group.title}</span><span className="changes-count">{group.changes.length}</span></div>
  <div className="changes-list">{group.changes.map(change => {
   const name = notes.find(n => `notes/${n.filename}` === change.path)?.title || change.path;
   return <div className="change" key={change.path}>
    <button className="change-file" title={change.path} aria-label={`查看${group.staged ? '已暂存' : '工作区'}差异：${name}`} disabled={busy} onClick={() => onDiff(change, group.staged)}><FileText size={13} /><span>{name}</span><code>{change.status === '??' ? 'U' : change.status}</code></button>
    <div className="change-actions">
     <button className="icon-button change-secondary-action" title={`打开文件：${change.path}`} disabled={busy || change.status === 'D' || change.status === 'AD'} onClick={() => onOpen(change)}><FilePenLine size={13} /></button>
     <button className="icon-button change-secondary-action" title={`撤销变更：${change.path}`} disabled={busy} onClick={() => onDiscard(change)}><RotateCcw size={13} /></button>
     {group.staged ? <button className="icon-button" title={`取消暂存：${change.path}`} disabled={busy} onClick={() => onUnstage(change)}><Minus size={15} /></button> : <button className="icon-button" title={`暂存变更：${change.path}`} disabled={busy} onClick={() => onStage(change)}><Plus size={15} /></button>}
    </div>
   </div>;
  })}</div>
 </section>)}{!changes.length && <div className="clean-state"><CheckCheck size={26} /><span>无待提交变更</span></div>}</div>;
}

export function GitDiff({ diff, staged }: { diff: FileDiff; staged: boolean }) {
 return <><div className="diff-meta"><code>{diff.path}</code><span>{staged ? '上次提交 → 暂存版本' : '暂存版本（或上次提交）→ 工作区'}</span></div><pre className="git-diff" aria-label="文件变更对比">{diff.patch.split('\n').map((line, index) => <span key={index} className={`diff-line ${line.startsWith('@@') ? 'diff-hunk' : /^(diff |index |--- |\+\+\+ )/.test(line) ? 'diff-header' : line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-remove' : ''}`}>{line || ' '}{'\n'}</span>)}</pre></>;
}
