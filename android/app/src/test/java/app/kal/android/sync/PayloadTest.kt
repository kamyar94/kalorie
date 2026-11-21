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
    fun nothingToSendIsStillOneBatchSoTheServerLogsTheSync() {
        assertEquals(
            listOf("""{"tz":"Europe/Berlin","appVersion":"1.1 (2)"}"""),
            Payload.batches(Collected(), zone, "1.1 (2)"),
        )
        assertTrue(Collected().isEmpty)
    }

    @Test
    fun aReadOfTheWholeWindowSaysHowManyDaysOnEveryBatch() {
        assertEquals(
            listOf("""{"tz":"Europe/Berlin","appVersion":"1.1 (2)","firstReadDays":30}"""),
            Payload.batches(Collected(), zone, "1.1 (2)", firstReadDays = 30),
        )
        val steps = (0 until 3).map { StepsDay(LocalDate.of(2026, 11, 1).plusDays(it.toLong()), 100L, null) }
        val batches = Payload.batches(Collected(steps = steps), zone, "1.1 (2)", firstReadDays = 365, maxRecords = 2)
        assertEquals(2, batches.size)
        assertTrue(batches.all { it.startsWith("""{"tz":"Europe/Berlin","appVersion":"1.1 (2)","firstReadDays":365,"steps":[""") })
    }

    @Test
    fun dayTotalsCarryTheirMethodAndAppsNextToEverything11Sends() {
        val day = LocalDate.of(2026, 11, 10)
        val numbers = DayNumbers(day, 8412, "com.sec.android.app.shealth", 72, "com.sec.android.app.shealth", 486.44, null)
        assertEquals(
            linkedMapOf(
                "date" to "2026-11-10",
                "steps" to 8412L,
                "stepsApp" to "com.sec.android.app.shealth",
                "activeMinutes" to 72,
                "activeMethod" to "sessions+steps60",
                "activeApp" to "com.sec.android.app.shealth",
                "activeKcal" to 486.4,
                "kcalApp" to null,
            ),
            Payload.dayTotal(numbers),
        )
        // Unknown numbers go as null, and an unknown active time has no method.
        val unknown = Payload.dayTotal(DayNumbers(day, 120, null, null, null, null, null))
        assertEquals(null, unknown["activeMinutes"])
        assertEquals(null, unknown["activeMethod"])
        assertEquals(null, unknown["activeKcal"])

        // The steps of 1.0 and 1.1 stay; day totals count towards a batch's records.
        val collected = Collected(
            steps = listOf(StepsDay(day, 8412, "com.sec.android.app.shealth")),
            days = listOf(numbers, DayNumbers(day.minusDays(1), 0, null, 0, null, 0.0, null)),
        )
        assertFalse(collected.isEmpty)
        assertFalse(Collected(days = listOf(numbers)).isEmpty)
        val batches = Payload.batches(collected, zone, "1.2 (3)", maxRecords = 2)
        assertEquals(2, batches.size)
        assertEquals(
            """{"tz":"Europe/Berlin","appVersion":"1.2 (3)",""" +
                """"steps":[{"date":"2026-11-10","count":8412,"sourceApp":"com.sec.android.app.shealth"}],""" +
                """"dayTotals":[{"date":"2026-11-10","steps":8412,"stepsApp":"com.sec.android.app.shealth",""" +
                """"activeMinutes":72,"activeMethod":"sessions+steps60","activeApp":"com.sec.android.app.shealth",""" +
                """"activeKcal":486.4,"kcalApp":null}]}""",
            batches[0],
        )
        assertEquals(
            """{"tz":"Europe/Berlin","appVersion":"1.2 (3)","dayTotals":[{"date":"2026-11-09","steps":0,""" +
                """"stepsApp":null,"activeMinutes":0,"activeMethod":"sessions+steps60","activeApp":null,""" +
                """"activeKcal":0,"kcalApp":null}]}""",
            batches[1],
        )
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
