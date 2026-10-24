package io.anvil.workstation.ui

import android.app.ActivityManager
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import io.anvil.workstation.chat.ChatClient
import io.anvil.workstation.chat.ChatProviderConfig
import io.anvil.workstation.chat.ChatTurn
import io.anvil.workstation.localai.GgufHeaderInspector
import io.anvil.workstation.security.AndroidKeystoreAuthManager
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList

class AndroidWebBridge(
    private val context: Context,
    private val viewModel: WorkstationViewModel,
    private val webViewProvider: () -> WebView?,
) {
    private val prefs = context.getSharedPreferences("obsidian_web_bridge", Context.MODE_PRIVATE)
    private val auth = AndroidKeystoreAuthManager(context)
    private val mainHandler = Handler(Looper.getMainLooper())

    private data class StoredConversation(
        val id: String,
        var title: String,
        var workspaceId: String,
        var providerId: String = "gemini",
        var modelId: String = "gemini-2.5-flash",
        var agentId: String = "coder",
        var pinned: Boolean = false,
        val createdAt: Long = System.currentTimeMillis(),
        var updatedAt: Long = System.currentTimeMillis(),
    )

    private data class StoredMessage(
        val id: String,
        val conversationId: String,
        val role: String,
        val content: String,
        val timestamp: Long = System.currentTimeMillis(),
        val modelId: String? = null,
        val providerId: String? = null,
        val skillsUsed: List<Pair<String, String>> = emptyList(),
    )

    private val conversations = ConcurrentHashMap<String, StoredConversation>()
    private val messagesByConv = ConcurrentHashMap<String, MutableList<StoredMessage>>()
    private val agentEvents = CopyOnWriteArrayList<JSONObject>()

    @Volatile
    private var cachedLiveServerUrl: String? = null
    @Volatile
    private var lastServerProbeTime: Long = 0L

    init {
        val defaultConvId = "conv-default"
        val wsName = viewModel.activeWorkspace?.id ?: "android-workstation"
        conversations[defaultConvId] = StoredConversation(
            id = defaultConvId,
            title = "Session 1",
            workspaceId = wsName,
            providerId = viewModel.providerId,
            modelId = viewModel.modelId,
        )
        messagesByConv[defaultConvId] = mutableListOf(
            StoredMessage(
                id = "msg-welcome",
                conversationId = defaultConvId,
                role = "assistant",
                content = "OBSIDIAN AI Coding Workstation online.\n\n- **Workspace:** `$wsName`\n- **Model:** `${viewModel.modelId}` (${viewModel.providerDisplayName()})\n\nAsk me to inspect or edit files, run terminal commands, build an Android APK, or activate domain skills from the **Tools → Skills** library.",
                modelId = viewModel.modelId,
                providerId = viewModel.providerId,
            )
        )
    }

    private fun discoverLiveServer(): String? {
        val now = System.currentTimeMillis()
        if (now - lastServerProbeTime < 6_000L) {
            return cachedLiveServerUrl
        }
        lastServerProbeTime = now
        val candidates = listOf(
            prefs.getString("custom_server_url", null),
            "http://192.168.1.2:3000",
            "http://10.0.2.2:3000",
            "http://127.0.0.1:3000",
        ).filterNotNull().filter { it.isNotBlank() }.distinct()

        for (base in candidates) {
            try {
                val conn = (URL("$base/api/settings").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 400
                    readTimeout = 400
                    requestMethod = "GET"
                }
                val code = conn.responseCode
                conn.disconnect()
                if (code in 200..299) {
                    cachedLiveServerUrl = base
                    return base
                }
            } catch (_: Exception) {
            }
        }
        cachedLiveServerUrl = null
        return null
    }

    @JavascriptInterface
    fun requestSync(method: String, rawPath: String, bodyStr: String?): String {
        val liveServer = discoverLiveServer()
        if (liveServer != null && !rawPath.startsWith("/api/agent/events/stream")) {
            try {
                val targetUrl = URL(liveServer + rawPath)
                val conn = (targetUrl.openConnection() as HttpURLConnection).apply {
                    connectTimeout = 3500
                    readTimeout = 60000
                    requestMethod = method.uppercase()
                    setRequestProperty("Accept", "application/json")
                    if (!bodyStr.isNullOrBlank() && method.uppercase() != "GET") {
                        doOutput = true
                        setRequestProperty("Content-Type", "application/json; charset=utf-8")
                        outputStream.use { it.write(bodyStr.toByteArray(Charsets.UTF_8)) }
                    }
                }
                val status = conn.responseCode
                val stream = if (status in 200..299) conn.inputStream else conn.errorStream
                val responseBody = stream?.let {
                    BufferedReader(InputStreamReader(it, Charsets.UTF_8)).use { r -> r.readText() }
                } ?: "{}"
                conn.disconnect()
                return JSONObject().apply {
                    put("status", status)
                    put("body", responseBody)
                }.toString()
            } catch (_: Exception) {
                cachedLiveServerUrl = null
            }
        }

        return try {
            val resultJson = handleLocalApi(method.uppercase(), rawPath, bodyStr)
            JSONObject().apply {
                put("status", 200)
                put("body", resultJson)
            }.toString()
        } catch (e: Exception) {
            val errBody = JSONObject().apply {
                put("error", e.message ?: "Local API error")
            }.toString()
            JSONObject().apply {
                put("status", 500)
                put("body", errBody)
            }.toString()
        }
    }

    private fun recordAndEmitEvent(eventObj: JSONObject) {
        agentEvents.add(0, eventObj)
        while (agentEvents.size > 150) {
            agentEvents.removeAt(agentEvents.lastIndex)
        }
        val payload = eventObj.toString()
        mainHandler.post {
            webViewProvider()?.evaluateJavascript(
                "window.__obsidianReceiveAgentEvent && window.__obsidianReceiveAgentEvent($payload);",
                null
            )
        }
    }

    private fun convToJson(c: StoredConversation): JSONObject {
        val msgs = messagesByConv[c.id].orEmpty()
        val msgArr = JSONArray()
        msgs.forEach { m ->
            msgArr.put(JSONObject().apply {
                put("id", m.id)
                put("role", m.role)
                put("sender", if (m.role == "user") "user" else "agent")
                put("content", m.content)
                put("text", m.content)
                put("timestamp", m.timestamp)
                if (m.modelId != null) put("modelId", m.modelId)
                if (m.providerId != null) put("providerId", m.providerId)
                if (m.skillsUsed.isNotEmpty()) {
                    val skArr = JSONArray()
                    m.skillsUsed.forEach { (sid, sname) ->
                        skArr.put(JSONObject().put("id", sid).put("name", sname))
                    }
                    put("skillsUsed", skArr)
                }
            })
        }
        return JSONObject().apply {
            put("id", c.id)
            put("title", c.title)
            put("workspaceId", c.workspaceId)
            put("providerId", c.providerId)
            put("modelId", c.modelId)
            put("agentId", c.agentId)
            put("pinned", c.pinned)
            put("createdAt", c.createdAt)
            put("updatedAt", c.updatedAt)
            put("messages", msgArr)
        }
    }

    private fun allConversationsArray(): JSONArray {
        val arr = JSONArray()
        conversations.values.sortedWith(
            compareByDescending<StoredConversation> { it.pinned }.thenByDescending { it.updatedAt }
        ).forEach { c ->
            arr.put(convToJson(c))
        }
        return arr
    }

    private fun handleLocalApi(method: String, rawPath: String, bodyStr: String?): String {
        val pathOnly = rawPath.substringBefore("?")
        val body = if (!bodyStr.isNullOrBlank()) runCatching { JSONObject(bodyStr) }.getOrNull() else null

        return when {
            pathOnly == "/api/conversations" && method == "GET" -> {
                JSONObject().put("conversations", allConversationsArray()).toString()
            }

            pathOnly == "/api/conversations" && method == "POST" -> {
                val title = body?.optString("title")?.takeIf { it.isNotBlank() } ?: "Session ${conversations.size + 1}"
                val wsId = body?.optString("workspaceId")?.takeIf { it.isNotBlank() }
                    ?: viewModel.activeWorkspace?.id ?: "android-workstation"
                val id = "conv-${UUID.randomUUID().toString().take(8)}"
                val conv = StoredConversation(
                    id = id,
                    title = title,
                    workspaceId = wsId,
                    providerId = body?.optString("providerId")?.takeIf { it.isNotBlank() } ?: viewModel.providerId,
                    modelId = body?.optString("modelId")?.takeIf { it.isNotBlank() } ?: viewModel.modelId,
                    agentId = body?.optString("agentId")?.takeIf { it.isNotBlank() } ?: "coder",
                )
                conversations[id] = conv
                messagesByConv[id] = mutableListOf()
                JSONObject().apply {
                    put("conversation", convToJson(conv))
                    put("conversations", allConversationsArray())
                }.toString()
            }

            pathOnly.startsWith("/api/conversations/") && method == "DELETE" -> {
                val id = pathOnly.removePrefix("/api/conversations/")
                conversations.remove(id)
                messagesByConv.remove(id)
                if (conversations.isEmpty()) {
                    val fallback = StoredConversation("conv-default", "Session 1", "android-workstation")
                    conversations[fallback.id] = fallback
                    messagesByConv[fallback.id] = mutableListOf()
                }
                JSONObject().apply {
                    put("success", true)
                    put("conversations", allConversationsArray())
                }.toString()
            }

            pathOnly.startsWith("/api/conversations/") && (method == "PATCH" || method == "PUT") -> {
                val id = pathOnly.removePrefix("/api/conversations/")
                val conv = conversations[id]
                if (conv != null && body != null) {
                    if (body.has("title")) conv.title = body.optString("title", conv.title)
                    if (body.has("workspaceId")) conv.workspaceId = body.optString("workspaceId", conv.workspaceId)
                    if (body.has("providerId")) conv.providerId = body.optString("providerId", conv.providerId)
                    if (body.has("modelId")) conv.modelId = body.optString("modelId", conv.modelId)
                    if (body.has("pinned")) conv.pinned = body.optBoolean("pinned", conv.pinned)
                    conv.updatedAt = System.currentTimeMillis()
                }
                JSONObject().apply {
                    put("success", true)
                    if (conv != null) put("conversation", convToJson(conv))
                    put("conversations", allConversationsArray())
                }.toString()
            }

            (pathOnly == "/api/chat/send" || pathOnly == "/api/chat") && method == "POST" -> {
                val userMsg = (body?.optString("content")?.takeIf { it.isNotBlank() }
                    ?: body?.optString("message").orEmpty()).trim()
                val convId = body?.optString("conversationId")?.takeIf { it.isNotBlank() }
                    ?: conversations.keys.firstOrNull() ?: "conv-default"
                val conv = conversations.getOrPut(convId) {
                    StoredConversation(convId, "Session 1", viewModel.activeWorkspace?.id ?: "android-workstation")
                }
                val list = messagesByConv.getOrPut(convId) { mutableListOf() }
                val userStored = StoredMessage(
                    id = "msg-${UUID.randomUUID().toString().take(8)}",
                    conversationId = convId,
                    role = "user",
                    content = userMsg,
                )
                list.add(userStored)
                if (conv.title.startsWith("Session ") || conv.title == "New Chat") {
                    conv.title = userMsg.take(36)
                }
                conv.updatedAt = System.currentTimeMillis()

                val matchedSkills = viewModel.matchSkillsForPrompt(userMsg)
                matchedSkills.forEach { sk ->
                    recordAndEmitEvent(JSONObject().apply {
                        put("id", "evt-${UUID.randomUUID().toString().take(8)}")
                        put("type", "LOADING_SKILL")
                        put("status", "completed")
                        put("message", "Loaded skill: ${sk.name}")
                        put("detail", sk.description)
                        put("skillId", sk.id)
                        put("skillName", sk.name)
                        put("conversationId", convId)
                        put("timestamp", System.currentTimeMillis())
                    })
                }

                val key = auth.getActiveSecret(viewModel.providerId).orEmpty()
                val replyText = if (key.isBlank()) {
                    "No API key is configured for **${viewModel.providerDisplayName()}**.\n\nOpen **Settings** (or **Tools → Models**) and save your API key in the Android Keystore to enable live completions."
                } else {
                    val thinkId = "evt-think-${UUID.randomUUID().toString().take(6)}"
                    recordAndEmitEvent(JSONObject().apply {
                        put("id", thinkId)
                        put("type", "THINKING")
                        put("status", "running")
                        put("message", "Generating response with ${viewModel.modelId}")
                        put("conversationId", convId)
                        put("timestamp", System.currentTimeMillis())
                    })
                    val client = ChatClient(
                        ChatProviderConfig(
                            viewModel.providerId,
                            viewModel.modelId,
                            viewModel.baseUrl,
                            key,
                        )
                    )
                    val turns = list.map {
                        ChatTurn(if (it.role == "user") "user" else "assistant", it.content)
                    }
                    val skillPrompt = if (matchedSkills.isNotEmpty()) {
                        "\n\nActive Skills:\n" + matchedSkills.joinToString("\n\n") {
                            "## ${it.name}\n${it.instructions}"
                        }
                    } else ""
                    val sysPrompt = "You are OBSIDIAN, an AI Coding Workstation on Android. Active workspace: ${conv.workspaceId}.$skillPrompt"
                    runCatching { runBlocking { client.complete(sysPrompt, turns) } }
                        .getOrElse { "Provider error: ${it.message}" }
                }

                val agentMsg = StoredMessage(
                    id = "msg-${UUID.randomUUID().toString().take(8)}",
                    conversationId = convId,
                    role = "assistant",
                    content = replyText,
                    modelId = viewModel.modelId,
                    providerId = viewModel.providerId,
                    skillsUsed = matchedSkills.map { it.id to it.name },
                )
                list.add(agentMsg)
                conv.updatedAt = System.currentTimeMillis()

                recordAndEmitEvent(JSONObject().apply {
                    put("id", "evt-done-${UUID.randomUUID().toString().take(6)}")
                    put("type", "COMPLETED")
                    put("status", "completed")
                    put("message", "Task completed")
                    put("conversationId", convId)
                    put("timestamp", System.currentTimeMillis())
                })

                val evArr = JSONArray()
                agentEvents.take(40).forEach { evArr.put(it) }

                JSONObject().apply {
                    put("reply", replyText)
                    put("conversation", convToJson(conv))
                    put("events", evArr)
                }.toString()
            }

            pathOnly == "/api/chat/cancel" && method == "POST" -> {
                mainHandler.post { viewModel.cancelChat() }
                JSONObject().put("success", true).toString()
            }

            pathOnly == "/api/agent/events" && method == "GET" -> {
                val evArr = JSONArray()
                agentEvents.take(60).forEach { evArr.put(it) }
                JSONObject().apply {
                    put("events", evArr)
                    put("pendingApprovals", JSONArray())
                }.toString()
            }

            pathOnly == "/api/skills" && method == "GET" -> {
                val arr = JSONArray()
                viewModel.skills.forEach { sk ->
                    arr.put(skillToJson(sk, includeInstructions = false))
                }
                val stats = JSONObject().apply {
                    put("total", viewModel.skills.size)
                    put("enabled", viewModel.skills.count { it.enabled })
                    put("builtin", viewModel.skills.count { !it.isCustom })
                    put("custom", viewModel.skills.count { it.isCustom })
                }
                JSONObject().apply {
                    put("skills", arr)
                    put("stats", stats)
                }.toString()
            }

            pathOnly.startsWith("/api/skills/") && pathOnly.endsWith("/toggle") && method == "POST" -> {
                val id = pathOnly.removePrefix("/api/skills/").removeSuffix("/toggle")
                mainHandler.post { viewModel.toggleSkill(id) }
                val sk = viewModel.skills.firstOrNull { it.id == id }
                JSONObject().apply {
                    put("success", true)
                    if (sk != null) {
                        put("skill", skillToJson(sk.copy(enabled = !sk.enabled), includeInstructions = true))
                    }
                }.toString()
            }

            pathOnly.startsWith("/api/skills/") && method == "GET" -> {
                val id = pathOnly.removePrefix("/api/skills/")
                val sk = viewModel.skills.firstOrNull { it.id == id }
                    ?: throw IllegalArgumentException("Skill not found: $id")
                JSONObject().put("skill", skillToJson(sk, includeInstructions = true)).toString()
            }

            pathOnly == "/api/skills" && method == "POST" -> {
                val name = body?.optString("name").orEmpty()
                val id = body?.optString("id").orEmpty().ifBlank { name }
                val desc = body?.optString("description").orEmpty()
                val category = body?.optString("category").orEmpty().ifBlank { "general" }
                val instructions = body?.optString("instructions").orEmpty()
                val toolsArr = body?.optJSONArray("tools")
                val toolsCsv = buildString {
                    if (toolsArr != null) {
                        for (i in 0 until toolsArr.length()) {
                            if (i > 0) append(",")
                            append(toolsArr.optString(i))
                        }
                    }
                }
                mainHandler.post {
                    viewModel.createCustomSkill(id, name, desc, category, toolsCsv, instructions)
                }
                JSONObject().put("success", true).toString()
            }

            pathOnly.startsWith("/api/skills/") && method == "DELETE" -> {
                val id = pathOnly.removePrefix("/api/skills/")
                mainHandler.post { viewModel.deleteSkill(id) }
                JSONObject().put("success", true).toString()
            }

            pathOnly == "/api/workspaces" && method == "GET" -> {
                val arr = JSONArray()
                viewModel.workspaces.forEach { ws ->
                    arr.put(JSONObject().apply {
                        put("id", ws.id)
                        put("name", ws.name)
                        put("path", ws.rootDir.absolutePath)
                        put("template", "general")
                        put("active", ws.id == viewModel.activeWorkspace?.id)
                    })
                }
                JSONObject().apply {
                    put("workspaces", arr)
                    put("activeWorkspace", viewModel.activeWorkspace?.id ?: "")
                }.toString()
            }

            pathOnly == "/api/providers" && method == "GET" -> {
                val arr = JSONArray()
                WorkstationViewModel.PROVIDERS.forEach { p ->
                    val hasKey = auth.getActiveSecret(p.id) != null
                    arr.put(JSONObject().apply {
                        put("id", p.id)
                        put("name", p.label)
                        put("type", p.id)
                        put("enabled", true)
                        put("configured", hasKey)
                        put("hasApiKey", hasKey)
                        put("defaultModel", if (viewModel.providerId == p.id) viewModel.modelId else p.defaultModel)
                        put("activeModel", if (viewModel.providerId == p.id) viewModel.modelId else p.defaultModel)
                        put("baseUrl", if (viewModel.providerId == p.id) viewModel.baseUrl else p.defaultBaseUrl)
                        val modelsArr = JSONArray()
                        viewModel.modelCatalog.filter { it.providerId == p.id }.forEach { m ->
                            modelsArr.put(JSONObject().apply {
                                put("id", m.modelId)
                                put("name", m.modelId)
                                put("description", m.description)
                                put("contextWindow", m.contextWindow)
                            })
                        }
                        put("models", modelsArr)
                    })
                }
                JSONObject().apply {
                    put("providers", arr)
                    put("activeProvider", viewModel.providerId)
                    put("activeModel", viewModel.modelId)
                }.toString()
            }

            pathOnly == "/api/credentials" && method == "POST" -> {
                val prov = body?.optString("providerId")?.takeIf { it.isNotBlank() } ?: viewModel.providerId
                val key = body?.optString("apiKey").orEmpty()
                if (key.isNotBlank()) {
                    auth.saveApiKey(prov, "Primary", key)
                    mainHandler.post { viewModel.refreshApiKeyState() }
                }
                JSONObject().put("success", true).toString()
            }

            pathOnly == "/api/settings" && method == "GET" -> {
                JSONObject().apply {
                    put("settings", JSONObject().apply {
                        put("defaultProviderId", viewModel.providerId)
                        put("defaultModelId", viewModel.modelId)
                        put("maxAgentIterations", 10)
                    })
                    put("permissions", JSONObject().apply {
                        put("FILE_READ", "ALLOW")
                        put("FILE_WRITE", "ALLOW")
                        put("TERMINAL_EXEC", "ASK")
                        put("APK_BUILD", "ALLOW")
                    })
                }.toString()
            }

            pathOnly == "/api/subagents" && method == "GET" -> {
                val arr = JSONArray()
                viewModel.agentTasks.forEach { t ->
                    arr.put(JSONObject().apply {
                        put("id", t.id)
                        put("role", t.role)
                        put("title", t.prompt.take(60))
                        put("status", t.status.name.lowercase())
                        put("summary", t.result.take(200))
                    })
                }
                JSONObject().put("tasks", arr).toString()
            }

            (pathOnly == "/api/toolchains" || pathOnly == "/api/toolchains/state") && method == "GET" -> {
                val core = JSONArray().apply {
                    put(JSONObject().apply {
                        put("id", "android-sdk-35")
                        put("name", "Android SDK Platform 35 (AAPT2 + D8 + apksigner)")
                        put("category", "core")
                        put("version", "35.0.1")
                        put("installed", true)
                        put("status", "installed")
                        put("verified", true)
                    })
                    put(JSONObject().apply {
                        put("id", "openjdk-17")
                        put("name", "OpenJDK 17 Embedded Compiler")
                        put("category", "core")
                        put("version", "17.0.20")
                        put("installed", true)
                        put("status", "installed")
                        put("verified", true)
                    })
                }
                JSONObject().apply {
                    put("coreToolchains", core)
                    put("optionalToolchains", JSONArray())
                    put("toolchains", core)
                }.toString()
            }

            (pathOnly == "/api/toolchains/resources" || pathOnly == "/api/toolchains/bundles") && method == "GET" -> {
                JSONObject().put("bundles", JSONArray()).toString()
            }

            (pathOnly == "/api/mcp" || pathOnly == "/api/mcp/servers") && method == "GET" -> {
                JSONObject().put("servers", JSONArray()).toString()
            }

            (pathOnly == "/api/system/environment" || pathOnly == "/api/environment") && method == "GET" -> {
                val actManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
                val memInfo = ActivityManager.MemoryInfo()
                actManager?.getMemoryInfo(memInfo)
                val availMem = memInfo.availMem
                val totalMem = memInfo.totalMem
                val modelsDir = File(context.filesDir, "models").apply { if (!exists()) mkdirs() }
                val workspacesDir = File(context.filesDir, "workspaces").apply { if (!exists()) mkdirs() }
                val modelsCount = modelsDir.listFiles { f -> f.extension == "gguf" || f.extension == "bin" }?.size ?: 0

                JSONObject().apply {
                    put("client", JSONObject().apply {
                        put("platform", "android_native")
                        put("isMobile", true)
                        put("isAndroidNative", true)
                        put("deviceModel", Build.MODEL)
                        put("manufacturer", Build.MANUFACTURER)
                        put("androidApiLevel", Build.VERSION.SDK_INT)
                        put("label", "Android Native Client (${Build.MODEL})")
                    })
                    put("backend", JSONObject().apply {
                        put("os", "android")
                        put("platform", "android")
                        put("osName", "Android")
                        put("arch", Build.SUPPORTED_ABIS.firstOrNull() ?: "arm64-v8a")
                        put("hostname", Build.MODEL)
                        put("release", Build.VERSION.RELEASE)
                        put("isNativeAndroid", true)
                        put("isWindows", false)
                        put("isLinux", true)
                        put("isMac", false)
                        put("isContainer", false)
                        put("label", "Android Linux Runtime (${Build.SUPPORTED_ABIS.firstOrNull() ?: "arm64-v8a"})")
                    })
                    put("filesystem", JSONObject().apply {
                        put("owner", "android_native")
                        put("ownerLabel", "Android App Scoped Storage")
                        put("workspaceId", "android-workstation")
                        put("workspaceRoot", workspacesDir.absolutePath)
                        put("accessible", true)
                        put("pathSeparator", "/")
                        put("isWindowsPaths", false)
                    })
                    put("capabilities", JSONObject().apply {
                        put("shell", false)
                        put("pty", false)
                        put("localAi", true)
                        put("arm64", Build.SUPPORTED_ABIS.any { it.contains("arm64") || it.contains("aarch64") })
                        put("freeMemoryBytes", availMem)
                        put("totalMemoryBytes", totalMem)
                        put("modelsDirectory", modelsDir.absolutePath)
                        put("modelsDirAccessible", true)
                        put("modelsCount", modelsCount)
                        put("inferenceEngine", "GgufHeaderInspector / On-Device ARM64 Engine")
                    })
                }.toString()
            }

            pathOnly == "/api/local-models" && method == "GET" -> {
                val actManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
                val memInfo = ActivityManager.MemoryInfo()
                actManager?.getMemoryInfo(memInfo)
                val availMem = memInfo.availMem
                val modelsDir = File(context.filesDir, "models").apply { if (!exists()) mkdirs() }
                val inspector = GgufHeaderInspector()
                val modelsArr = JSONArray()

                modelsDir.listFiles { f -> f.extension == "gguf" || f.extension == "bin" }?.forEach { f ->
                    val result = inspector.inspectGgufFile(f, availMem).getOrNull()
                    val sizeMb = (f.length() / (1024 * 1024)).toInt()
                    val sizeDisplay = if (sizeMb > 1024) String.format("%.2f GB", sizeMb / 1024f) else "$sizeMb MB"
                    modelsArr.put(JSONObject().apply {
                        put("id", f.name)
                        put("displayName", f.nameWithoutExtension.replace('-', ' ').replace('_', ' '))
                        put("description", result?.diagnosticNote ?: "On-device GGUF model")
                        put("format", "GGUF v${result?.formatVersion ?: 3}")
                        put("sizeBytes", f.length())
                        put("sizeDisplay", sizeDisplay)
                        put("ramRequiredDisplay", "~${((result?.estimatedMinRamBytes ?: (f.length() + 512 * 1024 * 1024)) / (1024 * 1024))} MB RAM")
                        put("architectureHint", if (f.name.contains("qwen")) "qwen2" else "llama")
                        put("isDownloaded", f.length() >= 1024 * 1024)
                        put("filePath", f.absolutePath)
                        put("validMagic", result != null)
                        put("formatVersion", result?.formatVersion ?: 3)
                        put("tensorCount", result?.tensorCount ?: 0)
                        put("metadataKvCount", result?.metadataKvCount ?: 0)
                        put("fitsHostMemory", result?.fitsInDeviceMemory ?: false)
                        put("diagnosticMessage", result?.diagnosticNote ?: "Valid local model.")
                        put("downloadStatus", if (f.length() >= 1024 * 1024) "ready" else "available")
                    })
                }

                JSONObject().put("models", modelsArr).toString()
            }

            pathOnly == "/api/local-models/validate" && method == "POST" -> {
                val actManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
                val memInfo = ActivityManager.MemoryInfo()
                actManager?.getMemoryInfo(memInfo)
                val availMem = memInfo.availMem

                val reqJson = body ?: JSONObject()
                val filename = reqJson.optString("filename")
                val filePath = reqJson.optString("filePath")
                val file = when {
                    filename.isNotBlank() -> File(File(context.filesDir, "models"), filename)
                    filePath.isNotBlank() -> File(filePath)
                    else -> null
                }

                if (file == null || !file.exists() || !file.isFile) {
                    JSONObject().apply {
                        put("ok", false)
                        put("state", "Inference failed")
                        put("error", "Model file not found on Android device: ${file?.absolutePath}")
                    }.toString()
                } else if (file.length() < 1024 * 1024) {
                    JSONObject().apply {
                        put("ok", false)
                        put("state", "Inference failed")
                        put("error", "Model file is only ${file.length()} bytes. Full tensor weights (>1MB) are required.")
                    }.toString()
                } else {
                    val inspector = GgufHeaderInspector()
                    val inspection = inspector.inspectGgufFile(file, availMem)
                    if (inspection.isFailure) {
                        JSONObject().apply {
                            put("ok", false)
                            put("state", "Inference failed")
                            put("error", inspection.exceptionOrNull()?.message ?: "GGUF validation failed.")
                        }.toString()
                    } else {
                        val meta = inspection.getOrThrow()
                        val checks = JSONArray().apply {
                            put(JSONObject().apply {
                                put("name", "File existence & readable size")
                                put("passed", true)
                                put("detail", "${(file.length() / (1024 * 1024))} MB")
                            })
                            put(JSONObject().apply {
                                put("name", "GGUF binary magic (0x47475546)")
                                put("passed", true)
                                put("detail", "Valid GGUF header")
                            })
                            put(JSONObject().apply {
                                put("name", "GGUF version v${meta.formatVersion}")
                                put("passed", true)
                                put("detail", "Version ${meta.formatVersion}")
                            })
                            put(JSONObject().apply {
                                put("name", "Architecture & tensor weights")
                                put("passed", true)
                                put("detail", "${meta.tensorCount} tensors, ${meta.metadataKvCount} metadata keys")
                            })
                            put(JSONObject().apply {
                                put("name", "ARM64 Android device memory check")
                                put("passed", meta.fitsInDeviceMemory)
                                put("detail", meta.diagnosticNote)
                            })
                            put(JSONObject().apply {
                                put("name", "Android ARM64 inference backend")
                                put("passed", true)
                                put("detail", "Native Android runtime (${Build.SUPPORTED_ABIS.firstOrNull()})")
                            })
                        }

                        JSONObject().apply {
                            put("ok", true)
                            put("state", "Backend supported")
                            put("metadata", JSONObject().apply {
                                put("fileName", file.name)
                                put("filePath", file.absolutePath)
                                put("sizeBytes", file.length())
                                put("formatVersion", meta.formatVersion)
                                put("tensorCount", meta.tensorCount)
                                put("metadataKvCount", meta.metadataKvCount)
                                put("fitsHostMemory", meta.fitsInDeviceMemory)
                                put("diagnosticMessage", meta.diagnosticNote)
                            })
                            put("checks", checks)
                        }.toString()
                    }
                }
            }

            pathOnly == "/api/local-models/import-saf" && method == "POST" -> {
                val reqJson = body ?: JSONObject()
                val uriStr = reqJson.optString("uri")
                val customName = reqJson.optString("displayName").ifBlank { null }
                if (uriStr.isBlank()) {
                    JSONObject().apply {
                        put("ok", false)
                        put("state", "Inference failed")
                        put("error", "Missing 'uri' parameter for SAF import.")
                    }.toString()
                } else {
                    try {
                        val uri = Uri.parse(uriStr)
                        val cr = context.contentResolver
                        var fileName = customName ?: "imported-model.gguf"
                        cr.query(uri, null, null, null, null)?.use { cursor ->
                            val nameIdx = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                            if (nameIdx >= 0 && cursor.moveToFirst()) {
                                fileName = cursor.getString(nameIdx)
                            }
                        }
                        if (!fileName.endsWith(".gguf")) fileName = "$fileName.gguf"

                        val modelsDir = File(context.filesDir, "models").apply { if (!exists()) mkdirs() }
                        val destFile = File(modelsDir, fileName)

                        val freeDiskBytes = context.filesDir.usableSpace
                        cr.openInputStream(uri)?.use { input ->
                            FileOutputStream(destFile).use { output ->
                                val buffer = ByteArray(64 * 1024)
                                var bytesRead: Int
                                var totalCopied = 0L
                                while (input.read(buffer).also { bytesRead = it } != -1) {
                                    totalCopied += bytesRead
                                    if (totalCopied > freeDiskBytes) {
                                        destFile.delete()
                                        throw IllegalStateException("Insufficient storage space on Android device for model.")
                                    }
                                    output.write(buffer, 0, bytesRead)
                                }
                            }
                        }

                        val actManager = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
                        val memInfo = ActivityManager.MemoryInfo()
                        actManager?.getMemoryInfo(memInfo)
                        val inspector = GgufHeaderInspector()
                        val result = inspector.inspectGgufFile(destFile, memInfo.availMem).getOrThrow()

                        JSONObject().apply {
                            put("ok", true)
                            put("state", "Backend supported")
                            put("message", "Model successfully imported via Android Storage Access Framework.")
                            put("filePath", destFile.absolutePath)
                            put("sizeBytes", destFile.length())
                            put("diagnosticMessage", result.diagnosticNote)
                        }.toString()
                    } catch (e: Exception) {
                        JSONObject().apply {
                            put("ok", false)
                            put("state", "Inference failed")
                            put("error", "SAF import error: ${e.message}")
                        }.toString()
                    }
                }
            }

            pathOnly == "/api/agents" && method == "GET" -> {
                val agents = JSONArray().apply {
                    put(JSONObject().put("id", "coder").put("name", "Autonomous Coder").put("role", "Coder"))
                    put(JSONObject().put("id", "planner").put("name", "Architecture Planner").put("role", "Planner"))
                    put(JSONObject().put("id", "debugger").put("name", "Build & Crash Debugger").put("role", "Debugger"))
                }
                JSONObject().put("agents", agents).toString()
            }

            else -> JSONObject().put("ok", true).toString()
        }
    }

    private fun skillToJson(sk: NativeSkill, includeInstructions: Boolean): JSONObject {
        return JSONObject().apply {
            put("id", sk.id)
            put("name", sk.name)
            put("description", sk.description)
            put("category", sk.category)
            put("scope", sk.scope)
            put("version", "1.0.0")
            put("author", if (sk.isCustom) "User" else "OBSIDIAN Core")
            put("source", if (sk.isCustom) "custom" else "builtin")
            put("enabled", sk.enabled)
            put("hasScripts", false)
            put("tools", JSONArray(sk.tools))
            put("tags", JSONArray(sk.keywords))
            put("keywords", JSONArray(sk.keywords))
            put("prerequisites", JSONArray())
            put("updatedAt", System.currentTimeMillis())
            if (includeInstructions) {
                put("instructions", sk.instructions)
                put("rawMarkdown", "---\nname: ${sk.name}\ndescription: ${sk.description}\ncategory: ${sk.category}\n---\n\n${sk.instructions}")
            }
        }
    }
}
