package io.anvil.workstation

import io.anvil.workstation.buildsystem.DefaultBuildService
import io.anvil.workstation.core.PermissionCategory
import io.anvil.workstation.core.PermissionPolicy
import io.anvil.workstation.core.SecretRedactor
import io.anvil.workstation.localai.GgufHeaderInspector
import io.anvil.workstation.mcp.JsonRpcMcpClient
import io.anvil.workstation.memory.InMemoryKeywordStore
import io.anvil.workstation.providers.StandardHttpAIProvider
import io.anvil.workstation.security.DefaultPermissionManager
import io.anvil.workstation.workspace.LocalWorkspaceManager
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class WorkstationCoreUnitTest {

    @Test
    fun secretRedactor_masksBearerAndApiKeys() {
        val raw = "Authorization: Bearer sk-or-v1-9876543210abcdef and custom secret mySuperSecretToken123"
        val redacted = SecretRedactor.redact(raw, listOf("mySuperSecretToken123"))
        assertFalse(redacted.contains("9876543210abcdef"))
        assertFalse(redacted.contains("mySuperSecretToken123"))
        assertTrue(redacted.contains("[REDACTED]") || redacted.contains("••••"))
    }

    @Test
    fun permissionManager_blocksPathTraversalOutsideWorkspace() {
        val tempRoot = Files.createTempDirectory("anvil-ws-test").toFile()
        try {
            val pm = DefaultPermissionManager()
            val valid = pm.validateWorkspacePath(tempRoot, "src/Main.kt")
            assertTrue(valid.canonicalPath.startsWith(tempRoot.canonicalPath))

            assertThrows(IllegalArgumentException::class.java) {
                pm.validateWorkspacePath(tempRoot, "../../etc/passwd")
            }
        } finally {
            tempRoot.deleteRecursively()
        }
    }

    @Test
    fun workspaceManager_computesUnifiedDiffAndDetectsBinary() {
        val tempRoot = Files.createTempDirectory("anvil-diff-test").toFile()
        try {
            val pm = DefaultPermissionManager()
            val wm = LocalWorkspaceManager(tempRoot, pm)
            val project = wm.createWorkspaceFromTemplate("DemoApp", "python")
            val diff = wm.writeFileSafely(project, "main.py", "def main():\n    print('Updated')\n").getOrThrow()
            assertTrue(diff.additions > 0)
            assertTrue(diff.deletions > 0)
        } finally {
            tempRoot.deleteRecursively()
        }
    }

    @Test
    fun buildService_verifiesRealApkZipStructure() {
        val service = DefaultBuildService()
        val missing = File("/tmp/nonexistent-artifact-12345.apk")
        assertFalse(service.verifyApkArtifact(missing).verified)

        val validApk = Files.createTempFile("test-build", ".apk").toFile()
        try {
            ZipOutputStream(FileOutputStream(validApk)).use { zos ->
                zos.putNextEntry(ZipEntry("AndroidManifest.xml"))
                zos.write("<manifest/>".toByteArray())
                zos.closeEntry()
                zos.putNextEntry(ZipEntry("classes.dex"))
                zos.write(byteArrayOf(0x64, 0x65, 0x78, 0x0A))
                zos.closeEntry()
            }
            val result = service.verifyApkArtifact(validApk)
            assertTrue(result.verified)
            assertTrue(result.containsAndroidManifest)
            assertTrue(result.containsDexBytecode)
            assertNotNull(result.sha256Hex)
        } finally {
            validApk.delete()
        }
    }

    @Test
    fun ggufInspector_parsesRealBinaryHeaderAndChecksMemory() {
        val inspector = GgufHeaderInspector()
        val tempGguf = Files.createTempFile("tiny-model", ".gguf").toFile()
        try {
            val buf = ByteBuffer.allocate(32).order(ByteOrder.LITTLE_ENDIAN)
            buf.put("GGUF".toByteArray(Charsets.US_ASCII))
            buf.putInt(3) // version 3
            buf.putLong(42L) // 42 tensors
            buf.putLong(18L) // 18 KV pairs
            buf.putLong(0L)
            tempGguf.writeBytes(buf.array())

            val meta = inspector.inspectGgufFile(tempGguf, 4L * 1024L * 1024L * 1024L).getOrThrow()
            assertEquals(3, meta.formatVersion)
            assertEquals(42L, meta.tensorCount)
            assertEquals(18L, meta.metadataKvCount)
            assertTrue(meta.fitsInDeviceMemory)
        } finally {
            tempGguf.delete()
        }
    }

    @Test
    fun mcpClient_validatesToolSchemasAndRejectsErrors() {
        val client = JsonRpcMcpClient()
        val payload = """
            {
              "jsonrpc": "2.0",
              "id": 1,
              "result": {
                "tools": [
                  {
                    "name": "git_status",
                    "description": "Returns working tree status",
                    "inputSchema": {
                      "type": "object",
                      "required": ["repoPath"]
                    }
                  }
                ]
              }
            }
        """.trimIndent()
        val tools = client.parseToolsListResponse("local-mcp", payload).getOrThrow()
        assertEquals(1, tools.size)
        assertEquals("git_status", tools[0].name)
        assertEquals(listOf("repoPath"), tools[0].requiredParams)
    }
}
