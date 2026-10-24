package io.anvil.workstation.security

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import io.anvil.workstation.core.PermissionCategory
import io.anvil.workstation.core.PermissionPolicy
import io.anvil.workstation.core.SecretRedactor
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class StoredCredentialInfo(
    val id: String,
    val providerId: String,
    val label: String,
    val maskedPreview: String,
    val isActive: Boolean,
    val createdAtMillis: Long,
)

interface AuthenticationManager {
    fun saveApiKey(providerId: String, label: String, rawSecret: String): StoredCredentialInfo
    fun listCredentials(providerId: String): List<StoredCredentialInfo>
    fun getActiveSecret(providerId: String): String?
    fun removeCredential(providerId: String, credentialId: String)
    fun generatePkceChallenge(): PkcePair
    fun verifyOAuthState(expectedState: String, receivedState: String?): Boolean
}

data class PkcePair(
    val codeVerifier: String,
    val codeChallenge: String,
    val state: String,
)

/**
 * Android Keystore AES-GCM credential manager adapted and hardened from Mobile-Harness ApiKeyVault.
 */
class AndroidKeystoreAuthManager(context: Context) : AuthenticationManager {
    private val preferences = context.getSharedPreferences("anvil_secure_vault", Context.MODE_PRIVATE)
    private val keyAlias = "anvil-workstation-aes-gcm-key"

    @Synchronized
    override fun saveApiKey(providerId: String, label: String, rawSecret: String): StoredCredentialInfo {
        val cleaned = cleanSecret(rawSecret)
        require(cleaned.isNotBlank()) { "API key cannot be empty" }
        val existing = readPool(providerId).toMutableList()
        val id = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        val info = StoredCredentialInfo(
            id = id,
            providerId = providerId,
            label = label.trim().ifBlank { "Primary Key" }.take(48),
            maskedPreview = SecretRedactor.maskSecret(cleaned),
            isActive = true,
            createdAtMillis = now,
        )
        putEncrypted("cred.$providerId.$id", cleaned)
        val updated = existing.map { it.copy(isActive = false) } + info
        savePool(providerId, updated)
        return info
    }

    @Synchronized
    override fun listCredentials(providerId: String): List<StoredCredentialInfo> = readPool(providerId)

    @Synchronized
    override fun getActiveSecret(providerId: String): String? {
        val active = readPool(providerId).firstOrNull { it.isActive } ?: readPool(providerId).firstOrNull() ?: return null
        return getEncrypted("cred.$providerId.${active.id}")
    }

    @Synchronized
    override fun removeCredential(providerId: String, credentialId: String) {
        preferences.edit()
            .remove("cred.$providerId.$credentialId.iv")
            .remove("cred.$providerId.$credentialId.ct")
            .apply()
        val remaining = readPool(providerId).filterNot { it.id == credentialId }
        val normalized = if (remaining.isNotEmpty() && remaining.none { it.isActive }) {
            remaining.mapIndexed { idx, item -> item.copy(isActive = idx == 0) }
        } else {
            remaining
        }
        savePool(providerId, normalized)
    }

    override fun generatePkceChallenge(): PkcePair {
        val random = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val verifier = Base64.encodeToString(random, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))
        val challenge = Base64.encodeToString(digest, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        val stateBytes = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val state = Base64.encodeToString(stateBytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        return PkcePair(verifier, challenge, state)
    }

    override fun verifyOAuthState(expectedState: String, receivedState: String?): Boolean {
        return expectedState.isNotBlank() && expectedState == receivedState
    }

    internal fun cleanSecret(secret: String): String =
        secret.trim().removePrefix("Bearer ").removePrefix("bearer ").filterNot(Char::isWhitespace)

    private fun putEncrypted(storageKey: String, plaintext: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        preferences.edit()
            .putString("$storageKey.iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString("$storageKey.ct", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
            .apply()
    }

    private fun getEncrypted(storageKey: String): String? = runCatching {
        val iv = Base64.decode(preferences.getString("$storageKey.iv", null), Base64.NO_WRAP)
        val ct = Base64.decode(preferences.getString("$storageKey.ct", null), Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(), GCMParameterSpec(128, iv))
        cleanSecret(cipher.doFinal(ct).toString(Charsets.UTF_8))
    }.getOrNull()

    private fun readPool(providerId: String): List<StoredCredentialInfo> = runCatching {
        val raw = preferences.getString("pool.$providerId", "[]") ?: "[]"
        val arr = JSONArray(raw)
        (0 until arr.length()).mapNotNull { i ->
            arr.optJSONObject(i)?.let { obj ->
                StoredCredentialInfo(
                    id = obj.optString("id"),
                    providerId = providerId,
                    label = obj.optString("label", "Primary Key"),
                    maskedPreview = obj.optString("maskedPreview", "••••••••"),
                    isActive = obj.optBoolean("isActive", false),
                    createdAtMillis = obj.optLong("createdAtMillis", 0L),
                )
            }
        }
    }.getOrDefault(emptyList())

    private fun savePool(providerId: String, items: List<StoredCredentialInfo>) {
        val arr = JSONArray()
        for (item in items) {
            arr.put(
                JSONObject()
                    .put("id", item.id)
                    .put("label", item.label)
                    .put("maskedPreview", item.maskedPreview)
                    .put("isActive", item.isActive)
                    .put("createdAtMillis", item.createdAtMillis)
            )
        }
        preferences.edit().putString("pool.$providerId", arr.toString()).apply()
    }

    private fun getOrCreateSecretKey(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(keyAlias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(
                KeyGenParameterSpec.Builder(
                    keyAlias,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build(),
            )
            generateKey()
        }
    }
}

interface PermissionManager {
    fun getPolicy(category: PermissionCategory): PermissionPolicy
    fun setPolicy(category: PermissionCategory, policy: PermissionPolicy)
    fun requiresUserApproval(category: PermissionCategory): Boolean
    fun validateWorkspacePath(workspaceRoot: File, candidatePath: String): File
}

class DefaultPermissionManager : PermissionManager {
    private val policies = mutableMapOf(
        PermissionCategory.READ_WORKSPACE to PermissionPolicy.ALLOW,
        PermissionCategory.CREATE_FILES to PermissionPolicy.ALLOW,
        PermissionCategory.MODIFY_FILES to PermissionPolicy.ASK,
        PermissionCategory.DELETE_FILES to PermissionPolicy.ASK,
        PermissionCategory.EXECUTE_COMMANDS to PermissionPolicy.ASK,
        PermissionCategory.NETWORK_ACCESS to PermissionPolicy.ASK,
        PermissionCategory.INSTALL_DEPENDENCIES to PermissionPolicy.ASK,
        PermissionCategory.BUILD_PROJECTS to PermissionPolicy.ALLOW,
        PermissionCategory.INSTALL_APKS to PermissionPolicy.ASK,
        PermissionCategory.EXTERNAL_DIRECTORIES to PermissionPolicy.DENY,
    )

    override fun getPolicy(category: PermissionCategory): PermissionPolicy =
        policies[category] ?: PermissionPolicy.ASK

    override fun setPolicy(category: PermissionCategory, policy: PermissionPolicy) {
        policies[category] = policy
    }

    override fun requiresUserApproval(category: PermissionCategory): Boolean =
        getPolicy(category) == PermissionPolicy.ASK

    override fun validateWorkspacePath(workspaceRoot: File, candidatePath: String): File {
        require(!candidatePath.contains('\u0000')) { "Null byte in file path is prohibited" }
        val rootCanonical = workspaceRoot.canonicalFile
        val resolved = File(rootCanonical, candidatePath).canonicalFile
        val rootPrefix = rootCanonical.path + File.separator
        require(resolved == rootCanonical || resolved.path.startsWith(rootPrefix)) {
            "Path traversal outside workspace root is blocked: $candidatePath"
        }
        return resolved
    }
}
