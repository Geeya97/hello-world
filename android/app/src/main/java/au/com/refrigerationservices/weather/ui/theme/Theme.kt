package au.com.refrigerationservices.weather.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

/**
 * The palette is shared with web/styles.css and the Claude-space artifact so all
 * three surfaces read as one product. Keep the hex values in step if you change them.
 */

val Ink = Color(0xFFE2E8F0)
val InkDim = Color(0xFF94A3B8)
val InkFaint = Color(0xFF64748B)
val Bg0 = Color(0xFF060B16)
val Bg1 = Color(0xFF0B1425)
val Bg2 = Color(0xFF111C33)
val Line = Color(0xFF1E293B)
val Accent = Color(0xFF38BDF8)
val AccentSoft = Color(0xFF7DD3FC)
val Warm = Color(0xFFFBBF24)
val Bad = Color(0xFFFB7185)
val Good = Color(0xFF34D399)

private val DarkColors = darkColorScheme(
    primary = Accent,
    onPrimary = Color(0xFF04121F),
    secondary = Warm,
    onSecondary = Color(0xFF1C1204),
    background = Bg0,
    onBackground = Ink,
    surface = Bg1,
    onSurface = Ink,
    surfaceVariant = Bg2,
    onSurfaceVariant = InkDim,
    outline = Line,
    error = Bad,
    onError = Color(0xFF2B0710),
)

private val LightColors = lightColorScheme(
    primary = Color(0xFF0B7FC4),
    onPrimary = Color.White,
    secondary = Color(0xFFB45309),
    background = Color(0xFFEEF3FB),
    onBackground = Color(0xFF0F1E33),
    surface = Color.White,
    onSurface = Color(0xFF0F1E33),
    surfaceVariant = Color(0xFFF1F5FC),
    onSurfaceVariant = Color(0xFF4A5C77),
    outline = Color(0xFFD3DDEC),
    error = Color(0xFFBE123C),
)

/** Reports are fixed-width art; they must render in a monospace face. */
val ReportTextStyle = TextStyle(
    fontFamily = FontFamily.Monospace,
    fontSize = 11.sp,
    lineHeight = 16.sp,
)

private val AppTypography = Typography(
    headlineSmall = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Bold, lineHeight = 28.sp),
    titleMedium = TextStyle(fontSize = 17.sp, fontWeight = FontWeight.SemiBold, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 21.sp),
    bodySmall = TextStyle(fontSize = 12.5.sp, lineHeight = 19.sp),
    labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.8.sp),
)

@Composable
fun CurrentWeatherTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) DarkColors else LightColors
    val view = LocalView.current

    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(colorScheme = colors, typography = AppTypography, content = content)
}
