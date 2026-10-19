import { visit, SKIP } from 'unist-util-visit';
import type { Root, Image, Text } from 'mdast';
import { imageAltWithWidth, parseImageAlt } from './imageSize.ts';

// Old Git revisions retain their original Obsidian syntax and original image names.
export default function remarkLegacyImages() {
 return (tree: Root) => {
  visit(tree, 'text', (node, index, parent) => {
   if (!parent || index === undefined) return;
   const replacements: (Text | Image)[] = [];
   let cursor = 0;
   for (const match of node.value.matchAll(/!\[\[([^\]\n]+)\]\]/g)) {
    const [source, ...label] = match[1].split('|');
    const alias = label.join('|');
    const parsed = parseImageAlt(`|${alias}`);
    if (!/\.(png|jpe?g|gif|webp|avif|bmp)(?:[?#].*)?$/i.test(source)) continue;
    if (match.index > cursor) replacements.push({ type: 'text', value: node.value.slice(cursor, match.index) });
    const alt = parsed.alt.slice(1);
    replacements.push({ type: 'image', url: source, alt: imageAltWithWidth(alt && !/^\d+x\d+$/.test(alt) ? alt : source.split('/').at(-1) || '', parsed.width), title: null, data: { hProperties: { 'data-wiki': 'true' } } });
    cursor = match.index + match[0].length;
   }
   if (!replacements.length) return;
   if (cursor < node.value.length) replacements.push({ type: 'text', value: node.value.slice(cursor) });
   parent.children.splice(index, 1, ...replacements);
   return [SKIP, index + replacements.length];
  });
 };
}
