package io.anvil.workstation.runtime

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ProgressBar
import android.widget.Button
import android.graphics.Typeface
import android.text.TextUtils
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import io.anvil.workstation.MainActivity
import io.anvil.workstation.R
import kotlin.math.abs

/**
 * System-wide OBSIDIAN "chat head" overlay.
 *
 * Works like a messenger bubble: a round floating icon stays on top of other apps,
 * can be dragged anywhere, snaps to the nearest edge and opens OBSIDIAN on tap.
 */
class FloatingBubbleService : Service() {

    private var windowManager: WindowManager? = null
    private var bubbleView: View? = null
    private var bubbleContainer: FrameLayout? = null
    private var activityBadge: View? = null
    private var dismissView: FrameLayout? = null
    private var layoutParams: WindowManager.LayoutParams? = null
    private var dismissLayoutParams: WindowManager.LayoutParams? = null
    private var bubbleSizePx = 0
    private var dismissSizePx = 0
    private var isOverDismissZone = false
    private var isForeground = false
    private var lastTitle: String = "OBSIDIAN"
    private var lastStep: String = "Ready for tasks"
    private var lastIsRunning: Boolean = false
    private var lastProgress: Int = -1

    private var expandedHudView: View? = null
    private var hudTitleView: TextView? = null
    private var hudStepView: TextView? = null
    private var hudStatusBadge: TextView? = null
    private var hudProgressBar: ProgressBar? = null
    private var hudProgressText: TextView? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    companion object {
        const val ACTION_SHOW = "io.anvil.workstation.ACTION_SHOW_BUBBLE"
        const val ACTION_HIDE = "io.anvil.workstation.ACTION_HIDE_BUBBLE"
        const val ACTION_OVERLAY_DISMISSED = "io.anvil.workstation.ACTION_OVERLAY_DISMISSED"
        const val ACTION_UPDATE_ACTIVITY = "io.anvil.workstation.ACTION_UPDATE_ACTIVITY"
        const val EXTRA_TITLE = "extra_title"
        const val EXTRA_STEP = "extra_step"
        const val EXTRA_IS_RUNNING = "extra_is_running"
        const val EXTRA_PROGRESS = "extra_progress"

        fun updateActivity(
            context: Context,
            title: String,
            step: String,
            isRunning: Boolean,
            progress: Int
        ) {
            if (!canDrawOverlays(context)) return
            val intent = Intent(context, FloatingBubbleService::class.java).apply {
                action = ACTION_UPDATE_ACTIVITY
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_STEP, step)
                putExtra(EXTRA_IS_RUNNING, isRunning)
                putExtra(EXTRA_PROGRESS, progress)
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (_: Exception) {}
        }

        private const val NOTIFICATION_ID = 4242
        private const val CHANNEL_ID = "obsidian_overlay"

        fun canDrawOverlays(context: Context): Boolean =
            Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context)

        fun showBubble(context: Context) {
            if (!canDrawOverlays(context)) return
            val intent = Intent(context, FloatingBubbleService::class.java).apply {
                action = ACTION_SHOW
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (_: Exception) {
                // Permission was revoked or the app is restricted; nothing else to do.
            }
        }

        fun hideBubble(context: Context) {
            try {
                context.stopService(Intent(context, FloatingBubbleService::class.java))
            } catch (_: Exception) {
                // Service was not running.
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_SHOW

        when (action) {
            ACTION_UPDATE_ACTIVITY -> {
                val title = intent?.getStringExtra(EXTRA_TITLE) ?: "OBSIDIAN"
                val step = intent?.getStringExtra(EXTRA_STEP) ?: "Active"
                val isRunning = intent?.getBooleanExtra(EXTRA_IS_RUNNING, false) ?: false
                val progress = intent?.getIntExtra(EXTRA_PROGRESS, -1) ?: -1
                if (bubbleView == null && canDrawOverlays(this)) {
                    startForegroundCompat()
                    createAndAttachBubble()
                }
                updateBubbleActivity(title, step, isRunning, progress)
                return START_STICKY
            }
            ACTION_HIDE -> {
                removeBubble()
                stopForegroundCompat()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_SHOW -> {
                if (!canDrawOverlays(this)) {
                    stopSelf()
                    return START_NOT_STICKY
                }
                startForegroundCompat()
                if (bubbleView == null) {
                    createAndAttachBubble()
                } else {
                    bubbleView?.visibility = View.VISIBLE
                    bubbleView?.scaleX = 1f
                    bubbleView?.scaleY = 1f
                    bubbleView?.alpha = 1f
                }
            }
        }

        return START_STICKY
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "OBSIDIAN overlay",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Keeps the OBSIDIAN chat-head bubble available over other apps."
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }

    private fun startForegroundCompat() {
        if (isForeground) return
        val launchIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_obsidian)
            .setContentTitle("OBSIDIAN overlay")
            .setContentText("Chat head active - tap to open the workstation")
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build()
        startForeground(NOTIFICATION_ID, notification)
        isForeground = true
    }

    private fun stopForegroundCompat() {
        if (!isForeground) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        isForeground = false
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun createAndAttachBubble() {
        if (!canDrawOverlays(this)) {
            stopSelf()
            return
        }

        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = resources.displayMetrics
        val screenWidth = metrics.widthPixels
        val screenHeight = metrics.heightPixels
        bubbleSizePx = (52 * metrics.density).toInt()

        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        // Messenger-style Dismiss Target Zone at bottom center of the screen
        val dSize = (64 * metrics.density).toInt()
        dismissSizePx = dSize
        val dMarginBottom = (40 * metrics.density).toInt()

        val dParams = WindowManager.LayoutParams(
            dSize,
            dSize,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = dMarginBottom
        }
        dismissLayoutParams = dParams

        val normalDismissBg = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.parseColor("#E6161B22"))
            setStroke((2 * metrics.density).toInt(), Color.parseColor("#30363D"))
        }

        val dContainer = FrameLayout(this).apply {
            background = normalDismissBg
            elevation = 20f
            visibility = View.GONE
            alpha = 0f
        }

        val xIcon = ImageView(this).apply {
            setImageResource(R.drawable.ic_close_x)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            val p = (18 * metrics.density).toInt()
            setPadding(p, p, p, p)
        }
        dContainer.addView(xIcon)
        dismissView = dContainer
        try {
            windowManager?.addView(dContainer, dParams)
        } catch (_: Exception) {}

        // Main Bubble Layout
        val params = WindowManager.LayoutParams(
            bubbleSizePx,
            bubbleSizePx,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = (screenWidth - bubbleSizePx - (16 * metrics.density).toInt()).coerceAtLeast(0)
            y = (screenHeight * 0.25f).toInt().coerceAtMost(screenHeight - bubbleSizePx)
        }
        layoutParams = params

        val container = FrameLayout(this).apply {
            val bg = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#161B22"))
                setStroke((1.5f * metrics.density).toInt(), Color.parseColor("#C7FF65"))
            }
            background = bg
            elevation = 16f
        }

        val icon = ImageView(this).apply {
            setImageResource(R.drawable.obsidian_crystal_icon)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            val iconPadding = (10 * metrics.density).toInt()
            setPadding(iconPadding, iconPadding, iconPadding, iconPadding)
        }
        container.addView(icon)

        val badge = View(this).apply {
            val bg = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#C7FF65"))
            }
            background = bg
            val badgeSize = (11 * metrics.density).toInt()
            layoutParams = FrameLayout.LayoutParams(badgeSize, badgeSize).apply {
                gravity = Gravity.TOP or Gravity.END
                topMargin = (2 * metrics.density).toInt()
                rightMargin = (2 * metrics.density).toInt()
            }
            visibility = if (lastIsRunning) View.VISIBLE else View.GONE
        }
        container.addView(badge)
        activityBadge = badge
        bubbleContainer = container

        container.setOnTouchListener(object : View.OnTouchListener {
            private var initialX = 0
            private var initialY = 0
            private var initialTouchX = 0f
            private var initialTouchY = 0f
            private var hasMoved = false
            private var currentScreenWidth = screenWidth
            private var currentScreenHeight = screenHeight

            override fun onTouch(v: View, event: MotionEvent): Boolean {
                val currentParams = layoutParams ?: return false

                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        collapseExpandedHud()
                        initialX = currentParams.x
                        initialY = currentParams.y
                        initialTouchX = event.rawX
                        initialTouchY = event.rawY
                        hasMoved = false
                        isOverDismissZone = false
                        val latestMetrics = v.resources.displayMetrics
                        currentScreenWidth = latestMetrics.widthPixels
                        currentScreenHeight = latestMetrics.heightPixels

                        // Show Messenger dismiss target zone with scale & fade in
                        dismissView?.apply {
                            visibility = View.VISIBLE
                            val bg = GradientDrawable().apply {
                                shape = GradientDrawable.OVAL
                                setColor(Color.parseColor("#E6161B22"))
                                setStroke((2 * latestMetrics.density).toInt(), Color.parseColor("#30363D"))
                            }
                            background = bg
                            scaleX = 0.85f
                            scaleY = 0.85f
                            alpha = 0f
                            animate()
                                .alpha(1f)
                                .scaleX(1f)
                                .scaleY(1f)
                                .setDuration(160)
                                .start()
                        }
                        return true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = event.rawX - initialTouchX
                        val dy = event.rawY - initialTouchY
                        if (abs(dx) > 10 || abs(dy) > 10) {
                            hasMoved = true
                        }
                        currentParams.x = (initialX + dx).toInt()
                            .coerceIn(0, (currentScreenWidth - bubbleSizePx).coerceAtLeast(0))
                        currentParams.y = (initialY + dy).toInt()
                            .coerceIn(0, (currentScreenHeight - bubbleSizePx).coerceAtLeast(0))
                        windowManager?.updateViewLayout(container, currentParams)

                        // Proximity check to bottom dismiss target (Messenger grab-down-to-X)
                        val targetCenterX = currentScreenWidth / 2f
                        val targetCenterY = currentScreenHeight - dMarginBottom - dismissSizePx / 2f
                        val bubbleCenterX = currentParams.x + bubbleSizePx / 2f
                        val bubbleCenterY = currentParams.y + bubbleSizePx / 2f
                        val dist = kotlin.math.hypot(
                            (bubbleCenterX - targetCenterX).toDouble(),
                            (bubbleCenterY - targetCenterY).toDouble()
                        )
                        val threshold = 90 * v.resources.displayMetrics.density

                        if (dist < threshold) {
                            if (!isOverDismissZone) {
                                isOverDismissZone = true
                                v.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
                                dismissView?.let { dv ->
                                    val redBg = GradientDrawable().apply {
                                        shape = GradientDrawable.OVAL
                                        setColor(Color.parseColor("#DA3633"))
                                        setStroke((2.5f * v.resources.displayMetrics.density).toInt(), Color.parseColor("#FF727A"))
                                    }
                                    dv.background = redBg
                                    dv.animate().scaleX(1.22f).scaleY(1.22f).setDuration(120).start()
                                }
                                container.animate().scaleX(0.75f).scaleY(0.75f).alpha(0.8f).setDuration(100).start()
                            }
                        } else {
                            if (isOverDismissZone) {
                                isOverDismissZone = false
                                dismissView?.let { dv ->
                                    val normalBg = GradientDrawable().apply {
                                        shape = GradientDrawable.OVAL
                                        setColor(Color.parseColor("#E6161B22"))
                                        setStroke((2 * v.resources.displayMetrics.density).toInt(), Color.parseColor("#30363D"))
                                    }
                                    dv.background = normalBg
                                    dv.animate().scaleX(1f).scaleY(1f).setDuration(120).start()
                                }
                                container.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(100).start()
                            }
                        }
                        return true
                    }
                    MotionEvent.ACTION_UP -> {
                        // Fade out dismiss target
                        dismissView?.let { dv ->
                            dv.animate()
                                .alpha(0f)
                                .scaleX(0.8f)
                                .scaleY(0.8f)
                                .setDuration(140)
                                .withEndAction { dv.visibility = View.GONE }
                                .start()
                        }

                        if (isOverDismissZone) {
                            // User dragged bubble into bottom X to remove it
                            v.performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY)
                            container.animate()
                                .scaleX(0f)
                                .scaleY(0f)
                                .alpha(0f)
                                .setDuration(150)
                                .withEndAction {
                                    removeBubble()
                                    stopForegroundCompat()
                                    stopSelf()
                                }
                                .start()

                            try {
                                getSharedPreferences("obsidian_native", Context.MODE_PRIVATE)
                                    .edit()
                                    .putBoolean("overlay_enabled", false)
                                    .apply()
                            } catch (_: Exception) {}

                            try {
                                val dismissIntent = Intent(ACTION_OVERLAY_DISMISSED).apply {
                                    setPackage(packageName)
                                }
                                sendBroadcast(dismissIntent)
                            } catch (_: Exception) {}
                        } else {
                            container.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(100).start()
                            if (!hasMoved) {
                                toggleExpandedHud(currentParams.x, currentParams.y)
                            } else {
                                val snapMargin = (16 * v.resources.displayMetrics.density).toInt()
                                val midScreen = currentScreenWidth / 2
                                val targetX = if (currentParams.x + bubbleSizePx / 2 < midScreen) {
                                    snapMargin
                                } else {
                                    (currentScreenWidth - bubbleSizePx - snapMargin).coerceAtLeast(0)
                                }
                                currentParams.x = targetX
                                currentParams.y = currentParams.y
                                    .coerceIn(0, (currentScreenHeight - bubbleSizePx).coerceAtLeast(0))
                                windowManager?.updateViewLayout(container, currentParams)
                            }
                        }
                        return true
                    }
                    MotionEvent.ACTION_CANCEL -> {
                        dismissView?.let { dv ->
                            dv.animate()
                                .alpha(0f)
                                .scaleX(0.8f)
                                .scaleY(0.8f)
                                .setDuration(140)
                                .withEndAction { dv.visibility = View.GONE }
                                .start()
                        }
                        container.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(100).start()
                        return true
                    }
                }
                return false
            }
        })

        bubbleView = container
        try {
            windowManager?.addView(container, params)
        } catch (_: Exception) {
            bubbleView = null
            stopSelf()
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val container = bubbleView ?: return
        val currentParams = layoutParams ?: return
        val metrics = resources.displayMetrics
        val maxX = (metrics.widthPixels - bubbleSizePx).coerceAtLeast(0)
        val maxY = (metrics.heightPixels - bubbleSizePx).coerceAtLeast(0)
        currentParams.x = currentParams.x.coerceIn(0, maxX)
        currentParams.y = currentParams.y.coerceIn(0, maxY)
        try {
            windowManager?.updateViewLayout(container, currentParams)
        } catch (_: Exception) {
            // View was detached; ignore.
        }
    }

    private fun updateBubbleActivity(title: String, step: String, isRunning: Boolean, progress: Int) {
        lastTitle = title
        lastStep = step
        lastIsRunning = isRunning
        lastProgress = progress

        // 1. Update system foreground notification with real-time active task
        if (isForeground) {
            val manager = getSystemService(NotificationManager::class.java)
            val launchIntent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pendingIntent = PendingIntent.getActivity(
                this,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val notifText = if (isRunning) step else "Chat head active - tap to open the workstation"
            val notifTitle = if (isRunning) "OBSIDIAN: $title" else "OBSIDIAN overlay"

            val notifBuilder = NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_obsidian)
                .setContentTitle(notifTitle)
                .setContentText(notifText)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)

            if (isRunning && progress in 0..100) {
                notifBuilder.setProgress(100, progress, false)
            } else if (isRunning) {
                notifBuilder.setProgress(100, 0, true)
            }

            manager?.notify(NOTIFICATION_ID, notifBuilder.build())
        }

        // 2. Update visual bubble appearance on screen
        bubbleContainer?.let { container ->
            val metrics = resources.displayMetrics
            val bg = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#161B22"))
                setStroke(
                    ((if (isRunning) 2.5f else 1.5f) * metrics.density).toInt(),
                    Color.parseColor(if (isRunning) "#C7FF65" else "#30363D")
                )
            }
            container.background = bg
        }

        activityBadge?.let { badge ->
            badge.visibility = if (isRunning) View.VISIBLE else View.GONE
            if (isRunning) {
                badge.animate()
                    .scaleX(1.3f)
                    .scaleY(1.3f)
                    .setDuration(400)
                    .withEndAction {
                        badge.animate().scaleX(1f).scaleY(1f).setDuration(400).start()
                    }
                    .start()
            }
        }

        // 3. Update active expanded HUD overlay card if visible
        mainHandler.post {
            hudTitleView?.text = title
            hudStepView?.text = step
            hudStatusBadge?.apply {
                text = if (isRunning) "RUNNING" else "IDLE"
                setTextColor(Color.parseColor(if (isRunning) "#C7FF65" else "#8B949E"))
                (background as? GradientDrawable)?.apply {
                    setColor(Color.parseColor(if (isRunning) "#26C7FF65" else "#21262D"))
                    setStroke((1 * resources.displayMetrics.density).toInt(), Color.parseColor(if (isRunning) "#66C7FF65" else "#30363D"))
                }
            }
            if (progress in 0..100) {
                (hudProgressBar?.parent as? View)?.visibility = View.VISIBLE
                hudProgressBar?.progress = progress
                hudProgressText?.text = "$progress%"
            } else {
                (hudProgressBar?.parent as? View)?.visibility = View.GONE
            }
        }
    }

    private fun toggleExpandedHud(bubbleX: Int, bubbleY: Int) {
        val wm = windowManager ?: return
        if (expandedHudView != null) {
            collapseExpandedHud()
            return
        }

        val metrics = resources.displayMetrics
        val density = metrics.density
        val screenWidth = metrics.widthPixels
        val screenHeight = metrics.heightPixels

        val hudWidth = (280 * density).toInt().coerceAtMost((screenWidth * 0.88f).toInt())
        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val hParams = WindowManager.LayoutParams(
            hudWidth,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            val margin = (12 * density).toInt()
            val targetX = if (bubbleX > screenWidth / 2) {
                (bubbleX - hudWidth - margin).coerceAtLeast(margin)
            } else {
                (bubbleX + bubbleSizePx + margin).coerceAtMost(screenWidth - hudWidth - margin)
            }
            x = targetX
            y = bubbleY.coerceIn(margin, (screenHeight - (280 * density).toInt()).coerceAtLeast(margin))
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val pad = (14 * density).toInt()
            setPadding(pad, pad, pad, pad)
            val bg = GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = 16 * density
                setColor(Color.parseColor("#F0161B22"))
                setStroke((1.5f * density).toInt(), Color.parseColor("#30363D"))
            }
            background = bg
            elevation = 24f
        }

        // Header
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val titleText = TextView(this).apply {
            text = "OBSIDIAN Live Activity"
            setTextColor(Color.parseColor("#F0F6FC"))
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val badge = TextView(this).apply {
            text = if (lastIsRunning) "RUNNING" else "IDLE"
            setTextColor(Color.parseColor(if (lastIsRunning) "#C7FF65" else "#8B949E"))
            textSize = 10f
            typeface = Typeface.MONOSPACE
            val bPadH = (6 * density).toInt()
            val bPadV = (2 * density).toInt()
            setPadding(bPadH, bPadV, bPadH, bPadV)
            val bBg = GradientDrawable().apply {
                cornerRadius = 6 * density
                setColor(Color.parseColor(if (lastIsRunning) "#26C7FF65" else "#21262D"))
                setStroke((1 * density).toInt(), Color.parseColor(if (lastIsRunning) "#66C7FF65" else "#30363D"))
            }
            background = bBg
        }
        hudStatusBadge = badge
        val closeBtn = ImageView(this).apply {
            val icPad = (4 * density).toInt()
            setPadding(icPad, icPad, icPad, icPad)
            val closeBg = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.parseColor("#21262D"))
            }
            background = closeBg
            layoutParams = LinearLayout.LayoutParams((24 * density).toInt(), (24 * density).toInt()).apply {
                marginStart = (8 * density).toInt()
            }
            setColorFilter(Color.parseColor("#8B949E"))
            setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            setOnClickListener { collapseExpandedHud() }
        }
        header.addView(titleText)
        header.addView(badge)
        header.addView(closeBtn)
        root.addView(header)

        // Divider
        val div = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (1 * density).toInt()).apply {
                topMargin = (10 * density).toInt()
                bottomMargin = (10 * density).toInt()
            }
            setBackgroundColor(Color.parseColor("#30363D"))
        }
        root.addView(div)

        // Live task card
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val cPad = (10 * density).toInt()
            setPadding(cPad, cPad, cPad, cPad)
            val cBg = GradientDrawable().apply {
                cornerRadius = 10 * density
                setColor(Color.parseColor("#0D1117"))
                setStroke((1 * density).toInt(), Color.parseColor("#21262D"))
            }
            background = cBg
        }
        val actTitle = TextView(this).apply {
            text = lastTitle
            setTextColor(Color.parseColor("#C7FF65"))
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        hudTitleView = actTitle
        val actStep = TextView(this).apply {
            text = lastStep
            setTextColor(Color.parseColor("#8B949E"))
            textSize = 11f
            maxLines = 2
            ellipsize = TextUtils.TruncateAt.END
            val topM = (4 * density).toInt()
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = topM
            }
        }
        hudStepView = actStep
        card.addView(actTitle)
        card.addView(actStep)

        val progressRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            val pTop = (8 * density).toInt()
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = pTop
            }
            visibility = if (lastProgress in 0..100) View.VISIBLE else View.GONE
        }
        val pBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progress = if (lastProgress in 0..100) lastProgress else 0
            layoutParams = LinearLayout.LayoutParams(0, (6 * density).toInt(), 1f)
            val pBg = GradientDrawable().apply {
                cornerRadius = 3 * density
                setColor(Color.parseColor("#21262D"))
            }
            progressDrawable = GradientDrawable().apply {
                cornerRadius = 3 * density
                setColor(Color.parseColor("#C7FF65"))
            }
        }
        hudProgressBar = pBar
        val pText = TextView(this).apply {
            text = if (lastProgress in 0..100) "$lastProgress%" else ""
            setTextColor(Color.parseColor("#C7FF65"))
            textSize = 10f
            typeface = Typeface.MONOSPACE
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                marginStart = (6 * density).toInt()
            }
        }
        hudProgressText = pText
        progressRow.addView(pBar)
        progressRow.addView(pText)
        card.addView(progressRow)

        root.addView(card)

        // Actions Row
        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            val aTop = (12 * density).toInt()
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                topMargin = aTop
            }
        }

        fun createButton(label: String, targetTab: String?, isPrimary: Boolean): Button {
            return Button(this).apply {
                text = label
                textSize = 11f
                isAllCaps = false
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(Color.parseColor(if (isPrimary) "#0D1117" else "#F0F6FC"))
                val btnBg = GradientDrawable().apply {
                    cornerRadius = 8 * density
                    setColor(Color.parseColor(if (isPrimary) "#C7FF65" else "#21262D"))
                    if (!isPrimary) setStroke((1 * density).toInt(), Color.parseColor("#30363D"))
                }
                background = btnBg
                val vPad = (4 * density).toInt()
                setPadding(0, vPad, 0, vPad)
                layoutParams = LinearLayout.LayoutParams(0, (34 * density).toInt(), 1f).apply {
                    val m = (3 * density).toInt()
                    setMargins(m, 0, m, 0)
                }
                setOnClickListener {
                    collapseExpandedHud()
                    val launchIntent = Intent(this@FloatingBubbleService, MainActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                            Intent.FLAG_ACTIVITY_SINGLE_TOP or
                            Intent.FLAG_ACTIVITY_CLEAR_TOP
                        if (targetTab != null) {
                            putExtra("extra_navigate_tab", targetTab)
                        }
                    }
                    startActivity(launchIntent)
                }
            }
        }

        actions.addView(createButton("Chat", "chat", false))
        actions.addView(createButton("Terminal", "terminal", false))
        actions.addView(createButton("Open App", null, true))
        root.addView(actions)

        root.scaleX = 0.85f
        root.scaleY = 0.85f
        root.alpha = 0f
        root.animate()
            .scaleX(1f)
            .scaleY(1f)
            .alpha(1f)
            .setDuration(160)
            .start()

        wm.addView(root, hParams)
        expandedHudView = root
    }

    private fun collapseExpandedHud() {
        val view = expandedHudView ?: return
        expandedHudView = null
        hudTitleView = null
        hudStepView = null
        hudStatusBadge = null
        hudProgressBar = null
        hudProgressText = null
        view.animate()
            .scaleX(0.85f)
            .scaleY(0.85f)
            .alpha(0f)
            .setDuration(120)
            .withEndAction {
                try {
                    windowManager?.removeView(view)
                } catch (_: Exception) {}
            }
            .start()
    }

    private fun removeBubble() {
        collapseExpandedHud()
        dismissView?.let { dv ->
            try {
                windowManager?.removeView(dv)
            } catch (_: Exception) {}
            dismissView = null
        }
        bubbleView?.let { view ->
            try {
                windowManager?.removeView(view)
            } catch (_: Exception) {
                // View was already detached.
            }
            bubbleView = null
        }
        activityBadge = null
        bubbleContainer = null
        isForeground = false
    }

    override fun onDestroy() {
        removeBubble()
        stopForegroundCompat()
        super.onDestroy()
    }
}
