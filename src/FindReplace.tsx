import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, CaseSensitive, ChevronDown, ChevronRight, Regex, Replace, ReplaceAll, TextSelect, WholeWord, X } from 'lucide-react';
import { matchLimit, replacementText, type SearchAdapter, type SearchOptions, type SearchRange, type SearchRequest } from './articleSearch';
import { useArticleSearch } from './useArticleSearch';
import { modifier } from './ContextMenu';

export default function FindReplace({ adapter, request }: { adapter: SearchAdapter | null; request?: SearchRequest }) {
 const [open, setOpen] = useState(false), [expanded, setExpanded] = useState(false);
 const [query, setQuery] = useState(''), [replacement, setReplacement] = useState('');
 const [options, setOptions] = useState<SearchOptions>({ caseSensitive: false, wholeWord: false, regex: false });
 const [scope, setScope] = useState<SearchRange | null>(null), [selection, setSelection] = useState<SearchRange | null>(null);
 const [anchor, setAnchor] = useState(0), [version, setVersion] = useState(0), [navigation, setNavigation] = useState(0);
 const [message, setMessage] = useState('');
 const input = useRef<HTMLTextAreaElement>(null), panel = useRef<HTMLDivElement>(null);
 const reveal = useRef(false);
 const segments = useMemo(() => open ? adapter?.segments() ?? [] : [], [adapter, open, version]);
 const { matches, error, limited, searching } = useArticleSearch(segments, open ? query : '', options, scope);
 const nearest = matches.findIndex(match => match.from >= anchor);
 const index = matches.length ? nearest < 0 ? 0 : nearest : -1;
 const mac = modifier === '⌘';
 const replaceShortcut = mac ? '⌥⌘F' : 'Ctrl+H';

 useEffect(() => {
  if (!open) return;
  return adapter?.subscribe(change => {
   setVersion(value => value + 1);
   setAnchor(value => change.mapPosition(value, 1));
   const map = (range: SearchRange | null) => range && { from: change.mapPosition(range.from, -1), to: change.mapPosition(range.to, 1) };
   setScope(map); setSelection(map);
   setMessage('');
  });
 }, [adapter, open]);
 useLayoutEffect(() => {
  if (!adapter) return;
  adapter.highlight(open ? matches : [], open ? index : -1, open && reveal.current);
  if (!searching) reveal.current = false;
 }, [adapter, open, matches, index, navigation, searching]);
 useEffect(() => () => { adapter?.highlight([], -1, false); }, [adapter]);

 function focusSearch() { requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); }); }
 function show(replace = false) {
  if (!adapter || document.querySelector('[aria-modal="true"]')) return;
  const inside = panel.current?.contains(document.activeElement);
  const current = adapter.selection();
  if (!inside && adapter.element.contains(document.activeElement)) {
   if (current.text && !current.text.includes('\n')) setQuery(options.regex ? current.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : current.text);
   setSelection(current.from !== current.to ? current : null);
   setScope(null);
   setAnchor(current.from);
  } else if (!open) { setSelection(null); setAnchor(current.from); }
  if (replace) setExpanded(true);
  setOpen(true); setMessage(''); reveal.current = true; setNavigation(value => value + 1); focusSearch();
 }
 function close() { setOpen(false); setScope(null); setMessage(''); adapter?.focus(); }
 function navigate(direction: number) {
  if (!matches.length) return;
  const next = (index + direction + matches.length) % matches.length;
  setAnchor(matches[next].from); reveal.current = true; setNavigation(value => value + 1);
  setMessage(next < index && direction > 0 ? '已回到第一个匹配项' : next > index && direction < 0 ? '已回到最后一个匹配项' : '');
 }
 function toggle(key: keyof SearchOptions) {
  setOptions(value => ({ ...value, [key]: !value[key] })); setMessage(''); reveal.current = true;
 }
 function replace(all = false) {
  if (!adapter || !matches.length || error || (all && limited)) return;
  const targets = all ? matches : [matches[index]];
  const changes = targets.map(match => ({ from: match.from, to: match.to, text: replacementText(match, replacement, options.regex) }));
  adapter.replace(changes);
  if (!all) setAnchor(changes[0].from + changes[0].text.length + (changes[0].from === changes[0].to ? 1 : 0));
  reveal.current = true;
  setMessage(`已替换 ${targets.length} 处`);
 }
 useEffect(() => {
  const keydown = (event: KeyboardEvent) => {
   if (event.isComposing || event.defaultPrevented || document.querySelector('[aria-modal="true"], [data-select-open="true"], .context-menu')) return;
   const key = event.code?.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
   const mod = mac ? event.metaKey : event.ctrlKey;
   const find = mod && key === 'f' && !event.shiftKey && (!event.altKey || mac);
   const startReplace = (find && event.altKey) || (!mac && event.ctrlKey && key === 'h' && !event.altKey && !event.shiftKey);
   if (find || startReplace) { event.preventDefault(); event.stopPropagation(); show(startReplace); return; }
   if (!open) return;
   const target = event.target as HTMLElement;
   const inPanel = !!panel.current?.contains(target);
   const inEditor = adapter?.element.contains(target);
   if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation(); close();
   } else if ((inPanel || inEditor) && (event.key === 'F3' || (mod && key === 'g' && !event.altKey))) {
    event.preventDefault(); event.stopPropagation(); navigate(event.shiftKey ? -1 : 1);
   } else if (inPanel && event.altKey && (!mac || event.metaKey) && ['c', 'w', 'r'].includes(key)) {
    event.preventDefault(); toggle(({ c: 'caseSensitive', w: 'wholeWord', r: 'regex' } as const)[key as 'c' | 'w' | 'r']);
   } else if (inPanel && event.key === 'Enter' && target.tagName === 'TEXTAREA') {
    event.preventDefault(); event.stopPropagation();
    if (target === input.current) navigate(event.shiftKey ? -1 : 1);
    else replace(mod);
   }
  };
  window.addEventListener('keydown', keydown, true);
  return () => { window.removeEventListener('keydown', keydown, true); };
 });
 useEffect(() => {
  if (adapter && request?.requested) { show(); request.onHandled(); }
 });
 const host = adapter?.element.closest('.document-area');
 if (!open || !host) return null;
 const count = !query ? '输入关键词' : searching ? '查找中…' : error ? '' : matches.length ? `${index + 1} / ${matches.length}${limited ? '+' : ''}` : '无结果';
 return createPortal(<div ref={panel} className={`find-widget${error || (query && !matches.length) ? ' no-results' : ''}`} role="region" aria-label="文章内查找和替换">
  <div className="find-main">
   <button className="find-toggle" aria-label={expanded ? '收起替换' : '展开替换'} title={`替换 · ${replaceShortcut}`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
   <div className="find-fields">
    <div className="find-row">
     <div className="find-input-wrap">
      <textarea ref={input} aria-label="查找内容" placeholder="查找" rows={1} spellCheck={false} value={query} aria-invalid={!!error} onChange={event => { setQuery(event.target.value); setMessage(''); reveal.current = true; }} />
      <div className="find-options">
       <button aria-label="区分大小写" title="区分大小写" aria-pressed={options.caseSensitive} onClick={() => toggle('caseSensitive')}><CaseSensitive size={17} /></button>
       <button aria-label="全词匹配" title="全词匹配" aria-pressed={options.wholeWord} onClick={() => toggle('wholeWord')}><WholeWord size={17} /></button>
       <button aria-label="使用正则表达式" title="使用正则表达式" aria-pressed={options.regex} onClick={() => toggle('regex')}><Regex size={17} /></button>
      </div>
     </div>
     <output className="find-count" aria-live="polite">{count}</output>
     <div className="find-actions">
      <button aria-label="上一个匹配项" title="上一个匹配项 · Shift+Enter" disabled={!matches.length} onClick={() => navigate(-1)}><ArrowUp size={16} /></button>
      <button aria-label="下一个匹配项" title="下一个匹配项 · Enter" disabled={!matches.length} onClick={() => navigate(1)}><ArrowDown size={16} /></button>
      <button aria-label="在选区中查找" title={selection ? '在选区中查找' : '先在正文中选择一段文字'} disabled={!selection && !scope} aria-pressed={!!scope} onClick={() => { setScope(scope ? null : selection); setMessage(''); reveal.current = true; }}><TextSelect size={16} /></button>
      <button aria-label="关闭查找" title="关闭 · Esc" onClick={close}><X size={16} /></button>
     </div>
    </div>
    {expanded && <div className="find-row replace-row">
     <div className="find-input-wrap"><textarea aria-label="替换为" placeholder="替换为" rows={1} spellCheck={false} value={replacement} onChange={event => { setReplacement(event.target.value); setMessage(''); }} /></div>
     <div className="find-actions">
      <button aria-label="替换当前匹配项" title="替换 · Enter" disabled={!matches.length || !!error} onClick={() => replace()}><Replace size={17} /></button>
      <button aria-label="全部替换" title={`全部替换 · ${modifier}Enter`} disabled={!matches.length || !!error || limited} onClick={() => replace(true)}><ReplaceAll size={17} /></button>
     </div>
    </div>}
   </div>
  </div>
  <div className="find-footer"><span role="status">{error || message || (limited ? `超过 ${matchLimit.toLocaleString()} 处，请缩小范围后全部替换` : scope ? '仅在选区中查找' : options.regex && expanded ? '正则替换支持 $1、$2、$&' : '仅搜索当前文章')}</span><span>Enter 跳转 · Esc 关闭</span></div>
 </div>, host);
}
