package com.posnic.captain;

import android.os.Bundle;
import android.util.Log;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalNetworkPlugin.class);
        super.onCreate(savedInstanceState);
        runSelfTestIfAsked();
    }

    /**
     * Let a device with no hands answer "can you reach this server".
     *
     * WHY THIS IS HERE. A shop's handset could not reach an address that the
     * same phone's browser loaded instantly, and finding out why took a day:
     * every round was a release, an install, a photograph of an error message
     * read back over a chat, and one line of new information. Three of those
     * rounds went on guesses a real device would have settled in a minute -
     * including a fix that could never have worked, because it bypassed a
     * JavaScript patch while the interception was happening down here, in
     * native code, underneath every frame and every transport.
     *
     * Node tests cannot find that class of bug. Playwright cannot either: it
     * drives Chromium, and the whole difficulty lives in the gap between
     * Chromium and the WebView an app is actually built on.
     *
     * So an emulator in CI can now ask the app directly:
     *
     *     adb shell am start -n com.posnic.captain/.MainActivity \
     *       -e selftest https://develop.posnic.io/api
     *
     * and read the one line the app prints. See assets/common/self-test.js and
     * .github/workflows/device-test.yml.
     *
     * It runs only when the extra is present, only probes an address it was
     * handed, and changes nothing - there is nothing here a stranger could not
     * learn by typing that address into a browser.
     */
    private void runSelfTestIfAsked() {
        final String url = getIntent() == null ? null : getIntent().getStringExtra("selftest");
        if (url == null || url.isEmpty()) {
            return;
        }

        final WebView webView = getBridge() == null ? null : getBridge().getWebView();
        if (webView == null) {
            return;
        }

        /*
         * After the page has had a moment to load its scripts. The bridge is
         * ready before the document is, and asking too early finds no
         * SelfTest - which would look exactly like a failed probe.
         */
        webView.postDelayed(new Runnable() {
            @Override
            public void run() {
                /* `matrix` when the host asked which SHAPE of request this
                   WebView will make, `run` for the ordinary question. */
                final boolean wantsMatrix = getIntent() != null
                    && getIntent().getBooleanExtra("matrix", false);
                webView.evaluateJavascript(
                    "window.SelfTest && SelfTest." + (wantsMatrix ? "matrix" : "run")
                        + "(" + toJsString(url) + ")",
                    null
                );
                pollForAnswer(webView, 0);
            }
        }, 4000);
    }

    /**
     * Read the answer back, rather than hoping it was printed.
     *
     * A WebView's console.log does NOT reliably reach logcat. Capacitor's
     * WebChromeClient takes onConsoleMessage and decides for itself whether to
     * forward it, so the first emulator run printed nothing at all - which
     * looked exactly like an app that never started, and cost a round to tell
     * apart from one.
     *
     * evaluateJavascript hands the value straight back to this process, where
     * Log.i cannot be filtered by anybody. The probe is asynchronous, so this
     * asks until there is something to read or the patience runs out.
     */
    private void pollForAnswer(final WebView webView, final int attempt) {
        if (attempt > 30) {
            Log.i(SELF_TEST_TAG, "{\"ok\":false,\"why\":\"the app never answered\"}");
            return;
        }
        webView.evaluateJavascript(
            "JSON.stringify(window.__selftest || null)",
            new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    /* evaluateJavascript hands back a JSON-encoded STRING, so
                       the report arrives wrapped and escaped once over. */
                    if (value == null || "null".equals(value) || "\"null\"".equals(value)) {
                        webView.postDelayed(new Runnable() {
                            @Override
                            public void run() {
                                pollForAnswer(webView, attempt + 1);
                            }
                        }, 1000);
                        return;
                    }
                    Log.i(SELF_TEST_TAG, unwrap(value));
                }
            }
        );
    }

    private static final String SELF_TEST_TAG = "POSNIC_SELFTEST";

    /** The JSON string evaluateJavascript wraps a result in, unwrapped once. */
    private static String unwrap(String value) {
        String out = value;
        if (out.length() > 1 && out.charAt(0) == '"' && out.endsWith("\"")) {
            out = out.substring(1, out.length() - 1);
        }
        return out.replace("\\\"", "\"").replace("\\\\", "\\");
    }

    /** A Java string as a JavaScript literal, so a quote cannot end the call. */
    private static String toJsString(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }
}
