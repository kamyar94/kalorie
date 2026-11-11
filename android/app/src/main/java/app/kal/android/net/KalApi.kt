package app.kal.android.net

import app.kal.android.BuildConfig
import app.kal.android.Kal
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/**
 * The few calls the app makes to its Kal server, over HTTPS only. The device token travels in the
 * Authorization header, never in a URL. Blocking: call from a background thread or Dispatchers.IO.
 */
object KalApi {
    sealed interface Answer {
        data class Ok(val body: JSONObject) : Answer
        /** 401: the phone is not (or no longer) linked. */
        data object Unlinked : Answer
        data class Failed(val network: Boolean, val message: String?) : Answer
    }

    private fun call(method: String, path: String, token: String? = null, body: String? = null): Answer {
        val connection = (URL(Kal.baseUrl + path).openConnection() as HttpURLConnection)
        return try {
            connection.requestMethod = method
            connection.connectTimeout = 15_000
            connection.readTimeout = 60_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", "Kal-Android/${BuildConfig.VERSION_NAME}")
            if (token != null) connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                val bytes = body.toByteArray(Charsets.UTF_8)
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            val json = try {
                JSONObject(text)
            } catch (_: Exception) {
                JSONObject()
            }
            when {
                status in 200..299 -> Answer.Ok(json)
                status == 401 -> Answer.Unlinked
                else -> Answer.Failed(false, json.optString("error").takeIf { it.isNotBlank() })
            }
        } catch (_: IOException) {
            Answer.Failed(true, null)
        } finally {
            connection.disconnect()
        }
    }

    /** Trades the one-time code from the web page for this phone's token. */
    fun claim(code: String, name: String, appVersion: String): Answer =
        call(
            "POST",
            "/api/devices/claim",
            body = JSONObject().put("code", code).put("name", name).put("appVersion", appVersion).toString(),
        )

    /** Whether the server still knows this phone. */
    fun self(token: String): Answer = call("GET", "/api/devices/self", token)

    /** "Unlink this phone". */
    fun unlink(token: String): Answer = call("DELETE", "/api/devices/self", token)

    /** One batch of Health Connect records (sync/Payload.kt). */
    fun sync(token: String, batch: String): Answer = call("POST", "/api/health-connect/sync", token, batch)

    /** The app version the server hands out: versionCode to versionName, or null. */
    fun latestVersion(): Pair<Int, String>? =
        when (val answer = call("GET", "/android/version.json")) {
            is Answer.Ok -> {
                val code = answer.body.optInt("versionCode", 0)
                val name = answer.body.optString("versionName")
                if (code > 0 && name.isNotBlank()) code to name else null
            }
            else -> null
        }
}
