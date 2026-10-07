import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const url = 'http://127.0.0.1:5173';
let server, desktop;
async function available() {
 try {
  const response = await fetch(url, { signal: AbortSignal.timeout(700) });
  const html = await response.text();
  if (!html.includes('Fever · 让想法生长')) throw new Error('端口 5173 已被其他应用占用');
  return true;
 } catch (e) { if (e.message.includes('其他应用')) throw e; return false; }
}
function cleanup() { server?.kill(); desktop?.kill(); }
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
try {
 if (!await available()) {
  server = spawn(process.execPath, [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js')], { stdio: 'inherit' });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
   if (server.exitCode !== null) throw new Error('开发服务器启动失败');
   if (await available()) { ready = true; break; }
   await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('等待开发服务器超时');
 } else console.log('复用已运行的 Fever 开发服务器');
 const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
 desktop = spawn(require('electron'), ['.'], { stdio: 'inherit', env });
 desktop.on('error', e => { console.error(e.message); cleanup(); process.exit(1); });
 desktop.on('exit', code => { server?.kill(); process.exit(code || 0); });
} catch (e) { console.error(e.message); cleanup(); process.exit(1); }
