package io.anvil.workstation

import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import io.anvil.workstation.runtime.FloatingBubbleService
import io.anvil.workstation.ui.AndroidWebBridge
import io.anvil.workstation.ui.WorkstationViewModel
import java.io.ByteArrayInputStream

class MainActivity : ComponentActivity() {

    private val viewModel: WorkstationViewModel by viewModels()
    private var webView: WebView? = null
    private lateinit var apiBridge: AndroidWebBridge
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher: ActivityResultLauncher<Intent> =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            fileUploadCallback?.onReceiveValue(uris)
            fileUploadCallback = null
        }

    private val overlayDismissedReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == FloatingBubbleService.ACTION_OVERLAY_DISMISSED) {
                runOnUiThread {
                    viewModel.changeOverlayEnabled(false)
                    webView?.evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('obsidian-overlay-dismissed', { detail: { dismissed: true } }));",
                        null
                    )
                }
            }
        }
    }

    inner class AndroidOverlayBridge {
        @JavascriptInterface
        fun isSupported(): Boolean = true

        @JavascriptInterface
        fun isEnabled(): Boolean = viewModel.overlayEnabled

        @JavascriptInterface
        fun setEnabled(enabled: Boolean) {
            runOnUiThread {
                viewModel.changeOverlayEnabled(enabled)
            }
        }

        @JavascriptInterface
        fun sync(enabled: Boolean) {
            runOnUiThread {
                if (enabled) {
                    if (FloatingBubbleService.canDrawOverlays(this@MainActivity)) {
                        viewModel.changeOverlayEnabled(true)
                    } else {
                        webView?.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('obsidian-overlay-permission', { detail: { granted: false } }));",
                            null
                        )
                    }
                } else {
                    viewModel.changeOverlayEnabled(false)
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.statusBarColor = Color.parseColor("#090A0C")
        window.navigationBarColor = Color.parseColor("#090A0C")

        val filter = IntentFilter(FloatingBubbleService.ACTION_OVERLAY_DISMISSED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(overlayDismissedReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(overlayDismissedReceiver, filter)
        }

        apiBridge = AndroidWebBridge(
            context = applicationContext,
            viewModel = viewModel,
            webViewProvider = { webView },
        )

        val wv = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            setBackgroundColor(Color.parseColor("#090A0C"))

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                loadsImagesAutomatically = true
                mediaPlaybackRequiresUserGesture = false
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                cacheMode = WebSettings.LOAD_DEFAULT
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
            }

            addJavascriptInterface(AndroidOverlayBridge(), "AndroidOverlay")
            addJavascriptInterface(apiBridge, "AndroidApiBridge")

            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView?,
                    filePathCallback: ValueCallback<Array<Uri>>?,
                    fileChooserParams: FileChooserParams?,
                ): Boolean {
                    fileUploadCallback?.onReceiveValue(null)
                    fileUploadCallback = filePathCallback

                    val intent = try {
                        fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                        }
                    } catch (e: Exception) {
                        Intent(Intent.ACTION_GET_CONTENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                        }
                    }

                    return try {
                        fileChooserLauncher.launch(intent)
                        true
                    } catch (e: Exception) {
                        fileUploadCallback?.onReceiveValue(null)
                        fileUploadCallback = null
                        false
                    }
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView?,
                    request: WebResourceRequest?,
                ): WebResourceResponse? {
                    val uri = request?.url ?: return null
                    val host = uri.host ?: return null
                    if (host != VIRTUAL_HOST) return null

                    val rawPath = uri.path?.trimStart('/')?.ifEmpty { "index.html" } ?: "index.html"
                    if (rawPath.startsWith("api/")) {
                        return null
                    }

                    return serveBundledAsset(rawPath)
                }

                override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    view?.evaluateJavascript(BRIDGE_BOOTSTRAP_JS, null)
                }
            }
        }

        webView = wv
        setContentView(wv)

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    val currentWebView = webView
                    if (currentWebView != null && currentWebView.canGoBack()) {
                        currentWebView.goBack()
                    } else {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            }
        )

        wv.loadUrl("https://$VIRTUAL_HOST/index.html")
    }

    private fun serveBundledAsset(relativePath: String): WebResourceResponse {
        val assetPath = "webapp/$relativePath"
        return try {
            if (relativePath == "index.html") {
                val rawHtml = assets.open(assetPath).bufferedReader(Charsets.UTF_8).use { it.readText() }
                val injectedHtml = rawHtml.replace(
                    "<head>",
                    "<head><script>$BRIDGE_BOOTSTRAP_JS</script>"
                )
                WebResourceResponse(
                    "text/html",
                    "UTF-8",
                    ByteArrayInputStream(injectedHtml.toByteArray(Charsets.UTF_8))
                )
            } else {
                val stream = assets.open(assetPath)
                val ext = relativePath.substringAfterLast('.', "").lowercase()
                val mime = when (ext) {
                    "js", "mjs" -> "application/javascript"
                    "css" -> "text/css"
                    "svg" -> "image/svg+xml"
                    "json" -> "application/json"
                    "png" -> "image/png"
                    "jpg", "jpeg" -> "image/jpeg"
                    "webp" -> "image/webp"
                    "woff2" -> "font/woff2"
                    "woff" -> "font/woff"
                    "ttf" -> "font/ttf"
                    else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
                }
                WebResourceResponse(mime, "UTF-8", stream)
            }
        } catch (_: Exception) {
            // SPA fallback to index.html for client-side routes
            try {
                val rawHtml = assets.open("webapp/index.html").bufferedReader(Charsets.UTF_8).use { it.readText() }
                val injectedHtml = rawHtml.replace(
                    "<head>",
                    "<head><script>$BRIDGE_BOOTSTRAP_JS</script>"
                )
                WebResourceResponse(
                    "text/html",
                    "UTF-8",
                    ByteArrayInputStream(injectedHtml.toByteArray(Charsets.UTF_8))
                )
            } catch (_: Exception) {
                WebResourceResponse(
                    "text/plain",
                    "UTF-8",
                    404,
                    "Not Found",
                    emptyMap(),
                    ByteArrayInputStream("Not Found".toByteArray(Charsets.UTF_8))
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        viewModel.onResume()
        val granted = FloatingBubbleService.canDrawOverlays(this)
        webView?.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('obsidian-overlay-permission', { detail: { granted: $granted } }));",
            null
        )
    }

    override fun onDestroy() {
        try {
            unregisterReceiver(overlayDismissedReceiver)
        } catch (_: Exception) {}
        webView?.destroy()
        webView = null
        super.onDestroy()
    }

    companion object {
        private const val VIRTUAL_HOST = "appassets.androidplatform.net"

        private const val BRIDGE_BOOTSTRAP_JS = """
            (function() {
                if (window.__obsidianBridgeInstalled) return;
                window.__obsidianBridgeInstalled = true;

                const originalFetch = window.fetch.bind(window);
                window.fetch = function(input, init) {
                    try {
                        const rawUrl = typeof input === 'string' ? input : (input && input.url ? input.url : String(input));
                        let pathWithQuery = null;
                        if (rawUrl.startsWith('/api/')) {
                            pathWithQuery = rawUrl;
                        } else if (rawUrl.includes('/api/')) {
                            const u = new URL(rawUrl, window.location.origin);
                            if (u.pathname.startsWith('/api/')) {
                                pathWithQuery = u.pathname + (u.search || '');
                            }
                        }

                        if (pathWithQuery && window.AndroidApiBridge && window.AndroidApiBridge.requestSync) {
                            const method = (init && init.method) ? String(init.method).toUpperCase() : 'GET';
                            const body = (init && typeof init.body === 'string') ? init.body : null;
                            return new Promise((resolve) => {
                                setTimeout(() => {
                                    try {
                                        const rawRes = window.AndroidApiBridge.requestSync(method, pathWithQuery, body);
                                        const parsed = JSON.parse(rawRes || '{"status":200,"body":"{}"}');
                                        const status = parsed.status || 200;
                                        const responseBody = typeof parsed.body === 'string' ? parsed.body : JSON.stringify(parsed.body || {});
                                        resolve(new Response(responseBody, {
                                            status: status,
                                            headers: { 'Content-Type': 'application/json' }
                                        }));
                                    } catch (err) {
                                        resolve(new Response(JSON.stringify({ error: String(err) }), {
                                            status: 500,
                                            headers: { 'Content-Type': 'application/json' }
                                        }));
                                    }
                                }, 0);
                            });
                        }
                    } catch (e) {}
                    return originalFetch(input, init);
                };

                const eventListeners = [];
                window.__obsidianReceiveAgentEvent = function(evt) {
                    eventListeners.forEach(fn => {
                        try { fn(evt); } catch (e) {}
                    });
                };

                const toolchainListeners = [];
                window.__obsidianReceiveToolchainEvent = function(evt) {
                    toolchainListeners.forEach(fn => {
                        try { fn(evt); } catch (e) {}
                    });
                };

                const OriginalEventSource = window.EventSource;
                window.EventSource = function(url, config) {
                    if (typeof url === 'string' && url.includes('/api/agent/events')) {
                        const listeners = {};
                        const handler = function(evt) {
                            const list = listeners['activity'] || [];
                            const msgEvent = { data: JSON.stringify(evt) };
                            list.forEach(cb => { try { cb(msgEvent); } catch (e) {} });
                        };
                        eventListeners.push(handler);
                        return {
                            addEventListener: function(type, cb) {
                                if (!listeners[type]) listeners[type] = [];
                                listeners[type].push(cb);
                            },
                            removeEventListener: function(type, cb) {
                                if (!listeners[type]) return;
                                listeners[type] = listeners[type].filter(x => x !== cb);
                            },
                            close: function() {
                                const idx = eventListeners.indexOf(handler);
                                if (idx !== -1) eventListeners.splice(idx, 1);
                            }
                        };
                    }

                    if (typeof url === 'string' && (url.includes('/api/toolchains/stream') || url.includes('/api/toolchains/events'))) {
                        const listeners = {};
                        const handler = function(payload) {
                            const eventName = payload && payload.event ? payload.event : 'progress';
                            const eventData = payload && payload.data ? payload.data : payload;
                            const list = listeners[eventName] || listeners['message'] || [];
                            const msgEvent = { data: JSON.stringify(eventData) };
                            list.forEach(cb => { try { cb(msgEvent); } catch (e) {} });
                        };
                        toolchainListeners.push(handler);

                        if (window.AndroidApiBridge && window.AndroidApiBridge.requestSync) {
                            setTimeout(() => {
                                try {
                                    const rawRes = window.AndroidApiBridge.requestSync('GET', '/api/toolchains', null);
                                    const parsed = JSON.parse(rawRes || '{}');
                                    const body = typeof parsed.body === 'string' ? JSON.parse(parsed.body) : parsed.body;
                                    const initList = listeners['init'] || [];
                                    initList.forEach(cb => { try { cb({ data: JSON.stringify(body) }); } catch(e) {} });
                                } catch (e) {}
                            }, 50);
                        }

                        return {
                            addEventListener: function(type, cb) {
                                if (!listeners[type]) listeners[type] = [];
                                listeners[type].push(cb);
                            },
                            removeEventListener: function(type, cb) {
                                if (!listeners[type]) return;
                                listeners[type] = listeners[type].filter(x => x !== cb);
                            },
                            close: function() {
                                const idx = toolchainListeners.indexOf(handler);
                                if (idx !== -1) toolchainListeners.splice(idx, 1);
                            }
                        };
                    }

                    return new OriginalEventSource(url, config);
                };
            })();
        """
    }
}
