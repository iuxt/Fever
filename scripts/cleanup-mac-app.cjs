const { readdir, rm } = require('node:fs/promises');
const path = require('node:path');

module.exports = async function cleanupMacApp({ outDir, platformToTargets }) {
  const macTargets = [...platformToTargets].find(([platform]) => platform.nodeName === 'darwin')?.[1];
  // macOS 的 --dir 不注册 Target，因此目标 Map 为空；此时 .app 本身就是产物。
  // 保留它供 npm run pack 和本地安装脚本使用，安装脚本会在退出时清理临时目录。
  if (!macTargets || macTargets.size === 0 || macTargets.has('dir')) return [];

  // 此钩子在所有架构的安装包生成后执行，避免提前删除 DMG 的源应用。
  const entries = await readdir(outDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && /^mac(?:-(?:arm64|x64|universal))?$/.test(entry.name)) {
      await rm(path.join(outDir, entry.name, 'Fever.app'), { recursive: true, force: true });
    }
  }
  return [];
};
