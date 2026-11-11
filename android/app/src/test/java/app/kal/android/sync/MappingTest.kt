package app.kal.android.sync

import androidx.health.connect.client.records.ExerciseSessionRecord as E
import androidx.health.connect.client.records.SleepSessionRecord as S
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Health Connect's exercise types and sleep stages in Kal's words. */
class MappingTest {
    private val validCategories = setOf("cardio", "strength", "walking", "mobility", "sports", "other")

    // ACTIVITY_TYPES ids of lib/contracts/activities.ts the mapping may use.
    private val kalTypeIds = setOf(
        "run", "cycle", "swim", "row", "elliptical", "hiit", "dance", "jump_rope", "stairs", "cardio",
        "weights", "bodyweight", "circuit", "walk", "hike", "yoga", "stretching", "pilates", "mobility",
        "football", "basketball", "tennis", "badminton", "volleyball", "martial_arts", "climbing", "sport",
        "other",
    )

    @Test
    fun commonWorkoutsGetKalTypesAndCategories() {
        assertEquals(KalType("run", "cardio", "Running"), ExerciseTypes.of(E.EXERCISE_TYPE_RUNNING))
        assertEquals("cycle", ExerciseTypes.of(E.EXERCISE_TYPE_BIKING_STATIONARY).id)
        assertEquals("swim", ExerciseTypes.of(E.EXERCISE_TYPE_SWIMMING_POOL).id)
        assertEquals(KalType("weights", "strength", "Strength training"), ExerciseTypes.of(E.EXERCISE_TYPE_STRENGTH_TRAINING))
        assertEquals("strength", ExerciseTypes.of(E.EXERCISE_TYPE_WEIGHTLIFTING).category)
        assertEquals(KalType("walk", "walking", "Walking"), ExerciseTypes.of(E.EXERCISE_TYPE_WALKING))
        assertEquals("walking", ExerciseTypes.of(E.EXERCISE_TYPE_HIKING).category)
        assertEquals("mobility", ExerciseTypes.of(E.EXERCISE_TYPE_YOGA).category)
        assertEquals(KalType("sport", "sports", "Table tennis"), ExerciseTypes.of(E.EXERCISE_TYPE_TABLE_TENNIS))
        assertEquals("football", ExerciseTypes.of(E.EXERCISE_TYPE_SOCCER).id)
        assertEquals("hiit", ExerciseTypes.of(E.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING).id)
    }

    @Test
    fun unknownAndOtherWorkoutsAreOther() {
        assertEquals(ExerciseTypes.OTHER, ExerciseTypes.of(E.EXERCISE_TYPE_OTHER_WORKOUT))
        assertEquals(ExerciseTypes.OTHER, ExerciseTypes.of(9999))
        assertEquals("other", ExerciseTypes.OTHER.category)
    }

    @Test
    fun everyMappingUsesTheServersWords() {
        for (type in 0..120) {
            val kal = ExerciseTypes.of(type)
            assertTrue("category ${kal.category} of $type", kal.category in validCategories)
            assertTrue("type ${kal.id} of $type", kal.id in kalTypeIds)
            assertTrue(Regex("^[a-z_]{1,40}$").matches(kal.id))
            assertTrue(kal.label.isNotBlank() && kal.label.length <= 80)
        }
    }

    @Test
    fun sleepStagesBecomeMinutesPerStage() {
        val t = Instant.parse("2026-11-10T22:00:00Z")
        val stages = listOf(
            SleepStage(t, t.plusSeconds(30 * 60), S.STAGE_TYPE_LIGHT),
            SleepStage(t.plusSeconds(30 * 60), t.plusSeconds(90 * 60), S.STAGE_TYPE_DEEP),
            SleepStage(t.plusSeconds(90 * 60), t.plusSeconds(100 * 60), S.STAGE_TYPE_AWAKE),
            SleepStage(t.plusSeconds(100 * 60), t.plusSeconds(105 * 60), S.STAGE_TYPE_AWAKE_IN_BED),
            SleepStage(t.plusSeconds(105 * 60), t.plusSeconds(150 * 60), S.STAGE_TYPE_REM),
            SleepStage(t.plusSeconds(150 * 60), t.plusSeconds(170 * 60), S.STAGE_TYPE_LIGHT),
            SleepStage(t.plusSeconds(170 * 60), t.plusSeconds(170 * 60 + 20), S.STAGE_TYPE_OUT_OF_BED),
        )
        assertEquals(
            mapOf("awake" to 15L, "deep" to 60L, "light" to 50L, "rem" to 45L),
            SleepStages.minutes(stages),
        )
        assertEquals("sleeping", SleepStages.key(S.STAGE_TYPE_SLEEPING))
        assertEquals("out_of_bed", SleepStages.key(S.STAGE_TYPE_OUT_OF_BED))
        assertEquals("unknown", SleepStages.key(S.STAGE_TYPE_UNKNOWN))
    }
}
