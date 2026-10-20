# Fever 官网

Fever 的中文软件介绍页，使用 [Hugo Fresh](https://github.com/StefMa/hugo-fresh)（MIT 许可），通过 Hugo Modules 固定主题版本。保留 Fresh 的首页结构、Bulma 布局、功能区和图标，在 `layouts/partials/` 中覆盖品牌、首屏、下载区和导航，并使用本地脚本替代主题的 CDN 脚本。字体使用系统字体，不加载 Google Fonts。

## 本地预览

需要 **Hugo Extended 0.168.0** 和 **Go 1.27.1 或更新版本**。主题的 Sass 需要 Extended 版；CI 固定相同的 Hugo 版本。

在仓库根目录运行：

```bash
hugo server --source website
```

打开终端输出的地址（通常是 `http://localhost:1313/Fever/`）。首次构建会下载固定版本的主题及 Bulma，无需安装桌面应用的 npm 依赖。

生产构建：

```bash
hugo --source website --gc --minify
```

生成目录为 `website/public/`，已忽略，无需提交生成的 HTML。

## 编辑内容

- `hugo.yaml`：标题、产品介绍、功能列表、导航、平台信息和 Release 链接。
- `assets/css/fever.css`：品牌颜色、页面样式和移动端布局。
- `layouts/partials/section3.html`：下载区和首次使用指南。
- `static/images/`：复用的 Fever 图标，以及从应用浏览器演示版截取的示例界面图 `fever-app.png`；截图只包含应用自带的示例笔记。
- `go.mod` / `go.sum`：主题版本和校验信息。`hugo mod graph --source website` 可查看依赖。

不直接修改下载的主题。通过本目录同名模板和资源覆盖，便于以后升级。Fresh 仍使用 LibSass，当前固定版本构建会出现 LibSass 弃用提示，但可正常构建；升级 Hugo 前需要确认主题兼容性。

## GitHub Pages 发布

工作流位于 [`../.github/workflows/website.yml`](../.github/workflows/website.yml)，与桌面应用的 Release 工作流独立。

首次启用：

1. 将官网与工作流文件提交并推送到 `main`。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 在 **Actions → Build and deploy website → Run workflow** 中选择 `main` 并运行。
4. 等待构建与部署完成，默认网站地址为 **https://iuxt.github.io/Fever/**。

后续推送 `main`，如果修改 `website/**` 或官网工作流，就会自动构建和部署。Pull Request 只验证构建，不部署；也支持手动运行。部署只允许 `main`。使用内置 `GITHUB_TOKEN`，无需额外 PAT、发布分支或仓库密钥。

构建仅将 `website/public/` 上传到 Pages，不发布桌面应用源代码。实际发布地址从 `actions/configure-pages` 获取，资源 URL 由 Hugo 生成，支持项目子路径与配置好的自定义域名。

### 当前仓库的访问条件

配置时 `iuxt/Fever` 是私有仓库，尚未开启 Pages。根据 [GitHub 文档](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)，私有仓库使用 Pages 需要 GitHub Pro、Team 或 Enterprise。若账号套餐不支持，需要先调整套餐，或由仓库所有者决定是否公开仓库。

**公开的 Pages 网站不会自动公开私有仓库的 Releases。** 官网的 GitHub、反馈、迁移指南和下载链接都指向当前仓库；在仓库保持私有时，这些链接仅对有仓库权限的人可用。面向公众发布下载时，应使用公开的 Release 仓库或其他公开下载地址，并更新 `hugo.yaml` 和相关模板链接。

官方参考：[Hugo 部署到 GitHub Pages](https://gohugo.io/host-and-deploy/deploy-to-github-pages/)。
