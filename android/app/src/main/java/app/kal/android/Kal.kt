package app.kal.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build

/** This build's Kal server and the ways into the web app. */
object Kal {
    /** The server's host name, a build property (kal.host). */
    val host: String get() = BuildConfig.KAL_HOST

    val baseUrl: String get() = "https://$host"

    /** "1.0 (1)" for the server's list of phones. */
    val appVersion: String get() = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"

    /** Health Connect runs on Android 9 and newer; older phones get the web app only. */
    val healthConnectPossible: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P

    /** Opens Kal at [path] full screen (the Trusted Web Activity). */
    fun open(context: Context, path: String = "/") {
        val url = AppUrl.page(host, path, healthConnectPossible, BuildConfig.VERSION_CODE)
        context.startActivity(
            Intent(context, KalLauncherActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse(url))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}
