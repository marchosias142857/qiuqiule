# GitHub Pages 部署说明

## 方法一：完整工程 + 自动部署

1. 新建或使用你的 GitHub 仓库，将解压后 `qiuqiule` 文件夹里的**内容**放到仓库根目录。推荐用 GitHub Desktop 上传，确保包含 `.github/workflows/pages.yml`。
2. 打开仓库 **Settings → Pages**，把 **Source** 设为 **GitHub Actions**。
3. 打开 **Actions**，选择 **Deploy 球球了**，点击 **Run workflow**。若此前第一次自动运行因 Pages 尚未启用而失败，启用 Pages 后重新运行即可。
4. 工作流会安装锁定依赖、检查代码、运行测试，将 `dist/` 构建为压缩后的 `build/`，验证资源后上传部署，不需要填写密钥、不需要改仓库名相关路径。
5. 在 **Settings → Pages** 打开发布的网址。资源使用相对路径，普通仓库的 `/<仓库名>/` 路径和用户主页根路径均支持。

后续推送 `main` 或 `master` 会自动更新；使用其他分支时，修改工作流的 `branches`，或手动运行工作流。

注意：GitHub 不会自动解压你上传的 ZIP。应先解压后上传工程内容。

## 方法二：只上传网页，不使用 Actions

如果只想通过 GitHub 网页上传：

1. 在本包目录执行 `npm ci`、`npm run build` 和 `npm run verify:build`，再将 `build/` **内部全部文件和文件夹**上传到仓库根目录；仓库根目录应直接有 `index.html`、`game.js`、`fonts/`、`audio/`、`vendor/` 等。
2. 在 **Settings → Pages** 选择 **Deploy from a branch**，选择你的主分支及 **/(root)**，保存。
3. 这种方式不需要上传本包根目录的 `package.json`、`tests/`、`scripts/` 或 `.github/`；请在本地保留完整工程以便以后修改。

两种方式选一种即可。

## 更新与离线确认

- 修改网页资源后，同步递增 `dist/sw.js` 中 `CACHE` 所用的版本号，避免旧缓存继续显示旧文件。
- 更新后，保持联网打开游戏，让新资源完成下载，再关闭重开。
- 添加主屏幕后，务必从主屏幕图标联网打开一次。首次加载建议停留约 30 秒（慢网需更久），再断网从图标重开；缓存静默运行，设置里没有新增状态显示。
- 不要删除字体许可文件：`fonts/OFL-Fredoka.txt`；引擎许可为 `vendor/PHASER-LICENSE.md`。
- 手机首次加载 BGM 需一次触摸，红色喇叭球控制总静音，音量在设置中独立调整。

官方部署说明：
https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

本仓库已配置 GitHub Actions 部署；更新 main 后由既有 Pages 工作流发布。
