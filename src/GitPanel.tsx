import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, Check, GitBranch, GitCommitHorizontal, LoaderCircle, MoreHorizontal, RefreshCw, Upload } from 'lucide-react';
import type { GitStatus } from './types';

type Props = {
 status: GitStatus | null;
 busy: boolean;
 pulling: boolean;
 stagedCount: number;
 commitMessage: string;
 ignoreWhitespace: boolean;
 operation: { title: string; detail: string } | null;
 onMessage: (message: string) => void;
 onIgnoreWhitespace: (ignore: boolean) => void;
 onRefresh: () => void;
 onPull: () => void;
 onPush: () => void;
 onCommit: () => void;
 children: ReactNode;
};

export default function GitPanel({ status, busy, pulling, stagedCount, commitMessage, ignoreWhitespace, operation, onMessage, onIgnoreWhitespace, onRefresh, onPull, onPush, onCommit, children }: Props) {
 const [optionsOpen, setOptionsOpen] = useState(false);
 const options = useRef<HTMLDivElement>(null);
 const optionsButton = useRef<HTMLButtonElement>(null);
 useEffect(() => {
  if (!optionsOpen) return;
  const dismiss = (event: PointerEvent) => {
   if (!options.current?.contains(event.target as Node)) setOptionsOpen(false);
  };
  const escape = (event: KeyboardEvent) => {
   if (event.key === 'Escape') { event.stopPropagation(); setOptionsOpen(false); optionsButton.current?.focus(); }
  };
  document.addEventListener('pointerdown', dismiss);
  document.addEventListener('keydown', escape);
  return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
 }, [optionsOpen]);
 const commitLabel = stagedCount ? `提交已暂存变更 (${stagedCount})` : '提交所有笔记变更';
 return <>
  <div className="git-repository-header">
   <div className="git-branch-name"><GitBranch size={15} /><strong title={status?.branch}>{status?.branch || '—'}</strong></div>
   <div className="git-toolbar" role="toolbar" aria-label="Git 全局操作">
    <button className="icon-button git-sync-button" title={pulling ? '正在后台拉取，可继续编辑' : `拉取${status?.behind ? ` · ${status.behind} 个提交` : ''}`} aria-label="拉取" aria-busy={pulling} disabled={busy || pulling} onClick={onPull}>{pulling ? <LoaderCircle size={15} className="spin" /> : <ArrowDownToLine size={15} />}{Boolean(status?.behind) && <span>{status?.behind}</span>}</button>
    <button className="icon-button git-sync-button" title={`推送${status?.ahead ? ` · ${status.ahead} 个提交` : ''}`} aria-label="推送" disabled={busy} onClick={onPush}><Upload size={15} />{Boolean(status?.ahead) && <span>{status?.ahead}</span>}</button>
    <div className="git-options" ref={options}>
     <button ref={optionsButton} className="icon-button" title="Git 更多选项" aria-label="Git 更多选项" aria-expanded={optionsOpen} aria-controls="git-options" onClick={() => setOptionsOpen(value => !value)}><MoreHorizontal size={17} /></button>
     {optionsOpen && <div className="git-options-popover" id="git-options" role="group" aria-label="Git 选项">
      <p className="git-remote-address">{status?.remote || '本地仓库 · 未配置远程'}</p>
      <button className="git-refresh" title="刷新 Git 状态" disabled={busy} onClick={() => { setOptionsOpen(false); onRefresh(); }}><RefreshCw size={14} />刷新 Git 状态</button>
      <label className="git-whitespace-filter" title="隐藏纯空白变更，并在提交时还原这些变更，不纳入提交"><span>忽略空格和空行</span><input type="checkbox" role="switch" checked={ignoreWhitespace} disabled={busy} onChange={event => onIgnoreWhitespace(event.target.checked)} /></label>
     </div>}
    </div>
   </div>
  </div>
  <div className="commit-box">
   <textarea aria-label="提交说明" id="git-commit-message" placeholder="这次记录了什么？" value={commitMessage} onChange={event => onMessage(event.target.value)} />
   <button className="primary" aria-label={busy ? '正在处理…' : commitLabel} title={commitLabel} disabled={busy || !commitMessage.trim() || !status?.changes.length} onClick={onCommit}><GitCommitHorizontal size={15} />{busy ? '正在处理…' : stagedCount ? `提交暂存 (${stagedCount})` : '提交变更'}</button>
  </div>
  {children}
  <div className="git-status-footer" role="status" aria-live="polite">
   {pulling ? <><LoaderCircle size={12} className="spin" /><span>正在后台拉取，可继续编辑…</span></> : operation ? <div className="git-operation-summary" title={`${operation.title} · ${operation.detail}`}><Check size={12} /><span>{operation.title} · {operation.detail}</span></div> : <><Check size={12} /><span>{status?.remote ? '远程仓库已配置' : '本地仓库'}</span></>}
  </div>
 </>;
}
