import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';

const parser = unified().use(remarkParse).use(remarkGfm);
const frontmatter = content => content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)(?:\r?\n)*/)?.[0] || '';

// These constructs have no lossless representation in the rich-text schema.
// Attribute-free <br> tags map to hardBreak nodes (also inside GFM tables).
// Inspect Markdown nodes so examples inside code never force source editing.
export function requiresSourceEditing(content) {
  if (!/[<]|\[\^/.test(content)) return false;
  const body = content.slice(frontmatter(content).length);
  let unsupported = false;
  visit(parser.parse(body), node => {
    if ((node.type === 'html' && !/^<br\s*\/?>\s*$/i.test(node.value)) || ['footnoteReference', 'footnoteDefinition'].includes(node.type) || (node.type === 'definition' && node.identifier.startsWith('^')) || (node.type === 'text' && /\[\^[^\]\n]+\]/.test(node.value))) unsupported = true;
  });
  return unsupported;
}

const whitespaceText = text => text.split('\n').map(line => line.replace(/[ \t\r\v\f]/g, '')).filter(Boolean).join('\n');
function semanticNode(node) {
  const result = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'position' || key === 'data') continue;
    result[key] = key === 'children' ? value.map(semanticNode) : key === 'value' && node.type === 'text' ? value.replace(/[ \t\r\n]+/g, ' ') : value;
  }
  return result;
}

export function canIgnoreWhitespace(filename, before, after) {
  if (/\.json$/i.test(filename)) {
    try { return JSON.stringify(JSON.parse(before)) === JSON.stringify(JSON.parse(after)); }
    catch { return false; }
  }
  if (whitespaceText(before) !== whitespaceText(after)) return false;
  if (/\.txt$/i.test(filename)) return true;
  if (/\.(md|markdown)$/i.test(filename)) {
    if (before.length + after.length > 400_000) return false;
    const prefix = frontmatter(before);
    if (prefix !== frontmatter(after)) return false;
    return JSON.stringify(semanticNode(parser.parse(before.slice(prefix.length)))) === JSON.stringify(semanticNode(parser.parse(after.slice(prefix.length))));
  }
  // Code, drawings and unknown formats can assign meaning to any whitespace.
  return false;
}
