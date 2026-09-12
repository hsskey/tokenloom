import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object ColorToken {
    val buttonPrimaryBg: Color
        @Composable get() = if (isSystemInDarkTheme()) Color(0xff60a5fa) else Color(0xff2563eb)
    val buttonPrimaryFg: Color
        @Composable get() = if (isSystemInDarkTheme()) Color(0xff0f172a) else Color(0xffffffff)
    val buttonSecondaryBg: Color
        @Composable get() = if (isSystemInDarkTheme()) Color(0xff334155) else Color(0xffe2e8f0)
    val buttonSecondaryFg: Color
        @Composable get() = if (isSystemInDarkTheme()) Color(0xfff8fafc) else Color(0xff1e293b)
}

object SpaceToken {
    val md: Dp = 16.dp
    val sm: Dp = 8.dp
}

object TypoToken {
    val labelMdFontFamily: String = "Inter"
    val labelMdFontSize: TextUnit = 14.sp
    val labelMdFontWeight: Float = 600f
    val labelMdLetterSpacing: TextUnit = 0.sp
    val labelMdLineHeight: TextUnit = 20.sp
}
