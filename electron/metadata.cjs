const { randomUUID } = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTENSIONS = new Set(['md', 'markdown', 'txt', 'fountain']);
function invalid() { throw new Error('metadata.json 含有无效的笔记或分类记录'); }

// Keep FSNotes' snapshot as the source of truth; Fever's manifest is only a view.
function folderPaths(metadata) {
  if (!metadata || metadata.version !== 1 || !Array.isArray(metadata.notes) || !Array.isArray(metadata.folders)) invalid();
  const folders = new Map(), paths = new Map(), visiting = new Set(), siblings = new Set();
  for (const folder of metadata.folders) {
    if (!folder || !UUID.test(folder.id) || typeof folder.name !== 'string' || !folder.name || folder.name.includes('/') || folders.has(folder.id) || (folder.parentID != null && typeof folder.parentID !== 'string')) invalid();
    const sibling = JSON.stringify([folder.parentID ?? null, folder.name.toLowerCase()]);
    if (siblings.has(sibling)) invalid();
    siblings.add(sibling); folders.set(folder.id, folder);
  }
  function resolve(id) {
    if (paths.has(id)) return paths.get(id);
    const folder = folders.get(id);
    if (!folder || visiting.has(id)) invalid();
    visiting.add(id);
    const value = folder.parentID == null ? folder.name : `${resolve(folder.parentID)}/${folder.name}`;
    visiting.delete(id); paths.set(id, value); return value;
  }
  for (const id of folders.keys()) resolve(id);
  const ids = new Set();
  for (const note of metadata.notes) {
    if (!note || !UUID.test(note.id) || ids.has(note.id) || typeof note.name !== 'string' || !note.name.trim() || !EXTENSIONS.has(note.fileExtension) || (note.folderID != null && !folders.has(note.folderID)) || (note.trashed != null && typeof note.trashed !== 'boolean') || (note.aliases != null && (!Array.isArray(note.aliases) || !note.aliases.every(a => typeof a === 'string')))) invalid();
    ids.add(note.id);
  }
  return paths;
}

function metadataView(metadata) {
  const paths = folderPaths(metadata);
  const viewNote = note => ({
    id: note.id, filename: `${note.id}.${note.fileExtension}`, title: note.name,
    category: note.folderID == null ? (note.trashed && typeof note.feverTrashCategory === 'string' ? note.feverTrashCategory : '') : paths.get(note.folderID), createdAt: '', updatedAt: '',
    ...(note.legacyPath ? { sourcePath: note.legacyPath } : {}),
  });
  return {
    version: 1,
    categories: metadata.folders.map(folder => paths.get(folder.id)),
    notes: metadata.notes.filter(note => !note.trashed).map(viewNote),
    trash: metadata.notes.filter(note => note.trashed).map(viewNote),
  };
}

function updateMetadata(metadata, manifest, removedCategory) {
  const next = structuredClone(metadata), paths = folderPaths(next);
  const folders = new Map([...paths].map(([id, category]) => [category.toLowerCase(), id]));
  function ensureFolder(category) {
    if (!category) return undefined;
    let parentID, prefix = '';
    for (const name of category.split('/')) {
      if (!name.trim()) invalid();
      prefix += (prefix ? '/' : '') + name;
      const key = prefix.toLowerCase();
      if (!folders.has(key)) {
        const folder = { id: randomUUID(), name, ...(parentID ? { parentID } : {}) };
        next.folders.push(folder); folders.set(key, folder.id);
      }
      parentID = folders.get(key);
    }
    return parentID;
  }
  for (const category of manifest.categories) ensureFolder(category);
  const active = new Map(manifest.notes.map(note => [note.id, note]));
  const entries = new Map(next.notes.map(note => [note.id, note]));
  for (const entry of next.notes) {
    // A delete uses FSNotes' trash flag and retains both the file and attachments.
    if (!entry.trashed && !active.has(entry.id)) entry.trashed = true;
  }
  for (const note of manifest.notes) {
    let entry = entries.get(note.id);
    if (!entry) {
      entry = { id: note.id, name: note.title, fileExtension: note.filename.slice(note.id.length + 1), trashed: false };
      next.notes.push(entry);
    } else if (entry.name !== note.title) {
      entry.aliases = [...new Set([...(entry.aliases || []), entry.name])].slice(-50);
      entry.name = note.title;
    }
    const folderID = ensureFolder(note.category);
    if (folderID) entry.folderID = folderID;
    else delete entry.folderID;
    entry.trashed = false;
    delete entry.feverTrashCategory;
  }
  if (removedCategory) {
    const removed = new Set([...paths].filter(([, category]) => category === removedCategory || category.startsWith(`${removedCategory}/`)).map(([id]) => id));
    for (const entry of next.notes) {
      if (!removed.has(entry.folderID)) continue;
      // Keep the restore path without leaving FSNotes references to deleted folders.
      entry.feverTrashCategory = paths.get(entry.folderID);
      delete entry.folderID;
    }
    next.folders = next.folders.filter(folder => !removed.has(folder.id));
  }
  folderPaths(next);
  return next;
}

module.exports = { metadataView, updateMetadata };
