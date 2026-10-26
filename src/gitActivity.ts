import type { GitFileChange, PullRecord } from './types';

export function fileChangeSummary(changes: GitFileChange[]) {
 const groups = [
  ['新增', changes.filter(change => /[AC]/.test(change.status[0])).length],
  ['修改', changes.filter(change => /[MT]/.test(change.status[0])).length],
  ['删除', changes.filter(change => change.status[0] === 'D').length],
  ['重命名', changes.filter(change => change.status[0] === 'R').length],
 ] as const;
 const detail = groups.filter(([, count]) => count).map(([label, count]) => `${label} ${count}`).join(' · ');
 return `${changes.length} 个文件${detail ? `（${detail}）` : ''}`;
}

const key = (path: string) => `fever-last-pull:${path}`;
export function loadLastPull(path: string): PullRecord | null {
 try {
  const record = JSON.parse(localStorage.getItem(key(path)) || 'null');
  if (record && (record.before === '' || /^[0-9a-f]{40,64}$/.test(record.before)) && /^[0-9a-f]{40,64}$/.test(record.after)
   && Number.isInteger(record.commitCount) && record.commitCount >= 0 && typeof record.pulledAt === 'string' && Number.isFinite(Date.parse(record.pulledAt))
   && Array.isArray(record.changes) && record.changes.every((change: GitFileChange) => change && typeof change.path === 'string' && /^[ACDMRTUXB]$/.test(change.status) && (change.originalPath === undefined || typeof change.originalPath === 'string'))) return record;
 } catch { /* Git operations still work without saved activity. */ }
 return null;
}
export function saveLastPull(path: string, record: PullRecord) {
 try { localStorage.setItem(key(path), JSON.stringify(record)); }
 catch { /* Keep the current session's activity when storage is unavailable. */ }
}
