package io.anvil.workstation.chat

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

data class ChatTurn(
    val role: String,
    val text: String,
)

data class ChatProviderConfig(
    val providerId: String,
    val model: String,
    val baseUrl: String,
    val apiKey: String,
)

/**
 * Minimal native chat client. Supports Google Gemini and OpenAI-compatible
 * `/chat/completions` endpoints. No API keys are bundled in the APK.
 */
class ChatClient(private val config: ChatProviderConfig) {

    suspend fun complete(
        systemPrompt: String,
        turns: List<ChatTurn>,
        temperature: Double = 0.4,
    ): String = withContext(Dispatchers.IO) {
        if (config.apiKey.isBlank()) {
            throw IllegalStateException("No API key saved for ${config.providerId}. Open Settings to add one.")
        }
        if (config.model.isBlank()) {
            throw IllegalStateException("No model configured. Open Settings to choose a model.")
        }
        if (config.baseUrl.isBlank()) {
            throw IllegalStateException("No endpoint URL configured.")
        }
        when (config.providerId.trim().lowercase()) {
            "gemini", "google" -> callGemini(systemPrompt, turns, temperature)
            else -> callOpenAiCompatible(systemPrompt, turns, temperature)
        }
    }

    private fun callGemini(
        systemPrompt: String,
        turns: List<ChatTurn>,
        temperature: Double,
    ): String {
        val endpoint = "${config.baseUrl.trimEnd('/')}/models/${config.model.trim()}:generateContent"
        val contents = JSONArray()
        for (turn in turns) {
            val role = if (turn.role == "assistant") "model" else "user"
            contents.put(
                JSONObject()
                    .put("role", role)
                    .put(
                        "parts",
                        JSONArray().put(JSONObject().put("text", turn.text))
                    )
            )
        }
        val payload = JSONObject()
            .put(
                "systemInstruction",
                JSONObject().put(
                    "parts",
                    JSONArray().put(JSONObject().put("text", systemPrompt))
                )
            )
            .put("contents", contents)
            .put(
                "generationConfig",
                JSONObject()
                    .put("temperature", temperature)
                    .put("maxOutputTokens", 4096)
            )

        val body = postJson(
            endpoint = endpoint,
            payload = payload,
            headers = mapOf("x-goog-api-key" to config.apiKey),
        )
        val root = JSONObject(body)
        root.optJSONObject("error")?.let {
            throw IllegalStateException(it.optString("message", "Gemini request failed"))
        }
        val candidates = root.optJSONArray("candidates")
            ?: throw IllegalStateException("Gemini returned no candidates.")
        if (candidates.length() == 0) {
            val blockReason = root.optJSONObject("promptFeedback")?.optString("blockReason")
            throw IllegalStateException(
                if (blockReason.isNullOrBlank()) "Gemini returned an empty response."
                else "Gemini blocked the prompt: $blockReason"
            )
        }
        val parts = candidates.getJSONObject(0)
            .optJSONObject("content")
            ?.optJSONArray("parts")
            ?: throw IllegalStateException("Gemini response did not contain text parts.")
        val text = buildString {
            for (i in 0 until parts.length()) {
                append(parts.optJSONObject(i)?.optString("text").orEmpty())
            }
        }.trim()
        if (text.isEmpty()) throw IllegalStateException("Gemini returned an empty response.")
        return text
    }

    private fun callOpenAiCompatible(
        systemPrompt: String,
        turns: List<ChatTurn>,
        temperature: Double,
    ): String {
        val endpoint = "${config.baseUrl.trimEnd('/')}/chat/completions"
        val messages = JSONArray()
        messages.put(JSONObject().put("role", "system").put("content", systemPrompt))
        for (turn in turns) {
            val role = if (turn.role == "assistant") "assistant" else "user"
            messages.put(JSONObject().put("role", role).put("content", turn.text))
        }
        val payload = JSONObject()
            .put("model", config.model.trim())
            .put("messages", messages)
            .put("temperature", temperature)
            .put("max_tokens", 4096)

        val body = postJson(
            endpoint = endpoint,
            payload = payload,
            headers = mapOf("Authorization" to "Bearer ${config.apiKey}"),
        )
        val root = JSONObject(body)
        root.optJSONObject("error")?.let {
            throw IllegalStateException(it.optString("message", "Provider request failed"))
        }
        val choices = root.optJSONArray("choices")
            ?: throw IllegalStateException("Provider returned no choices.")
        if (choices.length() == 0) throw IllegalStateException("Provider returned an empty response.")
        val message = choices.getJSONObject(0).optJSONObject("message")
            ?: throw IllegalStateException("Provider response did not contain a message.")
        val content = message.opt("content")
        val text = when (content) {
            is String -> content
            is JSONArray -> buildString {
                for (i in 0 until content.length()) {
                    val part = content.optJSONObject(i)
                    if (part?.optString("type") == "text") append(part.optString("text"))
                }
            }
            else -> ""
        }.trim()
        if (text.isEmpty()) {
            throw IllegalStateException("Provider returned an empty message.")
        }
        return text
    }

    private fun postJson(
        endpoint: String,
        payload: JSONObject,
        headers: Map<String, String>,
    ): String {
        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 30_000
            readTimeout = 180_000
            doOutput = true
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Accept", "application/json")
            headers.forEach { (name, value) -> setRequestProperty(name, value) }
        }
        try {
            connection.outputStream.use { output ->
                output.write(payload.toString().toByteArray(Charsets.UTF_8))
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.bufferedReader(Charsets.UTF_8)
                ?.use(BufferedReader::readText)
                .orEmpty()
            if (status !in 200..299) {
                throw IllegalStateException("HTTP $status: ${extractErrorMessage(body)}")
            }
            return body
        } finally {
            connection.disconnect()
        }
    }

    private fun extractErrorMessage(raw: String): String {
        if (raw.isBlank()) return "Empty error response"
        return runCatching {
            val obj = JSONObject(raw)
            obj.optJSONObject("error")?.optString("message")?.takeIf { it.isNotBlank() }
                ?: obj.optString("message").takeIf { it.isNotBlank() }
                ?: raw.take(500)
        }.getOrDefault(raw.take(500))
    }
}
