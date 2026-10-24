package io.anvil.workstation.workspace

import io.anvil.workstation.security.PermissionManager
import java.io.File

data class WorkspaceProject(
    val id: String,
    val name: String,
    val rootDir: File,
    val templateType: String,
    val updatedAtMillis: Long,
)

data class DiffHunkLine(
    val type: Char, // '+', '-', ' '
    val content: String,
    val oldLineNumber: Int?,
    val newLineNumber: Int?,
)

data class FileDiffSummary(
    val relativePath: String,
    val additions: Int,
    val deletions: Int,
    val lines: List<DiffHunkLine>,
)

interface WorkspaceManager {
    fun listWorkspaces(): List<WorkspaceProject>
    fun createWorkspaceFromTemplate(name: String, templateId: String): WorkspaceProject
    fun readFileBounded(workspace: WorkspaceProject, relativePath: String, maxBytes: Int = 256 * 1024): Result<String>
    fun writeFileSafely(workspace: WorkspaceProject, relativePath: String, content: String): Result<FileDiffSummary>
    fun computeUnifiedDiff(previousContent: String, updatedContent: String, relativePath: String): FileDiffSummary
}

class LocalWorkspaceManager(
    private val baseWorkspacesDir: File,
    private val permissionManager: PermissionManager,
) : WorkspaceManager {

    init {
        baseWorkspacesDir.mkdirs()
    }

    override fun listWorkspaces(): List<WorkspaceProject> {
        val dirs = baseWorkspacesDir.listFiles()?.filter { it.isDirectory }.orEmpty()
        return dirs.map { dir ->
            WorkspaceProject(
                id = dir.name,
                name = dir.name,
                rootDir = dir,
                templateType = detectProjectType(dir),
                updatedAtMillis = dir.lastModified(),
            )
        }.sortedByDescending { it.updatedAtMillis }
    }

    override fun createWorkspaceFromTemplate(name: String, templateId: String): WorkspaceProject {
        val slug = name.lowercase().replace(Regex("[^a-z0-9\\-_]"), "-").trim('-').ifBlank { "project" }
        val root = File(baseWorkspacesDir, slug).apply { mkdirs() }
        when (templateId) {
            "kotlin-android" -> {
                File(root, "settings.gradle.kts").writeText("rootProject.name = \"$slug\"\ninclude(\":app\")\n")
                File(root, "app/src/main/java/com/example/$slug").mkdirs()
                File(root, "app/src/main/java/com/example/$slug/MainActivity.kt").writeText(
                    "package com.example.$slug\n\nimport android.app.Activity\nimport android.os.Bundle\n\nclass MainActivity : Activity() {\n    override fun onCreate(savedInstanceState: Bundle?) {\n        super.onCreate(savedInstanceState)\n    }\n}\n"
                )
            }
            "python" -> {
                File(root, "main.py").writeText("def main() -> None:\n    print('Hello from $slug')\n\nif __name__ == '__main__':\n    main()\n")
            }
            else -> {
                File(root, "README.md").writeText("# $name\n\nCreated in Anvil AI Coding Workstation.\n")
            }
        }
        return WorkspaceProject(slug, name, root, templateId, System.currentTimeMillis())
    }

    override fun readFileBounded(workspace: WorkspaceProject, relativePath: String, maxBytes: Int): Result<String> = runCatching {
        val file = permissionManager.validateWorkspacePath(workspace.rootDir, relativePath)
        require(file.isFile) { "File does not exist: $relativePath" }
        val bytes = file.inputStream().use { input ->
            val buf = ByteArray(minOf(file.length().toInt(), maxBytes))
            val read = input.read(buf)
            if (read <= 0) ByteArray(0) else buf.copyOf(read)
        }
        require(!bytes.contains(0.toByte())) { "Binary file cannot be opened in UTF-8 text editor: $relativePath" }
        bytes.toString(Charsets.UTF_8)
    }

    override fun writeFileSafely(workspace: WorkspaceProject, relativePath: String, content: String): Result<FileDiffSummary> = runCatching {
        val file = permissionManager.validateWorkspacePath(workspace.rootDir, relativePath)
        val previous = if (file.isFile) file.readText(Charsets.UTF_8) else ""
        file.parentFile?.mkdirs()
        file.writeText(content, Charsets.UTF_8)
        computeUnifiedDiff(previous, content, relativePath)
    }

    override fun computeUnifiedDiff(previousContent: String, updatedContent: String, relativePath: String): FileDiffSummary {
        val oldLines = if (previousContent.isEmpty()) emptyList() else previousContent.lines()
        val newLines = if (updatedContent.isEmpty()) emptyList() else updatedContent.lines()
        val diffLines = mutableListOf<DiffHunkLine>()
        var adds = 0
        var dels = 0
        val maxLen = maxOf(oldLines.size, newLines.size)
        for (i in 0 until maxLen) {
            val o = oldLines.getOrNull(i)
            val n = newLines.getOrNull(i)
            when {
                o == n && o != null -> diffLines += DiffHunkLine(' ', o, i + 1, i + 1)
                o != null && n == null -> {
                    dels++
                    diffLines += DiffHunkLine('-', o, i + 1, null)
                }
                o == null && n != null -> {
                    adds++
                    diffLines += DiffHunkLine('+', n, null, i + 1)
                }
                o != null && n != null -> {
                    dels++
                    adds++
                    diffLines += DiffHunkLine('-', o, i + 1, null)
                    diffLines += DiffHunkLine('+', n, null, i + 1)
                }
            }
        }
        return FileDiffSummary(relativePath, adds, dels, diffLines)
    }

    private fun detectProjectType(dir: File): String = when {
        File(dir, "build.gradle.kts").isFile || File(dir, "settings.gradle.kts").isFile -> "kotlin-android"
        File(dir, "package.json").isFile -> "web-node"
        File(dir, "main.py").isFile || File(dir, "requirements.txt").isFile -> "python"
        else -> "general"
    }
}
