import { diffLines } from 'diff';

export type DiffRow = { text: string; style: string };
export const DIFF_PAGE_SIZE = 200;

export function revisionRows(before: string, after: string): DiffRow[] | null {
 // A worker prevents UI stalls; these limits also bound its time and output.
 if (before.length + after.length > 2 * 1024 * 1024) return null;
 const changes = diffLines(before, after, { timeout: 300, maxEditLength: 2000 });
 if (!changes) return null;
 const rows: DiffRow[] = [];
 for (const change of changes) {
  const lines = change.value.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (rows.length + lines.length > 20000) return null;
  const prefix = change.added ? '+' : change.removed ? '-' : ' ';
  const style = change.added ? 'diff-add' : change.removed ? 'diff-remove' : 'diff-context';
  for (const line of lines) rows.push({ text: prefix + line, style });
  if (!change.value.endsWith('\n')) rows.push({ text: '末行无换行符', style: 'diff-header' });
 }
 return rows;
}
