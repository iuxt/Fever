import { memo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';

// Reuse the language extension across edits and background status refreshes.
const extensions = [markdown({ codeLanguages: languages })];
const basicSetup = { lineNumbers: true, foldGutter: false, highlightActiveLine: true };
export default memo(function MarkdownEditor({ content, dark, onChange }: { content: string; dark: boolean; onChange: (value: string) => void }) {
 return <CodeMirror value={content} extensions={extensions} theme={dark ? 'dark' : 'light'} basicSetup={basicSetup} onChange={onChange} height="100%" placeholder="让一个想法，从这里开始…" />;
});
