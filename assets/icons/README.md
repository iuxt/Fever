# Fever 应用图标

暖橙色皮革笔记本，封面压印火焰，配合缝线、纸页和书签呈现拟物质感。外部背景透明。

- `fever-source.png`：1254 × 1254 原始生成图，保留透明通道。
- `fever.png`：1024 × 1024 透明 PNG 主图，也可用于 Linux。
- `fever.icns`：macOS 图标，包含标准尺寸及 Retina 尺寸。
- `fever.ico`：Windows 图标，包含 16、24、32、48、64、128、256 px。
- `png/`：16、24、32、48、64、128、256、512、1024 px 透明 PNG，可用于 Linux 图标目录及其他用途。

使用内置 image_gen 生成；通过 macOS sips / iconutil 和 ICO 容器编码导出平台格式，保留原图。生成提示词见 `prompt.txt`。

`package.json` 已配置 macOS 使用 `fever.icns`、Windows 使用 `fever.ico`、Linux 使用 `png/` 多尺寸图标。`fever.png` 与 `fever.ico` 同时复制到应用资源目录的 `icons/`，供桌面窗口及 macOS Dock 使用；开发模式直接读取本目录。
