import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Folder, FolderOpen, Search } from 'lucide-react';
import type { Note } from './types';

type FolderNode = { path: string; name: string; children: Map<string, FolderNode> };

export default function CategoryPicker({ categories, notes, value, current, onChange, disabled }: {
 categories: string[]; notes: Note[]; value: string; current: string; onChange: (path: string) => void; disabled: boolean;
}) {
 const [query, setQuery] = useState('');
 const [expanded, setExpanded] = useState(() => new Set(value.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/'))));
 const choose = (path: string) => {
  onChange(path);
  setExpanded(previous => new Set([...previous, ...path.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/'))]));
 };
 const folders = useMemo(() => {
  const root: FolderNode = { path: '', name: '', children: new Map() };
  for (const path of [...categories, ...notes.map(note => note.category)]) {
   let parent = root;
   for (const name of path.split('/').filter(Boolean)) {
    if (!parent.children.has(name)) parent.children.set(name, { path: parent.path ? `${parent.path}/${name}` : name, name, children: new Map() });
    parent = parent.children.get(name)!;
   }
  }
  return root;
 }, [categories, notes]);
 const needle = query.trim().toLocaleLowerCase();
 const rows: { folder: FolderNode; depth: number }[] = [];
 const matches = (folder: FolderNode): boolean => folder.path.toLocaleLowerCase().includes(needle) || [...folder.children.values()].some(matches);
 const walk = (parent: FolderNode, depth: number) => {
  for (const folder of parent.children.values()) {
   if (needle && !matches(folder)) continue;
   rows.push({ folder, depth });
   if (needle || expanded.has(folder.path)) walk(folder, depth + 1);
  }
 };
 walk(folders, 0);
 const renderFolder = (path: string, name: string, depth: number, children = false) => <div key={path} className={`category-folder ${path === value ? 'selected' : ''}`} style={{ paddingLeft: 10 + depth * 22 }}>
  {children ? <button type="button" className="category-expand" disabled={disabled || Boolean(needle)} aria-label={`${expanded.has(path) || needle ? '收起' : '展开'}分类：${path}`} aria-expanded={Boolean(needle) || expanded.has(path)} onClick={() => setExpanded(previous => { const next = new Set(previous); if (next.has(path)) next.delete(path); else next.add(path); return next; })}>{expanded.has(path) || needle ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="category-expand" />}
  <button type="button" className="category-choice" disabled={disabled} aria-label={`选择分类：${path || '笔记库根目录'}`} aria-pressed={path === value} title={path || '笔记库根目录'} onClick={() => choose(path)}>
   {path === value || expanded.has(path) ? <FolderOpen size={18} /> : <Folder size={18} />}<span>{name}</span>{path === current && <small>当前分类</small>}{path === value && <Check size={16} />}
  </button>
 </div>;
 return <div className="category-picker">
  <div className="category-heading"><span>移动到</span><small>选择目标文件夹</small></div>
  <div className="category-browser">
   <div className="category-search"><Search size={16} /><input aria-label="搜索分类" placeholder="搜索文件夹…" value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} /></div>
   <div className="category-folders" role="group" aria-label="目标分类">
    {!needle && renderFolder('', '笔记库根目录', 0)}
    {rows.map(({ folder, depth }) => renderFolder(folder.path, folder.name, depth, folder.children.size > 0))}
    {needle && !rows.length && <p className="category-empty">没有找到匹配的文件夹</p>}
   </div>
   <div className="category-destination"><FolderOpen size={15} /><span>目标位置</span><strong title={value || '笔记库根目录'}>{value ? value.split('/').join(' / ') : '笔记库根目录'}</strong></div>
  </div>
 </div>;
}
