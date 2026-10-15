export const formattingShortcuts = [
 { action: 'bold', label: '加粗', key: 'Mod-b' },
 { action: 'italic', label: '斜体', key: 'Mod-i' },
 { action: 'strike', label: '删除线', key: 'Mod-Shift-x' },
 { action: 'code', label: '行内代码', key: 'Mod-`' },
 { action: 'codeBlock', label: '代码块', key: 'Mod-Shift-l' },
 { action: 'blockquote', label: '引用', key: 'Mod-Shift-b' },
 { action: 'bulletList', label: '无序列表', key: 'Mod-Shift-8' },
 { action: 'orderedList', label: '有序列表', key: 'Mod-Shift-7' },
 { action: 'taskList', label: '任务列表', key: 'Mod-Shift-9' },
 { action: 'paragraph', label: '正文段落', key: 'Mod-0' },
 ...([1, 2, 3, 4, 5, 6] as const).map(level => ({ action: `heading${level}` as const, label: `${level} 级标题`, key: `Mod-${level}` })),
];
export type FormattingAction = typeof formattingShortcuts[number]['action'];
export function shortcutLabel(key: string, modifier: string) {
 return key.replace('Mod-', modifier).replace('Shift-', modifier === '⌘' ? '⇧' : 'Shift+').replace(/([a-z])$/, letter => letter.toUpperCase());
}
