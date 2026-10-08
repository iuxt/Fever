import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type MenuItem = { label: string; icon?: ReactNode; shortcut?: string; disabled?: boolean; checked?: boolean; danger?: boolean; action: () => unknown } | { separator: true };
export type MenuState = { x: number; y: number; label: string; items: MenuItem[]; returnFocus?: HTMLElement | null };

export function useContextMenu() {
 const [menu, setMenu] = useState<MenuState | null>(null);
 const close = useCallback(() => setMenu(null), []);
 const open = useCallback((next: MenuState) => {
  window.dispatchEvent(new Event('fever:context-menu'));
  setMenu(next);
 }, []);
 useEffect(() => {
  window.addEventListener('fever:context-menu', close);
  return () => window.removeEventListener('fever:context-menu', close);
 }, [close]);
 return { menu, open, close };
}

export default function ContextMenu({ menu, onClose, onError }: { menu: MenuState | null; onClose: () => void; onError: (message: string) => void }) {
 const ref = useRef<HTMLDivElement>(null);
 useLayoutEffect(() => {
  if (!menu || !ref.current) return;
  const element = ref.current, bounds = element.getBoundingClientRect();
  element.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8))}px`;
  element.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8))}px`;
  element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
 }, [menu]);
 useEffect(() => {
  if (!menu) return;
  const outside = (event: Event) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
  const keydown = (event: KeyboardEvent) => {
   if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault(); event.stopPropagation(); onClose(); menu.returnFocus?.focus({ preventScroll: true });
   }
  };
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('scroll', outside, true);
  window.addEventListener('resize', onClose);
  window.addEventListener('blur', onClose);
  window.addEventListener('keydown', keydown, true);
  return () => {
   window.removeEventListener('pointerdown', outside, true);
   window.removeEventListener('scroll', outside, true);
   window.removeEventListener('resize', onClose);
   window.removeEventListener('blur', onClose);
   window.removeEventListener('keydown', keydown, true);
  };
 }, [menu, onClose]);
 if (!menu) return null;
 return createPortal(<div ref={ref} className="context-menu" role="menu" aria-label={menu.label} style={{ left: menu.x, top: menu.y }} onContextMenu={event => event.preventDefault()} onMouseDown={event => event.preventDefault()} onKeyDown={event => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
 }}>
  {menu.items.map((item, index) => 'separator' in item ? <div role="separator" className="context-menu-separator" key={index} /> :
   <button key={index} type="button" role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-label={item.label} aria-checked={item.checked} disabled={item.disabled} className={item.danger ? 'danger-text' : undefined} onClick={() => {
    onClose();
    try { Promise.resolve(item.action()).catch(error => onError(error instanceof Error ? error.message : String(error))); }
    catch (error) { onError(error instanceof Error ? error.message : String(error)); }
   }}><span className="context-menu-icon" aria-hidden="true">{item.icon || (item.checked ? '✓' : null)}</span><span>{item.label}</span>{item.shortcut && <kbd aria-hidden="true">{item.shortcut}</kbd>}</button>)}
 </div>, document.body);
}

export const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

export function keyboardContextMenu(event: ReactKeyboardEvent<HTMLElement>) {
 if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
 event.preventDefault(); event.stopPropagation();
 (event.target as HTMLElement).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
}
