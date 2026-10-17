import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowDownToLine, FileText, LoaderCircle, X } from 'lucide-react';
import Select from './Select';
import { defaultExportOptions, exportFilename, exportFormatLabel } from './noteExport';
import type { ExportFormat, ExportOptions } from './types';

export default function ExportDialog({ title, drawing, busy, returnFocusRef, onClose, onExport }: {
 title: string; drawing: boolean; busy: boolean; returnFocusRef: RefObject<HTMLDivElement | null>; onClose: () => void; onExport: (options: ExportOptions) => void;
}) {
 const [options, setOptions] = useState<ExportOptions>(() => ({ ...defaultExportOptions, filename: exportFilename(title, 'pdf').slice(0, -4) }));
 const dialog = useRef<HTMLFormElement>(null);
 const update = <K extends keyof ExportOptions>(key: K, value: ExportOptions[K]) => setOptions(previous => ({ ...previous, [key]: value }));
 const formatted = options.format === 'pdf' || options.format === 'html';
 useEffect(() => {
  dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
  return () => returnFocusRef.current?.querySelector('button')?.focus();
 }, [returnFocusRef]);
 return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
  <form ref={dialog} className="modal export-modal" role="dialog" aria-modal="true" aria-labelledby="export-title"
   onSubmit={event => { event.preventDefault(); if (!busy && options.filename.trim()) onExport(options); }}
   onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(dialog.current!.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]')).filter(element => !element.matches(':disabled'));
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
   }}>
   <div className="modal-header"><div><span className="modal-icon"><ArrowDownToLine size={20} /></span><h2 id="export-title">导出{drawing ? '绘图' : '笔记'}</h2></div><button type="button" className="icon-button" aria-label="关闭导出" disabled={busy} onClick={onClose}><X size={18} /></button></div>
   <div className="modal-body">
    <div className="export-document"><FileText size={18} /><span title={title}>{title}</span></div>
    <fieldset disabled={busy}>
     <label>文件名<input value={options.filename} maxLength={120} onChange={event => update('filename', event.target.value)} required /></label>
     <Select<ExportFormat> label="文件格式" value={options.format} onChange={value => update('format', value)} options={(['pdf', 'html', drawing ? 'excalidraw' : 'md'] as ExportFormat[]).map(value => ({ value, label: `${exportFormatLabel(value)} (.${value})` }))} />
     <p className="form-hint">{{ pdf: '适合打印和分享，保留正文、图片与绘图排版。', html: '生成可在浏览器中打开的独立网页，图片和绘图会嵌入文件。', md: '保留 Markdown 源码，图片和绘图保留原引用路径。', excalidraw: '保留可继续编辑的 Excalidraw 绘图数据。' }[options.format]}</p>
     {formatted && <div className="export-layout">
      <div className="form-section-title">排版设置</div>
      {options.format === 'pdf' && <div className="form-columns">
       <Select label="纸张大小" value={options.pageSize} onChange={value => update('pageSize', value)} options={[
        { value: 'A4', label: 'A4 · 210 × 297 mm' }, { value: 'A3', label: 'A3 · 297 × 420 mm' }, { value: 'A5', label: 'A5 · 148 × 210 mm' }, { value: 'Letter', label: 'Letter · 216 × 279 mm' },
       ]} />
       <Select label="页面方向" value={options.landscape ? 'landscape' : 'portrait'} onChange={value => update('landscape', value === 'landscape')} options={[{ value: 'portrait', label: '纵向' }, { value: 'landscape', label: '横向' }]} />
      </div>}
      <div className="form-columns">
       {options.format === 'pdf'
        ? <Select label="页边距" value={options.margin} onChange={value => update('margin', value)} options={[0, 10, 18, 25].map(value => ({ value, label: `${value} mm${value === 18 ? '（默认）' : ''}` }))} />
        : <Select label="内容宽度" value={options.width} onChange={value => update('width', value)} options={[640, 780, 960, 1200].map(value => ({ value, label: `${value} px${value === 780 ? '（默认）' : ''}` }))} />}
       <Select label="正文字号" value={options.fontSize} onChange={value => update('fontSize', value)} options={[12, 14, 15, 16, 18, 20].map(value => ({ value, label: `${value} px${value === 15 ? '（默认）' : ''}` }))} />
      </div>
     </div>}
    </fieldset>
    <p className="export-filename" title={exportFilename(options.filename, options.format)}>将导出为 <strong>{exportFilename(options.filename, options.format)}</strong></p>
   </div>
   <div className="modal-footer"><button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary" disabled={busy || !options.filename.trim()}>{busy ? <LoaderCircle size={15} className="spin" /> : <ArrowDownToLine size={15} />}{busy ? '正在导出…' : '导出'}</button></div>
  </form>
 </div>;
}
