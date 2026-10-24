package io.anvil.workstation.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

object ObsidianPalette {
    val Background = Color(0xFF0D1117)
    val BackgroundDeep = Color(0xFF080B0F)
    val Surface = Color(0xFF161B22)
    val SurfaceElevated = Color(0xFF1C2128)
    val SurfaceMuted = Color(0xFF21262D)
    val Border = Color(0xFF30363D)
    val BorderSubtle = Color(0xFF21262D)
    val Accent = Color(0xFFC7FF65)
    val AccentDim = Color(0xFF9CCF4B)
    val TextPrimary = Color(0xFFF0F6FC)
    val TextSecondary = Color(0xFF8B949E)
    val TextMuted = Color(0xFF6E7681)
    val Info = Color(0xFF58A6FF)
    val Success = Color(0xFF3FB950)
    val Warning = Color(0xFFD29922)
    val Danger = Color(0xFFFF727A)
}

private val ObsidianColorScheme = darkColorScheme(
    primary = ObsidianPalette.Accent,
    onPrimary = ObsidianPalette.Background,
    primaryContainer = ObsidianPalette.Accent,
    onPrimaryContainer = ObsidianPalette.Background,
    secondary = ObsidianPalette.Info,
    onSecondary = ObsidianPalette.Background,
    background = ObsidianPalette.Background,
    onBackground = ObsidianPalette.TextPrimary,
    surface = ObsidianPalette.Surface,
    onSurface = ObsidianPalette.TextPrimary,
    surfaceVariant = ObsidianPalette.SurfaceMuted,
    onSurfaceVariant = ObsidianPalette.TextSecondary,
    outline = ObsidianPalette.Border,
    outlineVariant = ObsidianPalette.BorderSubtle,
    error = ObsidianPalette.Danger,
    onError = ObsidianPalette.Background,
)

@Composable
fun ObsidianTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = ObsidianColorScheme,
        content = content,
    )
}
