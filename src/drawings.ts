import { notePath } from './notePaths.ts';
import LZString from 'lz-string';
import { visit, SKIP } from 'unist-util-visit';
import type { Root, Image, Text } from 'mdast';
import type { Note } from './types';

export const isLegacyDrawing = (content: string) => /^excalidraw-plugin:[ \t]*\S/m.test(content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || '');
export const isDrawingNote = (note: Note) => /\.excalidraw$/i.test(note.filename) || /\.excalidraw(?:\.md)?$/i.test(note.sourcePath || '') || /\.excalidraw$/i.test(note.title);
const drawingBlock = /^([ \t]*```(compressed-json|json)[ \t]*\r?\n)([\s\S]*?)(^[ \t]*```[ \t]*\r?$)/m;

export function drawingJSON(content: string) {
 if (!isLegacyDrawing(content)) return content;
 const start = content.search(/^## Drawing[ \t]*\r?$/m);
 const block = start < 0 ? null : content.slice(start).match(drawingBlock);
 if (!block) throw new Error('找不到 Excalidraw 绘图数据');
 const json = block[2] === 'compressed-json' ? LZString.decompressFromBase64(block[3].replace(/\s/g, '')) : block[3];
 if (!json) throw new Error('无法解压 Excalidraw 绘图数据');
 return json;
}

export function replaceDrawing(content: string, json: string) {
 if (!isLegacyDrawing(content)) return json;
 const start = content.search(/^## Drawing[ \t]*\r?$/m);
 if (start < 0 || !drawingBlock.test(content.slice(start))) throw new Error('找不到 Excalidraw 绘图数据');
 return content.slice(0, start) + content.slice(start).replace(drawingBlock, (_match, opening: string, format: string, _body: string, closing: string) => {
  const newline = opening.endsWith('\r\n') ? '\r\n' : '\n';
  return `${opening}${format === 'compressed-json' ? LZString.compressToBase64(json) : json.replace(/\r?\n/g, newline)}${newline}${closing}`;
 });
}

export function resolveDrawing(source: string, notes: Note[]) {
 let path = source;
 try { path = decodeURIComponent(path); } catch { /* Leave malformed escapes unchanged. */ }
 path = path.replaceAll('\\', '/');
 if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('/') || path.startsWith('//')) return undefined;
 const relative = path.replace(/^(?:\.\.\/(?:notes|drawings)\/|\.\/(?:notes|drawings)\/|(?:notes|drawings)\/|\.\/)/, '');
 if (relative.split('/').includes('..')) return undefined;
 const exact = notes.filter(note => note.filename === relative || note.sourcePath === relative);
 if (exact.length === 1) return exact[0];
 if (exact.length > 1) return undefined;
 const name = relative.split('/').at(-1)!;
 const matches = notes.filter(note => isDrawingNote(note) && (note.title === relative || note.title === name || `${note.title}.excalidraw` === name || `${note.title}.md` === name || note.sourcePath?.split('/').at(-1) === name));
 return matches.length === 1 ? matches[0] : undefined;
}

// Use Markdown AST nodes so fenced code and inline code keep their literal text.
export default function remarkDrawingEmbeds(notes: Note[] = []) {
 return (tree: Root) => {
  visit(tree, 'text', (node, index, parent) => {
   if (!parent || index === undefined) return;
   const replacements: (Text | Image)[] = [];
   let cursor = 0;
   for (const match of node.value.matchAll(/!\[\[([^\]\n]+)\]\]/g)) {
    const [source, alias] = match[1].split('|');
    const note = resolveDrawing(source, notes);
    if (!/\.excalidraw(?:\.md)?$/i.test(source) && !note) continue;
    if (match.index > cursor) replacements.push({ type: 'text', value: node.value.slice(cursor, match.index) });
    replacements.push({ type: 'image', url: note ? `../${notePath(note)}` : source, alt: alias || note?.title || source, title: null });
    cursor = match.index + match[0].length;
   }
   if (!replacements.length) return;
   if (cursor < node.value.length) replacements.push({ type: 'text', value: node.value.slice(cursor) });
   parent.children.splice(index, 1, ...replacements);
   return [SKIP, index + replacements.length];
  });
 };
}
