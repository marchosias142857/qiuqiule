import {readFile, writeFile, copyFile, mkdir, readdir, rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {join} from 'node:path';

// Run after `npx cap add android` or `npx cap sync android`.
// Only generated Android files are edited. The web game in dist stays intact.
const root = 'android/app/src/main';
const assets = join(root, 'assets/public');
const swRegistration = "if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));";
const originalGame = await readFile('dist/game.js', 'utf8');
assert.equal(originalGame.split(swRegistration).length, 2, 'Expected one web service-worker registration');
await writeFile(join(assets, 'game.js'), originalGame.replace(swRegistration, '// Android loads its bundled assets directly; no web cache is needed.'));
const originalHtml = await readFile('dist/index.html', 'utf8');
const offlineScript = /\s*<script\b[^>]*src=["']\.\/offline\.js["'][^>]*><\/script>/g;
assert.equal([...originalHtml.matchAll(offlineScript)].length, 1, 'Expected one offline bootstrap');
await writeFile(join(assets, 'index.html'), originalHtml.replace(offlineScript, ''));

// Preserve gameplay, artwork, typography and music byte for byte.
async function verifyAssets(directory = 'dist', relative = '') {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (entry.name.startsWith('.')) continue;
    const rel = join(relative, entry.name);
    if (entry.isDirectory()) await verifyAssets(join(directory, entry.name), rel);
    else if (!['index.html', 'game.js'].includes(rel))
      assert.deepEqual(await readFile(join(assets, rel)), await readFile(join(directory, entry.name)), rel);
  }
}
await verifyAssets();
await mkdir(join(assets, 'licenses'), {recursive: true});
await copyFile('node_modules/@capacitor/core/LICENSE', join(assets, 'licenses/Capacitor-MIT.txt'));

const nativeConfigPath = join(root, 'assets/capacitor.config.json');
const config = JSON.parse(await readFile(nativeConfigPath, 'utf8'));
assert.ok(!config.server?.url, 'An offline APK must not point to a hosted website');
config.android = {...config.android, backgroundColor: '#f4f3eb', adjustMarginsForEdgeToEdge: 'disable', resolveServiceWorkerRequests: false};
await writeFile(nativeConfigPath, JSON.stringify(config, null, 2) + '\n');

let manifest = await readFile(join(root, 'AndroidManifest.xml'), 'utf8');
manifest = manifest.replace(/\s+android:screenOrientation="[^"]*"/g, '');
manifest = manifest.replace('android:name=".MainActivity"', 'android:name=".MainActivity"\n            android:screenOrientation="fullSensor"');
if (!manifest.includes('android.permission.VIBRATE')) manifest = manifest.replace('</manifest>', '    <uses-permission android:name="android.permission.VIBRATE" />\n</manifest>');
await writeFile(join(root, 'AndroidManifest.xml'), manifest);

let gradle = await readFile('android/app/build.gradle', 'utf8');
assert.match(gradle, /versionCode (?:1|22501)\b/);
gradle = gradle.replace(/versionCode (?:1|22501)\b/, 'versionCode 22501').replace('versionName "1.0"', 'versionName "2.2.5"');
await writeFile('android/app/build.gradle', gradle);

await copyFile('native/android/MainActivity.java', join(root, 'java/com/qiuqiule/game/MainActivity.java'));
// Capacitor's generated example asserts the template package ID, not this app's ID.
await rm('android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java', {force: true});
await mkdir('android/app/src/androidTest/java/com/qiuqiule/game', {recursive: true});
await copyFile('native/android/OfflineGameTest.java', 'android/app/src/androidTest/java/com/qiuqiule/game/OfflineGameTest.java');

// Reuse the game's existing icon, including on adaptive-icon launchers.
for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
  const folder = join(root, 'res', 'mipmap-' + density);
  await mkdir(folder, {recursive: true});
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png'])
    await copyFile('dist/icons/icon-512.png', join(folder, name));
}
await writeFile(join(root, 'res/drawable/ic_launcher_foreground.xml'), `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="512" android:viewportHeight="512">
  <group android:pivotX="256" android:pivotY="256" android:rotation="-12" android:scaleX="0.8" android:scaleY="0.8">
    <path android:fillColor="#252720" android:pathData="M256,100a156,156 0,1 0,0 312a156,156 0,1 0,0 -312"/>
    <path android:fillColor="#f4f3eb" android:pathData="M219.5,225a16.5,16.5 0,0 1,16.5 16.5v24a16.5,16.5 0,0 1,-33 0v-24a16.5,16.5 0,0 1,16.5 -16.5M293.5,225a16.5,16.5 0,0 1,16.5 16.5v24a16.5,16.5 0,0 1,-33 0v-24a16.5,16.5 0,0 1,16.5 -16.5"/>
  </group>
</vector>
`);
await writeFile(join(root, 'res/values/ic_launcher_background.xml'), '<?xml version="1.0" encoding="utf-8"?><resources><color name="ic_launcher_background">#f4f3eb</color></resources>\n');
for (const name of ['ic_launcher', 'ic_launcher_round'])
  await writeFile(join(root, `res/mipmap-anydpi-v26/${name}.xml`), '<?xml version="1.0" encoding="utf-8"?><adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@drawable/ic_launcher_foreground"/></adaptive-icon>\n');
await writeFile(join(root, 'res/values/styles.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <style name="AppTheme" parent="Theme.AppCompat.Light.NoActionBar">
    <item name="android:fontFamily">sans</item>
    <item name="android:windowLightStatusBar">true</item>
    <item name="android:windowBackground">#f4f3eb</item>
    <item name="android:colorAccent">#252720</item>
    <item name="android:windowActionModeOverlay">true</item>
  </style>
  <style name="AppTheme.NoActionBar" parent="AppTheme">
    <item name="windowActionBar">false</item>
    <item name="windowNoTitle">true</item>
    <item name="android:background">@null</item>
  </style>
  <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
    <item name="windowSplashScreenBackground">#f4f3eb</item>
    <item name="windowSplashScreenAnimatedIcon">@drawable/ic_launcher_foreground</item>
    <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
  </style>
</resources>
`);
console.log('Android 2.2.5 (22501): bundled assets verified; web sources unchanged.');
