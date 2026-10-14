import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { parse, preprocess, postprocess } from 'micromark';
import { downloadImage } from '../electron/remote-images.cjs';

const exec = promisify(execFile);
const parser = unified().use(remarkParse).use(remarkGfm);
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp']);
const ignored = new Set(['.git', '.obsidian', '.claude', '.superpowers', 'node_modules', '.DS_Store']);
const posix = value => value.split(path.sep).join('/');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function stableId(value) {
 const bytes = createHash('sha256').update(`fever-notebook-migration-v1:${value}`).digest().subarray(0, 16);
 bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
 const hex = bytes.toString('hex');
 return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
async function filesIn(root) {
 const files = [];
 async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
   if (ignored.has(entry.name)) continue;
   const file = path.join(dir, entry.name);
   if (entry.isSymbolicLink()) throw new Error('Migration does not follow symlinks');
   if (entry.isDirectory()) await walk(file);
   else files.push(posix(path.relative(root, file)));
  }
 }
 await walk(root); return files.sort();
}
function excludedRanges(ast) {
 const result = [];
 visit(ast, node => { if (node.type === 'code' || node.type === 'inlineCode') result.push([node.position.start.offset, node.position.end.offset]); });
 return result;
}
const wikiPattern = /(!?)\[\[([^\]\n]+)\]\]/g;

function destinationRanges(text) {
 const destinations = new Map(), containers = [];
 const events = postprocess(parse({ extensions: parser.data('micromarkExtensions') }).document().write(preprocess()(text, undefined, true)));
 for (const [event, token] of events) {
  if (['link', 'image', 'definition'].includes(token.type)) {
   if (event === 'enter') containers.push(token);
   else containers.pop();
  } else if (event === 'enter' && ['resourceDestinationString', 'definitionDestinationString'].includes(token.type) && containers.length) {
   destinations.set(containers.at(-1).start.offset, { start: token.start.offset, end: token.end.offset });
  }
 }
 return destinations;
}

export function rewriteMarkdown(text, notePath, mapping) {
 const ast = parser.parse(text), edits = [], unresolved = [], ranges = excludedRanges(ast);
 const destinations = destinationRanges(text);
 let replaced = 0;
 function resolve(raw) {
  if (mapping.external.has(raw)) return mapping.external.get(raw);
  if (/^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith('#')) return null;
  const index = raw.indexOf('#'), anchor = index >= 0 ? raw.slice(index) : '';
  let target = index >= 0 ? raw.slice(0, index) : raw;
  try { target = decodeURIComponent(target); } catch { /* Keep malformed escapes literal. */ }
  const normalized = target.replaceAll('\\', '/');
  const candidates = [path.posix.normalize(path.posix.join(path.posix.dirname(notePath), normalized)), path.posix.normalize(normalized.replace(/^\//, ''))];
  for (const candidate of candidates) {
   const match = mapping.paths.get(candidate) || mapping.paths.get(candidate + '.md');
   if (match) return match + anchor;
  }
  const matches = [...mapping.paths.entries()].filter(([source]) => source === normalized || source.endsWith('/' + normalized) || source.endsWith('/' + normalized + '.md') || path.posix.basename(source, '.md') === normalized);
  if (matches.length === 1) return matches[0][1] + anchor;
  return undefined;
 }
 visit(ast, node => {
  if (!['image', 'link', 'definition'].includes(node.type)) return;
  const target = resolve(node.url);
  if (target === null) return;
  if (target === undefined) { unresolved.push({ source: notePath, target: node.url, kind: node.type }); return; }
  // Token offsets identify the destination even when the label/title repeats it,
  // or Markdown escaping makes the source spelling differ from node.url.
  const destination = destinations.get(node.position.start.offset);
  if (!destination) { unresolved.push({ source: notePath, target: node.url, kind: 'unsupported-url' }); return; }
  edits.push({ ...destination, value: target }); replaced++;
 });
 for (const match of text.matchAll(wikiPattern)) {
  const start = match.index, end = start + match[0].length;
  if (ranges.some(([a, b]) => start >= a && start < b) || edits.some(e => start < e.end && end > e.start)) continue;
  const [rawTarget, ...aliasParts] = match[2].split('|'), target = resolve(rawTarget.trim());
  if (!target) { unresolved.push({ source: notePath, target: rawTarget, kind: match[1] ? 'wiki-image' : 'wiki-link' }); continue; }
  const label = (aliasParts.join('|') || path.posix.basename(rawTarget, path.posix.extname(rawTarget))).replace(/[\[\]\\]/g, '\\$&');
  edits.push({ start, end, value: `${match[1] ? '!' : ''}[${label}](${target})` }); replaced++;
 }
 let content = text;
 for (const edit of edits.sort((a, b) => b.start - a.start)) content = content.slice(0, edit.start) + edit.value + content.slice(edit.end);
 return { content, replaced, unresolved };
}

export async function migrateNotebook(source, destination) {
 source = await fs.realpath(source); destination = path.resolve(destination);
 if (destination === source || destination.startsWith(source + path.sep)) throw new Error('Destination must be outside the source notebook');
 try { await fs.access(destination); throw new Error('Destination already exists; refusing to overwrite it'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
 const environment = { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' };
 async function git(cwd, args, optional = false) {
  try { return (await exec('git', args, { cwd, env: environment, timeout: 120000, maxBuffer: 20 * 1024 * 1024 })).stdout; }
  catch (e) { if (optional) return ''; throw new Error(`Git operation failed: ${args[0]}`); }
 }
 const sourceHead = (await git(source, ['rev-parse', 'HEAD'])).trim();
 const sourceStatus = await git(source, ['status', '--porcelain=v1', '-z']);
 if (sourceStatus) throw new Error('Commit or stash source notebook changes before migration');
 await git(source, ['lfs', 'version']);
 const files = await filesIn(source), notes = files.filter(f => /\.(md|markdown)$/i.test(f)), images = files.filter(f => imageExtensions.has(path.posix.extname(f).toLowerCase()));
 const attachments = files.filter(f => !notes.includes(f) && !images.includes(f) && !f.startsWith('.'));
 const mapping = { paths: new Map(), external: new Map() };
 for (const file of attachments) {
  const url = file.split('/').map(segment => encodeURIComponent(segment).replace(/[()]/g, char => `%${char.charCodeAt(0).toString(16)}`)).join('/');
  mapping.paths.set(file, `../attachments/${url}`);
 }
 const manifest = { version: 1, categories: [], notes: [], assets: {} };
 const report = { version: 1, source, destination, sourceHead, createdAt: new Date().toISOString(), originalCommits: Number((await git(source, ['rev-list', '--count', 'HEAD'])).trim()), notes: [], images: [], rewrittenReferences: 0, unresolved: [], externalImageFailures: [], additionalFiles: [] };
 const contents = new Map();
 for (const notePath of notes) {
  const id = stableId(`note:${notePath}`), filename = id + '.md', category = path.posix.dirname(notePath) === '.' ? '' : path.posix.dirname(notePath), stat = await fs.stat(path.join(source, notePath));
  const dates = (await git(source, ['log', '--follow', '--format=%aI', '--', notePath])).trim().split('\n').filter(Boolean);
  const createdAt = dates.at(-1) || stat.birthtime.toISOString(), updatedAt = dates[0] || stat.mtime.toISOString();
  const title = path.posix.basename(notePath, path.posix.extname(notePath));
  manifest.notes.push({ id, title, category, filename, createdAt, updatedAt, sourcePath: notePath });
  if (category && !manifest.categories.includes(category)) manifest.categories.push(category);
  mapping.paths.set(notePath, filename);
  const bytes = await fs.readFile(path.join(source, notePath));
  contents.set(notePath, bytes.toString('utf8'));
  report.notes.push({ sourcePath: notePath, filename, originalSha256: sha256(bytes) });
 }
 for (const imagePath of images) {
  const filename = stableId(`image:${imagePath}`) + path.posix.extname(imagePath).toLowerCase();
  const bytes = await fs.readFile(path.join(source, imagePath));
  if (bytes.subarray(0, 80).toString().startsWith('version https://git-lfs.github.com/spec/v1')) throw new Error('Source images must be hydrated with git lfs pull before migration');
  mapping.paths.set(imagePath, `../images/${filename}`);
  manifest.assets[imagePath] = `../images/${filename}`;
  report.images.push({ sourcePath: imagePath, filename, sha256: sha256(bytes), bytes: bytes.length });
 }
 const urls = new Set();
 for (const content of contents.values()) visit(parser.parse(content), node => { if (node.type === 'image' && /^https?:\/\//.test(node.url)) urls.add(node.url); });
 const remoteBytes = new Map();
 for (const url of urls) {
  try {
   const { bytes, extension } = await downloadImage(url);
   const filename = stableId(`remote:${url}`) + extension;
   remoteBytes.set(filename, bytes); mapping.external.set(url, `../images/${filename}`);
   manifest.assets[url] = `../images/${filename}`;
   report.images.push({ externalUrl: url, filename, sha256: sha256(bytes), bytes: bytes.length });
  } catch { report.externalImageFailures.push({ host: new URL(url).hostname, url }); }
 }
 for (const [notePath, content] of contents) {
  const result = rewriteMarkdown(content, notePath, mapping);
  contents.set(notePath, result.content); report.rewrittenReferences += result.replaced; report.unresolved.push(...result.unresolved);
  report.notes.find(n => n.sourcePath === notePath).migratedSha256 = sha256(Buffer.from(result.content));
 }
 if (report.unresolved.length || report.externalImageFailures.length) throw new Error(`Unresolved references: ${report.unresolved.length}; unavailable remote images: ${report.externalImageFailures.length}`);
 const stage = path.join(path.dirname(destination), `.${path.basename(destination)}-migration-${randomUUID()}`);
 await fs.mkdir(path.dirname(destination), { recursive: true });
 try {
  await git(path.dirname(destination), ['clone', '--no-hardlinks', '--no-checkout', source, stage]);
  await git(stage, ['remote', 'remove', 'origin']);
  await git(stage, ['checkout', '--force']);
  // Keep the complete original history but replace its working tree with the Fever layout.
  for (const entry of await fs.readdir(stage)) if (entry !== '.git') await fs.rm(path.join(stage, entry), { recursive: true, force: true });
  await fs.mkdir(path.join(stage, 'notes')); await fs.mkdir(path.join(stage, 'images'));
  // Commit byte-identical moves first so Git can follow even image-only notes.
  for (const note of manifest.notes) await fs.copyFile(path.join(source, note.sourcePath), path.join(stage, 'notes', note.filename));
  for (const image of report.images) await fs.writeFile(path.join(stage, 'images', image.filename), image.sourcePath ? await fs.readFile(path.join(source, image.sourcePath)) : remoteBytes.get(image.filename));
  // Preserve unrelated user attachments too, without exposing them in the application source tree.
  for (const file of attachments) {
   const target = path.join(stage, 'attachments', file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(path.join(source, file), target); report.additionalFiles.push({ sourcePath: file, destinationPath: posix(path.relative(stage, target)) });
  }
  const objectDir = path.join(source, '.git', 'lfs', 'objects');
  try { await fs.cp(objectDir, path.join(stage, '.git', 'lfs', 'objects'), { recursive: true }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await fs.writeFile(path.join(stage, '.gitattributes'), 'images/** filter=lfs diff=lfs merge=lfs -text\n');
  await fs.writeFile(path.join(stage, 'fever.json'), JSON.stringify(manifest, null, 2) + '\n');
  await fs.writeFile(path.join(stage, '.fever-migration.json'), JSON.stringify(report, null, 2) + '\n');
  for (const key of ['user.name', 'user.email']) {
   const value = (await git(source, ['config', key], true)).trim();
   await git(stage, ['config', '--local', key, value || (key === 'user.name' ? 'Fever Migration' : 'migration@fever.local')]);
  }
  await git(stage, ['lfs', 'install', '--local']);
  await git(stage, ['add', '--all']);
  await git(stage, ['commit', '-m', `Migrate ${notes.length} notes and ${report.images.length} images to Fever vault layout`]);
  for (const note of manifest.notes) await fs.writeFile(path.join(stage, 'notes', note.filename), contents.get(note.sourcePath));
  await git(stage, ['add', '--', 'notes']);
  if ((await git(stage, ['diff', '--cached', '--name-only'])).trim()) await git(stage, ['commit', '-m', 'Normalize Markdown image and note references for Fever']);
  if ((await git(source, ['rev-parse', 'HEAD'])).trim() !== sourceHead || await git(source, ['status', '--porcelain=v1', '-z']) !== sourceStatus) throw new Error('Source changed during migration');
  for (const note of report.notes) if (sha256(await fs.readFile(path.join(stage, 'notes', note.filename))) !== note.migratedSha256 || sha256(await fs.readFile(path.join(source, note.sourcePath))) !== note.originalSha256) throw new Error('Note verification failed');
  for (const image of report.images) {
   if (sha256(await fs.readFile(path.join(stage, 'images', image.filename))) !== image.sha256) throw new Error('Image verification failed');
   const pointer = await git(stage, ['show', `HEAD:images/${image.filename}`]);
   if (!pointer.includes(`oid sha256:${image.sha256}`)) throw new Error('Git LFS verification failed');
  }
  await fs.rename(stage, destination);
  return { notes: notes.length, localImages: images.length, remoteImages: remoteBytes.size, preservedCommits: report.originalCommits, rewrittenReferences: report.rewrittenReferences, additionalFiles: report.additionalFiles.length, destination };
 } catch (e) { await fs.rm(stage, { recursive: true, force: true }); throw e; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
 const [source, destination] = process.argv.slice(2);
 if (!source || !destination) { console.error('Usage: node scripts/notebook-migration.mjs <source> <new-vault>'); process.exitCode = 1; }
 else { try { console.log(JSON.stringify(await migrateNotebook(source, destination), null, 2)); } catch (e) { console.error(e.message); process.exitCode = 1; } }
}
