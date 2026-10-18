import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, FolderOpen, GitBranch, Keyboard, Monitor, Moon, Sun } from 'lucide-react';
import Select from './Select';
import { EditorWidthOptions } from './EditorWidth';
import { fontSizes, type ThemeMode, type useAppearance } from './appearance';
import { formattingShortcuts, shortcutLabel } from './editorShortcuts';
import { modifier } from './ContextMenu';
import type { Settings, Vault } from './types';

type Props = {
 vault: Vault;
 settings: Settings;
 onSettingsChange: (settings: Settings) => void;
 appearance: Omit<ReturnType<typeof useAppearance>, 'dark'>;
 desktop: boolean;
 lfs: boolean;
 busy: boolean;
 onSwitchVault: () => void;
};
const tabs = [
 { id: 'appearance', label: '外观', icon: Sun },
 { id: 'vault', label: '笔记库', icon: FolderOpen },
 { id: 'sync', label: '同步与备份', icon: GitBranch },
 { id: 'shortcuts', label: '快捷键', icon: Keyboard },
] as const;
type Tab = typeof tabs[number]['id'];

export default function SettingsPanel({ vault, settings, onSettingsChange, appearance, desktop, lfs, busy, onSwitchVault }: Props) {
 const [activeTab, setActiveTab] = useState<Tab>('appearance');
 const id = useId(), tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
 const { themeMode, fontSize, editorWidth, editorFullWidth, setThemeMode, setFontSize, setEditorWidth, setEditorFullWidth } = appearance;
 function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
  let next: number;
  if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
  else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  else return;
  event.preventDefault();
  setActiveTab(tabs[next].id);
  tabButtons.current[next]?.focus();
 }
 return <>
  <div className="settings-tabs" role="tablist" aria-label="设置分类">
   {tabs.map((tab, index) => <button key={tab.id} ref={element => { tabButtons.current[index] = element; }} type="button" role="tab" id={`${id}-tab-${tab.id}`} aria-controls={`${id}-panel-${tab.id}`} aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => setActiveTab(tab.id)} onKeyDown={event => navigateTabs(event, index)}><tab.icon size={16} aria-hidden="true" /><span>{tab.label}</span></button>)}
  </div>
  {tabs.map(tab => <section key={tab.id} className="settings-panel" role="tabpanel" id={`${id}-panel-${tab.id}`} aria-labelledby={`${id}-tab-${tab.id}`} hidden={activeTab !== tab.id} tabIndex={0}>
   {activeTab === 'appearance' && tab.id === 'appearance' && <>
    <div className="form-section-title">外观与排版</div>
    <div className="form-columns">
     <Select<ThemeMode> label="颜色模式" value={themeMode} onChange={setThemeMode} options={[{ value: 'system', label: '跟随系统', icon: <Monitor size={16} /> }, { value: 'light', label: '亮色模式', icon: <Sun size={16} /> }, { value: 'dark', label: '暗色模式', icon: <Moon size={16} /> }]} />
     <Select label="字体大小" value={fontSize} onChange={setFontSize} options={fontSizes.map(size => ({ value: size, label: `${size} px${size === 16 ? '（默认）' : ''}` }))} />
    </div>
    <p className="form-hint">外观调整立即生效，并在此设备上记住。字体大小同时调整正文、源码和界面文字；跟随系统会自动切换亮色与暗色。</p>
    <EditorWidthOptions width={editorWidth} fullWidth={editorFullWidth} onWidthChange={setEditorWidth} onFullWidthChange={setEditorFullWidth} />
    <div className="font-preview" aria-label="字体预览">让每一个想法，都有迹可循。<span>Fever · Markdown 0123456789</span></div>
   </>}
   {activeTab === 'vault' && tab.id === 'vault' && <>
    <div className="form-section-title">当前笔记库</div>
    <div className="settings-vault">
     <FolderOpen size={17} />
     <div><strong>{vault.name}</strong><span title={vault.path}>{vault.path}</span></div>
     <button className="text-button" disabled={busy} onClick={onSwitchVault}>切换</button>
    </div>
    {!desktop && <div className="demo-info">当前是浏览器演示，数据保存在此浏览器中。真实文件、Git、LFS 和定时备份请在桌面应用中使用。</div>}
    <div className="form-section-title">文件存储</div>
    <div className="settings-lfs">
     <Check size={15} />笔记目录 <code>notes/</code> · 绘图目录 <code>drawings/</code> · 图片目录 <code>images/</code> · Git LFS {lfs ? '已启用' : '待安装'}
    </div>
   </>}
   {activeTab === 'sync' && tab.id === 'sync' && <>
    <div className="form-section-title">GIT 提交身份</div>
    <div className="form-columns">
     <label>用户名<input value={settings.author} onChange={e => onSettingsChange({ ...settings, author: e.target.value })} placeholder="你的名字" /></label>
     <label>邮箱<input type="email" value={settings.email} onChange={e => onSettingsChange({ ...settings, email: e.target.value })} placeholder="you@example.com" /></label>
    </div>
    <label>远程仓库（origin）<input value={settings.remote} onChange={e => onSettingsChange({ ...settings, remote: e.target.value })} placeholder="git@github.com:you/notes.git" /></label>
    <p className="form-hint">使用系统 Git 的 SSH 密钥或凭据管理器进行认证。</p>
    <div className="setting-toggle">
     <div><strong>定时自动备份</strong><small>自动创建本地 Git 提交，推送由你手动操作。</small></div>
     <button className={`switch ${settings.autoCommit ? 'on' : ''}`} role="switch" aria-checked={settings.autoCommit} aria-label="定时自动备份" disabled={!desktop} onClick={() => onSettingsChange({ ...settings, autoCommit: !settings.autoCommit })}><span /></button>
    </div>
    {settings.autoCommit && <label>备份间隔（分钟）<input type="number" min={1} max={1440} value={settings.interval} onChange={e => onSettingsChange({ ...settings, interval: Number(e.target.value) })} /></label>}
    <div className="setting-toggle">
     <div><strong>定时自动拉取</strong><small>从远程仓库拉取更新，有本地未提交修改时跳过。</small></div>
     <button className={`switch ${settings.autoPull ? 'on' : ''}`} role="switch" aria-checked={settings.autoPull} aria-label="定时自动拉取" disabled={!desktop} onClick={() => onSettingsChange({ ...settings, autoPull: !settings.autoPull })}><span /></button>
    </div>
    {settings.autoPull && <label>拉取间隔（分钟）<input type="number" min={1} max={1440} step={1} value={settings.pullInterval} onChange={e => onSettingsChange({ ...settings, pullInterval: Number(e.target.value) })} /></label>}
    <p className="form-hint">{desktop ? '保存后在应用打开期间生效，间隔为 1–1440 分钟。拉取采用快进更新，失败时显示提示。' : '当前是浏览器演示，定时自动备份与拉取请在桌面应用中使用。'}</p>
   </>}
   {activeTab === 'shortcuts' && tab.id === 'shortcuts' && <>
    <div className="form-section-title">键盘快捷键</div>
    <p className="form-hint">格式快捷键适用于 Markdown 正文和源码编辑；Windows / Linux 使用 Ctrl。</p>
    <dl className="shortcut-list">{[{ label: '打开设置', key: 'Mod-,' }, { label: '搜索笔记', key: 'Mod-k' }, { label: '文章内查找', key: 'Mod-f' }, { label: '文章内替换', key: modifier === '⌘' ? 'Mod-Alt-f' : 'Mod-h' }, { label: '新建笔记', key: 'Mod-n' }, { label: '保存', key: 'Mod-s' }, { label: '切换源码与正文', key: 'Mod-e' }, { label: '关闭标签页', key: 'Mod-w' }, ...formattingShortcuts, { label: '撤销', key: 'Mod-z' }, { label: '重做', key: 'Mod-Shift-z' }].map(item => <div key={item.key}>
     <dt>{item.label}</dt><dd><kbd>{shortcutLabel(item.key, modifier)}</kbd></dd>
    </div>)}</dl>
   </>}
  </section>)}
 </>;
}
