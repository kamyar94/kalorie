package app.kal.android.hc

import app.kal.android.sync.BodyCode
import app.kal.android.sync.BodyValue
import app.kal.android.sync.Height
import app.kal.android.sync.RestingDay
import app.kal.android.sync.Sleep
import app.kal.android.sync.SleepStage
import app.kal.android.sync.StepsDay
import app.kal.android.sync.Workout
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.aggregate.AggregateMetric
import androidx.health.connect.client.response.ChangesResponse
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
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Instant
import java.time.LocalDate
import java.time.Period
import java.time.ZoneId
import kotlin.reflect.KClass

/**
 * Reads Health Connect for one sync, only the record types the person allowed ([granted]), and
 * turns records into the plain model of sync/Model.kt. Steps and resting heart rate come from
 * Health Connect's aggregates per local day, which merge the phone and the watch without counting
 * twice; workouts get their distance, energy and heart rate aggregated over the session's time.
 */
class HealthReader(
    private val client: HealthConnectClient,
    private val zone: ZoneId,
    private val granted: Set<String>,
) {
    fun can(type: KClass<out Record>) = HealthPermission.getReadPermission(type) in granted

    /** A changes token for [types], taken before a full read so nothing falls between. */
    suspend fun changesToken(types: List<KClass<out Record>>): String =
        client.getChangesToken(ChangesTokenRequest(recordTypes = types.toSet()))

    suspend fun changes(token: String): ChangesResponse = client.getChanges(token)

    suspend fun <T : Record> readAll(type: KClass<T>, from: Instant, to: Instant): List<T> {
        if (!can(type)) return emptyList()
        val out = mutableListOf<T>()
        var page: String? = null
        do {
            val response = client.readRecords(
                ReadRecordsRequest(
                    recordType = type,
                    timeRangeFilter = TimeRangeFilter.between(from, to),
                    pageSize = 1000,
                    pageToken = page,
                ),
            )
            out += response.records
            page = response.pageToken
        } while (page != null)
        return out
    }

    private suspend fun <T : Any> perDay(
        metric: AggregateMetric<T>,
        days: Collection<LocalDate>,
    ): Map<LocalDate, Pair<T?, String?>> {
        if (days.isEmpty()) return emptyMap()
        val groups = client.aggregateGroupByPeriod(
            AggregateGroupByPeriodRequest(
                metrics = setOf(metric),
                timeRangeFilter = TimeRangeFilter.between(
                    days.min().atStartOfDay(),
                    days.max().plusDays(1).atStartOfDay(),
                ),
                timeRangeSlicer = Period.ofDays(1),
            ),
        )
        return groups.associate { group ->
            group.startTime.toLocalDate() to
                (group.result[metric] to group.result.dataOrigins.map { it.packageName }.distinct().singleOrNull())
        }
    }

    /** Day totals of steps; a day without steps has count 0. */
    suspend fun stepsDays(days: Collection<LocalDate>): List<StepsDay> {
        if (!can(StepsRecord::class)) return emptyList()
        val totals = perDay(StepsRecord.COUNT_TOTAL, days)
        return days.distinct().sorted().map { day ->
            val (count, origin) = totals[day] ?: (null to null)
            StepsDay(day, count ?: 0L, origin)
        }
    }

    /** The day's resting heart rate (the average of its readings); null for a day without. */
    suspend fun restingDays(days: Collection<LocalDate>): List<RestingDay> {
        if (!can(RestingHeartRateRecord::class)) return emptyList()
        val values = perDay(RestingHeartRateRecord.BPM_AVG, days)
        return days.distinct().sorted().map { day ->
            val (bpm, origin) = values[day] ?: (null to null)
            RestingDay(day, bpm?.toDouble()?.takeIf { it > 0 }, origin)
        }
    }

    /** A session with what Health Connect knows about its time. */
    suspend fun workout(session: ExerciseSessionRecord): Workout {
        val metrics = buildSet<AggregateMetric<*>> {
            if (can(DistanceRecord::class)) add(DistanceRecord.DISTANCE_TOTAL)
            if (can(ActiveCaloriesBurnedRecord::class)) add(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
            if (can(TotalCaloriesBurnedRecord::class)) add(TotalCaloriesBurnedRecord.ENERGY_TOTAL)
            if (can(StepsRecord::class)) add(StepsRecord.COUNT_TOTAL)
            if (can(HeartRateRecord::class)) {
                add(HeartRateRecord.BPM_AVG)
                add(HeartRateRecord.BPM_MAX)
            }
        }
        val base = Workout(
            id = session.metadata.id,
            exerciseType = session.exerciseType,
            title = session.title,
            start = session.startTime,
            end = session.endTime,
            startOffset = session.startZoneOffset,
            sourceApp = session.metadata.dataOrigin.packageName,
        )
        if (metrics.isEmpty()) return base
        return try {
            val result = client.aggregate(
                AggregateRequest(metrics, TimeRangeFilter.between(session.startTime, session.endTime)),
            )
            base.copy(
                distanceM = result[DistanceRecord.DISTANCE_TOTAL]?.inMeters,
                activeKcal = result[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories,
                totalKcal = result[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.inKilocalories,
                steps = result[StepsRecord.COUNT_TOTAL],
                avgHeartRate = result[HeartRateRecord.BPM_AVG],
                maxHeartRate = result[HeartRateRecord.BPM_MAX],
            )
        } catch (_: Exception) {
            // Health Connect may refuse an aggregate (rate limits); the session still counts.
            base
        }
    }

    fun sleep(record: SleepSessionRecord) = Sleep(
        id = record.metadata.id,
        start = record.startTime,
        end = record.endTime,
        title = record.title,
        stages = record.stages.map { SleepStage(it.startTime, it.endTime, it.stage) },
        sourceApp = record.metadata.dataOrigin.packageName,
    )

    fun height(record: HeightRecord) = Height(record.height.inMeters * 100, record.time)

    /** A body record as one of Kal's measures; null for other records. */
    fun body(record: Record): BodyValue? {
        val origin = record.metadata.dataOrigin.packageName
        val id = record.metadata.id
        return when (record) {
            is WeightRecord -> BodyValue(id, BodyCode.WEIGHT, record.weight.inKilograms, record.time, origin)
            is BodyFatRecord -> BodyValue(id, BodyCode.BODY_FAT, record.percentage.value, record.time, origin)
            is LeanBodyMassRecord -> BodyValue(id, BodyCode.LEAN_MASS, record.mass.inKilograms, record.time, origin)
            is BoneMassRecord -> BodyValue(id, BodyCode.BONE_MASS, record.mass.inKilograms, record.time, origin)
            is BodyWaterMassRecord -> BodyValue(id, BodyCode.WATER_MASS, record.mass.inKilograms, record.time, origin)
            is BasalMetabolicRateRecord ->
                BodyValue(id, BodyCode.BMR, record.basalMetabolicRate.inKilocaloriesPerDay, record.time, origin)
            else -> null
        }
    }

    /** Every body record of the allowed types in a window. */
    suspend fun bodyBetween(from: Instant, to: Instant): List<BodyValue> =
        listOf(
            WeightRecord::class,
            BodyFatRecord::class,
            LeanBodyMassRecord::class,
            BoneMassRecord::class,
            BodyWaterMassRecord::class,
            BasalMetabolicRateRecord::class,
        ).flatMap { type -> readAll(type, from, to).mapNotNull { body(it) } }

    /** The local days a records' time span touches. */
    fun daysOf(start: Instant, end: Instant): List<LocalDate> {
        val first = start.atZone(zone).toLocalDate()
        val last = end.atZone(zone).toLocalDate()
        return generateSequence(first) { it.plusDays(1) }.takeWhile { !it.isAfter(last) }.toList()
    }
}
