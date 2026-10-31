# 球球了 · v2.2.0 完整工程（GitHub 版）

Phaser 极简弹弓碰撞游戏，支持手机横竖屏、PWA、离线缓存，以及 Capacitor 原生封装。

本次更新至 2.2.0，并保留 GitHub 版的后台离线缓存修复。本次仅更新网页工程，不更新已有 Android APK。此包是完整的可部署工程，网页运行不需要 npm 安装或构建。所有运行资源已在 `dist/`，无 CDN、外部字体或音乐服务依赖。

## 2.2.0 更新

- 圆形按钮取消浏览器原生外观；点击、触摸和菜单自动聚焦不显示额外外圈，仅键盘导航保留焦点提示。
- 设置框按实际内容高度收紧，玩法介绍保持同样尺寸；增加 120ms、100% 不透明的空白过渡层，仅保留小球、X 和横线，消除切换时整框淡入造成的闪动。
- 主页与局内拉伸时，眼睛变成圆润的 `> <`；两个六顶点轮廓均逐角圆滑，位置与尺寸接近常态眼睛。
- 第 6、11、16…阶段各增加初始拖拽速度阈值的 50%，阈值依次为 8、12、16、20…倍基础半径/秒。松手速度叠加按下瞬间的速度大小，方向沿新的瞄准方向；高速物理使用细分步长防止穿透。
- 移除设置等菜单的全屏灰膜和背景模糊，根背景、主题色和明暗模式同步，页面固定以减少 iOS 安装版顶部异常。系统状态栏仍需 iPhone 真机验收，当前未进行真机验证。
- 保留之前的数值回退、两秒半速刷新、达标清场及结算动画。现有离线缓存和 Pages 工作流保持兼容；不更新 APK。

## 最快部署到 GitHub Pages

1. 解压，把本目录内的文件和目录上传到你的 GitHub 仓库根目录，包括 `.github/workflows/pages.yml`。仓库根目录应直接看到 `dist/`、`package.json` 和 `README.md`，不要再套一层 `qiuqiule/`。
2. 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 在 **Actions → Deploy 球球了 → Run workflow** 运行一次；以后推送到 `main` 或 `master` 会自动发布。成功后的网址在 Pages 设置页面及工作流部署结果中。

更详细的步骤及不使用 Actions 的方法见 [GITHUB_PAGES.md](GITHUB_PAGES.md)。

## 包内内容

| 路径 | 内容 |
| --- | --- |
| `dist/` | 完整可运行网页、源代码、PWA 清单与 Service Worker |
| `dist/vendor/` | Phaser 3.90.0 完整引擎及 MIT 许可证 |
| `dist/fonts/` | Fredoka Medium WOFF2 字体、SIL OFL 许可证与来源说明 |
| `dist/audio/` | 原创 87.27 秒循环 BGM《轻轻弹》MP3 |
| `dist/icons/`、`dist/icon.svg` | App/PWA 图标 |
| `scripts/` | 引擎同步脚本、BGM 乐谱与合成脚本 |
| `tests/` | 64 项音频、显示、首页、物理与离线回归测试 |
| `.github/workflows/pages.yml` | GitHub Pages 自动部署配置 |
| `capacitor.config.json` | Android/iOS 封装配置 |
| `DEVELOPMENT.md` | 游戏设计、规则和工程说明 |
| `SHA256SUMS.txt` | 文件完整性清单 |

字体说明：分数字体 Fredoka 已完整随包；中文界面沿用设备系统字体，首页艺术字和图标由 SVG/代码绘制，无需下载字体。Node 依赖与原生 SDK 不属于网页运行资源；不包含 `node_modules`、签名 APK/IPA 或原托管平台的身份配置。

## 本地运行

在工程目录执行：

```sh
python3 -m http.server 8080 --directory dist
```

浏览器打开 `http://localhost:8080/`。不要直接双击 `index.html` 使用 `file://`，ES 模块与 PWA 需要 HTTP/HTTPS 环境。

开发检查需要 Node.js 20 或更高版本；这些检查不需要先安装依赖：

```sh
npm run check
npm test
```

## 离线使用

1. 部署后，通过 GitHub Pages 的 HTTPS 地址打开游戏。
2. 若添加到手机主屏幕，先保持联网，从**主屏幕游戏图标**打开一次。
3. 首次打开需让资源下载完成。首次联网进入主页后建议停留约 30 秒（网速较慢时需更久），再关闭重开游戏。
4. 随后开启飞行模式，从主屏幕图标重新打开，验证离线冷启动。离线准备全程在后台执行，不新增界面提示；音乐未下载完成时，核心游戏仍可离线游玩。

缓存以设备和网站地址为单位。换域名、换浏览器或新建主屏幕应用后需要重新准备；不要把浏览器已打开过等同于主屏幕应用已缓存。浏览器/系统清理网站数据后也需联网重新准备。首次音乐播放需要触摸或键盘操作。

本版本通过 64 项自动化回归检查，覆盖玩法、结算动画计算及 GitHub 离线缓存修复。浏览器已验证横竖屏、320px 窄屏和桌面菜单转场、圆角表情及真实拖拽速度叠加；尚未进行 iPhone 安装版顶部效果与真机长期试玩验证。
