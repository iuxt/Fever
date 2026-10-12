import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { codeLanguages } from './codeHighlight';

const label = (value: string) => value === '' ? '自动识别' : value === 'plaintext' ? '纯文本 · plaintext' : value;

export default function CodeLanguageSelect({ value, onChange }: { value: string; onChange: (language: string) => void }) {
 const id = useId();
 const input = useRef<HTMLInputElement>(null), popup = useRef<HTMLDivElement>(null), activeOption = useRef<HTMLButtonElement>(null);
 const [open, setOpen] = useState(false), [query, setQuery] = useState<string | null>(null), [active, setActive] = useState(0);
 const [position, setPosition] = useState<CSSProperties>();
 const search = (query || '').trim().toLowerCase();
 const values = ['', ...codeLanguages, ...(value && !codeLanguages.includes(value) ? [value] : [])];
 const options = values.filter(language => `${language} ${label(language)}`.toLowerCase().includes(search))
  .sort((a, b) => Number(b.toLowerCase() === search) - Number(a.toLowerCase() === search));

 function close() { setOpen(false); setQuery(null); setActive(0); }
 function choose(language: string) { close(); onChange(language); }
 function expand() { setOpen(true); setActive(Math.max(0, options.indexOf(value))); }

 useEffect(() => { setQuery(null); setActive(0); }, [value]);
 useLayoutEffect(() => {
  if (!open) return;
  function place() {
   const rect = input.current!.getBoundingClientRect();
   const below = window.innerHeight - rect.bottom - 8, above = rect.top - 8;
   const upwards = below < 180 && above > below;
   const width = Math.min(240, window.innerWidth - 16);
   setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), width,
    top: upwards ? undefined : rect.bottom + 4, bottom: upwards ? window.innerHeight - rect.top + 4 : undefined,
    maxHeight: Math.max(40, Math.min(260, (upwards ? above : below) - 4)),
   });
  }
  function outside(event: PointerEvent) {
   if (event.target !== input.current && !popup.current?.contains(event.target as Node)) close();
  }
  function scroll(event: Event) {
   if (!(event.target instanceof Node) || !popup.current?.contains(event.target)) place();
  }
  place();
  window.addEventListener('resize', place);
  window.addEventListener('scroll', scroll, true);
  document.addEventListener('pointerdown', outside);
  return () => {
   window.removeEventListener('resize', place);
   window.removeEventListener('scroll', scroll, true);
   document.removeEventListener('pointerdown', outside);
  };
 }, [open]);
 useLayoutEffect(() => {
  const container = popup.current, option = activeOption.current;
  if (!open || !container || !option) return;
  const top = option.offsetTop, bottom = top + option.offsetHeight;
  if (top < container.scrollTop) container.scrollTop = top;
  else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = bottom - container.clientHeight;
 }, [open, active, query, position]);

 return <div className="code-language-select">
  <input ref={input} type="text" role="combobox" aria-label="代码块语言" title="搜索代码块语言" placeholder={open ? '搜索语言…' : '自动识别'}
   aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined}
   aria-activedescendant={open && options[active] !== undefined ? `${id}-${active}` : undefined}
   value={query ?? value} autoComplete="off" spellCheck={false}
   onFocus={event => { expand(); event.currentTarget.select(); }} onClick={() => { if (!open) expand(); }} onBlur={close}
   onChange={event => { setQuery(event.target.value); setActive(0); setOpen(true); }}
   onKeyDown={event => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
     event.preventDefault(); setOpen(true);
     setActive(index => !open ? Math.max(0, options.indexOf(value)) : options.length ? (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : 0);
    } else if (event.key === 'Enter') {
     event.preventDefault();
     if (open && options[active] !== undefined) choose(options[active]);
     else if (!open) expand();
    }
   }} />
  <ChevronDown size={12} aria-hidden="true" />
  {open && position && createPortal(<div ref={popup} id={id} role="listbox" aria-label="代码块语言选项" className="code-language-options" style={position}>
   {options.map((language, index) => <button key={language} ref={index === active ? activeOption : undefined} id={`${id}-${index}`} type="button" role="option"
    aria-selected={index === active} className={index === active ? 'active' : undefined} tabIndex={-1}
    onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(language)}>
    <span>{label(language)}</span>{value === language && <span aria-hidden="true">✓</span>}
   </button>)}
   {!options.length && <div role="status" className="code-language-empty">没有匹配的语言</div>}
  </div>, document.body)}
 </div>;
}
