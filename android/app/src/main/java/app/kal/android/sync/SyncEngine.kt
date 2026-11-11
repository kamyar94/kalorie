package app.kal.android.sync

import android.content.Context
import app.kal.android.Kal
import app.kal.android.hc.HealthConnect
import app.kal.android.hc.HealthReader
import app.kal.android.net.KalApi
import app.kal.android.store.SyncState
import app.kal.android.store.TokenStore
import app.kal.android.ui.Words
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.records.BasalMetabolicRateRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.BodyWaterMassRecord
import androidx.health.connect.client.records.BoneMassRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeightRecord
import androidx.health.connect.client.records.LeanBodyMassRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

enum class SyncOutcome { SENT, NOT_LINKED, UNLINKED, NO_ACCESS, HEALTH_CONNECT_MISSING, READ_FAILED, NETWORK, SERVER }

/**
 * One sync: reads what changed in Health Connect since the last one (the first sync reads the
 * last 30 days, or a year with the history permission) and sends it to the Kal server in batches.
 * The changes token is kept only after every batch arrived, so nothing is lost when sending fails.
 *
 * Steps and resting heart rate are sent as day totals: for the days a change touched, today and
 * yesterday (late watch uploads), and the last 30 days after any deletion (a deletion does not say
 * what it deleted). Workouts of the last 48 hours are read again each time, so energy and heart
 * rate that arrive after the session are picked up.
 */
object SyncEngine {
    private val lock = Mutex()

    /** Types followed with the changes token. Heart rate samples, energy and distance are read
     * per workout instead (their changes would be thousands of samples). */
    private val CHANGE_TYPES = listOf(
        StepsRecord::class,
        ExerciseSessionRecord::class,
        RestingHeartRateRecord::class,
        SleepSessionRecord::class,
        WeightRecord::class,
        BodyFatRecord::class,
        LeanBodyMassRecord::class,
        BoneMassRecord::class,
        BodyWaterMassRecord::class,
        BasalMetabolicRateRecord::class,
        HeightRecord::class,
    )

    suspend fun run(context: Context): SyncOutcome =
        lock.withLock { withContext(Dispatchers.IO) { runLocked(context.applicationContext) } }

    private suspend fun runLocked(context: Context): SyncOutcome {
        val token = TokenStore.load(context) ?: return SyncOutcome.NOT_LINKED
        if (!Kal.healthConnectPossible) return SyncOutcome.HEALTH_CONNECT_MISSING
        if (HealthConnect.availability(context) != HealthConnect.Availability.READY)
            return SyncOutcome.HEALTH_CONNECT_MISSING
        val state = SyncState(context)
        state.lastAttemptAt = System.currentTimeMillis()
        val client = HealthConnect.client(context)
        val zone = ZoneId.systemDefault()
        val now = Instant.now()
        val today = now.atZone(zone).toLocalDate()

        val read: Pair<Collected, String>
        val todayLine: String?
        try {
            val granted = client.permissionController.getGrantedPermissions()
            if (granted.none { it in HealthConnect.READ_PERMISSIONS }) return SyncOutcome.NO_ACCESS
            val reader = HealthReader(client, zone, granted)
            val types = CHANGE_TYPES.filter { reader.can(it) }
            val signature = types.joinToString(",") { it.simpleName ?: "" } + "|" + (HealthConnect.HISTORY in granted)
            val known = state.changesToken.takeIf { state.tokenTypes == signature }
            val days = if (HealthConnect.HISTORY in granted) 365L else 30L
            read = (known?.let { changesSince(reader, it, now, today) })
                ?: firstRead(reader, types, now, today, days)
            state.tokenTypes = signature
            todayLine = Words.today(
                steps = read.first.steps.firstOrNull { it.date == today }?.count ?: 0,
                workouts = read.first.workouts.count { it.start.atZone(zone).toLocalDate() == today },
                weighIns = reader.readAll(WeightRecord::class, today.atStartOfDay(zone).toInstant(), now).size,
            )
        } catch (_: SecurityException) {
            return SyncOutcome.NO_ACCESS
        } catch (_: Exception) {
            return SyncOutcome.READ_FAILED
        }

        for (batch in Payload.batches(read.first, zone, Kal.appVersion)) {
            when (val answer = KalApi.sync(token, batch)) {
                is KalApi.Answer.Ok -> Unit
                KalApi.Answer.Unlinked -> {
                    TokenStore.clear(context)
                    state.reset()
                    state.unlinked = true
                    SyncScheduler.cancel(context)
                    return SyncOutcome.UNLINKED
                }
                is KalApi.Answer.Failed -> return if (answer.network) SyncOutcome.NETWORK else SyncOutcome.SERVER
            }
        }
        state.changesToken = read.second
        state.lastSyncAt = now.toEpochMilli()
        state.todayLine = todayLine
        state.todayDate = today.toString()
        return SyncOutcome.SENT
    }

    /** The first read (or after the token expired): a new token first, then the whole window. */
    private suspend fun firstRead(
        reader: HealthReader,
        types: List<kotlin.reflect.KClass<out Record>>,
        now: Instant,
        today: LocalDate,
        days: Long,
    ): Pair<Collected, String> {
        val nextToken = reader.changesToken(types)
        val from = now.minus(Duration.ofDays(days))
        val window = generateSequence(today.minusDays(days)) { it.plusDays(1) }.takeWhile { !it.isAfter(today) }.toList()
        val collected = Collected(
            steps = reader.stepsDays(window).filter { it.count > 0 },
            workouts = reader.readAll(ExerciseSessionRecord::class, from, now).map { reader.workout(it) },
            body = reader.bodyBetween(from, now),
            resting = reader.restingDays(window).filter { it.bpm != null },
            sleep = reader.readAll(SleepSessionRecord::class, from, now).map { reader.sleep(it) },
            height = reader.readAll(HeightRecord::class, from, now).maxByOrNull { it.time }?.let { reader.height(it) },
        )
        return collected to nextToken
    }

    /** What changed since [token]; null when the token expired (then everything is read again). */
    private suspend fun changesSince(
        reader: HealthReader,
        token: String,
        now: Instant,
        today: LocalDate,
    ): Pair<Collected, String>? {
        val log = ChangeLog<Record> { it.metadata.id }
        var next = token
        do {
            val response = reader.changes(next)
            if (response.changesTokenExpired) return null
            for (change in response.changes) {
                when (change) {
                    is UpsertionChange -> log.upsert(change.record)
                    is DeletionChange -> log.delete(change.recordId)
                }
            }
            next = response.nextChangesToken
        } while (response.hasMore)

        val written = log.written
        val recent = listOf(today, today.minusDays(1))
        val afterDeletion =
            if (log.deleted.isEmpty()) emptyList()
            else generateSequence(today.minusDays(30)) { it.plusDays(1) }.takeWhile { !it.isAfter(today) }.toList()
        val stepDays = written.filterIsInstance<StepsRecord>().flatMap { reader.daysOf(it.startTime, it.endTime) } +
            recent + afterDeletion
        val restingDays = written.filterIsInstance<RestingHeartRateRecord>().flatMap { reader.daysOf(it.time, it.time) } +
            recent + afterDeletion
        val sessions = LinkedHashMap<String, ExerciseSessionRecord>()
        written.filterIsInstance<ExerciseSessionRecord>().forEach { sessions[it.metadata.id] = it }
        reader.readAll(ExerciseSessionRecord::class, now.minus(Duration.ofHours(48)), now)
            .filter { it.metadata.id !in log.deleted }
            .forEach { sessions[it.metadata.id] = it }

        val collected = Collected(
            steps = reader.stepsDays(stepDays),
            workouts = sessions.values.map { reader.workout(it) },
            body = written.mapNotNull { reader.body(it) },
            resting = reader.restingDays(restingDays),
            sleep = written.filterIsInstance<SleepSessionRecord>().map { reader.sleep(it) },
            height = written.filterIsInstance<HeightRecord>().maxByOrNull { it.time }?.let { reader.height(it) },
            deleted = log.deleted,
        )
        return collected to next
    }
}
