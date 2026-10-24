package io.anvil.workstation.mcp

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

enum class McpTransport {
    STREAMABLE_HTTP,
    SSE,
    STDIO
}

enum class McpAuthMethod {
    NONE,
    BEARER,
    API_KEY,
    OAUTH2_PKCE
}

data class McpServerConfig(
    val id: String,
    val name: String,
    val transport: McpTransport = McpTransport.STREAMABLE_HTTP,
    val endpointUrl: String,
    val command: String? = null,
    val args: List<String> = emptyList(),
    val authMethod: McpAuthMethod = McpAuthMethod.NONE,
    val customHeaderName: String? = null,
    val oauthClientId: String? = null,
    val enabled: Boolean = true,
    val timeoutMs: Int = 10_000,
)

data class WwwAuthenticateChallenge(
    val scheme: String,
    val resourceMetadataUrl: String?,
    val scope: String?,
    val error: String?,
    val errorDescription: String?,
)

data class McpToolSchema(
    val serverId: String,
    val name: String,
    val description: String,
    val requiredParams: List<String>,
)

interface McpClient {
    fun parseToolsListResponse(serverId: String, rawJsonRpc: String): Result<Pair<List<McpToolSchema>, String?>>
    fun parseWwwAuthenticate(headerValue: String): WwwAuthenticateChallenge
    fun generatePkceChallenge(): Pair<String, String>
}

class JsonRpcMcpClient : McpClient {
    override fun parseToolsListResponse(
        serverId: String,
        rawJsonRpc: String
    ): Result<Pair<List<McpToolSchema>, String?>> = runCatching {
        val normalized = extractJsonPayload(rawJsonRpc)
        val root = JSONObject(normalized)
        if (root.has("error") && !root.isNull("error")) {
            val errObj = root.optJSONObject("error")
            throw IllegalStateException("MCP JSON-RPC Error: ${errObj?.optString("message") ?: "Unknown error"}")
        }
        val result = root.optJSONObject("result")
            ?: throw IllegalArgumentException("Missing JSON-RPC 'result' object")
        val toolsArr = result.optJSONArray("tools") ?: JSONArray()
        val nextCursor = result.optString("nextCursor", "").ifBlank { null }
        val tools = mutableListOf<McpToolSchema>()
        for (i in 0 until toolsArr.length()) {
            val t = toolsArr.optJSONObject(i) ?: continue
            val name = t.optString("name").trim()
            require(name.matches(Regex("^[a-zA-Z0-9_\\-]{1,64}$"))) { "Invalid MCP tool name: $name" }
            val desc = t.optString("description", "").take(500)
            val reqArr = t.optJSONObject("inputSchema")?.optJSONArray("required")
            val reqs = mutableListOf<String>()
            if (reqArr != null) {
                for (j in 0 until reqArr.length()) {
                    reqs += reqArr.optString(j)
                }
            }
            tools += McpToolSchema(serverId, name, desc, reqs)
        }
        tools to nextCursor
    }

    override fun parseWwwAuthenticate(headerValue: String): WwwAuthenticateChallenge {
        val trimmed = headerValue.trim()
        val scheme = trimmed.substringBefore(" ").ifBlank { "Bearer" }
        fun extract(key: String): String? {
            val regex = Regex("""$key\s*=\s*"([^"]*)"""", RegexOption.IGNORE_CASE)
            return regex.find(trimmed)?.groupValues?.getOrNull(1)
        }
        return WwwAuthenticateChallenge(
            scheme = scheme,
            resourceMetadataUrl = extract("resource_metadata"),
            scope = extract("scope"),
            error = extract("error"),
            errorDescription = extract("error_description"),
        )
    }

    override fun generatePkceChallenge(): Pair<String, String> {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        val encoder = Base64.getUrlEncoder().withoutPadding()
        val verifier = encoder.encodeToString(bytes)
        val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))
        val challenge = encoder.encodeToString(digest)
        return verifier to challenge
    }

    private fun extractJsonPayload(raw: String): String {
        val trimmed = raw.trim()
        if (trimmed.startsWith("{")) return trimmed
        for (line in trimmed.lines()) {
            if (line.startsWith("data:")) {
                val candidate = line.removePrefix("data:").trim()
                if (candidate.startsWith("{")) return candidate
            }
        }
        throw IllegalArgumentException("Payload is neither JSON-RPC 2.0 nor SSE data stream")
    }
}
