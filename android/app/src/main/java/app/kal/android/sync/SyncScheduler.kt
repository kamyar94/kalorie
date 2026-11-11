package app.kal.android.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.kal.android.Kal
import java.util.concurrent.TimeUnit

/**
 * When syncs run: about every hour with a network (only while Health Connect allows background
 * reads), and once when the app opens. "Send now" on the status screen runs one directly.
 */
object SyncScheduler {
    private const val PERIODIC = "kal-sync-hourly"
    private const val ONCE = "kal-sync-once"

    private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun ensurePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(1, TimeUnit.HOURS)
            .setConstraints(network)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** A sync soon, for example when the app opens (needs background access to read). */
    fun once(context: Context) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(network).build()
        WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.KEEP, request)
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).apply {
            cancelUniqueWork(PERIODIC)
            cancelUniqueWork(ONCE)
        }
    }

    /** When the hourly sync runs next (epoch milliseconds), or null when it is not scheduled. */
    fun nextRun(context: Context): Long? =
        try {
            WorkManager.getInstance(context)
                .getWorkInfosForUniqueWork(PERIODIC)
                .get()
                .firstOrNull { it.state == WorkInfo.State.ENQUEUED || it.state == WorkInfo.State.RUNNING }
                ?.nextScheduleTimeMillis
                ?.takeIf { it in 1 until Long.MAX_VALUE }
        } catch (_: Exception) {
            null
        }

    fun onAppOpen(context: Context) {
        if (Kal.healthConnectPossible) once(context)
    }
}

/** The background sync. Without background access Health Connect refuses, and it ends quietly. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (!Kal.healthConnectPossible) return Result.success()
        return when (SyncEngine.run(applicationContext)) {
            SyncOutcome.NETWORK, SyncOutcome.SERVER -> if (runAttemptCount < 3) Result.retry() else Result.success()
            else -> Result.success()
        }
    }
}
