const fs = require('node:fs/promises');

const ignoreRules = [
  '.DS_Store', '._*', 'Thumbs.db', 'Desktop.ini',
  '.fever-*.tmp', '/notes/.*.tmp', '/drawings/.*.tmp',
];
const lfsRule = 'images/** filter=lfs diff=lfs merge=lfs -text';

async function ensureRules(store, relative, rules) {
  const file = await store.safe(relative);
  const content = await fs.readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const existing = new Set(content.split(/\r?\n/).map(line => line.trim().replace(/[\t ]+/g, ' ')));
  const missing = rules.filter(rule => !existing.has(rule));
  if (!missing.length) return;
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  await fs.appendFile(file, (content && !content.endsWith('\n') ? eol : '') + missing.join(eol) + eol);
}

async function setupVault(store) {
  await ensureRules(store, '.gitignore', ignoreRules);
  await ensureRules(store, '.gitattributes', [lfsRule]);
  // Respect repository and inherited identities; a fresh machine can back up
  // notes immediately without changing the user's global Git configuration.
  for (const [key, fallback] of [['user.name', 'Fever'], ['user.email', 'fever@localhost']]) {
    if (!(await store.git(['config', key], true)).trim()) await store.git(['config', '--local', key, fallback]);
  }
  const warnings = [];
  let lfs = false;
  if (!(await store.git(['lfs', 'version'], true)).trim()) {
    warnings.push('未找到 Git LFS，文字笔记和本地备份可正常使用；图片功能需要安装 Git LFS 后重新打开笔记库。');
  } else {
    try {
      // Do not force installation: an existing custom pre-push hook must survive.
      await store.git(['lfs', 'install', '--local']);
      lfs = true;
    } catch (error) {
      warnings.push(`Git LFS 配置未完成，图片功能暂不可用。请检查现有 Git 配置或 pre-push 钩子后重新打开笔记库：${error.message}`);
    }
  }
  return { lfs, setupWarnings: warnings };
}

module.exports = { setupVault };
