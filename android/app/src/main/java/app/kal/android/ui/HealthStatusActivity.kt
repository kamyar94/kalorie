package app.kal.android.ui

import android.app.AlertDialog
import android.content.res.ColorStateList
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import app.kal.android.Kal
import app.kal.android.R
import app.kal.android.hc.HealthConnect
import app.kal.android.net.KalApi
import app.kal.android.store.SyncState
import app.kal.android.store.TokenStore
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
 * phone". Health Connect also opens this screen for "How Kal uses this data". While it is open
 * Kal sends (on opening, then on "Send now"), which is all it can do without background access.
 */
class HealthStatusActivity : ComponentActivity() {
    private var permissions: ActivityResultLauncher<Set<String>>? = null
    private var sending = false

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
        findViewById<TextView>(R.id.today).text =
            state.todayLine?.takeIf { state.todayDate == today } ?: getString(R.string.status_today_none)

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
