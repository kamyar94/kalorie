package app.kal.android.hc

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.os.Build

/**
 * The apps that write to Health Connect, as this phone knows them: whether Samsung Health and a
 * Renpho app are installed, their launcher labels, and opening Samsung Health. The manifest's
 * <queries> make Samsung Health, Renpho's known packages and launchable apps visible (Renpho's
 * package differs by region, so a launchable app whose label contains "Renpho" counts too).
 */
object HealthApps {
    private fun applicationInfo(pm: PackageManager, packageName: String): ApplicationInfo? =
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getApplicationInfo(packageName, PackageManager.ApplicationInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.getApplicationInfo(packageName, 0)
            }
        } catch (_: PackageManager.NameNotFoundException) {
            null
        }

    private fun launchable(pm: PackageManager): List<ResolveInfo> {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            pm.queryIntentActivities(intent, 0)
        }
    }

    /** The app's name as the launcher shows it, else a known name, else the package. */
    fun label(context: Context, packageName: String): String {
        val pm = context.packageManager
        val fromPhone = applicationInfo(pm, packageName)?.let { pm.getApplicationLabel(it).toString() }
        return fromPhone?.takeIf { it.isNotBlank() && it != packageName }
            ?: Inventory.knownName(packageName)
            ?: packageName
    }

    fun samsungHealth(context: Context): InstalledApp? =
        applicationInfo(context.packageManager, Inventory.SAMSUNG_HEALTH)?.let {
            InstalledApp(Inventory.SAMSUNG_HEALTH, label(context, Inventory.SAMSUNG_HEALTH))
        }

    /** A Renpho app: one of the known packages, else a launchable app labelled "Renpho...". */
    fun renpho(context: Context): InstalledApp? {
        val pm = context.packageManager
        Inventory.RENPHO_PACKAGES.firstOrNull { applicationInfo(pm, it) != null }?.let {
            return InstalledApp(it, label(context, it))
        }
        return try {
            launchable(pm)
                .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
                .firstOrNull { (pkg, label) -> Inventory.isRenpho(pkg, label) }
                ?.let { (pkg, label) -> InstalledApp(pkg, label) }
        } catch (_: RuntimeException) {
            null
        }
    }

    /** Opens an installed app at its start screen; false when it has none. */
    fun open(context: Context, packageName: String): Boolean {
        val intent = context.packageManager.getLaunchIntentForPackage(packageName) ?: return false
        return try {
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (_: ActivityNotFoundException) {
            false
        }
    }

    fun canOpen(context: Context, packageName: String): Boolean =
        context.packageManager.getLaunchIntentForPackage(packageName) != null
}
