package app.kal.android.ui

import android.app.AlertDialog
import android.content.res.ColorStateList
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.core.view.ViewCompat
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import app.kal.android.Kal
import app.kal.android.R
import app.kal.android.hc.AppState
import app.kal.android.hc.HealthApps
import app.kal.android.hc.HealthConnect
import app.kal.android.hc.InstalledApp
import app.kal.android.hc.Inventory
import app.kal.android.hc.InventoryKind
import app.kal.android.hc.InventoryReader
import app.kal.android.hc.KindCount
import app.kal.android.net.KalApi
import app.kal.android.store.SyncState
import app.kal.android.store.TokenStore
import app.kal.android.sync.DayNumbers
import app.kal.android.sync.SyncEngine
import app.kal.android.sync.SyncOutcome
import app.kal.android.sync.SyncScheduler
import app.kal.android.update.UpdateCheck
import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Board 15: whether the phone is linked, when it last sent and what today holds, when it sends
 * next, "Send now", which access Health Connect gives, how Kal uses the data, and "Unlink this
 * phone". Board 35: what Health Connect holds for the last 30 days and which apps wrote it
 * (counted on the phone, never sent), and "Health Connect has nothing to share yet" when every
 * kind Kal may read is empty, with Samsung Health and Renpho Health, buttons to open Samsung
 * Health and Health Connect's permissions, and the steps. Health Connect also opens this screen
 * for "How Kal uses this data". While it is open Kal sends (on opening, then on "Send now"),
 * which is all it can do without background access.
 */
class HealthStatusActivity : ComponentActivity() {
    private companion object {
        val KIND_LABELS = mapOf(
            InventoryKind.STEP_DAYS to R.string.inventory_steps,
            InventoryKind.WORKOUTS to R.string.inventory_workouts,
            InventoryKind.RESTING_DAYS to R.string.inventory_resting,
            InventoryKind.SLEEP_NIGHTS to R.string.inventory_sleep,
            InventoryKind.WEIGH_INS to R.string.inventory_weigh_ins,
        )
        val KIND_EMOJI = mapOf(
            InventoryKind.STEP_DAYS to "👟",
            InventoryKind.WORKOUTS to "🏋️",
            InventoryKind.RESTING_DAYS to "❤️",
            InventoryKind.SLEEP_NIGHTS to "😴",
            InventoryKind.WEIGH_INS to "⚖️",
        )
    }

    private var permissions: ActivityResultLauncher<Set<String>>? = null
    private var sending = false
    private var stepsOpen = false

    private val status by lazy { findViewById<TextView>(R.id.status) }
    private val dot by lazy { findViewById<ImageView>(R.id.dot) }
    private val result by lazy { findViewById<TextView>(R.id.result) }
    private val sendNow by lazy { findViewById<Button>(R.id.send_now) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_status)
        fitToWindow(findViewById(R.id.root))
        findViewById<View>(R.id.back).setOnClickListener { back() }
        findViewById<Button>(R.id.link_again).setOnClickListener {
            Kal.open(this, "/more/android")
            finish()
        }
        findViewById<Button>(R.id.update_button).setOnClickListener {
            startActivity(UpdateCheck.downloadIntent(this))
        }
        if (!Kal.healthConnectPossible) {
            showOldAndroid()
            return
        }
        permissions = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { granted ->
            if (HealthConnect.BACKGROUND in granted) SyncScheduler.ensurePeriodic(applicationContext)
            refresh(send = true)
        }
        sendNow.setOnClickListener { refresh(send = true, force = true) }
        findViewById<Button>(R.id.change_access).setOnClickListener { changeAccess() }
        findViewById<Button>(R.id.unlink).setOnClickListener { confirmUnlink() }
        findViewById<Button>(R.id.open_samsung).setOnClickListener {
            HealthApps.open(this, Inventory.SAMSUNG_HEALTH)
        }
        findViewById<Button>(R.id.open_permissions).setOnClickListener { HealthConnect.openSettings(this) }
        findViewById<Button>(R.id.steps_toggle).setOnClickListener {
            stepsOpen = !stepsOpen
            showSteps()
        }
        showSteps()
    }

    override fun onResume() {
        super.onResume()
        if (!Kal.healthConnectPossible) return
        UpdateCheck.checkInBackground(this)
        refresh(send = true)
    }

    private fun back() {
        if (isTaskRoot) Kal.open(this)
        finish()
    }

    private fun showOldAndroid() {
        status.setText(R.string.hc_old_android)
        dot.visibility = View.GONE
        for (id in listOf(R.id.facts, R.id.send_now, R.id.access, R.id.note, R.id.unlink)) {
            findViewById<View>(id).visibility = View.GONE
        }
    }

    private fun accessRow(id: Int, label: Int, state: Int, allowed: Boolean) {
        val row = findViewById<View>(id)
        row.findViewById<TextView>(R.id.label).setText(label)
        val text = row.findViewById<TextView>(R.id.state)
        text.setText(state)
        text.setTextColor(getColor(if (allowed) R.color.kal_primary else R.color.kal_on_warning_soft))
    }

    private fun groupState(granted: Set<String>, group: Set<String>) =
        when (granted.count { it in group }) {
            group.size -> R.string.status_allowed
            0 -> R.string.status_not_allowed
            else -> R.string.status_partly
        }

    /** Fills the screen; with [send], also sends (at most every two minutes unless [force]). */
    private fun refresh(send: Boolean = false, force: Boolean = false) {
        lifecycleScope.launch {
            val state = SyncState(this@HealthStatusActivity)
            val linked = TokenStore.has(this@HealthStatusActivity)
            val ready = HealthConnect.availability(this@HealthStatusActivity) == HealthConnect.Availability.READY
            val granted =
                if (ready) {
                    try {
                        HealthConnect.client(this@HealthStatusActivity).permissionController.getGrantedPermissions()
                    } catch (_: Exception) {
                        emptySet()
                    }
                } else {
                    emptySet()
                }
            show(state, linked, ready, granted)
            showInventory(if (ready) readInventory(granted) else null)
            val due = System.currentTimeMillis() - state.lastAttemptAt > 2 * 60 * 1000L
            if (send && linked && ready && !sending && (force || due)) {
                sending = true
                sendNow.isEnabled = false
                sendNow.setText(R.string.status_sending)
                val outcome = SyncEngine.run(this@HealthStatusActivity)
                sending = false
                sendNow.isEnabled = true
                sendNow.setText(R.string.status_send_now)
                show(state, TokenStore.has(this@HealthStatusActivity), ready, granted)
                say(outcome)
            } else if (linked && !send) {
                // Nothing to send: still learn whether the server unlinked this phone.
                val token = TokenStore.load(this@HealthStatusActivity) ?: return@launch
                if (withContext(Dispatchers.IO) { KalApi.self(token) } == KalApi.Answer.Unlinked) {
                    TokenStore.clear(this@HealthStatusActivity)
                    state.reset()
                    state.unlinked = true
                    SyncScheduler.cancel(this@HealthStatusActivity)
                    show(state, false, ready, granted)
                }
            }
        }
    }

    private fun say(outcome: SyncOutcome) {
        val text = when (outcome) {
            SyncOutcome.SENT -> getString(R.string.status_sent)
            SyncOutcome.NETWORK -> getString(R.string.status_error_network)
            SyncOutcome.SERVER -> getString(R.string.status_error_server)
            SyncOutcome.NO_ACCESS, SyncOutcome.READ_FAILED -> getString(R.string.status_error_permission)
            SyncOutcome.HEALTH_CONNECT_MISSING -> getString(R.string.hc_missing)
            SyncOutcome.NOT_LINKED, SyncOutcome.UNLINKED -> null
        }
        result.text = text
        result.visibility = if (text == null) View.GONE else View.VISIBLE
    }

    private suspend fun show(state: SyncState, linked: Boolean, ready: Boolean, granted: Set<String>) {
        val zone = ZoneId.systemDefault()
        status.setText(if (linked) R.string.status_linked else R.string.status_unlinked)
        dot.imageTintList = ColorStateList.valueOf(getColor(if (linked) R.color.kal_primary else R.color.kal_on_warning_soft))
        findViewById<View>(R.id.link_again).visibility = if (linked) View.GONE else View.VISIBLE
        sendNow.visibility = if (linked && ready) View.VISIBLE else View.GONE
        findViewById<View>(R.id.unlink).visibility = if (linked) View.VISIBLE else View.GONE

        findViewById<TextView>(R.id.last_sent).text =
            if (state.lastSyncAt > 0) Words.moment(Instant.ofEpochMilli(state.lastSyncAt), zone)
            else getString(R.string.status_not_yet)
        val today = Instant.now().atZone(zone).toLocalDate().toString()
        val numbers = state.today?.takeIf { it.date.toString() == today }
        findViewById<TextView>(R.id.today).text =
            state.todayLine?.takeIf { state.todayDate == today }
                ?: getString(if (numbers != null) R.string.status_today_no_more else R.string.status_today_none)
        showTotals(numbers)

        val background = HealthConnect.BACKGROUND in granted
        val next = if (linked && background) withContext(Dispatchers.IO) { SyncScheduler.nextRun(this@HealthStatusActivity) } else null
        findViewById<TextView>(R.id.next).text =
            if (next != null) getString(R.string.status_next_background, Words.clockOrMoment(Instant.ofEpochMilli(next), zone))
            else getString(R.string.status_next_open)

        accessRow(R.id.access_activity, R.string.status_access_activity, groupState(granted, HealthConnect.ACTIVITY_PERMISSIONS), HealthConnect.ACTIVITY_PERMISSIONS.all { it in granted })
        accessRow(R.id.access_body, R.string.status_access_body, groupState(granted, HealthConnect.BODY_PERMISSIONS), HealthConnect.BODY_PERMISSIONS.all { it in granted })
        accessRow(R.id.access_background, R.string.status_access_background, if (background) R.string.status_allowed else R.string.status_not_allowed, background)
        findViewById<TextView>(R.id.note).setText(if (background) R.string.status_note_sharing else R.string.status_note_no_background)

        val newer = state.newerVersionName
        val update = findViewById<TextView>(R.id.update)
        update.text = newer?.let { getString(R.string.status_update, it) }
        update.visibility = if (newer != null) View.VISIBLE else View.GONE
        findViewById<View>(R.id.update_button).visibility = if (newer != null) View.VISIBLE else View.GONE
    }

    /** Today's steps, active time and activity calories as last sent; hidden before app 1.2 sent them. */
    private fun showTotals(numbers: DayNumbers?) {
        val visibility = if (numbers != null) View.VISIBLE else View.GONE
        findViewById<View>(R.id.today_totals_title).visibility = visibility
        findViewById<View>(R.id.today_totals).visibility = visibility
        if (numbers == null) return
        for ((id, label, value) in listOf(
            Triple(R.id.total_steps, R.string.total_steps, Words.number(numbers.steps)),
            Triple(R.id.total_active, R.string.total_active, Words.minutes(numbers.activeMinutes)),
            Triple(R.id.total_kcal, R.string.total_kcal, Words.kcal(numbers.activeKcal)),
        )) {
            val box = findViewById<View>(id)
            box.findViewById<TextView>(R.id.value).text = value
            box.findViewById<TextView>(R.id.label).setText(label)
            box.contentDescription = getString(R.string.total_spoken, getString(label), value)
        }
    }

    /** What Health Connect holds and who wrote it, with the apps the warning names. */
    private class InventoryView(
        val counts: List<KindCount>,
        val labels: Map<String, String>,
        val samsung: InstalledApp?,
        val renpho: InstalledApp?,
    )

    /** Counts the last 30 days in Health Connect; null when Kal may read nothing or it failed. */
    private suspend fun readInventory(granted: Set<String>): InventoryView? {
        if (granted.none { it in HealthConnect.READ_PERMISSIONS }) return null
        val context = this
        return withContext(Dispatchers.IO) {
            try {
                val counts = InventoryReader(HealthConnect.client(context), ZoneId.systemDefault(), granted).read()
                InventoryView(
                    counts = counts,
                    labels = counts.flatMap { it.origins }.distinct().associateWith { HealthApps.label(context, it) },
                    samsung = HealthApps.samsungHealth(context),
                    renpho = HealthApps.renpho(context),
                )
            } catch (_: Exception) {
                null
            }
        }
    }

    /** Fills "In Health Connect, last 30 days" and, when it is all empty, the warning. */
    private fun showInventory(view: InventoryView?) {
        val card = findViewById<View>(R.id.inventory)
        val warning = findViewById<View>(R.id.empty_card)
        if (view == null) {
            card.visibility = View.GONE
            warning.visibility = View.GONE
            return
        }
        val empty = Inventory.isEmpty(view.counts)
        val rows = findViewById<LinearLayout>(R.id.inventory_rows)
        rows.removeAllViews()
        for (count in view.counts) {
            val row = layoutInflater.inflate(R.layout.item_count, rows, false)
            val label = getString(KIND_LABELS.getValue(count.kind))
            row.findViewById<TextView>(R.id.label).text = "${KIND_EMOJI.getValue(count.kind)} $label"
            val number = count.count?.toString() ?: getString(R.string.inventory_no_access)
            row.findViewById<TextView>(R.id.count).text = number
            val names = Words.apps(count.origins.map { view.labels[it] ?: it })
            val from = if (names.isEmpty()) null else getString(R.string.inventory_from, names)
            val apps = row.findViewById<TextView>(R.id.apps)
            apps.text = from
            apps.visibility = if (from == null) View.GONE else View.VISIBLE
            row.contentDescription =
                listOfNotNull(getString(R.string.inventory_row, label, number), from).joinToString(". ")
            rows.addView(row)
        }
        findViewById<TextView>(R.id.inventory_note).setText(
            if (empty) R.string.inventory_note_empty else R.string.inventory_note,
        )
        card.visibility = View.VISIBLE

        warning.visibility = if (empty) View.VISIBLE else View.GONE
        if (!empty) return
        val list = findViewById<LinearLayout>(R.id.empty_apps)
        list.removeAllViews()
        for (app in Inventory.appRows(view.counts, view.samsung, view.renpho)) {
            val row = layoutInflater.inflate(R.layout.item_app_row, list, false)
            val state = getString(
                when (app.state) {
                    AppState.NOT_INSTALLED -> R.string.empty_not_installed
                    AppState.NOT_SHARING -> R.string.empty_not_sharing
                    AppState.SHARING -> R.string.empty_sharing
                },
            )
            row.findViewById<TextView>(R.id.mark).text = if (app.state == AppState.SHARING) "✅" else "✖️"
            row.findViewById<TextView>(R.id.name).text = app.name
            row.findViewById<TextView>(R.id.state).text = state
            row.contentDescription = getString(R.string.empty_app_state, app.name, state)
            list.addView(row)
        }
        val openable = view.samsung != null && HealthApps.canOpen(this, Inventory.SAMSUNG_HEALTH)
        findViewById<View>(R.id.open_samsung).visibility = if (openable) View.VISIBLE else View.GONE
    }

    /** "Step by step" opens and closes the list of steps. */
    private fun showSteps() {
        val toggle = findViewById<Button>(R.id.steps_toggle)
        findViewById<View>(R.id.steps_list).visibility = if (stepsOpen) View.VISIBLE else View.GONE
        toggle.setCompoundDrawablesRelativeWithIntrinsicBounds(
            0,
            0,
            if (stepsOpen) R.drawable.ic_expand_less else R.drawable.ic_expand_more,
            0,
        )
        ViewCompat.setStateDescription(
            toggle,
            getString(if (stepsOpen) R.string.state_expanded else R.string.state_collapsed),
        )
    }

    /** Asks Health Connect for what is missing; with everything allowed, opens its settings. */
    private fun changeAccess() {
        if (HealthConnect.availability(this) != HealthConnect.Availability.READY) {
            HealthConnect.openStore(this)
            return
        }
        lifecycleScope.launch {
            val client = HealthConnect.client(this@HealthStatusActivity)
            val wanted = HealthConnect.toRequest(client, background = true)
            val granted = try {
                client.permissionController.getGrantedPermissions()
            } catch (_: Exception) {
                emptySet()
            }
            if (wanted.all { it in granted }) HealthConnect.openSettings(this@HealthStatusActivity)
            else permissions?.launch(wanted)
        }
    }

    private fun confirmUnlink() {
        AlertDialog.Builder(this)
            .setTitle(R.string.status_unlink_confirm_title)
            .setMessage(R.string.status_unlink_confirm_body)
            .setNegativeButton(R.string.status_unlink_keep, null)
            .setPositiveButton(R.string.status_unlink) { _, _ -> unlink() }
            .show()
    }

    private fun unlink() {
        val token = TokenStore.load(this) ?: return
        lifecycleScope.launch {
            when (val answer = withContext(Dispatchers.IO) { KalApi.unlink(token) }) {
                is KalApi.Answer.Ok, KalApi.Answer.Unlinked -> {
                    TokenStore.clear(this@HealthStatusActivity)
                    SyncState(this@HealthStatusActivity).reset()
                    SyncScheduler.cancel(this@HealthStatusActivity)
                    refresh()
                }
                is KalApi.Answer.Failed -> {
                    result.text = getString(if (answer.network) R.string.status_error_network else R.string.status_error_server)
                    result.visibility = View.VISIBLE
                }
            }
        }
    }
}
