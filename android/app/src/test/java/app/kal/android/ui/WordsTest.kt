package app.kal.android.ui

import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The status screen's sentences (boards 15 and 35). */
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
    fun appsInASentence() {
        assertEquals("", Words.apps(emptyList()))
        assertEquals("Samsung Health", Words.apps(listOf("Samsung Health")))
        assertEquals("Samsung Health and Renpho Health", Words.apps(listOf("Samsung Health", "Renpho Health")))
        assertEquals("Samsung Health, Google Fit and Renpho", Words.apps(listOf("Samsung Health", "Google Fit", "Renpho")))
    }

    @Test
    fun todaysThreeNumbers() {
        assertEquals("8,412", Words.number(8412))
        assertEquals("–", Words.number(null))
        assertEquals("0 min", Words.minutes(0))
        assertEquals("54 min", Words.minutes(54))
        assertEquals("1 h 12 min", Words.minutes(72))
        assertEquals("2 h", Words.minutes(120))
        assertEquals("–", Words.minutes(null))
        assertEquals("486 kcal", Words.kcal(486.4))
        assertEquals("1,201 kcal", Words.kcal(1200.6))
        assertEquals("–", Words.kcal(null))
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
