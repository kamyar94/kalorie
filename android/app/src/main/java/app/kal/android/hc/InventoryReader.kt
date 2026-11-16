package app.kal.android.hc

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Instant
import java.time.Period
import java.time.ZoneId

/**
 * Counts what Health Connect holds for the last 30 days (board 35), only for the kinds Kal may
 * read ([granted]); a kind it may not read is counted as unknown. Read on the phone for the status
 * screen; nothing of it is sent.
 */
class InventoryReader(
    private val client: HealthConnectClient,
    private val zone: ZoneId,
    granted: Set<String>,
) {
    private val reader = HealthReader(client, zone, granted)

    suspend fun read(now: Instant = Instant.now()): List<KindCount> {
        val today = now.atZone(zone).toLocalDate()
        val first = today.minusDays(Inventory.DAYS - 1)
        val from = first.atStartOfDay(zone).toInstant()
        val day = { at: Instant -> at.atZone(zone).toLocalDate() }

        val steps =
            if (!reader.can(StepsRecord::class)) Inventory.noAccess(InventoryKind.STEP_DAYS)
            else Inventory.stepDays(
                client.aggregateGroupByPeriod(
                    AggregateGroupByPeriodRequest(
                        metrics = setOf(StepsRecord.COUNT_TOTAL),
                        timeRangeFilter = TimeRangeFilter.between(first.atStartOfDay(), today.plusDays(1).atStartOfDay()),
                        timeRangeSlicer = Period.ofDays(1),
                    ),
                ).map { group ->
                    DayTotal(
                        group.startTime.toLocalDate(),
                        group.result[StepsRecord.COUNT_TOTAL] ?: 0L,
                        group.result.dataOrigins.map { it.packageName },
                    )
                },
            )
        val workouts =
            if (!reader.can(ExerciseSessionRecord::class)) Inventory.noAccess(InventoryKind.WORKOUTS)
            else Inventory.workouts(
                reader.readAll(ExerciseSessionRecord::class, from, now)
                    .map { Stamp(day(it.startTime), it.metadata.dataOrigin.packageName) },
            )
        val resting =
            if (!reader.can(RestingHeartRateRecord::class)) Inventory.noAccess(InventoryKind.RESTING_DAYS)
            else Inventory.restingDays(
                reader.readAll(RestingHeartRateRecord::class, from, now)
                    .map { Stamp(day(it.time), it.metadata.dataOrigin.packageName) },
            )
        val sleep =
            if (!reader.can(SleepSessionRecord::class)) Inventory.noAccess(InventoryKind.SLEEP_NIGHTS)
            else Inventory.sleepNights(
                reader.readAll(SleepSessionRecord::class, from, now)
                    .map { Stamp(day(it.endTime), it.metadata.dataOrigin.packageName) },
            )
        val weighIns =
            if (!reader.can(WeightRecord::class)) Inventory.noAccess(InventoryKind.WEIGH_INS)
            else Inventory.weighIns(
                reader.readAll(WeightRecord::class, from, now)
                    .map { Stamp(day(it.time), it.metadata.dataOrigin.packageName) },
            )
        return listOf(steps, workouts, resting, sleep, weighIns)
    }
}
