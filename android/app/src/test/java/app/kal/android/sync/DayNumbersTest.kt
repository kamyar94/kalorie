package app.kal.android.sync

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Active time from sessions and brisk step records, and each day's three numbers with their apps. */
class DayNumbersTest {
    private val berlin = ZoneId.of("Europe/Berlin")
    private val day = LocalDate.of(2026, 11, 10)
    private val watch = "com.sec.android.app.shealth"
    private val phone = "com.android.healthconnect.phone.0a1b2c3d"

    private fun at(time: String, date: LocalDate = day, zone: ZoneId = berlin): Instant =
        LocalDateTime.of(date, java.time.LocalTime.parse(time)).atZone(zone).toInstant()

    private fun session(from: String, to: String, app: String? = watch) = Span(at(from), at(to), app)

    private fun steps(from: String, to: String, count: Long, app: String? = watch) = Span(at(from), at(to), app, count)

    @Test
    fun aSessionCountsItsMinutes() {
        assertEquals(ActiveTime.Result(30, watch), ActiveTime.of(day, berlin, listOf(session("10:00", "10:30"))))
        assertEquals(ActiveTime.Result(0, null), ActiveTime.of(day, berlin, emptyList()))
    }

    @Test
    fun stepRecordsCountFromSixtyStepsAMinuteSpreadOverTheirLength() {
        // 600 steps over 10 minutes is 60 a minute: active. 590 is 59 a minute: not.
        assertTrue(ActiveTime.counts(steps("08:00", "08:10", 600)))
        assertFalse(ActiveTime.counts(steps("08:00", "08:10", 590)))
        assertTrue(ActiveTime.counts(steps("08:00", "08:01", 60)))
        assertFalse(ActiveTime.counts(steps("08:00", "08:01", 59)))
        // A long record at a slow rate is not active, even with many steps in all.
        assertFalse(ActiveTime.counts(steps("09:00", "11:00", 3000)))
        // A record without length counts nothing.
        assertFalse(ActiveTime.counts(steps("08:00", "08:00", 100)))
        assertFalse(ActiveTime.counts(session("08:00", "08:00")))
        val minutes = ActiveTime.of(
            day,
            berlin,
            listOf(steps("08:00", "08:10", 600), steps("08:10", "08:20", 590), steps("09:00", "11:00", 3000)),
        )
        assertEquals(10, minutes.minutes)
    }

    @Test
    fun aMinuteCoveredTwiceCountsOnce() {
        // A walk inside a workout, and the phone and the watch counting the same walk.
        val spans = listOf(
            session("10:00", "10:30"),
            steps("10:20", "10:40", 1200),
            steps("18:00", "18:15", 1500, phone),
            steps("18:00", "18:15", 1600, watch),
        )
        assertEquals(55, ActiveTime.of(day, berlin, spans).minutes)
        assertEquals(40L * 60_000, ActiveTime.covered(listOf(0L to 30L * 60_000, 20L * 60_000 to 40L * 60_000)))
        assertEquals(0L, ActiveTime.covered(listOf(5L to 5L, 9L to 3L)))
        assertEquals(30L, ActiveTime.covered(listOf(0L to 10L, 10L to 20L, 15L to 30L)))
    }

    @Test
    fun spansAreCutAtTheDaysMidnights() {
        val late = Span(at("23:30"), at("00:30", day.plusDays(1)), watch)
        assertEquals(30, ActiveTime.of(day, berlin, listOf(late)).minutes)
        assertEquals(30, ActiveTime.of(day.plusDays(1), berlin, listOf(late)).minutes)
        assertEquals(0, ActiveTime.of(day.minusDays(1), berlin, listOf(late)).minutes)
    }

    @Test
    fun theDayIsThePhonesLocalDayIncludingClockChanges() {
        // 23:30 to 00:30 in Berlin is 22:30 to 23:30 UTC: all of it on the 10th in London.
        val late = Span(at("23:30"), at("00:30", day.plusDays(1)), watch)
        assertEquals(60, ActiveTime.of(day, ZoneId.of("Europe/London"), listOf(late)).minutes)
        assertEquals(0, ActiveTime.of(day.plusDays(1), ZoneId.of("Europe/London"), listOf(late)).minutes)
        // The clocks go back on 25 October 2026 (25 hours) and forward on 29 March 2026 (23 hours).
        val autumn = LocalDate.of(2026, 10, 25)
        val allAutumn = Span(autumn.atStartOfDay(berlin).toInstant(), autumn.plusDays(1).atStartOfDay(berlin).toInstant(), watch)
        assertEquals(25 * 60, ActiveTime.of(autumn, berlin, listOf(allAutumn)).minutes)
        val spring = LocalDate.of(2026, 3, 29)
        val allSpring = Span(spring.atStartOfDay(berlin).toInstant(), spring.plusDays(2).atStartOfDay(berlin).toInstant(), watch)
        assertEquals(23 * 60, ActiveTime.of(spring, berlin, listOf(allSpring)).minutes)
    }

    @Test
    fun minutesAreRoundedToTheNearest() {
        assertEquals(2, ActiveTime.of(day, berlin, listOf(Span(at("10:00"), at("10:01:30"), watch))).minutes)
        assertEquals(1, ActiveTime.of(day, berlin, listOf(Span(at("10:00"), at("10:01:29"), watch))).minutes)
        assertEquals(0, ActiveTime.of(day, berlin, listOf(Span(at("10:00"), at("10:00:29"), watch))).minutes)
    }

    @Test
    fun theAppThatCoversMostNamesTheActiveTime() {
        val spans = listOf(session("07:00", "07:30", watch), steps("12:00", "12:10", 900, phone))
        assertEquals(ActiveTime.Result(40, watch), ActiveTime.of(day, berlin, spans))
        val tie = listOf(session("07:00", "07:10", watch), session("08:00", "08:10", phone))
        // A tie goes to the first package in the alphabet.
        assertEquals(phone, ActiveTime.of(day, berlin, tie).app)
        assertNull(ActiveTime.of(day, berlin, listOf(session("07:00", "07:10", null))).app)
    }

    @Test
    fun eachDaysNumbersWithTheAppThatWroteMost() {
        val other = day.minusDays(1)
        val steps = PerDay(
            totals = mapOf(day to 8412L, other to 300L),
            byApp = mapOf(watch to mapOf(day to 6000L, other to 120L), phone to mapOf(day to 4100L, other to 300L)),
        )
        val kcal = PerDay(totals = mapOf(day to 486.4), single = mapOf(day to watch))
        val days = Totals.days(listOf(day, other, day), berlin, steps, kcal, listOf(session("10:00", "10:30")))
        assertEquals(
            listOf(
                DayNumbers(other, 300L, phone, 0, null, 0.0, null),
                DayNumbers(day, 8412L, watch, 30, watch, 486.4, watch),
            ),
            days,
        )
        assertEquals(ActiveTime.METHOD, days[1].activeMethod)
        assertFalse(days[1].isEmpty)
        assertFalse(days[0].isEmpty)
        // What Kal may not read stays unknown, with no method for the active time.
        val unknown = Totals.days(listOf(day), berlin, null, null, null).single()
        assertEquals(DayNumbers(day, null, null, null, null, null, null), unknown)
        assertNull(unknown.activeMethod)
        assertTrue(unknown.isEmpty)
        assertTrue(DayNumbers(day, 0L, null, 0, null, 0.0, null).isEmpty)
    }

    @Test
    fun runsOfConsecutiveDays() {
        val d = { n: Long -> day.plusDays(n) }
        assertEquals(
            listOf(d(0) to d(2), d(5) to d(5), d(7) to d(8)),
            Totals.runs(listOf(d(8), d(0), d(1), d(2), d(5), d(7), d(1))),
        )
        assertEquals(emptyList<Pair<LocalDate, LocalDate>>(), Totals.runs(emptyList()))
    }

    @Test
    fun mostOfLeavesOutZeros() {
        assertNull(Totals.mostOf(mapOf(watch to 0L)))
        assertEquals(watch, Totals.mostOf(mapOf(watch to 5.5, phone to 2.0)))
    }
}
