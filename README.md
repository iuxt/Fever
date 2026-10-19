# Fever

一个本地优先的跨平台 Markdown 笔记应用。Electron + React + TypeScript，参考 Obsidian 的侧栏、分类树、多标签编辑区和右侧面板，提供浅色 / 深色 / 跟随系统主题。

## 开始使用

开发环境需要 Node.js 24、Git 和 Git LFS。桌面应用运行时仍需要系统安装 Git / Git LFS，并能从 PATH 找到它们。

```bash
npm install
npm run dev
```

首次启动会显示笔记库选择页。选择一个空文件夹，或带有 `fever.json` 的 Fever 笔记库根目录。应用会初始化独立 Git 仓库，并在安装了 Git LFS 时执行 `git lfs install --local`。不允许选择其他 Git 仓库内部的子文件夹，避免混入项目文件。

打开设置，配置 Git 用户名和邮箱；如需远程同步，填写 origin 的 HTTPS / SSH 地址。远程仓库应为空或已经保存这个笔记库。认证使用系统 Git 的 SSH 密钥、凭据管理器；应用不存储访问令牌。

## 编辑体验

默认采用三栏布局：左侧浏览文件夹，中间显示所选文件夹及其子文件夹中的笔记，右侧编辑正文。笔记列表提供两行正文摘要、更新时间和所属分类；顶部支持按更新时间、创建时间或标题排序，可切换升序与降序，并记住排序偏好，默认最近更新在前。点击文件夹名称切换列表，点击旁边的箭头展开或折叠子文件夹。「全部笔记」和搜索可浏览整个笔记库，新建笔记默认放入当前选中的文件夹。大纲、历史和 Git 面板通过编辑区右上角的按钮按需打开。

默认采用类似 Typora 的所见即所得体验：直接在排版后的正文中修改标题、列表、任务、表格和代码，图片与 Excalidraw 引用在正文中显示。输入 `# `、`- `、`> ` 等 Markdown 标记会自动转换格式；支持加粗、斜体、撤销 / 重做和 Markdown 粘贴。选中表格单元格后，可在格式栏添加或删除行列。图片可以通过按钮、拖放或粘贴插入。

右上角的代码按钮打开 Markdown 源码与预览，笔形按钮返回所见即所得；⌘ / Ctrl E 可在两者之间切换。编辑结果仍自动保存为 `.md` 文件，沿用 Git 历史；仅进入编辑模式不会改写原文件，YAML 文档属性和 Obsidian 图片引用会保留。

支持 Mermaid 图表：使用 `mermaid` 语言的代码块，或在代码块语言列表中选择 `mermaid`，即可离线渲染流程图、时序图等。所见即所得模式下点击「编辑源码」修改内容，再点击「查看图表」查看结果；源码与预览模式会随编辑更新图表。图表适配深浅主题，语法错误会显示提示并保留源码。

````markdown
```mermaid
flowchart LR
    A[开始] --> B[编辑笔记]
    B --> C[完成]
```
````

文章内查找参考 [VS Code](https://code.visualstudio.com/docs/editing/codebasics#_find-and-replace)：按 `⌘ F`（Windows / Linux：`Ctrl F`）打开右上角面板，选中的单行文字会自动填入。支持大小写、全词、正则、选区内查找和循环跳转；展开替换可逐项或全部替换，正则替换支持 `$1`、`$2`、`$<name>`、`$&` 和 `$$`。富文本查找覆盖可编辑正文（含代码块、表格），源码查找覆盖完整文件（含 YAML、链接和图片语法）；富文本替换保留周围格式和嵌入内容，全部替换可一次撤销。`Enter` / `Shift Enter` 跳转，`Esc` 关闭并回到编辑器。

笔记之间的 Markdown 链接（如 `[相关笔记](UUID.md)` 或 `[相关笔记](../notes/UUID.md)`）会在应用内打开目标笔记。预览中直接点击，所见即所得编辑器中按住 ⌘ / Ctrl 点击；普通点击仍可编辑链接文字。

桌面版右上角「更多笔记操作」（三个点）菜单中的「外部图片转为本地文件」会批量下载当前笔记的 HTTP / HTTPS 外链图片，保存到 `images/` 并替换为本地引用。支持 PNG/JPEG/GIF/WebP/AVIF，每张最大 20 MB，需要 Git LFS。重复链接只下载一次；下载失败的图片保留原链接，普通网站链接和代码中的示例不会转换。编辑模式和源码模式均可通过此菜单使用。

在右上角「更多笔记操作 → 导出…」中，统一选择文件名、格式和排版参数。PDF 可选 A4 / A3 / A5 / Letter 纸张、横纵方向、页边距和字号，使用独立的浅色排版，保留表格、代码、任务列表、图片和嵌入绘图；HTML 可选内容宽度和字号，并将图片与绘图内嵌到单个文件，便于离线阅读；Markdown 保留当前完整源码（附件仍使用原相对路径，不会一起复制）。绘图笔记可在同一弹窗中选择 PDF、HTML 或可继续编辑的 `.excalidraw` 格式。桌面版设置完成后弹出保存对话框。导出包含最新编辑内容；图片读取失败时会提示重试。浏览器演示版直接下载文件，PDF 通过浏览器打印窗口选择「另存为 PDF」。

在「设置 → 外观」中选择亮色、暗色或跟随系统；跟随系统会随系统外观变化自动切换。字体大小支持 12–24 px（默认 16 px），同时调整正文、源码、历史预览与界面文字。外观调整立即生效，并保存在当前设备上。

## 常用快捷键

快捷键参考 [MarkText](https://marktext.me/docs/key-bindings-macos) 等 Markdown 编辑器的惯例，代码块采用 `⌘ ⇧ L`。Windows / Linux 将 `⌘` 替换为 `Ctrl`；格式操作同时支持正文和 Markdown 源码编辑，设置中也可查看快捷键列表。

| 操作 | macOS 快捷键 |
| --- | --- |
| 加粗 / 斜体 | `⌘ B` / `⌘ I` |
| 删除线 | `⌘ ⇧ X` |
| 行内代码 | `⌘` + 反引号 |
| 代码块 | `⌘ ⇧ L` |
| 引用 | `⌘ ⇧ B` |
| 无序 / 有序 / 任务列表 | `⌘ ⇧ 8` / `⌘ ⇧ 7` / `⌘ ⇧ 9` |
| 1–6 级标题 / 正文段落 | `⌘ 1`–`⌘ 6` / `⌘ 0` |
| 打开设置 | `⌘ ,` |
| 文章内查找 / 替换 | `⌘ F` / `⌥ ⌘ F`（Windows / Linux：`Ctrl F` / `Ctrl H`） |
| 搜索 / 新建 / 保存笔记 | `⌘ K` / `⌘ N` / `⌘ S` |
| 切换源码与正文 / 关闭标签页 | `⌘ E` / `⌘ W` |
| 撤销 / 重做 | `⌘ Z` / `⌘ ⇧ Z` |

选中文字后可应用或取消格式；源码中未选中文字时，行内格式会插入成对标记并将光标放在中间，标题、列表和引用作用于当前行或所选行。代码块会保留选中的源码，重复按下可移除围栏。格式快捷键仅在编辑器中生效，设置等表单输入不受影响。

## 存储约定

```text
我的笔记库/
├── .git/
├── .gitattributes
├── fever.json
├── notes/
│   └── <UUID>.md
├── drawings/
│   └── <UUID>.excalidraw
└── images/
    └── <文章UUID>/
        └── 2026-10-15-143025-123.png
```

清单示例：

```json
{
  "version": 2,
  "folders": [
    { "id": "d1c5cc4f-154e-42a9-915c-e3cbd6952635", "name": "项目", "parentId": null },
    { "id": "7cf97a91-4699-4825-8f77-c398f8826278", "name": "Fever", "parentId": "d1c5cc4f-154e-42a9-915c-e3cbd6952635" }
  ],
  "notes": [{
    "id": "9746b2d9-1029-4caf-8c0d-b1021ed2a16f",
    "title": "一个新想法",
    "folderId": "7cf97a91-4699-4825-8f77-c398f8826278",
    "filename": "9746b2d9-1029-4caf-8c0d-b1021ed2a16f.md",
    "createdAt": "2026-10-07T00:00:00.000Z",
    "updatedAt": "2026-10-07T00:00:00.000Z"
  }]
}
```

标题和分类由清单管理。重命名、移动笔记不会改变 UUID 文件名。文件夹用稳定 UUID 标识，`parentId` 保存层级，笔记通过 `folderId` 引用文件夹（`null` 为根目录）。完整路径只在运行时计算；文件夹重命名只修改 `name`，移动只修改 `parentId`，子文件夹和笔记记录保持不变。首次打开 v1 清单会自动迁移，保留隐式父文件夹、空文件夹和笔记文件；旧 Git 清单仍可读取、撤销或编辑，后续保存使用 v2。回收站使用 `originalCategory` 保留删除时的位置。清单和笔记通过临时文件写入后替换；写操作排队，避免快速输入导致保存顺序错乱。

图片可通过拖放、粘贴或「更多 → 插入图片」导入，外部图片转存也使用同一规则：保存为 `images/<文章UUID>/<日期>.<原始扩展名>`，Markdown 引用 `../images/<文章UUID>/<日期>.<原始扩展名>`。日期采用本地时间 `YYYY-MM-DD-HHmmss-SSS`，重名时追加序号，保留原始图片字节和格式。`.gitattributes` 的 `images/**` 使用 LFS。Git LFS 未安装时禁止导入图片，防止图片作为普通 Git blob 提交。支持 PNG、JPEG、GIF、WebP、AVIF，单张最多 20 MB。已有图片路径仍可正常读取。

## Excalidraw 绘图

在侧栏「我的笔记」旁点击「新建绘图」，即可使用 Excalidraw 画布绘制形状、箭头、文字和自由线条。绘图以标准 `.excalidraw` JSON 保存到与 `notes/` 平级的 `drawings/`，沿用自动保存、分类、多标签页和 Git 历史。侧栏导入按钮支持 `.excalidraw`、Markdown，以及 Obsidian 的 `.excalidraw.md` 文件；「更多 → 导出 .excalidraw」可导出到其他 Excalidraw 工具。

新建和导入的绘图在清单中记录 `"directory": "drawings"`，导入的 Obsidian 绘图保留 Markdown 原文。已有清单没有 `directory` 的记录仍从 `notes/` 读取，原引用、自动保存、Git 历史和回收站继续可用。

侧栏新建绘图和正文中新建并插入绘图时，默认分类固定为 `Excalidraw`，创建时可修改。在分类右键菜单中新建时使用所选分类。

在 Markdown 编辑器点击「插入 Excalidraw」，选择已有绘图，或新建绘图后插入。阅读和双栏预览会显示绘图，点击「编辑绘图」打开画布。生成的引用使用 UUID 文件名，因此重命名和移动分类后仍然有效：

```markdown
![架构图](../drawings/<UUID>.excalidraw)
```

也支持 `![[架构图]]`、`![[架构图.excalidraw]]` 和 `![[旧图.excalidraw.md]]`。名称重复时请使用具体文件名。标记为 `excalidraw` 的代码块可以直接放入标准 Excalidraw JSON 并显示预览；代码块中的绘图需要在 Markdown 源码中修改。

Obsidian 的 `excalidraw-plugin` Markdown 文件支持 `json` 和 `compressed-json` 绘图数据，编辑时保留原来的压缩方式与绘图块之外的内容。画布和预览字体随应用打包，支持离线使用。Markdown 中引用的绘图使用当前工作区版本；查看绘图文件自身的 Git 历史可预览和恢复当时的画面。

## 已实现功能

- 首次选择笔记库，记住上次使用的文件夹，切换笔记库。
- 新建 / 重命名 / 移动笔记与 Excalidraw 绘图，嵌套分类，导入 Markdown / Excalidraw 文件。
- 文件夹右键菜单支持删除空文件夹或整个分类层级；其中的笔记移入回收站，恢复笔记时重建原分类。
- 回收站：删除笔记只移动清单记录，正文和附件保留。侧栏回收站支持只读查看正文、图片、绘图和版本历史，按标题、原分类和正文搜索，每页展示 20 篇；只提供还原，不支持再次删除。还原回到原分类，笔记 ID、文件名和历史保持不变；关闭或重启应用后仍可恢复。
- CodeMirror Markdown 编辑、阅读、双栏预览；表格、代码块、任务列表；输入后 650 ms 自动保存。
- 多标签页、标题 / 分类 / 正文搜索、标题大纲、字数统计、浅色 / 深色主题。
- Git 分支、工作区变更、提交说明、提交笔记库文件、拉取与推送。
- 本地定时 Git 备份，可设置 1–1440 分钟间隔；自动备份不推送远程。失败会显示提示。
- 设置中可开启定时自动拉取，默认关闭，默认间隔 10 分钟，可设置 1–1440 分钟；保存后在应用打开期间生效，并记住配置。有本地未提交修改、草稿或正在进行的操作时跳过本轮；远程更新后刷新笔记，失败会显示提示。
- 单篇笔记最近 80 次提交，历史内容预览，恢复指定版本到当前工作区；再次提交可记录恢复过程。
- Electron 使用隔离的 preload API，渲染器无 Node.js 权限；图片经受限自定义协议读取，Markdown 不执行原始 HTML。

Git 拉取采用 `--ff-only`，有未提交修改时拒绝拉取。首次推送会设置上游分支。分支分叉、冲突需要在系统 Git 工具中处理；当前应用没有内置冲突编辑器、分支切换或远程仓库克隆向导。打开或克隆已有仓库可先用系统 Git 操作，再从应用选择该仓库根目录。

导入 Markdown 保留原文并分配 UUID；导入文件中的相对图片不会自动复制，需重新导入附件。Git 历史预览从所选提交读取当时的图片附件。

## 迁移现有 Obsidian 笔记库

```bash
node scripts/notebook-migration.mjs /path/to/notebook /path/to/new-vault
```

原笔记库必须已提交全部改动，目标目录必须不存在。迁移会创建独立 Git 仓库，保留全部原始提交和本地 LFS 对象；通过正文不变的重命名提交保留笔记沿革，确保只有图片的短笔记也能继续追踪历史。原目录不改动，目标仓库不自动关联原来的远程。

Markdown 和图片分配 UUID，原目录层级转为分类。转换 `![[图片]]` 和 Markdown 图片引用，外链图片下载到本地并使用 LFS。代码块、行内代码及其格式保留；缺失的引用会阻止迁移完成。图片逐张检查 SHA-256 和 Git LFS 指针。其他附件保存在 `attachments/`。

`fever.json` 中的 `sourcePath` 保留笔记来源。历史预览根据提交 ID、当时的笔记路径和图片引用，从对应 Git 提交读取图片，支持历史 Obsidian 图片语法。Git LFS 图片按指针的对象 ID 读取，本地缺失时通过 Git LFS 从远程下载并校验，不依赖当前工作目录或图片名称映射。历史正文中的 HTTP(S) 图片仍使用原网址，Git 无法还原未提交到仓库的远程图片内容。恢复历史版本时，会将对应版本的图片保存到当前图片目录并更新正文引用，避免覆盖当前图片。旧版笔记库中的 `assets` 字段在打开时自动移除。迁移报告与校验值记录在笔记库的 `.fever-migration.json`，仅用于审计，不参与渲染。

迁移时先在原笔记位置规范化图片引用，再以正文不变的方式移动笔记，最后写入相对路径。这样既能让 Git 跟踪改名前的笔记，也能让新迁移过程中的每个提交独立显示图片。Excalidraw Markdown 原文保留，可直接预览和编辑其 JSON / compressed-json 绘图数据，并保留 Markdown 文件格式。项目内的 `vault/` 已加入 `.gitignore`，个人笔记与应用源码分开管理。

## 快捷键

| 操作 | macOS | Windows / Linux |
| --- | --- | --- |
| 搜索笔记库 | ⌘ K | Ctrl K |
| 文章内查找 | ⌘ F | Ctrl F |
| 文章内替换 | ⌥ ⌘ F | Ctrl H |
| 下一个 / 上一个匹配项 | Enter / ⇧ Enter | Enter / Shift Enter |
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
npm run test:desktop:export # 原生导出集成测试（先启动 dev:web）
npm run test:desktop     # 原生 Electron 集成测试（先启动 dev:web）
npm run test:desktop:history-images # 历史图片 / LFS 桌面回归，使用临时库，不需要 dev:web
npm run test:memory      # 生产版内存压测，使用临时库，不需要 dev:web
npm run test:resources   # 生产版读写量、Git 列表、历史 Worker 与后台轮询回归
npm run build           # TypeScript 检查和前端生产构建
npm run pack            # 生成当前平台应用目录
npm run dist:mac        # macOS DMG
npm run dist:win        # Windows NSIS
npm run dist:linux      # Linux AppImage / DEB
```

macOS 本地构建并安装到「应用程序」文件夹：

```bash
./build.sh
```

脚本先停止正在运行的 Fever，在系统临时目录构建当前 Node.js 架构对应的 `Fever.app`，覆盖安装到 `/Applications/Fever.app`，然后自动启动。缺少构建依赖时会执行 `npm ci`，打包前会显式准备 Electron 运行时（Electron 44 起，`npm ci` 不会自动下载二进制）；首次下载需要联网，之后复用本地运行时。应用程序目录需要管理员权限时会提示输入密码。构建失败时保留原应用，临时构建目录会自动清理，项目目录不留构建出的 `.app`。

已安装 Chrome 时，也可以通过 `PLAYWRIGHT_CHANNEL=chrome npm run test:ui` 运行界面测试。安装包位于 `release/`，`dist:mac` 成功生成所有 DMG 后会自动删除中间产物 `Fever.app`。`npm run pack` 专门用于生成应用目录，会保留 `.app` 供调试。建议分别在各自的操作系统构建。

### 自动发布 GitHub Release

`.github/workflows/build.yml` 在推送版本标签时自动测试、构建并发布 GitHub Release：

```bash
git tag 1
git push origin 1
```

请先提交并推送包含工作流的代码，再推送标签。标签从 `1` 开始，后续依次使用 `2`、`3` 等正整数，不带 `v` 前缀、前导零或预发布后缀。所有版本均发布为正式 Release。为兼容 npm 和打包工具，标签 `1` 对应安装包版本 `1.0.0`，标签 `2` 对应 `2.0.0`，以此类推；不需要提前修改 `package.json`。不符合正整数格式的标签会构建失败。

| 平台 | 架构 | Release 附件 |
| --- | --- | --- |
| Windows | x64 | NSIS 安装程序 `.exe` |
| macOS | Apple Silicon arm64、Intel x64 | 各自的 `.dmg` |
| Linux | x64 | `.AppImage` 和 `.deb` |

工作流先创建草稿 Release 并自动生成发布说明，各平台打包完成后直接将安装包上传到该 Release，不使用 Actions Artifacts。全部平台构建和上传成功后，最终任务从 Release 下载安装包生成并上传 `SHA256SUMS.txt`，再公开 Release。使用仓库自带的 `GITHUB_TOKEN`，上传和发布任务已声明 `contents: write`，无需配置个人访问令牌。构建或上传失败时，新 Release 保持草稿，可重新运行失败任务继续上传。

也可以在 Actions 页面手动运行工作流：选择分支时仅测试和构建，不上传安装包；选择版本标签时会发布对应 Release。当前安装包未配置 macOS 签名 / 公证或 Windows 签名。

内存压测默认生成 2,000 篇约 64 KiB 的笔记，测试全文搜索、取消查询、编辑器反复挂载、8 MiB 图片导入和绘图切换。记录各进程 RSS、渲染器 JS 堆和 DOM 节点，并检查回归上限；结果保存到 `test-results/memory.json`。可通过 `FEVER_STRESS_NOTES`、`FEVER_STRESS_NOTE_KIB`、`FEVER_STRESS_CYCLES`、`FEVER_STRESS_DRAWING_CYCLES` 和 `FEVER_MEMORY_REPORT` 调整规模和输出路径。优化前后的记录见 [内存压测报告](docs/performance/README.md)。

正文读取和导入限制为 10 MB，搜索跳过超限正文，标题和分类仍可匹配。当前查询的搜索缓存只保存匹配结果，保存后重读变化的文件，并检查外部文件的属性变化。Git 变更列表按可见区域渲染；历史和文件差异每页最多 200 行，历史差异过大时可分页查看两个版本的内容。未指定语言、不支持的语言及超过 32 KiB 的代码块按纯文本展示。

Git 状态查询会合并并发请求；前台约每 15 秒刷新，页面在后台时约每 60 秒刷新，保存和 Git 操作仍立即刷新。历史列表只在面板可见、选择的笔记或 HEAD 变化时刷新。批量导图先检查全部文件，中途写入失败会清理本批新图片；已插入未保存草稿的图片会保留，便于重试保存。

原生集成测试使用临时用户数据目录和临时笔记库，验证真实文件保存、IPC、Git 提交、历史预览和 LFS 图片加载，不使用你的实际笔记库。打包后也可以设置 `FEVER_EXECUTABLE` 为应用可执行文件路径，运行同一测试来验证生产应用。

目前是可运行的首版。应用图标位于 `assets/icons/`，已配置 macOS ICNS、Windows ICO 和 Linux 多尺寸 PNG，以及桌面窗口和 macOS Dock 图标。正式分发前还需要 macOS 签名 / 公证、Windows 签名，并在各目标平台验证。没有配置自动升级和产品遥测。

框架文档：[Electron](https://www.electronjs.org/docs/latest/)、[electron-builder](https://www.electron.build/)、[Git LFS](https://git-lfs.com/)。
