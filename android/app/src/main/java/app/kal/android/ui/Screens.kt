package app.kal.android.ui

import android.os.Build
import android.view.View
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Edge to edge (Android 15 and newer insist on it): the screen draws behind the bars and the
 * scrolling root keeps its own padding plus the bars' and the cutout's.
 */
fun ComponentActivity.fitToWindow(root: View) {
    enableEdgeToEdge()
    val left = root.paddingLeft
    val top = root.paddingTop
    val right = root.paddingRight
    val bottom = root.paddingBottom
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        view.setPadding(left + bars.left, top + bars.top, right + bars.right, bottom + bars.bottom)
        insets
    }
}

/** Marks a view as a heading for screen readers (the attribute in XML needs Android 9). */
fun View.asHeading() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) isAccessibilityHeading = true
    else ViewCompat.setAccessibilityHeading(this, true)
}
