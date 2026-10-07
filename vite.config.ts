import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const fonts = path.resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts');
export default defineConfig({ plugins: [react(), {
 name: 'local-excalidraw-fonts',
 configureServer(server) {
  server.middlewares.use('/excalidraw-assets/fonts', async (request, response, next) => {
   try {
    const filename = path.resolve(fonts, `.${decodeURIComponent((request.url || '').split('?')[0])}`);
    if (!filename.startsWith(fonts + path.sep) || !filename.endsWith('.woff2')) { next(); return; }
    response.setHeader('Content-Type', 'font/woff2'); response.end(await readFile(filename));
   } catch { next(); }
  });
 },
 async generateBundle() {
  const files = await readdir(fonts, { recursive: true });
  for (const file of files.filter(file => file.endsWith('.woff2'))) this.emitFile({ type: 'asset', fileName: `excalidraw-assets/fonts/${file.split(path.sep).join('/')}`, source: await readFile(path.join(fonts, file)) });
 },
}], base: './', server: { host: '127.0.0.1', port: 5173, strictPort: true } });
