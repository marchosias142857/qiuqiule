package com.qiuqiule.game;

import static org.junit.Assert.*;
import android.content.ContentValues;
import android.content.pm.ActivityInfo;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.MediaStore;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.OutputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
@androidx.test.filters.SdkSuppress(minSdkVersion = 29)
@android.annotation.TargetApi(29)
public class OfflineGameTest {
    private String js(ActivityScenario<MainActivity> scenario, String expression) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(expression, value -> {
            result.set(value);
            done.countDown();
        }));
        assertTrue("WebView callback timed out", done.await(5, TimeUnit.SECONDS));
        return result.get();
    }

    private void awaitTrue(ActivityScenario<MainActivity> scenario, String expression) throws Exception {
        long until = SystemClock.elapsedRealtime() + 20000;
        while (SystemClock.elapsedRealtime() < until) {
            if ("true".equals(js(scenario, "Boolean(" + expression + ")"))) return;
            SystemClock.sleep(150);
        }
        fail("Condition failed: " + expression + " -> " + js(scenario, expression));
    }

    private void screenshot(String name) throws Exception {
        Bitmap bitmap = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        assertNotNull(bitmap);
        android.content.ContentResolver resolver = InstrumentationRegistry.getInstrumentation().getTargetContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, name + ".png");
        values.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
        values.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/qiuqiule-qa");
        Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
        assertNotNull(uri);
        try (OutputStream output = resolver.openOutputStream(uri)) {
            assertNotNull(output);
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output));
        }
        bitmap.recycle();
    }

    @Test
    public void offlineFirstLaunchResourcesRotationAndMenus() throws Exception {
        // The workflow switches the emulator to airplane mode BEFORE this first launch.
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitTrue(scenario, "document.querySelector('#game canvas')?.width > 0 && !document.getElementById('home').hidden");
            assertEquals("\"https://localhost\"", js(scenario, "location.origin"));
            assertTrue(js(scenario, "document.querySelector('.game-version').textContent").contains("2.2.5"));
            assertEquals("true", js(scenario, "document.getElementById('page-top-color') === null"));
            assertEquals("true", js(scenario, "(() => { const r = document.getElementById('game').getBoundingClientRect(); return r.top === 0 && r.left === 0 && r.width === innerWidth && r.height === innerHeight; })()"));
            js(scenario, "navigator.serviceWorker.getRegistrations().then(items => window.__nativeNoWebCache = items.length === 0)");
            awaitTrue(scenario, "window.__nativeNoWebCache === true");
            js(scenario, "Promise.all(['./fonts/fredoka-latin-500-normal.woff2','./audio/light-bounce.mp3','./vendor/phaser.min.js','./physics.js'].map(async url => { const response = await fetch(url); return response.ok && (await response.arrayBuffer()).byteLength > 100; })).then(results => window.__nativeAssetsOK = results.every(Boolean))");
            awaitTrue(scenario, "window.__nativeAssetsOK === true");
            js(scenario, "document.fonts.load('500 40px BallScore').then(fonts => window.__nativeFontOK = fonts.length > 0)");
            awaitTrue(scenario, "window.__nativeFontOK === true");
            js(scenario, "fetch('./audio/light-bounce.mp3').then(r=>r.arrayBuffer()).then(b=>new AudioContext().decodeAudioData(b)).then(b=>window.__nativeMusicOK=b.duration>80)");
            awaitTrue(scenario, "window.__nativeMusicOK === true");
            screenshot("01-home-portrait-offline");
            scenario.onActivity(activity -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE));
            awaitTrue(scenario, "innerWidth > innerHeight");
            SystemClock.sleep(500);
            screenshot("02-home-landscape-offline");
            js(scenario, "document.getElementById('home-play').click()");
            awaitTrue(scenario, "!document.getElementById('hud').hidden && document.getElementById('home').hidden");
            SystemClock.sleep(1500);
            screenshot("03-game-offline");
            js(scenario, "document.querySelector('[data-action=pause]').click()");
            awaitTrue(scenario, "!document.getElementById('pause-panel').hidden");
            SystemClock.sleep(700);
            screenshot("04-pause");
            js(scenario, "document.querySelector('#pause-panel [data-action=settings]').click()");
            awaitTrue(scenario, "!document.getElementById('settings-panel').hidden");
            js(scenario, "document.getElementById('bgm-volume').value=37; document.getElementById('bgm-volume').dispatchEvent(new Event('input',{bubbles:true}))");
            assertTrue(js(scenario, "localStorage.getItem('qiuqiule-settings')").contains("0.37"));
            js(scenario, "document.querySelector('[data-palette=night]').click()");
            assertEquals("\"#22272b\"", js(scenario, "document.querySelector('meta[name=theme-color]').content"));
            awaitTrue(scenario, "getComputedStyle(document.body).backgroundColor === 'rgb(34, 39, 43)'");
            js(scenario, "document.querySelector('#settings-panel [data-action=help]').click()");
            awaitTrue(scenario, "!document.getElementById('help-panel').hidden && !document.getElementById('modal-layer').classList.contains('menu-switching')");
            js(scenario, "document.querySelector('#help-panel [data-action=close]').click()");
            awaitTrue(scenario, "!document.getElementById('settings-panel').hidden && !document.getElementById('modal-layer').classList.contains('menu-switching')");
            SystemClock.sleep(600);
            screenshot("05-settings");
            js(scenario, "document.querySelector('#settings-panel [data-action=close]').click()");
            awaitTrue(scenario, "!document.getElementById('pause-panel').hidden");
            SystemClock.sleep(700);
            js(scenario, "document.querySelector('[data-action=resume]').click()");
            awaitTrue(scenario, "document.getElementById('modal-layer').hidden");
            scenario.onActivity(activity -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
            awaitTrue(scenario, "innerWidth < innerHeight");
            SystemClock.sleep(700);
            screenshot("06-game-portrait");
            js(scenario, "document.querySelector('[data-action=pause]').click()");
            awaitTrue(scenario, "!document.getElementById('pause-panel').hidden");
            SystemClock.sleep(700);
            js(scenario, "document.querySelector('#pause-panel [data-action=home]').click()");
            awaitTrue(scenario, "!document.getElementById('over-panel').hidden && !document.querySelector('.result-actions').classList.contains('arriving')");
            screenshot("07-results");
            js(scenario, "document.getElementById('result-restart').click()");
            awaitTrue(scenario, "document.getElementById('modal-layer').hidden && document.getElementById('ui-ball').hidden");
            assertEquals("\"0000\"", js(scenario, "document.getElementById('score').textContent"));
            assertEquals("0", js(scenario, "document.getElementById('control-transfers').childElementCount"));
            js(scenario, "window.__nativeReloaded = true; location.reload()");
            awaitTrue(scenario, "document.querySelector('#game canvas')?.width > 0 && !window.__nativeReloaded");
            assertEquals("\"37\"", js(scenario, "document.getElementById('bgm-volume').value"));
            assertEquals("\"#22272b\"", js(scenario, "document.getElementById('bg-color').value"));
            screenshot("08-offline-reload");
        }
    }
}
