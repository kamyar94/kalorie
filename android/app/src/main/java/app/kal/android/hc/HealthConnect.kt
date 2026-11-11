package app.kal.android.hc

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.BasalMetabolicRateRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.BodyWaterMassRecord
import androidx.health.connect.client.records.BoneMassRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeightRecord
import androidx.health.connect.client.records.LeanBodyMassRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.WeightRecord
import kotlin.reflect.KClass

/**
 * Health Connect's availability and Kal's read permissions. The record classes are touched only
 * lazily, and callers check [supported] (or Kal.healthConnectPossible) before anything else: the
 * client library needs Android 9 or newer, older phones never load it.
 */
object HealthConnect {
    const val PROVIDER = "com.google.android.apps.healthdata"

    val supported: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P

    enum class Availability { OLD_ANDROID, MISSING, NEEDS_UPDATE, READY }

    fun availability(context: Context): Availability {
        if (!supported) return Availability.OLD_ANDROID
        return when (HealthConnectClient.getSdkStatus(context, PROVIDER)) {
            HealthConnectClient.SDK_AVAILABLE -> Availability.READY
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> Availability.NEEDS_UPDATE
            else -> Availability.MISSING
        }
    }

    fun client(context: Context): HealthConnectClient = HealthConnectClient.getOrCreate(context)

    /** Steps, workouts (with their distance, energy and heart rate), resting heart rate, sleep. */
    val ACTIVITY_TYPES: List<KClass<out Record>> by lazy {
        listOf(
        StepsRecord::class,
        ExerciseSessionRecord::class,
        DistanceRecord::class,
        ActiveCaloriesBurnedRecord::class,
        TotalCaloriesBurnedRecord::class,
        HeartRateRecord::class,
        RestingHeartRateRecord::class,
        SleepSessionRecord::class,
        )
    }

    /** Weight, body composition, BMR and height. */
    val BODY_TYPES: List<KClass<out Record>> by lazy {
        listOf(
        WeightRecord::class,
        BodyFatRecord::class,
        LeanBodyMassRecord::class,
        BoneMassRecord::class,
        BodyWaterMassRecord::class,
        BasalMetabolicRateRecord::class,
        HeightRecord::class,
        )
    }

    val ACTIVITY_PERMISSIONS: Set<String> by lazy {
        ACTIVITY_TYPES.map { HealthPermission.getReadPermission(it) }.toSet()
    }
    val BODY_PERMISSIONS: Set<String> by lazy { BODY_TYPES.map { HealthPermission.getReadPermission(it) }.toSet() }
    val READ_PERMISSIONS: Set<String> by lazy { ACTIVITY_PERMISSIONS + BODY_PERMISSIONS }

    const val BACKGROUND = HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND
    const val HISTORY = HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY

    /** Reading while no Kal screen is open (Health Connect's newer versions only). */
    fun backgroundAvailable(client: HealthConnectClient): Boolean =
        client.features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND) ==
            HealthConnectFeatures.FEATURE_STATUS_AVAILABLE

    /** Reading records older than 30 days before access was given. */
    fun historyAvailable(client: HealthConnectClient): Boolean =
        client.features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY) ==
            HealthConnectFeatures.FEATURE_STATUS_AVAILABLE

    /** What to ask for: every read permission, background when wanted and possible, history. */
    fun toRequest(client: HealthConnectClient, background: Boolean): Set<String> =
        READ_PERMISSIONS +
            (if (background && backgroundAvailable(client)) setOf(BACKGROUND) else emptySet()) +
            (if (historyAvailable(client)) setOf(HISTORY) else emptySet())

    /** Health Connect's page in the Play Store (Android 9 to 13), to install or update it. */
    fun openStore(context: Context) {
        val market = Intent(
            Intent.ACTION_VIEW,
            Uri.parse("market://details?id=$PROVIDER&url=healthconnect%3A%2F%2Fonboarding"),
        ).setPackage("com.android.vending").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(market)
        } catch (_: ActivityNotFoundException) {
            context.startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$PROVIDER"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }
    }

    /** Health Connect's own settings, where access can be changed. */
    fun openSettings(context: Context) {
        try {
            context.startActivity(Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS))
        } catch (_: ActivityNotFoundException) {
            openStore(context)
        }
    }
}
