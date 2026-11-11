package app.kal.android

import android.net.Uri
import android.os.Bundle
import app.kal.android.sync.SyncScheduler
import app.kal.android.store.TokenStore
import app.kal.android.update.UpdateCheck
import com.google.androidbrowserhelper.trusted.LauncherActivity

/**
 * Opens Kal full screen in a Trusted Web Activity (a Custom Tab where no browser can host one).
 * The start address carries the app's marker (AppUrl), so the site knows it runs in the app. On
 * open it checks for a newer app and asks for a sync when the phone is linked.
 */
class KalLauncherActivity : LauncherActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) {
            UpdateCheck.checkInBackground(this)
            if (TokenStore.has(this)) SyncScheduler.onAppOpen(applicationContext)
        }
    }

    override fun getLaunchingUrl(): Uri =
        Uri.parse(
            AppUrl.withMarker(
                super.getLaunchingUrl().toString(),
                Kal.host,
                Kal.healthConnectPossible,
                BuildConfig.VERSION_CODE,
            ),
        )
}
