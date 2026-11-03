import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const exec = promisify(execFile);
const scratch = await mkdtemp(path.join(tmpdir(), 'fever-desktop-history-images-'));
const folder = path.join(scratch, 'vault'), data = path.join(scratch, 'data');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6N3IAAAAASUVORK5CYII=', 'base64');
const second = Buffer.concat([png, Buffer.from('second version')]);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
 await mkdir(path.join(folder, '分类'), { recursive: true }); await mkdir(path.join(folder, '图片')); await mkdir(data);
 const git = async args => (await exec('git', args, { cwd: folder })).stdout;
 await git(['init', '-b', 'main']); await git(['config', 'user.name', 'Test']); await git(['config', 'user.email', 'test@example.com']);
 await writeFile(path.join(folder, '分类/History.md'), '# History first\n\n![[截图.png|旧图]]\n');
 await writeFile(path.join(folder, '图片/截图.png'), png);
 await git(['add', '.']); await git(['commit', '-m', 'original wiki image']);
 const original = (await git(['rev-parse', 'HEAD'])).trim();
 await writeFile(path.join(folder, '分类/History.md'), '# History second\n\n![第二版](../图片/截图.png)\n');
 await writeFile(path.join(folder, '图片/截图.png'), second);
 await git(['commit', '-am', 'changed image bytes']);
 // Build a historical rename and a current LFS snapshot without a migration tool.
 await mkdir(path.join(folder, 'notes')); await mkdir(path.join(folder, 'images'));
 await git(['mv', '分类/History.md', 'notes/history.md']);
 await git(['commit', '-m', 'rename historical note']);
 await git(['mv', '图片/截图.png', 'images/history.png']);
 await writeFile(path.join(folder, 'notes/history.md'), '# History second\n\n![第二版](../images/history.png)\n');
 await writeFile(path.join(folder, '.gitattributes'), 'images/** filter=lfs diff=lfs merge=lfs -text\n');
 await writeFile(path.join(folder, 'fever.json'), JSON.stringify({ version: 1, categories: ['分类'], notes: [{
  id: 'history', filename: 'history.md', title: 'History', category: '分类', sourcePath: '分类/History.md',
  createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z',
 }] }));
 await git(['lfs', 'install', '--local']);
 await git(['add', '.']); await git(['commit', '-m', 'current LFS image']);
 const latest = (await exec('git', ['rev-parse', 'HEAD'], { cwd: folder })).stdout.trim();
 for (const image of await readdir(path.join(folder, 'images'))) await rm(path.join(folder, 'images', image), { recursive: true, force: true });
 await writeFile(path.join(data, 'preferences.json'), JSON.stringify({ vault: folder }));
 const bootstrap = path.join(scratch, 'production.cjs');
 await writeFile(bootstrap, `const { BrowserWindow } = require('electron');\nBrowserWindow.prototype.loadURL = function () { return this.loadFile(${JSON.stringify(path.resolve('dist/index.html'))}); };\nrequire(${JSON.stringify(path.resolve('electron/main.cjs'))});\n`);
 app = await electron.launch({ args: [bootstrap, `--fever-data=${data}`], env });
 const page = await app.firstWindow(), errors = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.locator('.folder-row').filter({ hasText: '分类' }).click();
 await page.locator('.note-row').filter({ hasText: 'History' }).click();
 await page.getByTitle('笔记历史', { exact: true }).click();
 await page.locator('.history-item').filter({ hasText: 'original wiki image' }).click();
 await page.getByRole('button', { name: '预览此版本', exact: true }).click();
 const image = page.locator('.revision-document img');
 await expect(image).toHaveAttribute('src', new RegExp(`commit=${original}`));
 await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth)).toBe(1);
 assertBytes(await image.evaluate(async element => Array.from(new Uint8Array(await (await fetch(element.src)).arrayBuffer()))), png);
 await expect(image).toHaveAttribute('alt', '旧图');
 await page.screenshot({ path: 'test-results/desktop-history-images.png' });
 await page.locator('.history-item').first().click();
 await page.getByRole('button', { name: '预览此版本', exact: true }).click();
 await expect(image).toHaveAttribute('src', new RegExp(`commit=${latest}`));
 await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth)).toBe(1);
 assertBytes(await image.evaluate(async element => Array.from(new Uint8Array(await (await fetch(element.src)).arrayBuffer()))), second);
 const manifest = JSON.parse(await readFile(path.join(folder, 'fever.json'), 'utf8'));
 if (Object.hasOwn(manifest, 'assets')) throw new Error('Obsolete assets field remains');
 // Current BMP assets use the same restricted production protocol as migrated ones.
 const bmp = Buffer.from('424d3a00000000000000360000002800000001000000010000000100180000000000040000000000000000000000000000000000000000000000', 'hex');
 await page.evaluate(async bytes => {
  const vault = await window.fever.current(), note = vault.manifest.notes[0];
  const src = await window.fever.image(bytes, 'bitmap.bmp', note.id);
  await window.fever.save(note.id, (await window.fever.read(note.id)) + `\n\n![bitmap](${src})\n`);
 }, Array.from(bmp));
 await page.locator('.tab').getByRole('button', { name: 'History', exact: true }).click();
 const bitmap = page.locator('.wysiwyg-content img[alt="bitmap"]');
 await expect.poll(() => bitmap.evaluate(element => element.complete && element.naturalWidth)).toBe(1);
 assertBytes(await bitmap.evaluate(async element => Array.from(new Uint8Array(await (await fetch(element.src)).arrayBuffer()))), bmp);
 if (errors.length) throw new Error(errors.join('\n'));
 console.log('Desktop historical wiki images and LFS images render from their selected commits with current image files deleted.');
} finally { if (app) await app.close(); await rm(scratch, { recursive: true, force: true }); }
function assertBytes(actual, expected) { if (!Buffer.from(actual).equals(expected)) throw new Error('Image bytes do not match the selected commit'); }
