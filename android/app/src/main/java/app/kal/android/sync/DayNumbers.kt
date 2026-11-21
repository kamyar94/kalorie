package app.kal.android.sync

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

// A day's three numbers as Samsung Health shows them: steps, active time and activity calories
// (lib/contracts/health-connect.ts HcDayTotal on the server). HealthReader reads what they are made
// of; the arithmetic is here, in plain Kotlin, so it can be tested on the JVM.

/**
 * One local day: steps (Health Connect's aggregate, which merges the phone and the watch without
 * counting a step twice), active time in minutes ([ActiveTime]) and activity calories
 * (ActiveCaloriesBurnedRecord's aggregate), each with the app that wrote most of it. A null
 * number: Kal may not read what it is made of, or reading it failed.
 */
data class DayNumbers(
    val date: LocalDate,
    val steps: Long?,
    val stepsApp: String?,
    val activeMinutes: Int?,
    val activeApp: String?,
    val activeKcal: Double?,
    val kcalApp: String?,
) {
    /** How the active time was worked out; sent with the value. */
    val activeMethod: String? get() = if (activeMinutes != null) ActiveTime.METHOD else null

    /** Nothing to show: every number is 0 or unknown. */
    val isEmpty: Boolean
        get() = (steps ?: 0L) <= 0L && (activeMinutes ?: 0) <= 0 && (activeKcal ?: 0.0) <= 0.0
}

/**
 * A stretch of time that may count as active: an exercise session ([steps] null), or a step
 * record with its count. [app] is the package of the app that wrote it.
 */
data class Span(val start: Instant, val end: Instant, val app: String?, val steps: Long? = null)

/** Health Connect's total per day, and each app's own total per day (to name who wrote most). */
data class PerDay<V : Number>(
    val totals: Map<LocalDate, V> = emptyMap(),
    val byApp: Map<String, Map<LocalDate, V>> = emptyMap(),
    /** The day's only app, when Health Connect's total came from one. */
    val single: Map<LocalDate, String?> = emptyMap(),
)

/**
 * Active time. Health Connect has no record of it, so it is worked out the way a watch counts it:
 * the minutes of the day covered by exercise sessions, joined with the minutes of step records
 * walked at [STEPS_PER_MINUTE] steps a minute or more (a record's steps spread evenly over its
 * time, so its rate is its count over its length). A minute covered by two records (the phone and
 * the watch, or a walk inside a workout) counts once. Spans are cut at the day's local midnights,
 * so a day of 23 or 25 hours (a clock change) is right too.
 */
object ActiveTime {
    /** Sent with the value, so the server can tell how it was counted. */
    const val METHOD = "sessions+steps60"
    const val STEPS_PER_MINUTE = 60.0

    /** Whether a span counts: a session of some length, or a step record at the rate or above. */
    fun counts(span: Span): Boolean {
        val ms = Duration.between(span.start, span.end).toMillis()
        if (ms <= 0) return false
        val steps = span.steps ?: return true
        return steps * 60_000.0 / ms >= STEPS_PER_MINUTE
    }

    /** Milliseconds covered by [intervals] (start, end in epoch ms), each moment once. */
    fun covered(intervals: List<Pair<Long, Long>>): Long {
        var total = 0L
        var start = Long.MIN_VALUE
        var end = Long.MIN_VALUE
        for ((a, b) in intervals.filter { it.second > it.first }.sortedBy { it.first }) {
            if (a > end) {
                if (end > start) total += end - start
                start = a
                end = b
            } else if (b > end) {
                end = b
            }
        }
        if (end > start) total += end - start
        return total
    }

    data class Result(val minutes: Int, val app: String?)

    /** The day's active minutes (rounded to the nearest) and the app whose spans cover most. */
    fun of(day: LocalDate, zone: ZoneId, spans: List<Span>): Result {
        val from = day.atStartOfDay(zone).toInstant().toEpochMilli()
        val to = day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
        val clipped = spans.filter(::counts).mapNotNull { span ->
            val a = maxOf(span.start.toEpochMilli(), from)
            val b = minOf(span.end.toEpochMilli(), to)
            if (b > a) Triple(a, b, span.app) else null
        }
        val minutes = ((covered(clipped.map { it.first to it.second }) + 30_000) / 60_000).toInt()
        if (minutes == 0) return Result(0, null)
        val byApp = clipped
            .filter { it.third != null }
            .groupBy { it.third!! }
            .mapValues { (_, list) -> covered(list.map { it.first to it.second }) }
        return Result(minutes, Totals.mostOf(byApp))
    }
}

/** Puts the day numbers together from what HealthReader read. */
object Totals {
    /** The app with the largest value above 0; on a tie the first in the alphabet. */
    fun <V : Number> mostOf(values: Map<String, V>): String? =
        values.entries
            .filter { it.value.toDouble() > 0 }
            .sortedWith(compareByDescending<Map.Entry<String, V>> { it.value.toDouble() }.thenBy { it.key })
            .firstOrNull()
            ?.key

    private fun <V : Number> appOf(perDay: PerDay<V>, day: LocalDate): String? {
        val mine = perDay.byApp.mapNotNull { (app, days) -> days[day]?.let { app to it } }.toMap()
        return mostOf(mine) ?: perDay.single[day]
    }

    /**
     * The numbers of each of [days]. [steps] and [kcal] are null when Kal may not read them;
     * [spans] (sessions and step records around the days) is null when neither can be read or
     * reading them failed, and the active time is then unknown.
     */
    fun days(
        days: Collection<LocalDate>,
        zone: ZoneId,
        steps: PerDay<Long>?,
        kcal: PerDay<Double>?,
        spans: List<Span>?,
    ): List<DayNumbers> =
        days.distinct().sorted().map { day ->
            val stepCount = steps?.let { it.totals[day] ?: 0L }
            val energy = kcal?.let { it.totals[day] ?: 0.0 }
            val active = spans?.let { ActiveTime.of(day, zone, it) }
            DayNumbers(
                date = day,
                steps = stepCount,
                stepsApp = if ((stepCount ?: 0L) > 0L) steps?.let { appOf(it, day) } else null,
                activeMinutes = active?.minutes,
                activeApp = active?.app,
                activeKcal = energy,
                kcalApp = if ((energy ?: 0.0) > 0.0) kcal?.let { appOf(it, day) } else null,
            )
        }

    /** Consecutive runs of [days] (first and last of each), so a few far-apart days read little. */
    fun runs(days: Collection<LocalDate>): List<Pair<LocalDate, LocalDate>> {
        val sorted = days.distinct().sorted()
        val out = mutableListOf<Pair<LocalDate, LocalDate>>()
        for (day in sorted) {
            val last = out.lastOrNull()
            if (last != null && last.second.plusDays(1) == day) out[out.size - 1] = last.first to day
            else out += day to day
        }
        return out
    }
}
