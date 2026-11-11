package app.kal.android.sync

import androidx.health.connect.client.records.ExerciseSessionRecord as E
import androidx.health.connect.client.records.SleepSessionRecord as S

/**
 * A Kal activity type (lib/contracts/activities.ts ACTIVITY_TYPES ids) with its category and the
 * title used when the session has none.
 */
data class KalType(val id: String, val category: String, val label: String)

private fun cardio(id: String, label: String) = KalType(id, "cardio", label)
private fun sport(id: String, label: String) = KalType(id, "sports", label)

/** Health Connect's exercise types in Kal's words (unknown ones are "Other activity"). */
object ExerciseTypes {
    val OTHER = KalType("other", "other", "Workout")

    private val TYPES: Map<Int, KalType> = buildMap {
        put(E.EXERCISE_TYPE_RUNNING, cardio("run", "Running"))
        put(E.EXERCISE_TYPE_RUNNING_TREADMILL, cardio("run", "Treadmill run"))
        put(E.EXERCISE_TYPE_BIKING, cardio("cycle", "Cycling"))
        put(E.EXERCISE_TYPE_BIKING_STATIONARY, cardio("cycle", "Indoor cycling"))
        put(E.EXERCISE_TYPE_SWIMMING_POOL, cardio("swim", "Swimming"))
        put(E.EXERCISE_TYPE_SWIMMING_OPEN_WATER, cardio("swim", "Open water swim"))
        put(E.EXERCISE_TYPE_ROWING, cardio("row", "Rowing"))
        put(E.EXERCISE_TYPE_ROWING_MACHINE, cardio("row", "Rowing machine"))
        put(E.EXERCISE_TYPE_PADDLING, cardio("row", "Paddling"))
        put(E.EXERCISE_TYPE_ELLIPTICAL, cardio("elliptical", "Elliptical"))
        put(E.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING, cardio("hiit", "HIIT"))
        put(E.EXERCISE_TYPE_BOOT_CAMP, cardio("hiit", "Boot camp"))
        put(E.EXERCISE_TYPE_DANCING, cardio("dance", "Dancing"))
        put(E.EXERCISE_TYPE_STAIR_CLIMBING, cardio("stairs", "Stair climbing"))
        put(E.EXERCISE_TYPE_STAIR_CLIMBING_MACHINE, cardio("stairs", "Stair machine"))
        put(E.EXERCISE_TYPE_EXERCISE_CLASS, cardio("cardio", "Exercise class"))
        put(E.EXERCISE_TYPE_SKATING, cardio("cardio", "Skating"))
        put(E.EXERCISE_TYPE_ICE_SKATING, cardio("cardio", "Ice skating"))
        put(E.EXERCISE_TYPE_SKIING, cardio("cardio", "Skiing"))
        put(E.EXERCISE_TYPE_SNOWBOARDING, cardio("cardio", "Snowboarding"))
        put(E.EXERCISE_TYPE_SNOWSHOEING, cardio("cardio", "Snowshoeing"))
        put(E.EXERCISE_TYPE_WHEELCHAIR, cardio("cardio", "Wheelchair"))
        put(E.EXERCISE_TYPE_STRENGTH_TRAINING, KalType("weights", "strength", "Strength training"))
        put(E.EXERCISE_TYPE_WEIGHTLIFTING, KalType("weights", "strength", "Weightlifting"))
        put(E.EXERCISE_TYPE_CALISTHENICS, KalType("bodyweight", "strength", "Calisthenics"))
        put(E.EXERCISE_TYPE_WALKING, KalType("walk", "walking", "Walking"))
        put(E.EXERCISE_TYPE_HIKING, KalType("hike", "walking", "Hiking"))
        put(E.EXERCISE_TYPE_YOGA, KalType("yoga", "mobility", "Yoga"))
        put(E.EXERCISE_TYPE_STRETCHING, KalType("stretching", "mobility", "Stretching"))
        put(E.EXERCISE_TYPE_PILATES, KalType("pilates", "mobility", "Pilates"))
        put(E.EXERCISE_TYPE_GUIDED_BREATHING, KalType("mobility", "mobility", "Guided breathing"))
        put(E.EXERCISE_TYPE_SOCCER, sport("football", "Football"))
        put(E.EXERCISE_TYPE_BASKETBALL, sport("basketball", "Basketball"))
        put(E.EXERCISE_TYPE_TENNIS, sport("tennis", "Tennis"))
        put(E.EXERCISE_TYPE_BADMINTON, sport("badminton", "Badminton"))
        put(E.EXERCISE_TYPE_VOLLEYBALL, sport("volleyball", "Volleyball"))
        put(E.EXERCISE_TYPE_MARTIAL_ARTS, sport("martial_arts", "Martial arts"))
        put(E.EXERCISE_TYPE_BOXING, sport("martial_arts", "Boxing"))
        put(E.EXERCISE_TYPE_FENCING, sport("martial_arts", "Fencing"))
        put(E.EXERCISE_TYPE_ROCK_CLIMBING, sport("climbing", "Climbing"))
        put(E.EXERCISE_TYPE_TABLE_TENNIS, sport("sport", "Table tennis"))
        put(E.EXERCISE_TYPE_SQUASH, sport("sport", "Squash"))
        put(E.EXERCISE_TYPE_RACQUETBALL, sport("sport", "Racquetball"))
        put(E.EXERCISE_TYPE_GOLF, sport("sport", "Golf"))
        put(E.EXERCISE_TYPE_BASEBALL, sport("sport", "Baseball"))
        put(E.EXERCISE_TYPE_SOFTBALL, sport("sport", "Softball"))
        put(E.EXERCISE_TYPE_CRICKET, sport("sport", "Cricket"))
        put(E.EXERCISE_TYPE_HANDBALL, sport("sport", "Handball"))
        put(E.EXERCISE_TYPE_ICE_HOCKEY, sport("sport", "Ice hockey"))
        put(E.EXERCISE_TYPE_ROLLER_HOCKEY, sport("sport", "Roller hockey"))
        put(E.EXERCISE_TYPE_WATER_POLO, sport("sport", "Water polo"))
        put(E.EXERCISE_TYPE_FOOTBALL_AMERICAN, sport("sport", "American football"))
        put(E.EXERCISE_TYPE_FOOTBALL_AUSTRALIAN, sport("sport", "Australian football"))
        put(E.EXERCISE_TYPE_RUGBY, sport("sport", "Rugby"))
        put(E.EXERCISE_TYPE_FRISBEE_DISC, sport("sport", "Frisbee"))
        put(E.EXERCISE_TYPE_GYMNASTICS, sport("sport", "Gymnastics"))
        put(E.EXERCISE_TYPE_SURFING, sport("sport", "Surfing"))
        put(E.EXERCISE_TYPE_SAILING, sport("sport", "Sailing"))
        put(E.EXERCISE_TYPE_SCUBA_DIVING, sport("sport", "Scuba diving"))
        put(E.EXERCISE_TYPE_PARAGLIDING, sport("sport", "Paragliding"))
        put(E.EXERCISE_TYPE_OTHER_WORKOUT, OTHER)
    }

    fun of(exerciseType: Int): KalType = TYPES[exerciseType] ?: OTHER
}

/** Health Connect's sleep stages as the server names them (SLEEP_STAGES). */
object SleepStages {
    fun key(stage: Int): String =
        when (stage) {
            S.STAGE_TYPE_AWAKE, S.STAGE_TYPE_AWAKE_IN_BED -> "awake"
            S.STAGE_TYPE_SLEEPING -> "sleeping"
            S.STAGE_TYPE_OUT_OF_BED -> "out_of_bed"
            S.STAGE_TYPE_LIGHT -> "light"
            S.STAGE_TYPE_DEEP -> "deep"
            S.STAGE_TYPE_REM -> "rem"
            else -> "unknown"
        }

    /** Whole minutes per stage, stages that last no time left out. */
    fun minutes(stages: List<SleepStage>): Map<String, Long> =
        stages
            .groupBy { key(it.type) }
            .mapValues { (_, list) ->
                list.sumOf { java.time.Duration.between(it.start, it.end).seconds.coerceAtLeast(0) } / 60
            }
            .filterValues { it > 0 }
            .toSortedMap()
}
