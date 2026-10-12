import { memo, type ReactNode } from 'react';
import { common, createLowlight } from 'lowlight';
import type { RootContent } from 'hast';

// Rich editing and Markdown previews share grammars, aliases and token classes.
export const lowlight = createLowlight(common);
export const codeLanguages = [...new Set([...lowlight.listLanguages(), 'html', 'js', 'jsx', 'ts', 'tsx', 'sh', 'py', 'text', 'excalidraw'])].sort();

function renderTokens(nodes: RootContent[]): ReactNode[] {
 return nodes.map((node, index) => {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element') return null;
  const classes = node.properties.className;
  return <span key={index} className={Array.isArray(classes) ? classes.join(' ') : undefined}>{renderTokens(node.children)}</span>;
 });
}

export const HighlightedCode = memo(function HighlightedCode({ text, language, className }: { text: string; language?: string; className?: string }) {
 const tokens = language && lowlight.registered(language) ? lowlight.highlight(language, text) : lowlight.highlightAuto(text);
 return <code className={className}>{renderTokens(tokens.children)}</code>;
});
