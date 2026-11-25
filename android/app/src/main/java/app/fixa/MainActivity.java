package app.fixa;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;

/**
 * Android shell for Fixa: opens the web app that ships INSIDE the APK (assets folder), with no internet.
 *
 * The app is served from a reserved fake https origin (appassets.androidplatform.net). It has to be https so the
 * WebView allows the microphone and storage; no request ever leaves the device — the app does not even hold the
 * INTERNET permission.
 *
 * What the WebView does not do on its own, and this class handles:
 *  - picking files (image, audio, backup);
 *  - asking for the microphone to record;
 *  - saving the backup to a file — bridge FixaAndroid.saveBackup.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST + "/";
    private static final int REQUEST_FILE = 1;
    private static final int REQUEST_MIC = 2;
    private static final int REQUEST_SAVE = 3;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest micRequest;
    private String pendingBackup;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);   // localStorage: card text
        s.setDatabaseEnabled(true);     // IndexedDB: images and audio
        s.setMediaPlaybackRequiresUserGesture(false); // card audio plays on its own
        s.setAllowFileAccess(false);

        web.addJavascriptInterface(new Bridge(), "FixaAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
                return serve(req.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
                return !HOST.equals(req.getUrl().getHost()); // nothing navigates outside the app
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> callback, FileChooserParams p) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(p.createIntent(), REQUEST_FILE);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean wantsMic = false;
                    for (String r : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) wantsMic = true;
                    }
                    if (!wantsMic) {
                        request.deny();
                    } else if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        micRequest = request;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQUEST_MIC);
                    }
                });
            }
        });

        web.loadUrl(ORIGIN + "index.html");
    }

    /** Serves a file from the assets folder as if it came from the app's https origin. */
    private WebResourceResponse serve(Uri u) {
        if (!HOST.equals(u.getHost())) return null;
        String path = u.getPath();
        if (path == null || path.equals("/")) path = "/index.html";
        path = path.substring(1);
        if (!path.contains("..")) {
            try {
                return new WebResourceResponse(mimeType(path), isText(path) ? "utf-8" : null, getAssets().open(path));
            } catch (IOException e) {
                // falls through to the 404 below
            }
        }
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    private static boolean isText(String path) {
        return !path.endsWith(".png");
    }

    private static String mimeType(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".webmanifest") || path.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == REQUEST_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
                fileCallback = null;
            }
        } else if (request == REQUEST_SAVE) {
            String content = pendingBackup;
            pendingBackup = null;
            if (result != RESULT_OK || data == null || data.getData() == null || content == null) return;
            boolean ok = true;
            try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
                out.write(content.getBytes(StandardCharsets.UTF_8));
            } catch (Exception e) {
                ok = false;
            }
            web.evaluateJavascript("window.onBackupSaved && window.onBackupSaved(" + ok + ")", null);
        }
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request != REQUEST_MIC || micRequest == null) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            micRequest.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            micRequest.deny();
        }
        micRequest = null;
    }

    /** Phone back button: goes back a screen inside the app (study → home) before leaving it. */
    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    /** What the web app can ask Android for. Just one thing: saving the backup to a file. */
    private class Bridge {
        @JavascriptInterface
        public void saveBackup(String name, String content) {
            pendingBackup = content;
            final Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("application/json");
            i.putExtra(Intent.EXTRA_TITLE, name);
            runOnUiThread(() -> startActivityForResult(i, REQUEST_SAVE));
        }
    }
}
