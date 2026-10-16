import { memo, type ReactNode } from 'react';
import { common, createLowlight } from 'lowlight';
import dos from 'highlight.js/lib/languages/dos';
import powershell from 'highlight.js/lib/languages/powershell';
import type { RootContent } from 'hast';

// Rich editing and Markdown previews share grammars, aliases and token classes.
export const lowlight = createLowlight(common);
lowlight.register({ dos, powershell });
export const editorLowlight = {
 ...lowlight,
 highlight: (language: string, text: string) => lowlight.highlight(lowlight.registered(language) && text.length <= 32 * 1024 ? language : 'plaintext', text),
 highlightAuto: (text: string) => lowlight.highlight('plaintext', text),
};
export const codeLanguages = [...new Set([...lowlight.listLanguages(), 'html', 'js', 'jsx', 'ts', 'tsx', 'sh', 'py', 'text', 'bat', 'batch', 'cmd', 'pwsh', 'ps', 'ps1', 'excalidraw'])].sort();

function renderTokens(nodes: RootContent[]): ReactNode[] {
 return nodes.map((node, index) => {
  if (node.type === 'text') return node.value;
  if (node.type !== 'element') return null;
  const classes = node.properties.className;
  return <span key={index} className={Array.isArray(classes) ? classes.join(' ') : undefined}>{renderTokens(node.children)}</span>;
 });
}

export const HighlightedCode = memo(function HighlightedCode({ text, language, className }: { text: string; language?: string; className?: string }) {
 // Unknown languages and large blocks remain readable without expensive guessing.
 if (!language || !lowlight.registered(language) || text.length > 32 * 1024) return <code className={className}>{text}</code>;
 const tokens = lowlight.highlight(language, text);
 return <code className={className}>{renderTokens(tokens.children)}</code>;
});
