package app.kal.android.ui

import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The status screen's sentences (board 15). */
class WordsTest {
    private val zone = ZoneId.of("Europe/Berlin")
    private val now = Instant.parse("2026-11-10T10:00:00Z")

    @Test
    fun todaysLine() {
        assertEquals("8,412 steps · 1 workout · 1 weigh-in", Words.today(8412, 1, 1))
        assertEquals("12,000 steps · 2 workouts · 3 weigh-ins", Words.today(12_000, 2, 3))
        assertEquals("1 workout", Words.today(0, 1, 0))
        assertNull(Words.today(0, 0, 0))
    }

    @Test
    fun moments() {
        assertEquals("Today 10:42", Words.moment(Instant.parse("2026-11-10T09:42:00Z"), zone, now))
        assertEquals("Yesterday 21:05", Words.moment(Instant.parse("2026-11-09T20:05:00Z"), zone, now))
        assertEquals("Sun 8 Nov 08:10", Words.moment(Instant.parse("2026-11-08T07:10:00Z"), zone, now))
        assertEquals("11:40", Words.clockOrMoment(Instant.parse("2026-11-10T10:40:00Z"), zone, now))
        assertEquals("00:30", Words.clockOrMoment(Instant.parse("2026-11-09T23:30:00Z"), zone, now))
    }
}
