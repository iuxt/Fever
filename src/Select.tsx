import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

type Option<T> = { value: T; label: string; icon?: ReactNode };

export default function Select<T extends string | number>({ label, value, options, onChange }: {
 label: string; value: T; options: Option<T>[]; onChange: (value: T) => void;
}) {
 const id = useId(), container = useRef<HTMLDivElement>(null);
 const [open, setOpen] = useState(false), [active, setActive] = useState(0);
 const selected = Math.max(0, options.findIndex(option => option.value === value));
 useEffect(() => {
  if (!open) return;
  const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
  document.addEventListener('pointerdown', outside);
  return () => document.removeEventListener('pointerdown', outside);
 }, [open]);
 useEffect(() => {
  if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' });
 }, [open, active, id]);
 return <div className="form-field custom-select" ref={container} data-select-open={open}>
  <label htmlFor={id}>{label}</label>
  <button id={id} type="button" className="select-trigger" role="combobox" aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? `${id}-options` : undefined} aria-activedescendant={open ? `${id}-option-${active}` : undefined}
   onBlur={event => { if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) setOpen(false); }}
   onClick={() => { setActive(selected); setOpen(previous => !previous); }}
   onKeyDown={event => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) {
     event.preventDefault(); event.stopPropagation();
     if (event.key === 'Escape') { setOpen(false); return; }
     if (event.key === 'Enter' || event.key === ' ') {
      if (open) { onChange(options[active].value); setOpen(false); }
      else { setActive(selected); setOpen(true); }
      return;
     }
     setOpen(true);
     setActive(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : !open ? selected : Math.max(0, Math.min(options.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1))));
    }
   }}><span>{options[selected].icon}{options[selected].label}</span><ChevronDown size={15} /></button>
  {open && <div className="select-options" id={`${id}-options`} role="listbox" aria-label={label}>
   {options.map((option, index) => <div key={option.value} id={`${id}-option-${index}`} role="option" aria-selected={option.value === value} className={`select-option ${active === index ? 'active' : ''}`} onPointerMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.icon}{option.label}</span>{option.value === value && <Check size={15} />}</div>)}
  </div>}
 </div>;
}
