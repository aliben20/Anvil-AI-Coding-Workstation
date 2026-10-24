package io.anvil.workstation.buildsystem

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipFile

data class ApkVerificationResult(
    val exists: Boolean,
    val apkPath: String,
    val sizeBytes: Long,
    val sha256Hex: String?,
    val containsAndroidManifest: Boolean,
    val containsDexBytecode: Boolean,
    val verified: Boolean,
    val failureReason: String? = null,
)

interface BuildService {
    fun verifyApkArtifact(apkFile: File): ApkVerificationResult
}

/**
 * Verifies that an APK file actually exists, has nonzero size, is a valid ZIP container,
 * and contains AndroidManifest.xml and classes.dex. Never fabricates build success.
 */
class DefaultBuildService : BuildService {
    override fun verifyApkArtifact(apkFile: File): ApkVerificationResult {
        if (!apkFile.exists() || !apkFile.isFile) {
            return ApkVerificationResult(
                exists = false,
                apkPath = apkFile.absolutePath,
                sizeBytes = 0L,
                sha256Hex = null,
                containsAndroidManifest = false,
                containsDexBytecode = false,
                verified = false,
                failureReason = "APK artifact does not exist at ${apkFile.absolutePath}",
            )
        }
        val size = apkFile.length()
        if (size <= 0L) {
            return ApkVerificationResult(
                exists = true,
                apkPath = apkFile.absolutePath,
                sizeBytes = 0L,
                sha256Hex = null,
                containsAndroidManifest = false,
                containsDexBytecode = false,
                verified = false,
                failureReason = "APK file is empty (0 bytes)",
            )
        }
        return runCatching {
            val digest = MessageDigest.getInstance("SHA-256")
            apkFile.inputStream().use { input ->
                val buf = ByteArray(8192)
                var r: Int
                while (input.read(buf).also { r = it } != -1) {
                    digest.update(buf, 0, r)
                }
            }
            val sha256 = digest.digest().joinToString("") { "%02x".format(it) }
            var hasManifest = false
            var hasDex = false
            ZipFile(apkFile).use { zip ->
                val entries = zip.entries()
                while (entries.hasMoreElements()) {
                    val name = entries.nextElement().name
                    if (name == "AndroidManifest.xml") hasManifest = true
                    if (name.endsWith(".dex")) hasDex = true
                }
            }
            val valid = hasManifest && hasDex
            ApkVerificationResult(
                exists = true,
                apkPath = apkFile.absolutePath,
                sizeBytes = size,
                sha256Hex = sha256,
                containsAndroidManifest = hasManifest,
                containsDexBytecode = hasDex,
                verified = valid,
                failureReason = if (valid) null else "Archive missing AndroidManifest.xml or classes.dex",
            )
        }.getOrElse { err ->
            ApkVerificationResult(
                exists = true,
                apkPath = apkFile.absolutePath,
                sizeBytes = size,
                sha256Hex = null,
                containsAndroidManifest = false,
                containsDexBytecode = false,
                verified = false,
                failureReason = "Invalid ZIP/APK structure: ${err.message}",
            )
        }
    }
}

class ApkInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // Receives PackageInstaller session status callbacks
    }
}
