package app.kal.android.sync

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

// What the app read from Health Connect, in plain Kotlin types (no Health Connect classes), so
// the mapping and the payloads can be tested on the JVM. HealthReader fills these.

/** A day's step total from Health Connect's aggregate (it merges the phone and the watch). */
data class StepsDay(val date: LocalDate, val count: Long, val sourceApp: String?)

/** An exercise session with the totals Health Connect aggregated over its time. */
data class Workout(
    val id: String,
    val exerciseType: Int,
    val title: String?,
    val start: Instant,
    val end: Instant,
    val startOffset: ZoneOffset?,
    val distanceM: Double? = null,
    val activeKcal: Double? = null,
    val totalKcal: Double? = null,
    val steps: Long? = null,
    val avgHeartRate: Long? = null,
    val maxHeartRate: Long? = null,
    val sourceApp: String?,
)

/** Kal's body measure codes the app sends (lib/contracts/health-connect.ts HC_BODY_CODES). */
enum class BodyCode(val wire: String) {
    WEIGHT("weight"),
    BODY_FAT("body_fat"),
    LEAN_MASS("fat_free"),
    BONE_MASS("bone"),
    WATER_MASS("water_mass"),
    BMR("bmr"),
}

/** One body value: kg for masses, % for body fat, kcal a day for BMR. */
data class BodyValue(
    val id: String,
    val code: BodyCode,
    val value: Double,
    val at: Instant,
    val sourceApp: String?,
)

/** A day's resting heart rate; null when the day has none (any more). */
data class RestingDay(val date: LocalDate, val bpm: Double?, val sourceApp: String?)

data class SleepStage(val start: Instant, val end: Instant, val type: Int)

data class Sleep(
    val id: String,
    val start: Instant,
    val end: Instant,
    val title: String?,
    val stages: List<SleepStage>,
    val sourceApp: String?,
)

data class Height(val cm: Double, val at: Instant)

/** Everything one sync read, ready to be sent. */
data class Collected(
    val steps: List<StepsDay> = emptyList(),
    val workouts: List<Workout> = emptyList(),
    val body: List<BodyValue> = emptyList(),
    val resting: List<RestingDay> = emptyList(),
    val sleep: List<Sleep> = emptyList(),
    val height: Height? = null,
    val deleted: List<String> = emptyList(),
) {
    val isEmpty: Boolean
        get() =
            steps.isEmpty() && workouts.isEmpty() && body.isEmpty() && resting.isEmpty() &&
                sleep.isEmpty() && height == null && deleted.isEmpty()
}
