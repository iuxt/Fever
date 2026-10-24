import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Production file://, real IPC and disposable data: never open a personal vault.
const root = process.cwd(), scratch = await mkdtemp(path.join(tmpdir(), 'fever-audit-'));
const vault = path.join(scratch, 'vault'), data = path.join(scratch, 'data');
const content = '# 长文\n\n' + 'A paragraph with enough text to exercise the large document path.\n\n'.repeat(5000) + '\n## **末尾**\n\n完整正文\n';
let app;
try {
 await mkdir(path.join(vault, 'notes'), { recursive: true }); await mkdir(data);
 const note = { id: 'audit', title: '长文回归', filename: 'audit.md', category: '', createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z' };
 await writeFile(path.join(vault, 'fever.json'), JSON.stringify({ version: 1, categories: [], notes: [note] }));
 await writeFile(path.join(vault, 'notes', note.filename), content);
 await writeFile(path.join(data, 'preferences.json'), JSON.stringify({ vault }));
 const bootstrap = path.join(scratch, 'production.cjs');
 await writeFile(bootstrap, `const { BrowserWindow } = require('electron');\nBrowserWindow.prototype.loadURL = function () { return this.loadFile(${JSON.stringify(path.join(root, 'dist/index.html'))}); };\nrequire(${JSON.stringify(path.join(root, 'electron/main.cjs'))});\n`);
 const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
 app = await electron.launch({ args: [bootstrap, `--fever-data=${data}`], env });
 const page = await app.firstWindow(); page.setDefaultTimeout(30000);
 const errors = []; page.on('pageerror', error => errors.push(error.message));
 await page.locator('.note-card').click();
 await expect(page.locator('.document-space.source .cm-content')).toBeVisible();
 await expect(page.locator('.wysiwyg-content, .document .prose')).toHaveCount(0);
 await page.getByRole('button', { name: '大纲', exact: true }).click();
 await page.locator('.outline').getByRole('button', { name: '末尾', exact: true }).click();
 await expect(page.locator('.cm-content')).toContainText('## **末尾**');
 await page.keyboard.insertText('已定位');
 await page.keyboard.press('ControlOrMeta+s');
 await expect(page.getByText('笔记已保存', { exact: true })).toBeVisible();
 const edited = content.replace('## **末尾**', '已定位## **末尾**');
 expect(await readFile(path.join(vault, 'notes', note.filename), 'utf8')).toBe(edited);
 await app.close(); app = null;
 expect(await readFile(path.join(vault, 'notes', note.filename), 'utf8')).toBe(edited);
 expect(errors).toEqual([]);
 console.log('Production Electron: large note source editing, heading Worker, navigation and complete disk save passed.');
} finally {
 await app?.close();
 await rm(scratch, { recursive: true, force: true });
}
