package app.kal.android.ui

import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** The status screen's sentences (board 15), as plain functions. */
object Words {
    private val clock = DateTimeFormatter.ofPattern("HH:mm", Locale.US)
    private val day = DateTimeFormatter.ofPattern("EEE d MMM", Locale.US)

    private fun count(n: Int, one: String, many: String) =
        "${NumberFormat.getIntegerInstance(Locale.US).format(n.toLong())} ${if (n == 1) one else many}"

    /** "8,412 steps · 1 workout · 1 weigh-in"; null when there is nothing today. */
    fun today(steps: Long, workouts: Int, weighIns: Int): String? =
        listOfNotNull(
            if (steps > 0) "${NumberFormat.getIntegerInstance(Locale.US).format(steps)} steps" else null,
            if (workouts > 0) count(workouts, "workout", "workouts") else null,
            if (weighIns > 0) count(weighIns, "weigh-in", "weigh-ins") else null,
        ).joinToString(" · ").ifEmpty { null }

    /** "Today 10:42", "Yesterday 21:05", "Mon 9 Nov 08:10". */
    fun moment(at: Instant, zone: ZoneId, now: Instant = Instant.now()): String {
        val date = at.atZone(zone).toLocalDate()
        val today = now.atZone(zone).toLocalDate()
        val time = at.atZone(zone).format(clock)
        return when (date) {
            today -> "Today $time"
            today.minusDays(1) -> "Yesterday $time"
            else -> "${date.format(day)} $time"
        }
    }

    /** "11:40" for a time today, else as [moment]. */
    fun clockOrMoment(at: Instant, zone: ZoneId, now: Instant = Instant.now()): String =
        if (at.atZone(zone).toLocalDate() == now.atZone(zone).toLocalDate()) at.atZone(zone).format(clock)
        else moment(at, zone, now)
}
