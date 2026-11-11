package app.kal.android.ui

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ProgressBar
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
import app.kal.android.sync.SyncScheduler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Board 14, opened by "Connect Health Connect" on the web page with a one-time code
 * (kal://link?code=...). "Choose what Kal may read" trades the code for this phone's token, then
 * asks Health Connect for the read permissions (and background reading when ticked and
 * possible); after the first sync it shows the status screen. Older Android and a missing or
 * outdated Health Connect get a sentence and, where it helps, the Play Store.
 */
class LinkActivity : ComponentActivity() {
    private var code: String? = null
    private var permissions: ActivityResultLauncher<Set<String>>? = null

    private lateinit var choose: Button
    private lateinit var notNow: Button
    private lateinit var message: TextView
    private lateinit var progress: ProgressBar
    private lateinit var background: CheckBox

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_connect)
        fitToWindow(findViewById(R.id.root))
        findViewById<View>(R.id.title).asHeading()
        choose = findViewById(R.id.choose)
        notNow = findViewById(R.id.not_now)
        message = findViewById(R.id.message)
        progress = findViewById(R.id.progress)
        background = findViewById(R.id.background)
        addKinds(findViewById(R.id.kinds))
        code = codeOf(intent)
        notNow.setOnClickListener { finish() }
        findViewById<Button>(R.id.how).setOnClickListener {
            startActivity(Intent(this, HealthStatusActivity::class.java))
        }
        if (Kal.healthConnectPossible) {
            permissions = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) {
                onGranted(it)
            }
        }
        render()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        codeOf(intent)?.let { code = it }
        render()
    }

    private fun codeOf(intent: Intent?): String? =
        intent?.data?.takeIf { it.scheme == "kal" && it.host == "link" }?.getQueryParameter("code")
            ?.takeIf { Regex("^[A-Za-z0-9_-]{20,128}$").matches(it) }

    private fun addKinds(list: LinearLayout) {
        val kinds = listOf(
            Triple("👟", R.string.connect_steps, R.string.connect_steps_hint),
            Triple("🏋️", R.string.connect_workouts, R.string.connect_workouts_hint),
            Triple("❤️", R.string.connect_heart, R.string.connect_heart_hint),
            Triple("😴", R.string.connect_sleep, R.string.connect_sleep_hint),
            Triple("⚖️", R.string.connect_body, R.string.connect_body_hint),
        )
        val inflater = LayoutInflater.from(this)
        for ((emoji, name, hint) in kinds) {
            val row = inflater.inflate(R.layout.item_kind, list, false)
            row.findViewById<TextView>(R.id.emoji).text = emoji
            row.findViewById<TextView>(R.id.name).setText(name)
            row.findViewById<TextView>(R.id.hint).setText(hint)
            list.addView(row)
        }
    }

    private fun say(text: CharSequence?) {
        message.text = text
        message.visibility = if (text.isNullOrBlank()) View.GONE else View.VISIBLE
    }

    private fun busy(text: Int?) {
        progress.visibility = if (text == null) View.GONE else View.VISIBLE
        choose.isEnabled = text == null
        notNow.isEnabled = text == null
        if (text != null) say(getString(text))
    }

    /** Sets the screen for this phone: what is possible, and what the main button does. */
    private fun render() {
        say(null)
        if (!Kal.healthConnectPossible) {
            say(getString(R.string.hc_old_android))
            background.visibility = View.GONE
            choose.setText(R.string.connect_open_kal)
            choose.setOnClickListener { Kal.open(this, "/more/android"); finish() }
            return
        }
        when (HealthConnect.availability(this)) {
            HealthConnect.Availability.MISSING -> {
                say(getString(R.string.hc_missing))
                choose.setText(R.string.hc_install)
                choose.setOnClickListener { HealthConnect.openStore(this) }
                return
            }
            HealthConnect.Availability.NEEDS_UPDATE -> {
                say(getString(R.string.hc_update))
                choose.setText(R.string.hc_update_button)
                choose.setOnClickListener { HealthConnect.openStore(this) }
                return
            }
            else -> Unit
        }
        val client = HealthConnect.client(this)
        if (!HealthConnect.backgroundAvailable(client)) {
            background.isChecked = false
            background.visibility = View.GONE
            findViewById<View>(R.id.background_note).visibility = View.VISIBLE
        }
        val linked = TokenStore.has(this)
        if (code == null && !linked) {
            say(getString(R.string.connect_no_code))
            choose.setText(R.string.connect_open_kal)
            choose.setOnClickListener { Kal.open(this, "/more/android"); finish() }
            return
        }
        choose.setText(R.string.connect_choose)
        choose.setOnClickListener { start() }
    }

    private fun start() {
        val pending = code
        if (pending == null) {
            askPermissions()
            return
        }
        busy(R.string.connect_linking)
        lifecycleScope.launch {
            // A new code replaces an earlier link of this phone (for example one unlinked on the web).
            val earlier = TokenStore.load(this@LinkActivity)
            val name = listOf(Build.MANUFACTURER, Build.MODEL)
                .filter { it.isNotBlank() }
                .joinToString(" ") { part -> part.replaceFirstChar { it.uppercase() } }
            val answer = withContext(Dispatchers.IO) { KalApi.claim(pending, name, Kal.appVersion) }
            busy(null)
            when (answer) {
                is KalApi.Answer.Ok -> {
                    val token = answer.body.optString("token")
                    if (token.isBlank()) {
                        say(getString(R.string.status_error_server))
                        return@launch
                    }
                    TokenStore.save(this@LinkActivity, token)
                    SyncState(this@LinkActivity).reset()
                    if (earlier != null && earlier != token) {
                        withContext(Dispatchers.IO) { KalApi.unlink(earlier) }
                    }
                    code = null
                    askPermissions()
                }
                KalApi.Answer.Unlinked -> say(getString(R.string.status_error_server))
                is KalApi.Answer.Failed ->
                    say(answer.message ?: getString(if (answer.network) R.string.status_error_network else R.string.status_error_server))
            }
        }
    }

    private fun askPermissions() {
        val launcher = permissions ?: return
        launcher.launch(HealthConnect.toRequest(HealthConnect.client(this), background.isChecked))
    }

    private fun onGranted(granted: Set<String>) {
        if (granted.none { it in HealthConnect.READ_PERMISSIONS }) {
            say(getString(R.string.connect_nothing_allowed))
            return
        }
        if (HealthConnect.BACKGROUND in granted) SyncScheduler.ensurePeriodic(applicationContext)
        busy(R.string.connect_sending)
        lifecycleScope.launch {
            SyncEngine.run(this@LinkActivity)
            busy(null)
            startActivity(Intent(this@LinkActivity, HealthStatusActivity::class.java))
            finish()
        }
    }
}
