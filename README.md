# Fever

一个本地优先的跨平台 Markdown 笔记应用。Electron + React + TypeScript，参考 Obsidian 的侧栏、分类树、多标签编辑区和右侧面板，提供浅色 / 深色主题。

## 开始使用

开发环境需要 Node.js 24、Git 和 Git LFS。桌面应用运行时仍需要系统安装 Git / Git LFS，并能从 PATH 找到它们。

```bash
npm install
npm run dev
```

首次启动会显示笔记库选择页。选择一个空文件夹，或带有 `fever.json` 的现有 Fever 笔记库。应用会初始化独立 Git 仓库，并在安装了 Git LFS 时执行 `git lfs install --local`。不允许选择其他 Git 仓库内部的子文件夹，避免混入项目文件。

打开设置，配置 Git 用户名和邮箱；如需远程同步，填写 origin 的 HTTPS / SSH 地址。远程仓库应为空或已经保存这个笔记库。认证使用系统 Git 的 SSH 密钥、凭据管理器；应用不存储访问令牌。

## 存储约定

```text
我的笔记库/
├── .git/
├── .gitattributes
├── fever.json
├── notes/
│   ├── <UUID>.md
│   └── <UUID>.excalidraw
└── images/
    └── <UUID>.png
```

清单示例：

```json
{
  "version": 1,
  "categories": ["收件箱", "项目/Fever"],
  "notes": [{
    "id": "9746b2d9-1029-4caf-8c0d-b1021ed2a16f",
    "title": "一个新想法",
    "category": "项目/Fever",
    "filename": "9746b2d9-1029-4caf-8c0d-b1021ed2a16f.md",
    "createdAt": "2026-10-07T00:00:00.000Z",
    "updatedAt": "2026-10-07T00:00:00.000Z"
  }]
}
```

标题和分类由清单管理。重命名、移动笔记不会改变 UUID 文件名。分类使用 `/` 表示层级，界面递归生成文件夹树。清单和笔记通过临时文件写入后替换；写操作排队，避免快速输入导致保存顺序错乱。

图片可通过拖放或「更多 → 插入图片」导入，保存为 `images/<UUID>.<扩展名>`，Markdown 引用 `../images/<UUID>.<扩展名>`。`.gitattributes` 的 `images/**` 使用 LFS。Git LFS 未安装时禁止导入图片，防止图片作为普通 Git blob 提交。支持 PNG、JPEG、GIF、WebP、AVIF，单张最多 20 MB。

## Excalidraw 绘图

在侧栏「我的笔记」旁点击「新建绘图」，即可使用 Excalidraw 画布绘制形状、箭头、文字和自由线条。绘图以标准 `.excalidraw` JSON 保存到 `notes/`，沿用自动保存、分类、多标签页和 Git 历史。侧栏导入按钮支持 `.excalidraw`、Markdown，以及 Obsidian 的 `.excalidraw.md` 文件；「更多 → 导出 .excalidraw」可导出到其他 Excalidraw 工具。

在 Markdown 编辑器点击「插入 Excalidraw」，选择已有绘图，或新建绘图后插入。阅读和双栏预览会显示绘图，点击「编辑绘图」打开画布。生成的引用使用 UUID 文件名，因此重命名和移动分类后仍然有效：

```markdown
![架构图](../notes/<UUID>.excalidraw)
```

也支持 `![[架构图]]`、`![[架构图.excalidraw]]` 和 `![[旧图.excalidraw.md]]`。名称重复时请使用具体文件名。标记为 `excalidraw` 的代码块可以直接放入标准 Excalidraw JSON 并显示预览；代码块中的绘图需要在 Markdown 源码中修改。

Obsidian 的 `excalidraw-plugin` Markdown 文件支持 `json` 和 `compressed-json` 绘图数据，编辑时保留原来的压缩方式与绘图块之外的内容。画布和预览字体随应用打包，支持离线使用。Markdown 中引用的绘图使用当前工作区版本；查看绘图文件自身的 Git 历史可预览和恢复当时的画面。

## 已实现功能

- 首次选择笔记库，记住上次使用的文件夹，切换笔记库。
- 新建 / 重命名 / 移动 / 删除笔记与 Excalidraw 绘图，嵌套分类，导入 Markdown / Excalidraw 文件。
- CodeMirror Markdown 编辑、阅读、双栏预览；表格、代码块、任务列表；输入后 650 ms 自动保存。
- 多标签页、标题 / 分类 / 正文搜索、标题大纲、字数统计、浅色 / 深色主题。
- Git 分支、工作区变更、提交说明、提交笔记库文件、拉取与推送。
- 本地定时 Git 备份，可设置 1–1440 分钟间隔；自动备份不推送远程。失败会显示提示。
- 单篇笔记最近 80 次提交，历史内容预览，恢复指定版本到当前工作区；再次提交可记录恢复过程。
- Electron 使用隔离的 preload API，渲染器无 Node.js 权限；图片经受限自定义协议读取，Markdown 不执行原始 HTML。

Git 拉取采用 `--ff-only`，有未提交修改时拒绝拉取。首次推送会设置上游分支。分支分叉、冲突需要在系统 Git 工具中处理；当前应用没有内置冲突编辑器、分支切换或远程仓库克隆向导。打开或克隆已有仓库可先用系统 Git 操作，再从应用选择该仓库根目录。

导入 Markdown 保留原文并分配 UUID；导入文件中的相对图片不会自动复制，需重新导入附件。Git 历史预览使用当前工作区的图片附件。

## 迁移现有 Obsidian 笔记库

```bash
node scripts/notebook-migration.mjs /path/to/notebook /path/to/new-vault
```

原笔记库必须已提交全部改动，目标目录必须不存在。迁移会创建独立 Git 仓库，保留全部原始提交和本地 LFS 对象；先提交文件的纯重命名，再提交引用转换，确保只有图片的短笔记也能继续追踪历史。原目录不改动，目标仓库不自动关联原来的远程。

Markdown 和图片分配 UUID，原目录层级转为分类。转换 `![[图片]]` 和 Markdown 图片引用，外链图片下载到本地并使用 LFS。代码块、行内代码及其格式保留；缺失的引用会阻止迁移完成。图片逐张检查 SHA-256 和 Git LFS 指针。其他附件保存在 `attachments/`。

`fever.json` 中的 `sourcePath` 和 `assets` 保留来源和图片名称映射，应用可以读取重命名前的历史版本，并显示历史中原有的 Obsidian 图片语法。完整映射和校验值记录在笔记库的 `.fever-migration.json`。Excalidraw Markdown 原文保留，可直接预览和编辑其 JSON / compressed-json 绘图数据，并保留 Markdown 文件格式。项目内的 `vault/` 已加入 `.gitignore`，个人笔记与应用源码分开管理。

## 快捷键

| 操作 | macOS | Windows / Linux |
| --- | --- | --- |
| 搜索 | ⌘ K | Ctrl K |
| 新建笔记 | ⌘ N | Ctrl N |
| 保存 | ⌘ S | Ctrl S |
| 编辑 / 阅读切换 | ⌘ E | Ctrl E |
| 关闭弹窗 / 搜索 | Esc | Esc |

## 浏览器预览

```bash
npm run dev:web
```

访问 `http://127.0.0.1:5173`。浏览器使用独立的 localStorage 示例笔记与版本数据，不读写真实文件，不执行 Git，也不连接远程。真实文件存储与 Git / LFS 功能仅在 Electron 桌面应用启用。

## 测试和构建

```bash
npm test                 # 临时仓库中的真实文件 / Git / LFS 测试
npx playwright install chromium
npm run test:ui          # 浏览器中的交互流程与布局
npm run test:desktop     # 原生 Electron 集成测试（先启动 dev:web）
npm run test:memory      # 生产版内存压测，使用临时库，不需要 dev:web
npm run build           # TypeScript 检查和前端生产构建
npm run pack            # 生成当前平台应用目录
npm run dist:mac        # macOS DMG / ZIP
npm run dist:win        # Windows NSIS
npm run dist:linux      # Linux AppImage / DEB
```

macOS 本地构建并安装到「应用程序」文件夹：

```bash
./build.sh
```

脚本先停止正在运行的 Fever，构建当前 Node.js 架构对应的 `Fever.app`，覆盖安装到 `/Applications/Fever.app`，然后自动启动。缺少构建依赖时会执行 `npm ci`；应用程序目录需要管理员权限时会提示输入密码。构建失败时保留原应用，临时构建目录会自动清理。

已安装 Chrome 时，也可以通过 `PLAYWRIGHT_CHANNEL=chrome npm run test:ui` 运行界面测试。产物位于 `release/`。建议分别在各自的操作系统构建；`.github/workflows/build.yml` 提供三平台构建任务，可手动运行或通过 `v*` 标签触发，默认仅上传构建产物，不发布 Release。

内存压测默认生成 2,000 篇约 64 KiB 的笔记，测试全文搜索、取消查询、编辑器反复挂载、8 MiB 图片导入和绘图切换。记录各进程 RSS、渲染器 JS 堆和 DOM 节点，并检查回归上限；结果保存到 `test-results/memory.json`。可通过 `FEVER_STRESS_NOTES`、`FEVER_STRESS_NOTE_KIB`、`FEVER_STRESS_CYCLES`、`FEVER_STRESS_DRAWING_CYCLES` 和 `FEVER_MEMORY_REPORT` 调整规模和输出路径。优化前后的记录见 [内存压测报告](docs/performance/README.md)。

原生集成测试使用临时用户数据目录和临时笔记库，验证真实文件保存、IPC、Git 提交、历史预览和 LFS 图片加载，不使用你的实际笔记库。打包后也可以设置 `FEVER_EXECUTABLE` 为应用可执行文件路径，运行同一测试来验证生产应用。

目前是可运行的首版。正式分发前还需要提供应用图标、macOS 签名 / 公证、Windows 签名，并在各目标平台验证。没有配置自动升级和产品遥测。

框架文档：[Electron](https://www.electronjs.org/docs/latest/)、[electron-builder](https://www.electron.build/)、[Git LFS](https://git-lfs.com/)。
