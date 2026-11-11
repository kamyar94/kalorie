package app.kal.android.store

import android.content.Context

/**
 * What the app remembers between syncs: the Health Connect changes token (and which record types
 * it covers), when it last sent, today's line for the status screen, whether the server unlinked
 * the phone, and the newest app version the server offers. Times are epoch milliseconds.
 */
class SyncState(context: Context) {
    private val prefs = context.getSharedPreferences("kal-sync", Context.MODE_PRIVATE)

    var changesToken: String?
        get() = prefs.getString("changesToken", null)
        set(value) = prefs.edit().putString("changesToken", value).apply()

    /** The record types and history permission the changes token was made for. */
    var tokenTypes: String?
        get() = prefs.getString("tokenTypes", null)
        set(value) = prefs.edit().putString("tokenTypes", value).apply()

    var lastSyncAt: Long
        get() = prefs.getLong("lastSyncAt", 0)
        set(value) = prefs.edit().putLong("lastSyncAt", value).apply()

    var lastAttemptAt: Long
        get() = prefs.getLong("lastAttemptAt", 0)
        set(value) = prefs.edit().putLong("lastAttemptAt", value).apply()

    /** "8,412 steps · 1 workout" as of the last sync, and the day it was for. */
    var todayLine: String?
        get() = prefs.getString("todayLine", null)
        set(value) = prefs.edit().putString("todayLine", value).apply()

    var todayDate: String?
        get() = prefs.getString("todayDate", null)
        set(value) = prefs.edit().putString("todayDate", value).apply()

    /** The server answered 401: the phone was unlinked there. */
    var unlinked: Boolean
        get() = prefs.getBoolean("unlinked", false)
        set(value) = prefs.edit().putBoolean("unlinked", value).apply()

    var newerVersionName: String?
        get() = prefs.getString("newerVersionName", null)
        set(value) = prefs.edit().putString("newerVersionName", value).apply()

    var notifiedVersionCode: Int
        get() = prefs.getInt("notifiedVersionCode", 0)
        set(value) = prefs.edit().putInt("notifiedVersionCode", value).apply()

    var lastVersionCheckAt: Long
        get() = prefs.getLong("lastVersionCheckAt", 0)
        set(value) = prefs.edit().putLong("lastVersionCheckAt", value).apply()

    /** Starts over (linking again, unlinking): the next sync reads the whole window again. */
    fun reset() {
        prefs.edit()
            .remove("changesToken")
            .remove("tokenTypes")
            .remove("lastSyncAt")
            .remove("lastAttemptAt")
            .remove("todayLine")
            .remove("todayDate")
            .remove("unlinked")
            .apply()
    }
}
