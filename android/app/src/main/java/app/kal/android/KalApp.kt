package app.kal.android

import android.app.Application
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import app.kal.android.ui.HealthStatusActivity
import app.kal.android.update.UpdateCheck

/** Sets up the update notification channel and, where Health Connect runs, its launcher shortcut. */
class KalApp : Application() {
    override fun onCreate() {
        super.onCreate()
        UpdateCheck.createChannel(this)
        if (Kal.healthConnectPossible) addShortcut()
    }

    private fun addShortcut() {
        val manager = getSystemService(ShortcutManager::class.java) ?: return
        val shortcut = ShortcutInfo.Builder(this, "health-connect")
            .setShortLabel(getString(R.string.shortcut_health_short))
            .setLongLabel(getString(R.string.shortcut_health_long))
            .setIcon(Icon.createWithResource(this, R.mipmap.ic_launcher))
            .setIntent(Intent(this, HealthStatusActivity::class.java).setAction(Intent.ACTION_VIEW))
            .build()
        try {
            manager.dynamicShortcuts = listOf(shortcut)
        } catch (_: Exception) {
            // Some launchers limit shortcuts; the screen stays reachable from Kal for Android.
        }
    }
}
