import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { parse, preprocess, postprocess } from 'micromark';

const parser = unified().use(remarkParse).use(remarkGfm);

// Change only image destinations; preserve all other Markdown bytes and code examples.
export async function rewriteImageReferences(content, resolve) {
 const tree = parser.parse(content), destinations = new Map(), containers = [], references = [], edits = [];
 const events = postprocess(parse({ extensions: parser.data('micromarkExtensions') }).document().write(preprocess()(content, undefined, true)));
 for (const [event, token] of events) {
  if (['link', 'image', 'definition'].includes(token.type)) {
   if (event === 'enter') containers.push(token); else containers.pop();
  } else if (event === 'enter' && ['resourceDestinationString', 'definitionDestinationString'].includes(token.type) && containers.length) {
   destinations.set(containers.at(-1).start.offset, { start: token.start.offset, end: token.end.offset });
  }
 }
 const definitions = new Map();
 visit(tree, 'definition', node => { if (!definitions.has(node.identifier)) definitions.set(node.identifier, node); });
 const seen = new Set();
 visit(tree, node => {
  const image = node.type === 'imageReference' ? definitions.get(node.identifier) : node.type === 'image' ? node : undefined;
  if (image && !seen.has(image)) { seen.add(image); references.push(image); }
 });
 for (const image of references) {
  const range = destinations.get(image.position.start.offset);
  if (!range) throw new Error('无法解析历史图片引用');
  const target = await resolve(image.url, false);
  if (target !== image.url) edits.push({ ...range, value: target });
 }
 const textNodes = [];
 visit(tree, 'text', node => textNodes.push(node));
 for (const node of textNodes) {
  const raw = content.slice(node.position.start.offset, node.position.end.offset);
  for (const match of raw.matchAll(/(?<!\\)!\[\[([^\]\n]+)\]\]/g)) {
   const [source, ...alias] = match[1].split('|');
   if (!/\.(png|jpe?g|gif|webp|avif|bmp)(?:[?#].*)?$/i.test(source)) continue;
   const target = await resolve(source, true);
   const name = alias.join('|') || source.split('/').at(-1);
   const label = (/^\d+(?:x\d+)?$/.test(name) ? `|${name}` : name).replace(/[\[\]\\]/g, '\\$&');
   edits.push({ start: node.position.start.offset + match.index, end: node.position.start.offset + match.index + match[0].length, value: `![${label}](${target})` });
  }
 }
 for (const edit of edits.sort((a, b) => b.start - a.start)) content = content.slice(0, edit.start) + edit.value + content.slice(edit.end);
 return content;
}
