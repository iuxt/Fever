const fs = require('node:fs/promises');
const { readBounded } = require('./files.cjs');

// Keep autosave metadata durable without rewriting the entire manifest per edit.
// Entries live in Git's private directory, never in commits or the notes tree.
class MetadataJournal {
  constructor(file) { this.file = file; this.dirty = false; }
  async check() {
    try { if ((await fs.lstat(this.file)).isSymbolicLink()) throw new Error('更新时间日志不能使用符号链接'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async recover(manifest) {
    await this.check();
    const text = await readBounded(this.file).then(bytes => bytes.toString('utf8')).catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    if (!text) return;
    this.dirty = true;
    const notes = new Map(manifest.notes.map(note => [note.id, note]));
    // A process can stop halfway through the last append. Only complete records count.
    for (const line of text.split('\n').slice(0, -1)) {
      const entry = JSON.parse(line), note = notes.get(entry.id);
      if (note && note.filename === entry.filename && (note.directory || 'notes') === entry.directory && note.updatedAt === entry.previousUpdatedAt && typeof entry.updatedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(entry.updatedAt)) note.updatedAt = entry.updatedAt;
    }
  }
  async record(note, previousUpdatedAt) {
    await this.check();
    const size = await fs.stat(this.file).then(stat => stat.size).catch(error => { if (error.code === 'ENOENT') return 0; throw error; });
    try { await fs.appendFile(this.file, JSON.stringify({ id: note.id, filename: note.filename, directory: note.directory || 'notes', previousUpdatedAt, updatedAt: note.updatedAt }) + '\n', { mode: 0o600 }); }
    catch (error) { await fs.truncate(this.file, size).catch(() => {}); throw error; }
    this.dirty = true;
  }
  async clear() {
    if (!this.dirty) return;
    await this.check();
    await fs.writeFile(this.file, '', { mode: 0o600 });
    this.dirty = false;
  }
}
module.exports = { MetadataJournal };
