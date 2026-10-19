const fs = require('node:fs/promises');
const MAX_NOTE_BYTES = 10 * 1024 * 1024;

// Check the opened file, and also bound the actual reads if it grows after stat.
async function readBounded(file, { limit = MAX_NOTE_BYTES, message = '笔记最大为 10 MB', signal } = {}) {
  signal?.throwIfAborted();
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('请选择文件');
    if (stat.size > limit) throw new Error(message);
    const chunks = []; let size = 0;
    while (true) {
      signal?.throwIfAborted();
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, limit + 1 - size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      signal?.throwIfAborted();
      if (!bytesRead) break;
      size += bytesRead;
      if (size > limit) throw new Error(message);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, size);
  } finally { await handle.close(); }
}

module.exports = { readBounded, MAX_NOTE_BYTES };

// A list card only needs a prefix; do not read the rest of a large note.
async function readPrefix(file, { limit = 32 * 1024, signal } = {}) {
  signal?.throwIfAborted();
  const handle = await fs.open(file, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw new Error('请选择文件');
    const buffer = Buffer.allocUnsafe(limit);
    let size = 0;
    while (size < limit) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, size, limit - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    signal?.throwIfAborted();
    return new TextDecoder().decode(buffer.subarray(0, size), { stream: true }).slice(0, 8192);
  } finally { await handle.close(); }
}
module.exports.readPrefix = readPrefix;
