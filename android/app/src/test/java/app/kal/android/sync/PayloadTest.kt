package app.kal.android.sync

import androidx.health.connect.client.records.ExerciseSessionRecord as E
import androidx.health.connect.client.records.SleepSessionRecord as S
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The batches the app sends to POST /api/health-connect/sync, and the JSON they are written in. */
class PayloadTest {
    private val zone = ZoneId.of("Europe/Berlin")
    private val start = Instant.parse("2026-11-09T23:30:00.123456789Z")

    private val run = Workout(
        id = "6f1c1d57-0f7e-4a3c-9a55-3c2f4b6d1a01",
        exerciseType = E.EXERCISE_TYPE_RUNNING,
        title = "  Morning\n run ",
        start = start,
        end = start.plusSeconds(1800),
        startOffset = ZoneOffset.ofHours(1),
        distanceM = 5200.04,
        activeKcal = 351.66,
        totalKcal = 420.0,
        steps = 5100,
        avgHeartRate = 148,
        maxHeartRate = 171,
        sourceApp = "com.sec.android.app.shealth",
    )

    @Test
    fun workoutsCarryKalsTypeTheirLocalDayAndTotals() {
        assertEquals(
            linkedMapOf(
                "id" to run.id,
                "category" to "cardio",
                "type" to "run",
                "title" to "Morning run",
                "start" to "2026-11-09T23:30:00.123Z",
                "end" to "2026-11-10T00:00:00.123Z",
                // 23:30 UTC is 00:30 the next day at UTC+1.
                "localDate" to "2026-11-10",
                "distanceM" to 5200.0,
                "energyKcal" to 351.7,
                "steps" to 5100L,
                "avgHeartRate" to 148L,
                "maxHeartRate" to 171L,
                "sourceApp" to "com.sec.android.app.shealth",
            ),
            Payload.workout(run, zone),
        )
    }

    @Test
    fun workoutsFallBackToTheTypesTitleTotalEnergyAndThePhonesZone() {
        val plain = run.copy(title = " ", activeKcal = null, avgHeartRate = 300, maxHeartRate = null, startOffset = null, distanceM = 0.0)
        val json = Payload.workout(plain, zone)
        assertEquals("Running", json["title"])
        assertEquals(420.0, json["energyKcal"])
        assertEquals(null, json["avgHeartRate"])
        assertEquals(null, json["distanceM"])
        // Berlin is UTC+1 in November.
        assertEquals("2026-11-10", json["localDate"])
    }

    @Test
    fun recordsAreSplitIntoBatchesWithDeletionsFirst() {
        val steps = (0 until 5).map { StepsDay(LocalDate.of(2026, 11, 1).plusDays(it.toLong()), 1000L * it, null) }
        val collected = Collected(
            steps = steps,
            workouts = listOf(run),
            body = listOf(BodyValue("w1", BodyCode.WEIGHT, 80.2449, start, "com.qingniu.renpho")),
            resting = listOf(RestingDay(LocalDate.of(2026, 11, 9), null, null)),
            sleep = listOf(
                Sleep(
                    "s1",
                    start,
                    start.plusSeconds(8 * 3600),
                    null,
                    listOf(SleepStage(start, start.plusSeconds(3600), S.STAGE_TYPE_DEEP)),
                    "com.sec.android.app.shealth",
                ),
            ),
            height = Height(181.04, start),
            deleted = listOf("a", "b", "c", "a"),
        )
        val batches = Payload.batches(collected, zone, "1.0 (1)", maxRecords = 4, maxDeleted = 2)
        assertEquals(3, batches.size)
        assertEquals(
            """{"tz":"Europe/Berlin","appVersion":"1.0 (1)","steps":[""" +
                """{"date":"2026-11-01","count":0,"sourceApp":null},""" +
                """{"date":"2026-11-02","count":1000,"sourceApp":null},""" +
                """{"date":"2026-11-03","count":2000,"sourceApp":null},""" +
                """{"date":"2026-11-04","count":3000,"sourceApp":null}],""" +
                """"height":{"cm":181,"at":"2026-11-09T23:30:00.123Z"},"deleted":["a","b"]}""",
            batches[0],
        )
        assertTrue(batches[1].contains(""""workouts":[{"id":"6f1c1d57"""))
        assertTrue(batches[1].contains(""""body":[{"id":"w1","code":"weight","value":80.24,"""))
        assertTrue(batches[1].contains(""""restingHeartRate":[{"date":"2026-11-09","bpm":null,"sourceApp":null}]"""))
        assertTrue(batches[1].contains(""""deleted":["c"]"""))
        assertFalse(batches[1].contains("height"))
        assertEquals(
            """{"tz":"Europe/Berlin","appVersion":"1.0 (1)","sleep":[{"id":"s1",""" +
                """"start":"2026-11-09T23:30:00.123Z","end":"2026-11-10T07:30:00.123Z","title":null,""" +
                """"stages":{"deep":60},"sourceApp":"com.sec.android.app.shealth"}]}""",
            batches[2],
        )
    }

    @Test
    fun nothingToSendIsNoBatch() {
        assertEquals(emptyList<String>(), Payload.batches(Collected(), zone, "1.0 (1)"))
        assertTrue(Collected().isEmpty)
    }

    @Test
    fun changesEndAsTheirLastWord() {
        val log = ChangeLog<Pair<String, Int>> { it.first }
        log.upsert("a" to 1)
        log.upsert("b" to 1)
        log.delete("a")
        log.upsert("b" to 2)
        log.delete("c")
        log.upsert("c" to 1)
        assertEquals(listOf("b" to 2, "c" to 1), log.written)
        assertEquals(listOf("a"), log.deleted)
    }
}
