import type { Root, RootContent } from 'mdast';
import { visit } from 'unist-util-visit';

export type DocumentHeading = { level: number; text: string; id: string; line: number };
function textContent(node: RootContent): string {
 if ('value' in node) return node.value;
 if (node.type === 'image' || node.type === 'imageReference') return node.alt || '';
 return 'children' in node ? node.children.map(textContent).join('') : '';
}

// Preserve line positions for source navigation while excluding YAML metadata.
export function headingMarkdown(content: string) {
 return content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, prefix => '\n'.repeat((prefix.match(/\n/g) || []).length));
}
export function documentHeadings(tree: Root): DocumentHeading[] {
 const used = new Set<string>(), headings: DocumentHeading[] = [];
 visit(tree, 'heading', node => {
  if (node.depth > 3) return;
  const text = node.children.map(textContent).join('');
  const base = `heading-${text.replace(/[^\p{L}\p{N}]/gu, '-')}`;
  let id = base, suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
  headings.push({ level: node.depth, text, id, line: node.position?.start.line || 1 });
 });
 return headings;
}
export default function remarkHeadingIds() {
 return (tree: Root) => { documentHeadings(tree); };
}
