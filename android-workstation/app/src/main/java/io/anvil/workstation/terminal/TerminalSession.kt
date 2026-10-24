package io.anvil.workstation.terminal

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.OutputStreamWriter
import java.nio.charset.StandardCharsets
import java.util.UUID

data class CommandExecutionResult(
    val command: String,
    val workingDirectory: String,
    val stdout: String,
    val stderr: String,
    val exitCode: Int,
    val durationMs: Long,
    val timedOut: Boolean = false,
)

enum class AndroidShellRuntimeMode {
    PROOT_LINUX,
    ANDROID_SYSTEM_SH,
}

/**
 * Persistent interactive shell session for Android Workstation.
 * Connects to a long-lived `/system/bin/sh -i` or Mobile-Harness PRoot `/bin/bash -i` process
 * rather than spawning a fresh process for each command, preserving `cd` and exported variables.
 */
class PersistentProcessTerminalSession(
    val sessionId: String = "android-pty-${UUID.randomUUID().toString().take(8)}",
    initialDir: File,
    private val prootBinary: File? = null,
    private val prootRootfsDir: File? = null,
    private val scope: CoroutineScope,
) {
    var currentDirectory: File = initialDir
        private set

    val runtimeMode: AndroidShellRuntimeMode =
        if (prootBinary?.exists() == true && prootBinary.canExecute() && prootRootfsDir?.exists() == true) {
            AndroidShellRuntimeMode.PROOT_LINUX
        } else {
            AndroidShellRuntimeMode.ANDROID_SYSTEM_SH
        }

    @Volatile
    var isRunning: Boolean = false
        private set

    @Volatile
    var exitCode: Int? = null
        private set

    private var shellProcess: Process? = null
    private var stdinWriter: OutputStreamWriter? = null
    private var readerJob: Job? = null

    private val _outputStream = MutableSharedFlow<String>(extraBufferCapacity = 256)
    val outputStream: SharedFlow<String> = _outputStream.asSharedFlow()

    val scrollback = StringBuilder()

    fun startSession() {
        if (isRunning) return
        require(currentDirectory.exists() && currentDirectory.isDirectory) {
            "Working directory does not exist: ${currentDirectory.absolutePath}"
        }

        val commandArgs = if (runtimeMode == AndroidShellRuntimeMode.PROOT_LINUX) {
            listOf(
                prootBinary!!.absolutePath,
                "--kill-on-exit",
                "-r", prootRootfsDir!!.absolutePath,
                "-b", "/dev",
                "-b", "/proc",
                "-b", "/sys",
                "-w", "/root",
                "/bin/bash", "--norc", "-i"
            )
        } else {
            listOf("/system/bin/sh", "-i")
        }

        val pb = ProcessBuilder(commandArgs)
            .directory(currentDirectory)
            .redirectErrorStream(true)

        val env = pb.environment()
        env["TERM"] = "xterm-256color"
        env["HOME"] = currentDirectory.absolutePath

        val proc = pb.start()
        shellProcess = proc
        stdinWriter = OutputStreamWriter(proc.outputStream, StandardCharsets.UTF_8)
        isRunning = true

        readerJob = scope.launch(Dispatchers.IO) {
            val stream = proc.inputStream.reader(StandardCharsets.UTF_8)
            val buffer = CharArray(4096)
            try {
                while (isActive) {
                    val readCount = stream.read(buffer)
                    if (readCount == -1) break
                    val chunk = String(buffer, 0, readCount)
                    synchronized(scrollback) {
                        scrollback.append(chunk)
                        if (scrollback.length > 65_536) {
                            scrollback.delete(0, scrollback.length - 65_536)
                        }
                    }
                    _outputStream.tryEmit(chunk)
                }
            } finally {
                val code = runCatching { proc.waitFor() }.getOrNull() ?: 0
                exitCode = code
                isRunning = false
            }
        }
    }

    suspend fun writeInput(rawText: String) = withContext(Dispatchers.IO) {
        val writer = stdinWriter ?: error("Terminal session $sessionId is not running")
        writer.write(rawText)
        writer.flush()
    }

    suspend fun sendInterrupt() = withContext(Dispatchers.IO) {
        // Send ETX (Ctrl+C) to foreground shell input stream
        writeInput("\u0003\n")
    }

    fun clearScrollbackOnly() {
        synchronized(scrollback) {
            scrollback.clear()
        }
    }

    fun closeSession() {
        isRunning = false
        runCatching { stdinWriter?.close() }
        readerJob?.cancel()
        shellProcess?.destroyForcibly()
        shellProcess = null
    }
}
