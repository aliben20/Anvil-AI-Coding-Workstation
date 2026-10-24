package io.anvil.workstation.runtime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import io.anvil.workstation.MainActivity

/**
 * Foreground service used when executing user-authorized builds or long-running terminal commands.
 *
 * Implements:
 * - Persistent notification with execution progress & title
 * - Partial WakeLock to prevent CPU sleeping during build/agent execution
 * - State persistence to SharedPreferences surviving app lifecycle restarts
 * - Battery-friendly termination when idle
 */
class WorkstationExecutionService : Service() {

    private var wakeLock: PowerManager.WakeLock? = null
    private val notificationChannelId = "anvil_workstation_execution"
    private val notificationId = 1001

    companion object {
        const val ACTION_START = "io.anvil.workstation.ACTION_START"
        const val ACTION_UPDATE = "io.anvil.workstation.ACTION_UPDATE"
        const val ACTION_STOP = "io.anvil.workstation.ACTION_STOP"

        const val EXTRA_TASK_ID = "extra_task_id"
        const val EXTRA_TASK_TITLE = "extra_task_title"
        const val EXTRA_STEP = "extra_step"
        const val EXTRA_PROGRESS = "extra_progress"

        private const val PREFS_NAME = "workstation_service_state"
        private const val KEY_ACTIVE_TASK_ID = "active_task_id"
        private const val KEY_ACTIVE_TASK_TITLE = "active_task_title"
        private const val KEY_ACTIVE_STEP = "active_step"
        private const val KEY_ACTIVE_PROGRESS = "active_progress"

        fun startExecution(
            context: Context,
            taskId: String,
            title: String,
            step: String = "Initializing",
            progress: Int = 0
        ) {
            val intent = Intent(context, WorkstationExecutionService::class.java).apply {
                action = ACTION_START
                putExtra(EXTRA_TASK_ID, taskId)
                putExtra(EXTRA_TASK_TITLE, title)
                putExtra(EXTRA_STEP, step)
                putExtra(EXTRA_PROGRESS, progress)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun updateProgress(
            context: Context,
            taskId: String,
            title: String,
            step: String,
            progress: Int
        ) {
            val intent = Intent(context, WorkstationExecutionService::class.java).apply {
                action = ACTION_UPDATE
                putExtra(EXTRA_TASK_ID, taskId)
                putExtra(EXTRA_TASK_TITLE, title)
                putExtra(EXTRA_STEP, step)
                putExtra(EXTRA_PROGRESS, progress)
            }
            context.startService(intent)
        }

        fun stopExecution(context: Context) {
            val intent = Intent(context, WorkstationExecutionService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        acquireWakeLock()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_START

        when (action) {
            ACTION_STOP -> {
                clearSavedState()
                releaseWakeLock()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_START, ACTION_UPDATE -> {
                val taskId = intent?.getStringExtra(EXTRA_TASK_ID) ?: getSavedTaskId() ?: "default"
                val title = intent?.getStringExtra(EXTRA_TASK_TITLE) ?: getSavedTaskTitle() ?: "Background Task"
                val step = intent?.getStringExtra(EXTRA_STEP) ?: "Running"
                val progress = intent?.getIntExtra(EXTRA_PROGRESS, 0) ?: 0

                saveState(taskId, title, step, progress)
                val notification = buildNotification(title, step, progress)
                startForeground(notificationId, notification)
            }
        }

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        releaseWakeLock()
        super.onDestroy()
    }

    private fun acquireWakeLock() {
        if (wakeLock == null) {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "OBSIDIAN::ExecutionWakeLock"
            ).apply {
                setReferenceCounted(false)
                acquire(120 * 60 * 1000L) // 2 hours max safe limit
            }
        }
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (_: Exception) {}
        wakeLock = null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                notificationChannelId,
                "OBSIDIAN Workstation Engine",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Notifies when background coding agents or compiler toolchains are active"
                setShowBadge(false)
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(title: String, step: String, progress: Int): Notification {
        val launchIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, notificationChannelId)
            .setContentTitle("OBSIDIAN: $title")
            .setContentText(step)
            .setSmallIcon(android.R.drawable.ic_menu_rotate)
            .setContentIntent(pendingIntent)
            .setProgress(100, progress.coerceIn(0, 100), false)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun saveState(taskId: String, title: String, step: String, progress: Int) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString(KEY_ACTIVE_TASK_ID, taskId)
            .putString(KEY_ACTIVE_TASK_TITLE, title)
            .putString(KEY_ACTIVE_STEP, step)
            .putInt(KEY_ACTIVE_PROGRESS, progress)
            .apply()
    }

    private fun clearSavedState() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().clear().apply()
    }

    private fun getSavedTaskId(): String? =
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_ACTIVE_TASK_ID, null)

    private fun getSavedTaskTitle(): String? =
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_ACTIVE_TASK_TITLE, null)
}
