package com.qiuqiule.game;

import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getBridge().getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
        getBridge().getWebView().getSettings().setTextZoom(100);
        enterFullscreen();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                getBridge().getWebView().evaluateJavascript(
                    "(() => { const modal = document.getElementById('modal-layer'); const hud = document.getElementById('hud'); if ((modal && !modal.hidden) || (hud && !hud.hidden)) { document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); return true; } return false; })()",
                    handled -> { if (!"true".equals(handled)) moveTaskToBack(true); }
                );
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) enterFullscreen();
    }

    private void enterFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsetsCompat.Type.systemBars());
    }
}
