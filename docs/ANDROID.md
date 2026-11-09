# Android APK 构建与签名

v11.5.1 使用新的 v5 发布证书，与 v11.4.6 及此前版本的发布签名不同，需先卸载旧版再安装；卸载会清除设备上的应用本地进度。后续版本沿用 v5 证书，可在 v11.5.1 基础上覆盖升级。当前 `dist/` 内置 `audio/endless.mp3` 与 `audio/boss.mp3` 两首 BGM，游戏使用无尽模式，已移除关卡模式。

安卓应用使用 Capacitor 7.4.3 封装仓库中的 `dist/`，应用 ID 为 `com.qiuqiule.game`。游戏、字体、音乐、图标和引擎都随 APK 内置，不依赖 Site 或远程网页地址。保留横屏与竖屏，不锁定屏幕方向。

v5 发布证书的 SHA-256 公钥指纹：`10b05b66eba998b97439a32316b21f44e6d98ca5fdde0c30b60667d87ae2a2b4`。私钥与密码仅在仓库外单独保存。

## GitHub Actions 构建

工作流 `.github/workflows/android.yml` 在 `main` 的游戏资源、依赖、测试或安卓构建脚本变化时运行，也可在 Actions 中手动执行 **Build Android APK**。

只发布网页和源码时，可在推送的最新提交说明中加入 `[skip apk]`。该标记仅跳过本次推送的 Android 构建，手动构建仍可使用。

构建使用 Node 22、JDK 21、Android SDK 35 和 Build Tools 35.0.0，依次完成锁定依赖安装、源码检查、游戏测试、原生工程生成、release 编译和 APK 对齐。

`scripts/prepare-android.mjs` 从 `package.json` 读取版本，写入原生工程：

- `versionName`：例如 `11.5.1`。
- `versionCode`：`major × 10000 + minor × 100 + patch`，因此 `11.5.1` 为 `110501`；minor 与 patch 必须小于 100。
- 启动图标复用 `dist/icons/icon-512.png`，替换 Capacitor 默认图案。

原生 `android/` 工程由脚本生成，并继续作为忽略的构建目录。重复执行准备脚本会同步最新游戏资源与版本信息。

从 v7.11.3 源码构建时，准备脚本会从旧原生工程清理 `android.permission.VIBRATE`，构建流程还会检查最终 APK 的权限清单。v7.11.2 开始使用独立发布证书。使用更早签名的玩家需先卸载旧版，卸载会删除应用内的本地进度。

工作流上传名为 **`qiuqiule-v11.5.1-android-unsigned`** 的 artifact，名称随版本变化，包含：

- `qiuqiule-v11.5.1-unsigned.apk`：已做 16 KB 页面兼容对齐的未签名 release APK。
- `apksigner.jar`：来自 Android Build Tools 35.0.0，供本机使用 JDK 签名和验证。
- `APK-INFO.txt`：由 SDK `aapt dump badging` 导出的应用 ID、版本、最低 SDK 等包信息。
- `SHA256SUMS.txt`：构建产物校验值。

CI 只读取仓库，不生成或持有应用签名私钥，也不发布 GitHub Release。未签名 APK 必须完成下面的签名后才能安装。

## 本机构建

安装 Node 20 以上、JDK 21、Android SDK 35 与 Build Tools 35.0.0 后，在仓库根目录执行：

```sh
npm ci
npm run check
npm test
node scripts/prepare-android.mjs
cd android
./gradlew --no-daemon assembleRelease
```

未签名输出位于 `android/app/build/outputs/apk/release/app-release-unsigned.apk`。本地构建的 APK 先使用 SDK 的 `zipalign -P 16 -f 4` 对齐，再签名；Actions artifact 已完成这一步。

## 本地签名与下载发布

使用项目自己的长期签名证书；后续版本必须复用同一私钥。私钥、证书库密码与密码文件保存在仓库外的私人目录，限制文件权限并单独备份。不要将这些文件提交 Git、上传为 Actions artifact 或附在 GitHub Release 中，也不要把密码直接写进命令参数或日志。

下载并解压构建 artifact 后，可以使用其 `apksigner.jar`，无需在本机安装整套 Android SDK。下面命令中的环境变量指向本机私有证书库、密码文件及其别名；变量值不应进入版本控制。

```sh
java -jar apksigner.jar sign \
  --ks "$QIUQIULE_KEYSTORE" \
  --ks-key-alias "$QIUQIULE_KEY_ALIAS" \
  --ks-pass "file:$QIUQIULE_STORE_PASSWORD_FILE" \
  --key-pass "file:$QIUQIULE_KEY_PASSWORD_FILE" \
  --out qiuqiule-v11.5.1.apk qiuqiule-v11.5.1-unsigned.apk

java -jar apksigner.jar verify --verbose --print-certs qiuqiule-v11.5.1.apk
shasum -a 256 qiuqiule-v11.5.1.apk
```

验证签名与包内版本后，把最终签名 APK 及其 SHA-256 校验值保存到对应版本的 GitHub Release 或持久文件下载地址，使用可下载链接交付。不要把未签名构建产物当作可安装 APK 发布。首次使用新签名时，不能承诺覆盖安装由其他证书签署的旧 APK。
