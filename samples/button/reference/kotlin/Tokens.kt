import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object ColorToken {
    val brand500: Color = Color(0xff1a73e8)
    val buttonPrimaryBg: Color
        @Composable get() = if (isSystemInDarkTheme()) Color(0xff8ab4f8) else ColorToken.brand500
    val buttonPrimaryFg: Color
        @Composable get() = if (isSystemInDarkTheme()) ColorToken.neutral900 else ColorToken.neutral0
    val buttonSecondaryBg: Color
        @Composable get() = if (isSystemInDarkTheme()) Color(0xff303134) else ColorToken.neutral100
    val buttonSecondaryFg: Color
        @Composable get() = if (isSystemInDarkTheme()) ColorToken.neutral0 else ColorToken.neutral900
    val neutral0: Color = Color(0xffffffff)
    val neutral100: Color = Color(0xfff1f3f4)
    val neutral900: Color = Color(0xff1f1f1f)
}

object RadiusToken {
    val md: Dp = 8.dp
}

object SpaceToken {
    val md: Dp = 16.dp
    val sm: Dp = 8.dp
}

object TypoToken {
    val labelMdFontFamily: String = "Inter"
    val labelMdFontSize: TextUnit = 14.sp
    val labelMdFontWeight: Float = 600f
    val labelMdLineHeight: TextUnit = 20.sp
}
