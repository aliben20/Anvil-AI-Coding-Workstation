package io.anvil.workstation.localai

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

data class GgufModelMetadata(
    val fileName: String,
    val fileSizeBytes: Long,
    val formatVersion: Int,
    val tensorCount: Long,
    val metadataKvCount: Long,
    val estimatedMinRamBytes: Long,
    val fitsInDeviceMemory: Boolean,
    val diagnosticNote: String,
)

interface LocalModelEngine {
    fun inspectGgufFile(file: File, availableMemoryBytes: Long): Result<GgufModelMetadata>
}

/**
 * Inspects real GGUF binary headers ("GGUF" magic 0x47475546, version v2/v3, tensor count, KV count)
 * and evaluates memory safety against actual available RAM (e.g. Realme 7 5G / Dimensity 800U 8 GB profile).
 */
class GgufHeaderInspector : LocalModelEngine {
    override fun inspectGgufFile(file: File, availableMemoryBytes: Long): Result<GgufModelMetadata> = runCatching {
        require(file.exists() && file.isFile) { "GGUF file does not exist: ${file.absolutePath}" }
        require(file.length() >= 24L) { "File is too small (${file.length()} bytes) to contain a valid 24-byte GGUF header." }

        RandomAccessFile(file, "r").use { raf ->
            val headerBytes = ByteArray(24)
            raf.readFully(headerBytes)
            val magic = String(headerBytes, 0, 4, Charsets.US_ASCII)
            require(magic == "GGUF") { "Invalid GGUF magic header '$magic' (expected 'GGUF'). File is corrupted or not a GGUF model." }

            val buf = ByteBuffer.wrap(headerBytes, 4, 20).order(ByteOrder.LITTLE_ENDIAN)
            val version = buf.int
            require(version in 2..3) { "Unsupported GGUF format version $version (supported: v2, v3)." }

            val tensorCount = buf.long
            val kvCount = buf.long
            require(tensorCount >= 0 && kvCount >= 0) { "Corrupted GGUF tensor/KV counts in header." }

            // Conservative overhead: model weights + 512 MB KV cache & compute buffer
            val estimatedRam = file.length() + (512L * 1024L * 1024L)
            val fits = availableMemoryBytes >= estimatedRam
            val note = if (fits) {
                "Verified GGUF v$version ($tensorCount tensors, $kvCount metadata keys). Fits within available RAM budget."
            } else {
                "Verified GGUF v$version, but requires ~${estimatedRam / (1024 * 1024)} MB while only ${availableMemoryBytes / (1024 * 1024)} MB is safely available."
            }

            GgufModelMetadata(
                fileName = file.name,
                fileSizeBytes = file.length(),
                formatVersion = version,
                tensorCount = tensorCount,
                metadataKvCount = kvCount,
                estimatedMinRamBytes = estimatedRam,
                fitsInDeviceMemory = fits,
                diagnosticNote = note,
            )
        }
    }
}
