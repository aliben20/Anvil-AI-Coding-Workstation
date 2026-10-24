package io.anvil.workstation.core

/**
 * Core domain models, secret redaction, and stable contracts for Anvil AI Coding Workstation.
 */
object SecretRedactor {
    private val bearerRegex = Regex("(?i)Bearer\\s+[A-Za-z0-9._\\-~+/]+=*")
    private val keyPrefixRegex = Regex("\\b(sk-or-v1-|sk-ant-|sk-proj-|sk-|AIza)[A-Za-z0-9._\\-]{8,}\\b")

    fun redact(input: String, knownSecrets: Collection<String> = emptyList()): String {
        var result = input
        for (secret in knownSecrets) {
            val cleaned = secret.trim()
            if (cleaned.length >= 6) {
                result = result.replace(cleaned, maskSecret(cleaned))
            }
        }
        result = bearerRegex.replace(result) { "Bearer [REDACTED]" }
        result = keyPrefixRegex.replace(result) { match ->
            val v = match.value
            "${v.take(6)}...[REDACTED]"
        }
        return result
    }

    fun maskSecret(secret: String): String {
        val cleaned = secret.trim()
        if (cleaned.length <= 8) return "••••••••"
        return "${cleaned.take(4)}••••${cleaned.takeLast(4)}"
    }
}

enum class WorkstationDestination(val route: String, val label: String) {
    CHAT("chat", "Chat"),
    PROJECTS("projects", "Projects"),
    AGENTS("agents", "Agents"),
    TERMINAL("terminal", "Terminal"),
    SETTINGS("settings", "Settings"),
}

enum class ProviderProtocol {
    OPENAI_CHAT,
    OPENAI_RESPONSES,
    ANTHROPIC_MESSAGES,
    GEMINI_SERVER,
}

enum class PermissionCategory {
    READ_WORKSPACE,
    CREATE_FILES,
    MODIFY_FILES,
    DELETE_FILES,
    EXECUTE_COMMANDS,
    NETWORK_ACCESS,
    INSTALL_DEPENDENCIES,
    BUILD_PROJECTS,
    INSTALL_APKS,
    EXTERNAL_DIRECTORIES,
}

enum class PermissionPolicy {
    ALLOW,
    ASK,
    DENY,
}
