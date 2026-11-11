package app.kal.android.update

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import app.kal.android.AppUrl
import app.kal.android.BuildConfig
import app.kal.android.Kal
import app.kal.android.KalLauncherActivity
import app.kal.android.R
import app.kal.android.net.KalApi
import app.kal.android.store.SyncState
import kotlin.concurrent.thread

/**
 * Asks the server which app version it hands out (GET /android/version.json), at most every six
 * hours. When it is newer than this one, the status screen says so and, once per version, a
 * notification offers the download page (More, Kal for Android).
 */
object UpdateCheck {
    private const val CHANNEL = "updates"
    private const val NOTIFICATION_ID = 7001
    private const val EVERY_MS = 6 * 60 * 60 * 1000L

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.update_channel), NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    fun checkInBackground(context: Context, force: Boolean = false) {
        val app = context.applicationContext
        val state = SyncState(app)
        if (!force && System.currentTimeMillis() - state.lastVersionCheckAt < EVERY_MS) return
        thread(name = "kal-update-check", isDaemon = true) {
            val latest = KalApi.latestVersion() ?: return@thread
            state.lastVersionCheckAt = System.currentTimeMillis()
            val (code, name) = latest
            if (code <= BuildConfig.VERSION_CODE) {
                state.newerVersionName = null
                return@thread
            }
            state.newerVersionName = name
            if (state.notifiedVersionCode != code && notify(app, name)) state.notifiedVersionCode = code
        }
    }

    /** The download page in the app. */
    fun downloadIntent(context: Context): Intent =
        Intent(context, KalLauncherActivity::class.java)
            .setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse(AppUrl.page(Kal.host, "/more/android", Kal.healthConnectPossible, BuildConfig.VERSION_CODE)))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    private fun notify(context: Context, versionName: String): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        val manager = context.getSystemService(NotificationManager::class.java) ?: return false
        val pending = PendingIntent.getActivity(
            context,
            0,
            downloadIntent(context),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        @Suppress("DEPRECATION")
        val builder =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) android.app.Notification.Builder(context, CHANNEL)
            else android.app.Notification.Builder(context)
        val notification = builder
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(context.getColor(R.color.kal_brand))
            .setContentTitle(context.getString(R.string.update_title))
            .setContentText(context.getString(R.string.update_text, versionName))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        manager.notify(NOTIFICATION_ID, notification)
        return true
    }
}
