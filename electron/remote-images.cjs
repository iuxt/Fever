const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function imageExtension(bytes) {
 if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return '.png';
 if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return '.jpg';
 if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return '.gif';
 if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
 if (bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
  const boxEnd = Math.min(bytes.readUInt32BE(0), bytes.length);
  for (let offset = 8; offset + 4 <= boxEnd; offset += 4) {
   if (offset !== 12 && ['avif', 'avis'].includes(bytes.subarray(offset, offset + 4).toString('ascii'))) return '.avif';
  }
 }
 throw new Error('不是支持的 PNG/JPEG/GIF/WebP/AVIF 图片');
}

async function downloadImage(url) {
 const target = new URL(url);
 if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('图片链接无效');
 const response = await fetch(target, { signal: AbortSignal.timeout(20000) });
 if (!response.ok) { await response.body?.cancel(); throw new Error(`下载失败（HTTP ${response.status}）`); }
 if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) { await response.body?.cancel(); throw new Error('图片最大为 20 MB'); }
 if (!response.body) throw new Error('图片内容为空');
 const chunks = []; let size = 0;
 const reader = response.body.getReader();
 try {
  while (true) {
   const { value, done } = await reader.read();
   if (done) break;
   size += value.byteLength;
   if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error('图片最大为 20 MB'); }
   chunks.push(Buffer.from(value));
  }
 } finally { reader.releaseLock(); }
 if (!size) throw new Error('图片内容为空');
 const bytes = Buffer.concat(chunks);
 return { bytes, extension: imageExtension(bytes) };
}

module.exports = { downloadImage };
