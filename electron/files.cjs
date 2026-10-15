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
