import type { Note } from './types';

// Resolve only known notes; never turn a relative link into filesystem navigation.
export function resolveNoteLink(href: string, notes: Note[]): Note | undefined {
 let target = href.split('#')[0];
 if (!target) return undefined;
 try { target = decodeURIComponent(target); } catch { return undefined; }
 target = target.replaceAll('\\', '/');
 if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('/')) return undefined;
 target = target.replace(/^(?:\.\.\/(?:notes|drawings)\/|\.\/(?:notes|drawings)\/|(?:notes|drawings)\/|\.\/)/, '');
 if (target.split('/').includes('..')) return undefined;
 const matches = notes.filter(note => note.filename === target || note.sourcePath === target);
 return matches.length === 1 ? matches[0] : undefined;
}
