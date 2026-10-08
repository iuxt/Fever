export type ClipboardContent = { text: string; html?: string };

export async function writeClipboard(content: ClipboardContent) {
 if (window.fever?.writeClipboard) return window.fever.writeClipboard(content);
 try {
  if (content.html && navigator.clipboard.write && typeof ClipboardItem !== 'undefined') {
   await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([content.text], { type: 'text/plain' }), 'text/html': new Blob([content.html], { type: 'text/html' }) })]);
   return;
  }
  await navigator.clipboard.writeText(content.text);
 } catch { throw new Error('复制失败，请检查剪贴板权限'); }
}

export async function readClipboard(): Promise<ClipboardContent> {
 if (window.fever?.readClipboard) return window.fever.readClipboard();
 try {
  if (navigator.clipboard.read) {
   const items = await navigator.clipboard.read();
   let text = '', html = '';
   for (const item of items) {
    if (item.types.includes('text/plain')) text += await (await item.getType('text/plain')).text();
    if (item.types.includes('text/html')) html += await (await item.getType('text/html')).text();
   }
   return { text, html };
  }
 } catch { /* Some browsers grant text access separately. */ }
 try { return { text: await navigator.clipboard.readText() }; }
 catch { throw new Error('粘贴失败，请检查剪贴板权限或使用键盘快捷键'); }
}
