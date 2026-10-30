# 球球了 Android 安装包

网页游戏保持 v1.4.0，Android 包名为 `com.qiuqiule.game`，版本 1.4.0（14001）。
APK 包含字体、Phaser、音乐及全部游戏资源，首次打开即可离线运行；不加载 GitHub Pages 网站。
横竖屏自动适配，采用原游戏图标和全屏显示，系统返回键在游戏中用于暂停/关闭面板。

## 构建

需要 Node.js 22、JDK 21、Android SDK 35 和 Build Tools 35.0.0。

```sh
npm ci
npm run check
npm test
npx cap add android
node scripts/prepare-android.mjs
cd android
./gradlew :app:assembleRelease :app:lintRelease
```

已存在 android 工程时，先 `npx cap sync android`，再执行准备脚本。
脚本仅修改生成的 Android 文件，不改变 dist 下的网页游戏。
原生包使用内置资源，禁用原生副本的网页 Service Worker，以免应用升级后读到旧网页缓存。

`.github/workflows/android-apk.yml` 在 Android 打包分支推送时执行构建和断网模拟器测试。
构建产物包含对齐后的未签名 release APK 和官方 apksigner.jar，安装前须用自己的发行密钥签名。

## 签名与更新

发行签名在本地完成，密钥及密码不进入 GitHub 仓库或构建日志。
请妥善保留单独交付的签名备份，以后的更新使用同一密钥，并增加 versionCode。
不要将签名备份发给朋友；朋友只需要最终的 `.apk`。
未上架应用商店，接收方需允许其浏览器或文件管理器安装该 APK。
