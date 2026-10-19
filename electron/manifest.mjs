const ID = /^[a-zA-Z0-9_-]+$/;
const FILE = /^[a-zA-Z0-9_-]+\.(md|markdown|txt|fountain|excalidraw)$/;
export const withinCategory = (path, parent) => path === parent || path.startsWith(`${parent}/`);
export const remapCategory = (path, from, to) => withinCategory(path, from) ? to + path.slice(from.length) : path;
export function validCategory(path, root = false) {
  if (typeof path !== 'string' || (!root && !path.trim()) || path.length > 200 || (path && path.split('/').some(part => !part.trim()))) throw new Error('分类无效（路径最多 200 字）');
  return path.trim();
}
export function folderPaths(manifest) {
  const folders = new Map(manifest.folders.map(folder => [folder.id, folder])), paths = new Map();
  for (const folder of manifest.folders) {
    const chain = [], visited = new Set(); let current = folder;
    while (current && !paths.has(current.id)) {
      if (visited.has(current.id)) throw new Error('文件夹不能循环嵌套');
      visited.add(current.id); chain.push(current);
      if (current.parentId !== null && !folders.has(current.parentId)) throw new Error('父文件夹不存在');
      current = folders.get(current.parentId);
    }
    let path = current ? paths.get(current.id) : '';
    for (const item of chain.reverse()) { path = path ? `${path}/${item.name}` : item.name; paths.set(item.id, path); }
  }
  return paths;
}
export function ensureFolder(manifest, path) {
  path = validCategory(path, true);
  if (!path) return null;
  const paths = new Map([...folderPaths(manifest)].map(([id, path]) => [path, id]));
  let parentId = null, current = '';
  for (const name of path.split('/')) {
    current = current ? `${current}/${name}` : name;
    let id = paths.get(current);
    if (!id) { id = crypto.randomUUID(); manifest.folders.push({ id, name, parentId }); paths.set(current, id); }
    parentId = id;
  }
  return parentId;
}
export function noteCategory(manifest, note, paths = folderPaths(manifest)) {
  return note.originalCategory ?? (note.folderId === null ? '' : paths.get(note.folderId) || '');
}
export function noteView(manifest, note, paths) { const { originalCategory, ...record } = note; return { ...record, category: noteCategory(manifest, note, paths) }; }
export function manifestView(manifest) {
  const paths = folderPaths(manifest);
  return { ...manifest, folders: manifest.folders.map(folder => ({ ...folder })), categories: [...paths.values()], notes: manifest.notes.map(note => noteView(manifest, note, paths)), ...(manifest.trash ? { trash: manifest.trash.map(note => noteView(manifest, note, paths)) } : {}) };
}
// v1 remains readable for existing vaults, old Git snapshots and manually edited manifests.
export function readManifest(input, previous) {
  if (!input || ![1, 2].includes(input.version) || !Array.isArray(input.notes)) throw new Error('不支持的笔记清单格式');
  if (input.trash != null && !Array.isArray(input.trash)) throw new Error('回收站格式无效');
  const ids = new Set(), files = new Set();
  for (const note of [...input.notes, ...(input.trash || [])]) {
    if (!note || typeof note.id !== 'string' || !ID.test(note.id) || typeof note.filename !== 'string' || !FILE.test(note.filename) || typeof note.title !== 'string' || (note.sourcePath != null && typeof note.sourcePath !== 'string') || ids.has(note.id) || files.has(note.filename)) throw new Error('笔记清单含有无效或重复的文件记录');
    if (note.directory !== undefined && !['notes', 'drawings'].includes(note.directory)) throw new Error('笔记存储目录无效');
    if (input.version === 1 && typeof note.category !== 'string') throw new Error('笔记分类格式无效');
    ids.add(note.id); files.add(note.filename);
  }
  let manifest;
  if (input.version === 1) {
    if (!Array.isArray(input.categories) || !input.categories.every(path => typeof path === 'string')) throw new Error('分类格式无效');
    manifest = { version: 2, folders: [], notes: [], ...(input.trash ? { trash: [] } : {}) };
    // Reuse IDs when loading an older Git snapshot into an already open vault.
    const previousPaths = previous ? new Map([...folderPaths(previous)].map(([id, path]) => [path, id])) : new Map();
    const paths = new Map();
    const add = value => {
      const path = validCategory(value, true); let parentId = null, current = '';
      for (const name of path ? path.split('/') : []) {
        current = current ? `${current}/${name}` : name;
        if (!paths.has(current)) { const id = previousPaths.get(current) || crypto.randomUUID(); manifest.folders.push({ id, name, parentId }); paths.set(current, id); }
        parentId = paths.get(current);
      }
      return parentId;
    };
    input.categories.forEach(add);
    manifest.notes = input.notes.map(({ category, folderId: _folderId, originalCategory: _originalCategory, ...note }) => ({ ...note, folderId: add(category) }));
    if (input.trash) manifest.trash = input.trash.map(({ category, ...note }) => { validCategory(category, true); return { ...note, folderId: paths.get(category) || null, originalCategory: category }; });
  } else {
    if (!Array.isArray(input.folders)) throw new Error('文件夹格式无效');
    manifest = structuredClone(input); delete manifest.categories; delete manifest.assets;
    const folderIds = new Set(), siblings = new Set();
    for (const folder of manifest.folders) {
      if (!folder || typeof folder.id !== 'string' || !ID.test(folder.id) || folderIds.has(folder.id) || typeof folder.name !== 'string' || folder.name.includes('/') || !folder.name.trim() || folder.name.length > 200 || (folder.parentId !== null && (typeof folder.parentId !== 'string' || !ID.test(folder.parentId)))) throw new Error('文件夹记录无效或重复');
      const key = JSON.stringify([folder.parentId, folder.name]);
      if (siblings.has(key)) throw new Error('同一位置存在同名文件夹');
      siblings.add(key); folderIds.add(folder.id);
    }
    for (const path of folderPaths(manifest).values()) validCategory(path);
    const activeNotes = new Set(manifest.notes);
    for (const note of [...manifest.notes, ...(manifest.trash || [])]) {
      if (note.folderId !== null && (typeof note.folderId !== 'string' || !folderIds.has(note.folderId))) throw new Error('笔记引用的文件夹不存在');
      if (note.originalCategory !== undefined) validCategory(note.originalCategory, true);
      if (activeNotes.has(note) && note.originalCategory !== undefined) throw new Error('普通笔记不能使用回收站分类');
      delete note.category;
    }
  }
  return manifest;
}
export function moveCategory(manifest, from, to) {
  from = validCategory(from); to = validCategory(to);
  const paths = folderPaths(manifest), byPath = new Map([...paths].map(([id, path]) => [path, id]));
  const id = byPath.get(from);
  if (!id) throw new Error('分类不存在');
  if (from === to) return manifest;
  if (withinCategory(to, from)) throw new Error('不能将文件夹移入自身或子文件夹');
  if (byPath.has(to)) throw new Error('目标位置已存在同名文件夹');
  const parent = to.split('/').slice(0, -1).join('/'), parentId = parent ? byPath.get(parent) : null;
  if (parent && !parentId) throw new Error('目标父文件夹不存在');
  for (const path of paths.values()) if (withinCategory(path, from) && remapCategory(path, from, to).length > 200) throw new Error('移动后的分类路径超过 200 字');
  return { ...manifest, folders: manifest.folders.map(folder => folder.id === id ? { ...folder, name: to.split('/').at(-1), parentId } : folder) };
}
export function removeCategory(manifest, path) {
  path = validCategory(path);
  const paths = folderPaths(manifest), removedIds = new Set([...paths].filter(([, value]) => withinCategory(value, path)).map(([id]) => id));
  if (!removedIds.size) throw new Error('分类不存在');
  const removed = manifest.notes.filter(note => removedIds.has(note.folderId)).map(note => ({ ...note, originalCategory: noteCategory(manifest, note, paths), folderId: null }));
  return { ...manifest, folders: manifest.folders.filter(folder => !removedIds.has(folder.id)), notes: manifest.notes.filter(note => !removedIds.has(note.folderId)), trash: [...(manifest.trash || []).map(note => removedIds.has(note.folderId) ? { ...note, originalCategory: noteCategory(manifest, note, paths), folderId: null } : note), ...removed] };
}
