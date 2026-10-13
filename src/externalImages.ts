import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { parse, preprocess, postprocess } from 'micromark';

const parser = unified().use(remarkParse).use(remarkGfm);
type ImageLink = { url: string; start: number; end: number; reference?: { alt: string; title: string | null } };

function imageLinks(content: string): ImageLink[] {
 // Match the editor's frontmatter handling and keep properties verbatim.
 const prefix = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)(?:\r?\n)*/)?.[0] || '';
 const body = content.slice(prefix.length), tree = parser.parse(body);
 const definitions = new Map<string, { url: string; title: string | null }>();
 visit(tree, 'definition', node => { if (!definitions.has(node.identifier)) definitions.set(node.identifier, { url: node.url, title: node.title || null }); });
 const destinations = new Map<number, { start: number; end: number }>();
 const containers: { type: string; start: { offset?: number } }[] = [];
 const events = postprocess(parse().document().write(preprocess()(body, undefined, true)));
 for (const [event, token] of events) {
  if (['link', 'image', 'definition'].includes(token.type)) {
   if (event === 'enter') containers.push(token); else containers.pop();
  } else if (event === 'enter' && token.type === 'resourceDestinationString' && containers.at(-1)?.type === 'image') {
   destinations.set(containers.at(-1)!.start.offset!, { start: token.start.offset!, end: token.end.offset! });
  }
 }
 const links: ImageLink[] = [];
 visit(tree, node => {
  if (node.type !== 'image' && node.type !== 'imageReference') return;
  const definition = node.type === 'imageReference' ? definitions.get(node.identifier) : undefined;
  const url = node.type === 'image' ? node.url : definition?.url;
  if (!url || !/^https?:\/\//i.test(url)) return;
  const range = node.type === 'image' ? destinations.get(node.position!.start.offset!) : { start: node.position!.start.offset!, end: node.position!.end.offset! };
  if (!range) return;
  links.push({ url, start: range.start + prefix.length, end: range.end + prefix.length,
   ...(node.type === 'imageReference' ? { reference: { alt: node.alt || '', title: definition?.title || null } } : {}) });
 });
 return links;
}

export function externalImageUrls(content: string): string[] {
 return [...new Set(imageLinks(content).map(link => link.url))];
}

export function replaceExternalImages(content: string, replacements: Record<string, string>): { content: string; replaced: number } {
 const edits = imageLinks(content).filter(link => replacements[link.url]);
 for (const link of edits.sort((a, b) => b.start - a.start)) {
  let value = replacements[link.url];
  if (link.reference) {
   const alt = link.reference.alt.replace(/[\\\[\]]/g, '\\$&');
   const title = link.reference.title ? ` "${link.reference.title.replace(/[\\"]/g, '\\$&')}"` : '';
   // Do not rewrite a definition also used by ordinary website links.
   value = `![${alt}](${value}${title})`;
  }
  content = content.slice(0, link.start) + value + content.slice(link.end);
 }
 return { content, replaced: edits.length };
}
