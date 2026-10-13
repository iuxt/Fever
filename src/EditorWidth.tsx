import { useEffect, useId, useRef, useState } from 'react';
import { MoveHorizontal } from 'lucide-react';
import { editorWidths } from './appearance';

type Props = {
 width: number;
 fullWidth: boolean;
 onWidthChange: (width: number) => void;
 onFullWidthChange: (fullWidth: boolean) => void;
};

export function EditorWidthOptions({ width, fullWidth, onWidthChange, onFullWidthChange }: Props) {
 const id = useId();
 return <div className="editor-width-options">
  <div className="editor-width-heading"><label htmlFor={id}>正文最大宽度</label><output htmlFor={id}>{fullWidth ? '铺满编辑区' : `${width} px`}</output></div>
  <input id={id} type="range" min={editorWidths.min} max={editorWidths.max} step={editorWidths.step} value={width} disabled={fullWidth} onChange={event => onWidthChange(Number(event.target.value))} />
  <div className="editor-width-limits"><span>窄</span><span>宽</span></div>
  <div className="editor-width-footer"><button className="editor-width-toggle" role="switch" aria-checked={fullWidth} onClick={() => onFullWidthChange(!fullWidth)}><span className={`switch ${fullWidth ? 'on' : ''}`} aria-hidden="true"><span /></span>铺满编辑区</button><button className="text-button" onClick={() => { onWidthChange(editorWidths.default); onFullWidthChange(false); }}>恢复默认</button></div>
  <p className="form-hint">拖动滑块即时调整正文与预览的宽度，窗口较小时自动收缩。</p>
 </div>;
}

export default function EditorWidthButton(props: Props) {
 const [open, setOpen] = useState(false), id = useId();
 const container = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
 useEffect(() => {
  if (!open) return;
  const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', escape);
  return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
 }, [open]);
 return <div className="editor-width-menu" ref={container}>
  <button ref={button} className="icon-button" title="调整正文宽度" aria-label="调整正文宽度" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}><MoveHorizontal size={17} /></button>
  {open && <div id={id} className="editor-width-popover"><EditorWidthOptions {...props} /></div>}
 </div>;
}
