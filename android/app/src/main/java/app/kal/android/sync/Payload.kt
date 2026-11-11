package app.kal.android.sync

import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/**
 * Builds the JSON batches for POST /api/health-connect/sync (lib/contracts/health-connect.ts on
 * the server). Records are split into batches of at most [maxRecords]; deletions travel in the
 * first batches. Every batch carries the phone's time zone and the app's version.
 */
object Payload {
    const val MAX_RECORDS = 1000
    const val MAX_DELETED = 4000

    private fun time(at: Instant) = at.truncatedTo(ChronoUnit.MILLIS).toString()

    private fun round(value: Double, places: Int): Double {
        val factor = Math.pow(10.0, places.toDouble())
        return Math.round(value * factor) / factor
    }

    fun steps(day: StepsDay): Map<String, Any?> =
        linkedMapOf("date" to day.date.toString(), "count" to day.count.coerceAtLeast(0), "sourceApp" to day.sourceApp)

    fun workout(w: Workout, zone: ZoneId): Map<String, Any?> {
        val type = ExerciseTypes.of(w.exerciseType)
        val offset = w.startOffset ?: zone.rules.getOffset(w.start)
        val title = w.title?.replace(Regex("\\s+"), " ")?.trim()?.take(80)?.takeIf { it.isNotEmpty() }
        val energy = w.activeKcal?.takeIf { it > 0 } ?: w.totalKcal?.takeIf { it > 0 }
        return linkedMapOf(
            "id" to w.id,
            "category" to type.category,
            "type" to type.id,
            "title" to (title ?: type.label),
            "start" to time(w.start),
            "end" to time(w.end),
            "localDate" to w.start.atOffset(offset).toLocalDate().toString(),
            "distanceM" to w.distanceM?.takeIf { it > 0 }?.let { round(it, 1) },
            "energyKcal" to energy?.let { round(it, 1) },
            "steps" to w.steps?.takeIf { it > 0 },
            "avgHeartRate" to w.avgHeartRate?.takeIf { it in 20..250 },
            "maxHeartRate" to w.maxHeartRate?.takeIf { it in 20..250 },
            "sourceApp" to w.sourceApp,
        )
    }

    fun body(b: BodyValue): Map<String, Any?> =
        linkedMapOf(
            "id" to b.id,
            "code" to b.code.wire,
            "value" to round(b.value, 2),
            "at" to time(b.at),
            "sourceApp" to b.sourceApp,
        )

    fun resting(r: RestingDay): Map<String, Any?> =
        linkedMapOf("date" to r.date.toString(), "bpm" to r.bpm?.let { round(it, 1) }, "sourceApp" to r.sourceApp)

    fun sleep(s: Sleep): Map<String, Any?> =
        linkedMapOf(
            "id" to s.id,
            "start" to time(s.start),
            "end" to time(s.end),
            "title" to s.title?.trim()?.take(80)?.takeIf { it.isNotEmpty() },
            "stages" to SleepStages.minutes(s.stages),
            "sourceApp" to s.sourceApp,
        )

    /** The batches to send, in order; empty when there is nothing to send. */
    fun batches(
        collected: Collected,
        zone: ZoneId,
        appVersion: String,
        maxRecords: Int = MAX_RECORDS,
        maxDeleted: Int = MAX_DELETED,
    ): List<String> {
        val records: List<Pair<String, Map<String, Any?>>> =
            collected.steps.map { "steps" to steps(it) } +
                collected.workouts.map { "workouts" to workout(it, zone) } +
                collected.body.map { "body" to body(it) } +
                collected.resting.map { "restingHeartRate" to resting(it) } +
                collected.sleep.map { "sleep" to sleep(it) }
        val recordChunks = records.chunked(maxRecords)
        val deletedChunks = collected.deleted.distinct().chunked(maxDeleted)
        val count = maxOf(recordChunks.size, deletedChunks.size, if (collected.height != null) 1 else 0)
        return (0 until count).map { index ->
            val chunk = recordChunks.getOrElse(index) { emptyList() }
            val batch = linkedMapOf<String, Any?>("tz" to zone.id, "appVersion" to appVersion)
            for (kind in listOf("steps", "workouts", "body", "restingHeartRate", "sleep")) {
                val items = chunk.filter { it.first == kind }.map { it.second }
                if (items.isNotEmpty()) batch[kind] = items
            }
            if (index == 0) collected.height?.let { batch["height"] = linkedMapOf("cm" to round(it.cm, 1), "at" to time(it.at)) }
            deletedChunks.getOrNull(index)?.let { batch["deleted"] = it }
            Json.write(batch)
        }
    }
}

/**
 * Changes read from Health Connect, in order: a record changed and then deleted ends up deleted,
 * one deleted and then written again ends up written.
 */
class ChangeLog<T>(private val idOf: (T) -> String) {
    private val upserts = LinkedHashMap<String, T>()
    private val deletions = LinkedHashSet<String>()

    fun upsert(record: T) {
        val id = idOf(record)
        deletions.remove(id)
        upserts.remove(id)
        upserts[id] = record
    }

    fun delete(id: String) {
        upserts.remove(id)
        deletions.add(id)
    }

    val written: List<T> get() = upserts.values.toList()
    val deleted: List<String> get() = deletions.toList()
}
