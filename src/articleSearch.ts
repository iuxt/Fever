export type SearchRange = { from: number; to: number };
export type SearchSegment = { from: number; text: string };
export type SearchOptions = { caseSensitive: boolean; wholeWord: boolean; regex: boolean };
export type SearchMatch = SearchRange & { result: RegExpExecArray };
export const matchLimit = 10000;

export function findMatches(segments: SearchSegment[], query: string, options: SearchOptions, scope: SearchRange | null = null): { matches: SearchMatch[]; error: string; limited: boolean } {
 const matches: SearchMatch[] = [];
 if (!query) return { matches, error: '', limited: false };
 let expression: RegExp;
 try {
  let pattern = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (options.wholeWord) pattern = `(?<![\\p{L}\\p{N}\\p{M}_])(?:${pattern})(?![\\p{L}\\p{N}\\p{M}_])`;
  expression = new RegExp(pattern, `gmu${options.caseSensitive ? '' : 'i'}`);
 } catch { return { matches, error: '正则表达式无效', limited: false }; }
 for (const segment of segments) {
  if (scope && (segment.from > scope.to || segment.from + segment.text.length < scope.from)) continue;
  expression.lastIndex = 0;
  let result: RegExpExecArray | null;
  while ((result = expression.exec(segment.text))) {
   const from = segment.from + result.index, to = from + result[0].length;
   if (!scope || (from >= scope.from && to <= scope.to)) {
    if (matches.length === matchLimit) return { matches, error: '', limited: true };
    matches.push({ from, to, result });
   }
   // Global RegExp.exec does not advance after a zero-width match.
   if (!result[0].length) expression.lastIndex += (segment.text.codePointAt(expression.lastIndex) ?? 0) > 0xffff ? 2 : 1;
  }
 }
 return { matches, error: '', limited: false };
}

export function replacementText(match: SearchMatch, replacement: string, regex: boolean) {
 if (!regex) return replacement;
 const result = match.result;
 return replacement.replace(/\$(\$|&|\d{1,2}|<[^>]+>)/g, (token, group: string) => {
  if (group === '$') return '$';
  if (group === '&') return result[0];
  if (group.startsWith('<')) return result.groups ? result.groups[group.slice(1, -1)] ?? '' : token;
  const index = Number(group);
  if (index > 0 && index < result.length) return result[index] ?? '';
  const first = Number(group[0]);
  return group.length === 2 && first > 0 && first < result.length ? (result[first] ?? '') + group[1] : token;
 });
}

export type SearchChange = SearchRange & { text: string };
export type SearchDocumentChange = { mapPosition: (position: number, association: -1 | 1) => number };
export type SearchAdapter = {
 element: HTMLElement;
 segments: () => SearchSegment[];
 selection: () => SearchRange & { text: string };
 subscribe: (listener: (change: SearchDocumentChange) => void) => () => void;
 highlight: (matches: SearchRange[], active: number, reveal: boolean) => void;
 replace: (changes: SearchChange[]) => void;
 focus: () => void;
};

export type SearchRequest = { requested: boolean; onHandled: () => void };
