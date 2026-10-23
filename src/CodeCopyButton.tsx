import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { writeClipboard } from './clipboard';

export default function CodeCopyButton({ text, onError }: { text: string; onError?: (message: string) => void }) {
 const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
 const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
 useEffect(() => () => clearTimeout(timer.current), []);
 const label = status === 'copied' ? '已复制' : status === 'error' ? '复制失败，点击重试' : '复制代码';
 async function copy() {
  clearTimeout(timer.current);
  try {
   await writeClipboard({ text });
   setStatus('copied');
  } catch (error) {
   setStatus('error');
   onError?.(error instanceof Error ? error.message : '复制失败');
  }
  timer.current = setTimeout(() => setStatus('idle'), 1800);
 }
 return <button type="button" className="code-copy-button" data-export-ignore="true" aria-label={label} title={label}
  onMouseDown={event => event.preventDefault()} onClick={event => { event.stopPropagation(); void copy(); }}>
  {status === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
  <span className="code-copy-feedback" role="status">{status === 'copied' ? '代码已复制' : status === 'error' ? '复制失败，请重试' : ''}</span>
 </button>;
}
