import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';

// Render the line-break syntax used by Markdown tables without enabling raw HTML.
export default function remarkMarkdownBreaks() {
 return (tree: Root) => {
  visit(tree, 'html', (node, index, parent) => {
   if (!parent || index === undefined || !/^<br\s*\/?>\s*$/i.test(node.value)) return;
   parent.children.splice(index, 1, parent.type === 'root'
    ? { type: 'paragraph', children: [{ type: 'break' }] }
    : { type: 'break' });
  });
 };
}
