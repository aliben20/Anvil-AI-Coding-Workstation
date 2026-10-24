package io.anvil.workstation.providers

import io.anvil.workstation.core.ProviderProtocol
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class ModelCapabilityMetadata(
    val id: String,
    val displayName: String,
    val providerId: String,
    val contextWindowTokens: Int? = null,
    val supportsStreaming: Boolean = true,
    val supportsTools: Boolean = false,
    val supportsVision: Boolean = false,
    val isFreeTierVerified: Boolean = false,
)

data class ProviderEndpointConfig(
    val id: String,
    val name: String,
    val baseUrl: String,
    val protocol: ProviderProtocol,
    val docsUrl: String,
    val requiresApiKey: Boolean = true,
    val supportsModelDiscovery: Boolean = true,
)

sealed interface ConnectionTestOutcome {
    data class Connected(val latencyMs: Long, val discoveredCount: Int, val endpointChecked: String) : ConnectionTestOutcome
    data class Failed(val httpStatus: Int?, val diagnosticMessage: String) : ConnectionTestOutcome
}

interface AIProvider {
    val config: ProviderEndpointConfig
    suspend fun testConnection(apiKey: String): ConnectionTestOutcome
    suspend fun fetchModels(apiKey: String): Result<List<ModelCapabilityMetadata>>
}

interface ModelCatalog {
    fun getCachedModels(providerId: String): List<ModelCapabilityMetadata>
    fun lastUpdatedMillis(providerId: String): Long?
    suspend fun refreshModels(provider: AIProvider, apiKey: String): Result<List<ModelCapabilityMetadata>>
}

class StandardHttpAIProvider(override val config: ProviderEndpointConfig) : AIProvider {
    override suspend fun testConnection(apiKey: String): ConnectionTestOutcome = withContext(Dispatchers.IO) {
        if (config.requiresApiKey && apiKey.isBlank()) {
            return@withContext ConnectionTestOutcome.Failed(null, "API key is required for ${config.name}.")
        }
        val start = System.currentTimeMillis()
        val discovery = fetchModels(apiKey)
        val elapsed = System.currentTimeMillis() - start
        discovery.fold(
            onSuccess = { models ->
                ConnectionTestOutcome.Connected(
                    latencyMs = elapsed,
                    discoveredCount = models.size,
                    endpointChecked = "${config.baseUrl.trimEnd('/')}/models",
                )
            },
            onFailure = { err ->
                ConnectionTestOutcome.Failed(null, err.message ?: "Connection failed")
            },
        )
    }

    override suspend fun fetchModels(apiKey: String): Result<List<ModelCapabilityMetadata>> = withContext(Dispatchers.IO) {
        runCatching {
            val endpoint = "${config.baseUrl.trimEnd('/')}/models"
            val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 10_000
                readTimeout = 15_000
                setRequestProperty("Accept", "application/json")
                if (apiKey.isNotBlank()) {
                    when (config.protocol) {
                        ProviderProtocol.ANTHROPIC_MESSAGES -> {
                            setRequestProperty("x-api-key", apiKey)
                            setRequestProperty("anthropic-version", "2023-06-01")
                        }
                        else -> setRequestProperty("Authorization", "Bearer $apiKey")
                    }
                }
            }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                throw IllegalStateException("HTTP $status from $endpoint: ${extractErrorDetail(body)}")
            }
            parseModelCatalogJson(config.id, body)
        }
    }

    companion object {
        fun parseModelCatalogJson(providerId: String, rawJson: String): List<ModelCapabilityMetadata> {
            val root = JSONObject(rawJson)
            val dataArray: JSONArray = root.optJSONArray("data") ?: root.optJSONArray("models") ?: JSONArray()
            val list = mutableListOf<ModelCapabilityMetadata>()
            for (i in 0 until dataArray.length()) {
                val item = dataArray.optJSONObject(i) ?: continue
                val id = item.optString("id").ifBlank { item.optString("name") }
                if (id.isBlank()) continue
                val name = item.optString("name").ifBlank { id }
                val contextLen = item.optInt("context_length", 0).takeIf { it > 0 }
                val pricing = item.optJSONObject("pricing")
                val isFree = pricing != null &&
                    pricing.optString("prompt") == "0" &&
                    pricing.optString("completion") == "0"
                val supportedParams = item.optJSONArray("supported_parameters")
                var hasTools = false
                if (supportedParams != null) {
                    for (j in 0 until supportedParams.length()) {
                        if (supportedParams.optString(j) == "tools") hasTools = true
                    }
                }
                list += ModelCapabilityMetadata(
                    id = id,
                    displayName = name,
                    providerId = providerId,
                    contextWindowTokens = contextLen,
                    supportsStreaming = true,
                    supportsTools = hasTools || id.contains("claude") || id.contains("gpt-4") || id.contains("gemini") || id.contains("deepseek"),
                    supportsVision = id.contains("vision") || id.contains("claude-3") || id.contains("gpt-4o") || id.contains("gemini"),
                    isFreeTierVerified = isFree || id.endsWith(":free"),
                )
            }
            return list
        }

        fun extractErrorDetail(rawBody: String): String = runCatching {
            val obj = JSONObject(rawBody)
            obj.optJSONObject("error")?.optString("message")?.takeIf { it.isNotBlank() }
                ?: obj.optString("message").takeIf { it.isNotBlank() }
                ?: rawBody.take(180)
        }.getOrDefault(rawBody.take(180))
    }
}
