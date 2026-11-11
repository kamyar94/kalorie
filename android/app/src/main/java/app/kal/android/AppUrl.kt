package app.kal.android

import java.net.URI
import java.net.URLEncoder

/**
 * The address the app opens Kal at. On Kal's own host it tells the site that it runs inside the
 * app (source=android-app), whether this phone can run Health Connect (hc=1 from Android 9 on)
 * and the app's version, so the site shows "Connect Health Connect" and offers newer versions
 * (lib/contracts/android.ts on the server). Other addresses are left as they are.
 */
object AppUrl {
    private val MARKERS = setOf("source", "hc", "appVersion")

    fun withMarker(url: String, host: String, healthConnect: Boolean, versionCode: Int): String {
        val uri = try {
            URI(url)
        } catch (_: Exception) {
            return url
        }
        val authority = uri.rawAuthority ?: return url
        if (uri.scheme != "https" || !authority.equals(host, ignoreCase = true)) return url
        val kept = (uri.rawQuery ?: "")
            .split('&')
            .filter { it.isNotEmpty() && it.substringBefore('=') !in MARKERS }
        val marker = listOf(
            "source=android-app",
            "hc=${if (healthConnect) 1 else 0}",
            "appVersion=$versionCode",
        )
        val query = (kept + marker).joinToString("&")
        val path = uri.rawPath?.takeIf { it.isNotEmpty() } ?: "/"
        val fragment = uri.rawFragment?.let { "#$it" } ?: ""
        return "https://$authority$path?$query$fragment"
    }

    /** Kal's page at [path] on [host], marked as opened from the app. */
    fun page(host: String, path: String, healthConnect: Boolean, versionCode: Int): String =
        withMarker("https://$host$path", host, healthConnect, versionCode)

    fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")
}
