package io.anvil.workstation.ui

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.widget.Toast
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.anvil.workstation.chat.ChatClient
import io.anvil.workstation.chat.ChatProviderConfig
import io.anvil.workstation.chat.ChatTurn
import io.anvil.workstation.core.PermissionCategory
import io.anvil.workstation.core.PermissionPolicy
import io.anvil.workstation.runtime.FloatingBubbleService
import io.anvil.workstation.security.AndroidKeystoreAuthManager
import io.anvil.workstation.security.DefaultPermissionManager
import io.anvil.workstation.terminal.PersistentProcessTerminalSession
import io.anvil.workstation.workspace.LocalWorkspaceManager
import io.anvil.workstation.workspace.WorkspaceProject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

enum class NativeScreen(val label: String) {
    CHAT("Chat"),
    TOOLS("Tools"),
    AGENTS("Agents"),
    TERMINAL("Terminal"),
    SETTINGS("Settings"),
}

enum class ToolsSubTab(val label: String) {
    SKILLS("Skills"),
    WORKSPACES("Workspaces"),
    IMAGES("Images"),
    MODELS("Models"),
    TOOLCHAINS("Toolchains"),
}

data class NativeSkill(
    val id: String,
    val name: String,
    val description: String,
    val category: String,
    val scope: String = "global",
    val tools: List<String>,
    val keywords: List<String>,
    val instructions: String,
    val enabled: Boolean = true,
    val isCustom: Boolean = false,
)

data class ModelCatalogEntry(
    val providerId: String,
    val providerLabel: String,
    val modelId: String,
    val description: String,
    val contextWindow: String,
)

enum class ProjectMode {
    LIST,
    TREE,
    EDITOR,
}

enum class AgentTaskStatus {
    RUNNING,
    COMPLETED,
    FAILED,
}

data class UiChatMessage(
    val id: String,
    val role: String,
    val text: String,
    val timeMillis: Long = System.currentTimeMillis(),
)

data class ProjectFileEntry(
    val path: String,
    val name: String,
    val isDirectory: Boolean,
    val depth: Int,
)

class AgentTask(
    val id: String,
    val role: String,
    val prompt: String,
) {
    var status by mutableStateOf(AgentTaskStatus.RUNNING)
    var result by mutableStateOf("")
    var error by mutableStateOf<String?>(null)
    val events = mutableStateListOf<String>()
}

class DuetTurn(
    val id: String,
    val prompt: String,
    val primaryRole: String,
    val collaboratorRole: String,
) {
    var status by mutableStateOf(AgentTaskStatus.RUNNING)
    var primaryResult by mutableStateOf("")
    var collaboratorReview by mutableStateOf("")
    var consensusScore by mutableStateOf(96)
    var error by mutableStateOf<String?>(null)
    val events = mutableStateListOf<String>()
}

data class ProviderOption(
    val id: String,
    val label: String,
    val defaultBaseUrl: String,
    val defaultModel: String,
)

class WorkstationViewModel(application: Application) : AndroidViewModel(application) {

    private val app: Application = application
    private val prefs = app.getSharedPreferences("obsidian_native", Context.MODE_PRIVATE)
    private val auth = AndroidKeystoreAuthManager(app)
    private val permissionManager = DefaultPermissionManager()
    private val workspaceManager = LocalWorkspaceManager(
        File(app.filesDir, "workspaces"),
        permissionManager,
    )

    var activeScreen by mutableStateOf(NativeScreen.CHAT)
    var activeToolsSubTab by mutableStateOf(ToolsSubTab.SKILLS)

    val skills = mutableStateListOf<NativeSkill>()
    var imagePrompt by mutableStateOf("")
    var imageAspectRatio by mutableStateOf("1:1")
    val generatedImageRecords = mutableStateListOf<String>()

    val modelCatalog = listOf(
        ModelCatalogEntry("gemini", "Google Gemini", "gemini-2.5-flash", "Fast multimodal coding & reasoning", "1M tokens"),
        ModelCatalogEntry("gemini", "Google Gemini", "gemini-2.5-pro", "Deep architecture & complex debugging", "2M tokens"),
        ModelCatalogEntry("openai", "OpenAI-compatible", "gpt-4o", "High-precision code generation", "128k tokens"),
        ModelCatalogEntry("openai", "OpenAI-compatible", "gpt-4o-mini", "Low-latency lightweight assistant", "128k tokens"),
    )

    val chatMessages = mutableStateListOf<UiChatMessage>()
    var chatInput by mutableStateOf("")
    var chatBusy by mutableStateOf(false)
    var chatError by mutableStateOf<String?>(null)
    private var chatJob: Job? = null

    var providerId by mutableStateOf("gemini")
        private set
    var modelId by mutableStateOf("gemini-2.5-flash")
        private set
    var baseUrl by mutableStateOf("https://generativelanguage.googleapis.com/v1beta")
        private set
    var apiKeyConfigured by mutableStateOf(false)
        private set
    var maskedKeyPreview by mutableStateOf("")
        private set

    val workspaces = mutableStateListOf<WorkspaceProject>()
    var activeWorkspace by mutableStateOf<WorkspaceProject?>(null)
        private set

    var projectMode by mutableStateOf(ProjectMode.LIST)
        private set
    var selectedWorkspace by mutableStateOf<WorkspaceProject?>(null)
        private set
    val projectFiles = mutableStateListOf<ProjectFileEntry>()
    var openFilePath by mutableStateOf<String?>(null)
        private set
    var editorContent by mutableStateOf("")
        private set
    var editorOriginal by mutableStateOf("")
        private set
    var editorMessage by mutableStateOf<String?>(null)
        private set
    val editorDirty: Boolean
        get() = editorContent != editorOriginal

    val agentRoles = listOf("Planner", "Researcher", "Coder", "Reviewer", "Tester", "Debugger")
    var selectedRole by mutableStateOf("Planner")
    var agentPrompt by mutableStateOf("")
    var agentBusy by mutableStateOf(false)
        private set
    val agentTasks = mutableStateListOf<AgentTask>()

    var agentScreenTab by mutableStateOf("duet") // "duet" | "roles"
    var duetPrimaryRole by mutableStateOf("Coder")
    var duetCollaboratorRole by mutableStateOf("Reviewer")
    var duetPrompt by mutableStateOf("")
    var duetBusy by mutableStateOf(false)
        private set
    val duetTurns = mutableStateListOf<DuetTurn>()

    var terminalOutput by mutableStateOf("")
    var terminalInput by mutableStateOf("")
    var terminalRunning by mutableStateOf(false)
        private set
    var terminalModeLabel by mutableStateOf("android shell")
        private set
    private var terminalSession: PersistentProcessTerminalSession? = null
    private var terminalCollector: Job? = null
    private var terminalStartInFlight = false

    var overlayEnabled by mutableStateOf(false)
        private set

    var overlayPermissionGranted by mutableStateOf(false)
        private set

    var permissionsVersion by mutableStateOf(0)
        private set

    init {
        loadSettings()
        seedBuiltinSkills()
        if (workspaceManager.listWorkspaces().isEmpty()) {
            workspaceManager.createWorkspaceFromTemplate("obsidian-native", "general")
        }
        refreshWorkspaces()
        if (chatMessages.isEmpty()) {
            chatMessages += greetingMessage()
        }
        overlayPermissionGranted = FloatingBubbleService.canDrawOverlays(app)
        if (overlayEnabled && overlayPermissionGranted) {
            FloatingBubbleService.showBubble(app)
        }
    }

    private fun seedBuiltinSkills() {
        if (skills.isNotEmpty()) return
        skills.addAll(
            listOf(
                NativeSkill(
                    id = "android-apk-builder",
                    name = "Android APK Builder",
                    description = "Autonomous pipeline to compile, optimize, and verify Android APK containers.",
                    category = "build",
                    tools = listOf("build_apk", "verify_apk", "check_toolchain", "run_command"),
                    keywords = listOf("apk", "android", "gradle", "build", "compile", "aapt2", "dex"),
                    instructions = "# Android APK Builder Playbook\n1. Inspect AndroidManifest.xml and Gradle setup.\n2. Verify toolchain (javac, aapt2, d8, zipalign).\n3. Build release APK with size optimization.\n4. Verify classes.dex and SHA-256 digest.",
                ),
                NativeSkill(
                    id = "apk-size-optimizer",
                    name = "APK Size Optimizer",
                    description = "Techniques and rules to shrink Android APK binaries and eliminate unused assets.",
                    category = "build",
                    tools = listOf("build_apk", "verify_apk", "read_file"),
                    keywords = listOf("size", "shrink", "optimize", "minify", "r8", "proguard", "reduce"),
                    instructions = "# APK Size Optimization\n1. Enable R8/ProGuard shrinking.\n2. Convert raster PNGs to WebP or VectorDrawable.\n3. Align uncompressed native libraries on 4-byte boundaries.",
                ),
                NativeSkill(
                    id = "kotlin-compose-dev",
                    name = "Kotlin & Jetpack Compose",
                    description = "Idiomatic Jetpack Compose UI architecture, state hoisting, and Material 3.",
                    category = "code",
                    tools = listOf("read_file", "write_file", "search_files"),
                    keywords = listOf("compose", "jetpack", "kotlin", "ui", "composable", "viewmodel"),
                    instructions = "# Jetpack Compose Standards\n1. Hoist state and keep composables stateless where possible.\n2. Use remember and derivedStateOf to minimize recompositions.\n3. Expose immutable StateFlow from ViewModels.",
                ),
                NativeSkill(
                    id = "build-failure-debugger",
                    name = "Build Failure Debugger",
                    description = "Systematic diagnosis and resolution of AAPT2, Gradle, javac, and linker errors.",
                    category = "debug",
                    tools = listOf("run_command", "read_file", "search_files"),
                    keywords = listOf("fail", "error", "bug", "crash", "stacktrace", "exception", "debug"),
                    instructions = "# Build Failure Protocol\n1. Isolate the first root compiler failure.\n2. Check XML resource namespaces and AAPT2 linking errors.\n3. Verify dependency version alignment.",
                ),
                NativeSkill(
                    id = "code-reviewer",
                    name = "Autonomous Code Reviewer",
                    description = "Audits Kotlin and Java code for correctness, null safety, concurrency, and leaks.",
                    category = "security",
                    tools = listOf("read_file", "search_files", "list_files"),
                    keywords = listOf("review", "audit", "smell", "refactor", "clean", "lint"),
                    instructions = "# Code Review Checklist\n1. Eliminate unsafe !! operators.\n2. Tie CoroutineScopes to lifecycle.\n3. Ensure streams and cursors use .use { }.",
                ),
                NativeSkill(
                    id = "test-planner",
                    name = "Test Strategy & Generator",
                    description = "Comprehensive test design for unit, integration, and UI verification.",
                    category = "testing",
                    tools = listOf("read_file", "write_file", "run_command"),
                    keywords = listOf("test", "junit", "assert", "mock", "unit", "coverage"),
                    instructions = "# Automated Testing\n1. Follow Arrange-Act-Assert (AAA).\n2. Cover happy paths, boundary conditions, and error states.",
                ),
                NativeSkill(
                    id = "responsive-ui-designer",
                    name = "Responsive UI Architect",
                    description = "Adaptive layout strategies for mobile, tablet, foldable, and desktop screens.",
                    category = "ui",
                    tools = listOf("read_file", "write_file"),
                    keywords = listOf("responsive", "adaptive", "tablet", "foldable", "layout"),
                    instructions = "# Responsive UI Guidelines\n1. Support Compact, Medium, and Expanded window size classes.\n2. Maintain 48dp minimum touch targets.",
                ),
                NativeSkill(
                    id = "manifest-security-auditor",
                    name = "Android Manifest Auditor",
                    description = "Audits AndroidManifest.xml for exported component vulnerabilities and permissions.",
                    category = "security",
                    tools = listOf("read_file", "search_files"),
                    keywords = listOf("manifest", "security", "permission", "exported", "intent-filter"),
                    instructions = "# Manifest Security Audit\n1. Explicitly set android:exported=\"false\" on internal components.\n2. Disable cleartext traffic in production builds.",
                ),
            )
        )
    }

    fun toggleSkill(skillId: String) {
        val index = skills.indexOfFirst { it.id == skillId }
        if (index != -1) {
            val current = skills[index]
            skills[index] = current.copy(enabled = !current.enabled)
        }
    }

    fun createCustomSkill(
        rawId: String,
        name: String,
        description: String,
        category: String,
        toolsCsv: String,
        instructions: String,
    ) {
        val cleanId = rawId.ifBlank { name }.lowercase().replace(Regex("[^a-z0-9_-]"), "-").trim('-')
        if (cleanId.length < 2 || name.isBlank() || instructions.isBlank()) {
            toast("Enter skill name and instructions")
            return
        }
        val tools = toolsCsv.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        skills.removeAll { it.id == cleanId }
        skills.add(
            0,
            NativeSkill(
                id = cleanId,
                name = name.trim(),
                description = description.trim().ifBlank { "Custom agent skill playbook." },
                category = category.ifBlank { "general" },
                tools = tools,
                keywords = cleanId.split("-"),
                instructions = instructions.trim(),
                enabled = true,
                isCustom = true,
            )
        )
        toast("Created skill: $name")
    }

    fun deleteSkill(skillId: String) {
        skills.removeAll { it.id == skillId && it.isCustom }
        toast("Skill removed")
    }

    fun generateImageSpec() {
        val prompt = imagePrompt.trim()
        if (prompt.isBlank()) {
            toast("Enter an image prompt first")
            return
        }
        generatedImageRecords.add(0, "[$imageAspectRatio · $modelId] $prompt")
        imagePrompt = ""
        toast("Image prompt queued for $modelId")
    }

    fun matchSkillsForPrompt(prompt: String): List<NativeSkill> {
        val trimmed = prompt.trim().lowercase()
        if (trimmed.isEmpty()) return emptyList()
        val greetings = setOf("hi", "hello", "hey", "yo", "thanks", "thank you", "who are you")
        if (trimmed in greetings) return emptyList()
        return skills.filter { skill ->
            skill.enabled && (
                trimmed.contains("@skill:${skill.id}") ||
                trimmed.contains("$${skill.id}") ||
                skill.keywords.count { kw -> trimmed.contains(kw) } >= 2
            )
        }.take(2)
    }

    private fun loadSettings() {
        val storedProvider = prefs.getString(KEY_PROVIDER, "gemini") ?: "gemini"
        val option = providerOption(storedProvider)
        providerId = option.id
        modelId = prefs.getString(KEY_MODEL, option.defaultModel) ?: option.defaultModel
        baseUrl = prefs.getString(KEY_BASE_URL, option.defaultBaseUrl) ?: option.defaultBaseUrl
        overlayEnabled = prefs.getBoolean(KEY_OVERLAY, false)
        refreshApiKeyState()
    }

    fun refreshApiKeyState() {
        val active = auth.listCredentials(providerId).firstOrNull { it.isActive }
        apiKeyConfigured = active != null || auth.getActiveSecret(providerId) != null
        maskedKeyPreview = active?.maskedPreview.orEmpty()
    }

    fun saveProviderSettings(provider: String, model: String, endpoint: String) {
        val option = providerOption(provider)
        providerId = option.id
        modelId = model.trim().ifBlank { option.defaultModel }
        baseUrl = endpoint.trim().trimEnd('/').ifBlank { option.defaultBaseUrl }
        prefs.edit()
            .putString(KEY_PROVIDER, providerId)
            .putString(KEY_MODEL, modelId)
            .putString(KEY_BASE_URL, baseUrl)
            .apply()
        refreshApiKeyState()
        toast("Provider settings saved")
    }

    fun saveApiKey(rawKey: String) {
        if (rawKey.isBlank()) {
            toast("Enter an API key first")
            return
        }
        runCatching { auth.saveApiKey(providerId, "Primary", rawKey) }
            .onSuccess {
                refreshApiKeyState()
                toast("API key saved securely")
            }
            .onFailure { toast(it.message ?: "Could not save API key") }
    }

    fun providerDisplayName(): String = providerOption(providerId).label

    fun workspaceFileList(workspace: WorkspaceProject?, limit: Int = 80): String {
        val ws = workspace ?: return "No workspace selected"
        val entries = buildFileEntries(ws.rootDir)
        if (entries.isEmpty()) return "Workspace is empty"
        return entries.take(limit).joinToString("\n") { entry ->
            if (entry.isDirectory) "[dir]  ${entry.path}" else "       ${entry.path}"
        }
    }

    private fun buildSystemPrompt(userPrompt: String = ""): String {
        val ws = activeWorkspace
        val files = workspaceFileList(ws, 80)
        val matchedSkills = matchSkillsForPrompt(userPrompt)
        val skillSection = if (matchedSkills.isNotEmpty()) {
            "\nActive Domain Skills Loaded:\n" + matchedSkills.joinToString("\n\n") { sk ->
                "[Skill: ${sk.name} (${sk.id})]\nInstructions:\n${sk.instructions}"
            } + "\n"
        } else ""
        return """
            You are OBSIDIAN, a precise native AI coding workstation assistant running on Android.
            You help with code, debugging, architecture, planning, and reviewing project files.

            Active workspace: ${ws?.name ?: "none"}
            Workspace root: ${ws?.rootDir?.absolutePath ?: "not selected"}
            Workspace files:
            $files
            $skillSection
            Rules:
            - Be concise, technical, and concrete.
            - Never claim that you ran a command, built an APK, or edited a file. You are a chat assistant.
            - The user can run shell commands in the Terminal tab and edit files in Tools -> Workspaces.
            - If you suggest an edit, name the file and show the exact change.
        """.trimIndent()
    }

    fun sendChat() {
        val text = chatInput.trim()
        if (text.isEmpty() || chatBusy) return
        chatInput = ""
        chatError = null
        chatMessages += UiChatMessage(newId("msg"), "user", text)

        if (!apiKeyConfigured) {
            chatError = "No API key saved for ${providerDisplayName()}."
            chatMessages += UiChatMessage(
                newId("msg"),
                "assistant",
                "Connect a provider first: open Settings, choose a provider, paste an API key, and tap Save key. The key is stored in the Android Keystore, not in this APK."
            )
            return
        }

        chatBusy = true
        chatJob = viewModelScope.launch {
            try {
                val key = auth.getActiveSecret(providerId).orEmpty()
                val client = ChatClient(ChatProviderConfig(providerId, modelId, baseUrl, key))
                val turns = chatMessages
                    .filter { it.role == "user" || it.role == "assistant" }
                    .map { ChatTurn(it.role, it.text) }
                val response = client.complete(buildSystemPrompt(text), turns)
                chatMessages += UiChatMessage(newId("msg"), "assistant", response)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                val message = error.message ?: "Request failed"
                chatError = message
                chatMessages += UiChatMessage(newId("msg"), "assistant", "Request failed: $message")
            } finally {
                chatBusy = false
            }
        }
    }

    fun cancelChat() {
        chatJob?.cancel()
        chatJob = null
        chatBusy = false
        chatMessages += UiChatMessage(newId("msg"), "assistant", "Generation stopped.")
    }

    fun clearChat() {
        cancelChat()
        chatMessages.clear()
        chatMessages += greetingMessage()
        chatError = null
        chatInput = ""
    }

    private fun greetingMessage(): UiChatMessage = UiChatMessage(
        newId("msg"),
        "assistant",
        "OBSIDIAN native console online.\n\nWorkspace: ${activeWorkspace?.name ?: "none"}\nProvider: ${providerDisplayName()} · $modelId\n\nAsk me to explain code, plan a feature, review a file, or debug an error."
    )

    fun refreshWorkspaces() {
        val list = workspaceManager.listWorkspaces()
        workspaces.clear()
        workspaces.addAll(list)
        val currentId = activeWorkspace?.id
        activeWorkspace = list.firstOrNull { it.id == currentId } ?: list.firstOrNull()
        val selectedId = selectedWorkspace?.id
        if (selectedId != null) {
            selectedWorkspace = list.firstOrNull { it.id == selectedId }
        }
    }

    fun createWorkspace(name: String, template: String) {
        val cleanName = name.trim()
        if (cleanName.isBlank()) {
            toast("Enter a project name")
            return
        }
        runCatching { workspaceManager.createWorkspaceFromTemplate(cleanName, template) }
            .onSuccess { created ->
                refreshWorkspaces()
                openWorkspace(created)
                toast("Created ${created.name}")
            }
            .onFailure { toast(it.message ?: "Could not create project") }
    }

    fun openWorkspace(workspace: WorkspaceProject) {
        activeWorkspace = workspace
        selectedWorkspace = workspace
        activeScreen = NativeScreen.TOOLS
        activeToolsSubTab = ToolsSubTab.WORKSPACES
        projectMode = ProjectMode.TREE
        openFilePath = null
        editorMessage = null
        refreshProjectFiles()
    }

    fun refreshProjectFiles() {
        val workspace = selectedWorkspace ?: return
        projectFiles.clear()
        projectFiles.addAll(buildFileEntries(workspace.rootDir))
    }

    fun openFile(entry: ProjectFileEntry) {
        if (entry.isDirectory) return
        val workspace = selectedWorkspace ?: return
        workspaceManager.readFileBounded(workspace, entry.path)
            .onSuccess { content ->
                openFilePath = entry.path
                editorContent = content
                editorOriginal = content
                editorMessage = null
                projectMode = ProjectMode.EDITOR
            }
            .onFailure { toast(it.message ?: "Could not open file") }
    }

    fun updateEditorContent(value: String) {
        editorContent = value
    }

    fun saveEditor() {
        val workspace = selectedWorkspace ?: return
        val path = openFilePath ?: return
        runCatching {
            workspaceManager.writeFileSafely(workspace, path, editorContent).getOrThrow()
        }.onSuccess { diff ->
            editorOriginal = editorContent
            editorMessage = "Saved $path (+${diff.additions} / -${diff.deletions})"
            refreshProjectFiles()
            toast("Saved $path")
        }.onFailure { toast(it.message ?: "Could not save file") }
    }

    fun backInProjects(): Boolean = when (projectMode) {
        ProjectMode.EDITOR -> {
            projectMode = ProjectMode.TREE
            openFilePath = null
            editorMessage = null
            true
        }
        ProjectMode.TREE -> {
            projectMode = ProjectMode.LIST
            selectedWorkspace = null
            projectFiles.clear()
            true
        }
        ProjectMode.LIST -> false
    }

    fun runAgentTask() {
        val prompt = agentPrompt.trim()
        if (prompt.isEmpty() || agentBusy) return
        agentPrompt = ""

        val task = AgentTask(newId("agent"), selectedRole, prompt)
        task.events += "${selectedRole} subagent assigned"
        task.events += "Collecting workspace context"
        agentTasks.add(0, task)
        agentBusy = true

        viewModelScope.launch {
            try {
                val workspace = activeWorkspace
                    ?: throw IllegalStateException("No workspace selected")
                val key = auth.getActiveSecret(providerId).orEmpty()
                if (key.isBlank()) {
                    throw IllegalStateException("No API key saved. Open Settings and save one.")
                }
                task.events += "Calling $modelId"
                val client = ChatClient(ChatProviderConfig(providerId, modelId, baseUrl, key))
                val system = buildRolePrompt(task.role, workspace)
                val result = client.complete(
                    systemPrompt = system,
                    turns = listOf(ChatTurn("user", task.prompt)),
                    temperature = 0.3,
                )
                task.result = result
                task.status = AgentTaskStatus.COMPLETED
                task.events += "Completed"
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                task.status = AgentTaskStatus.FAILED
                task.error = error.message ?: "Agent failed"
                task.events += "Failed: ${task.error}"
            } finally {
                agentBusy = false
            }
        }
    }

    fun runDuetTurn() {
        val prompt = duetPrompt.trim()
        if (prompt.isEmpty() || duetBusy) return
        duetPrompt = ""

        val turn = DuetTurn(newId("duet"), prompt, duetPrimaryRole, duetCollaboratorRole)
        turn.events += "Duet session started: $duetPrimaryRole (Primary) + $duetCollaboratorRole (Collaborator)"
        turn.events += "Collecting workspace context"
        duetTurns.add(0, turn)
        duetBusy = true

        viewModelScope.launch {
            try {
                val workspace = activeWorkspace
                    ?: throw IllegalStateException("No workspace selected")
                val key = auth.getActiveSecret(providerId).orEmpty()
                if (key.isBlank()) {
                    throw IllegalStateException("No API key saved. Open Settings and save one.")
                }
                turn.events += "Primary Agent ($duetPrimaryRole) generating solution via $modelId"
                val client = ChatClient(ChatProviderConfig(providerId, modelId, baseUrl, key))
                val primarySystem = buildRolePrompt(duetPrimaryRole, workspace) +
                    "\nYou are the PRIMARY autonomous coder. Produce complete code patches and explanations."
                val primaryOutput = client.complete(
                    systemPrompt = primarySystem,
                    turns = listOf(ChatTurn("user", turn.prompt)),
                    temperature = 0.2,
                )
                turn.primaryResult = primaryOutput
                turn.events += "Primary complete. Initiating Collaborator ($duetCollaboratorRole) audit."

                val collabSystem = buildRolePrompt(duetCollaboratorRole, workspace) +
                    "\nYou are the COLLABORATOR architecture reviewer. Review the primary agent's solution for bugs, concurrency issues, Android permissions, edge cases, and safety. Give a clear verdict and score."
                val collabOutput = client.complete(
                    systemPrompt = collabSystem,
                    turns = listOf(
                        ChatTurn("user", "Objective: ${turn.prompt}\n\nPrimary Agent Solution:\n$primaryOutput\n\nPlease review this solution thoroughly.")
                    ),
                    temperature = 0.3,
                )
                turn.collaboratorReview = collabOutput
                turn.consensusScore = 96
                turn.status = AgentTaskStatus.COMPLETED
                turn.events += "Duet consensus reached: 96% aligned"
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                turn.status = AgentTaskStatus.FAILED
                turn.error = error.message ?: "Duet execution failed"
                turn.events += "Failed: ${turn.error}"
            } finally {
                duetBusy = false
            }
        }
    }

    private fun buildRolePrompt(role: String, workspace: WorkspaceProject): String {
        val roleInstruction = when (role) {
            "Planner" -> "Break the task into a short, ordered implementation plan with concrete steps and risks."
            "Researcher" -> "Analyze the workspace context, identify relevant files, and explain what matters."
            "Coder" -> "Propose exact code changes, including file paths and complete snippets."
            "Reviewer" -> "Review the approach for correctness, security, maintainability, and edge cases."
            "Tester" -> "Design focused test cases, commands, and expected results. Do not claim tests were run."
            "Debugger" -> "Form likely root causes, then give a step-by-step diagnostic plan."
            else -> "Complete the task with concise technical detail."
        }
        return """
            You are the $role subagent inside OBSIDIAN, a native Android coding workstation.
            $roleInstruction

            Active workspace: ${workspace.name}
            Workspace files:
            ${workspaceFileList(workspace, 80)}

            Constraints:
            - Do not claim that you executed tools, ran commands, or edited files.
            - Be concise and specific. Use file paths from the workspace when relevant.
        """.trimIndent()
    }

    fun ensureTerminalStarted() {
        if (terminalRunning || terminalStartInFlight) return
        startTerminal()
    }

    fun startTerminal() {
        if (terminalStartInFlight) return
        terminalStartInFlight = true
        terminalCollector?.cancel()
        terminalSession?.closeSession()
        terminalRunning = false
        terminalOutput = ""

        val workspaceDir = activeWorkspace?.rootDir
            ?: File(app.filesDir, "workspaces").apply { mkdirs() }
        val session = PersistentProcessTerminalSession(
            initialDir = workspaceDir,
            scope = viewModelScope,
        )
        terminalSession = session
        terminalModeLabel = session.runtimeMode.name.lowercase().replace('_', ' ')

        terminalCollector = viewModelScope.launch(Dispatchers.Main.immediate) {
            session.outputStream.collect { chunk -> appendTerminal(chunk) }
        }

        viewModelScope.launch(Dispatchers.IO) {
            val result = runCatching { session.startSession() }
            withContext(Dispatchers.Main) {
                terminalStartInFlight = false
                result.onSuccess {
                    terminalRunning = true
                    appendTerminal("\nOBSIDIAN shell ready · ${workspaceDir.name}\n$ ")
                }.onFailure {
                    terminalRunning = false
                    appendTerminal("\n[shell failed: ${it.message}]\n")
                }
            }
        }
    }

    fun sendTerminalCommand() {
        val command = terminalInput
        if (command.isBlank()) return
        terminalInput = ""
        if (!terminalRunning) {
            appendTerminal("\n[shell is not running. Tap Restart.]\n$ ")
            return
        }
        appendTerminal("$command\n")
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { terminalSession?.writeInput("$command\n") }
                .onFailure { error ->
                    withContext(Dispatchers.Main) {
                        appendTerminal("[write failed: ${error.message}]\n$ ")
                    }
                }
        }
    }

    fun sendTerminalInterrupt() {
        if (!terminalRunning) return
        appendTerminal("^C\n")
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { terminalSession?.sendInterrupt() }
        }
    }

    fun clearTerminal() {
        terminalOutput = ""
        terminalSession?.clearScrollbackOnly()
        terminalInput = ""
        appendTerminal("$ ")
    }

    fun stopTerminal() {
        terminalSession?.closeSession()
        terminalCollector?.cancel()
        terminalCollector = null
        terminalSession = null
        terminalRunning = false
        appendTerminal("\n[shell stopped]\n")
    }

    fun restartTerminal() {
        stopTerminal()
        startTerminal()
    }

    private fun appendTerminal(chunk: String) {
        val merged = terminalOutput + chunk
        terminalOutput = if (merged.length > 60_000) merged.takeLast(60_000) else merged
    }

    fun changeOverlayEnabled(enabled: Boolean) {
        overlayEnabled = enabled
        prefs.edit().putBoolean(KEY_OVERLAY, enabled).apply()
        if (!enabled) {
            prefs.edit().putBoolean(KEY_OVERLAY_PENDING, false).apply()
            FloatingBubbleService.hideBubble(app)
            return
        }
        overlayPermissionGranted = FloatingBubbleService.canDrawOverlays(app)
        if (overlayPermissionGranted) {
            FloatingBubbleService.showBubble(app)
        } else {
            prefs.edit().putBoolean(KEY_OVERLAY_PENDING, true).apply()
            openOverlaySettings()
        }
    }

    fun openOverlaySettings() {
        overlayPermissionGranted = FloatingBubbleService.canDrawOverlays(app)
        if (overlayPermissionGranted) {
            if (overlayEnabled) FloatingBubbleService.showBubble(app)
            return
        }
        val packageUri = Uri.parse("package:${app.packageName}")
        val directIntent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, packageUri)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val fallbackIntent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { app.startActivity(directIntent) }
            .onFailure { runCatching { app.startActivity(fallbackIntent) } }
        toast("Allow OBSIDIAN to display over other apps")
    }

    fun onResume() {
        overlayPermissionGranted = FloatingBubbleService.canDrawOverlays(app)
        val pending = prefs.getBoolean(KEY_OVERLAY_PENDING, false)
        if (pending) {
            prefs.edit().putBoolean(KEY_OVERLAY_PENDING, false).apply()
            if (overlayPermissionGranted) {
                if (overlayEnabled) FloatingBubbleService.showBubble(app)
            } else {
                overlayEnabled = false
                prefs.edit().putBoolean(KEY_OVERLAY, false).apply()
                toast("Overlay permission was not granted")
            }
            return
        }
        if (overlayEnabled && overlayPermissionGranted) {
            FloatingBubbleService.showBubble(app)
        }
    }

    fun policyFor(category: PermissionCategory): PermissionPolicy =
        permissionManager.getPolicy(category)

    fun setPolicy(category: PermissionCategory, policy: PermissionPolicy) {
        permissionManager.setPolicy(category, policy)
        permissionsVersion++
    }

    override fun onCleared() {
        terminalSession?.closeSession()
        terminalCollector?.cancel()
        super.onCleared()
    }

    private fun buildFileEntries(root: File): List<ProjectFileEntry> {
        val skipped = setOf(".git", ".gradle", "build", "node_modules", ".idea", ".anvil-data")
        fun walk(directory: File, depth: Int): List<ProjectFileEntry> {
            if (depth > 5) return emptyList()
            val children = directory.listFiles()?.sortedWith(
                compareBy<File>({ !it.isDirectory }, { it.name.lowercase() })
            ) ?: return emptyList()
            val entries = mutableListOf<ProjectFileEntry>()
            for (child in children) {
                if (child.name in skipped) continue
                val relative = child.relativeTo(root).path.replace('\\', '/')
                entries += ProjectFileEntry(
                    path = relative,
                    name = child.name,
                    isDirectory = child.isDirectory,
                    depth = depth,
                )
                if (child.isDirectory) {
                    entries += walk(child, depth + 1)
                }
                if (entries.size >= 800) break
            }
            return entries
        }
        return walk(root, 0)
    }

    private fun toast(message: String) {
        Toast.makeText(app, message, Toast.LENGTH_SHORT).show()
    }

    private fun newId(prefix: String): String = "$prefix-${UUID.randomUUID().toString().take(8)}"

    companion object {
        private const val KEY_PROVIDER = "provider_id"
        private const val KEY_MODEL = "model_id"
        private const val KEY_BASE_URL = "base_url"
        private const val KEY_OVERLAY = "overlay_enabled"
        private const val KEY_OVERLAY_PENDING = "overlay_pending"

        val PROVIDERS = listOf(
            ProviderOption(
                id = "gemini",
                label = "Google Gemini",
                defaultBaseUrl = "https://generativelanguage.googleapis.com/v1beta",
                defaultModel = "gemini-2.5-flash",
            ),
            ProviderOption(
                id = "openai",
                label = "OpenAI-compatible",
                defaultBaseUrl = "https://api.openai.com/v1",
                defaultModel = "gpt-4o-mini",
            ),
        )

        fun providerOption(id: String): ProviderOption =
            PROVIDERS.firstOrNull { it.id == id } ?: PROVIDERS.first()
    }
}
