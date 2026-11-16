package app.kal.android.hc

import java.time.LocalDate

// What Health Connect holds on this phone for the last 30 days, as the status screen lists it
// (board 35: "In Health Connect, last 30 days"), and the decision to show "Health Connect has
// nothing to share yet". Plain Kotlin, no Health Connect classes, so it is tested on the JVM;
// InventoryReader fills it. Nothing from this list is sent anywhere.

/** The five rows of the list, in its order. */
enum class InventoryKind { STEP_DAYS, WORKOUTS, RESTING_DAYS, SLEEP_NIGHTS, WEIGH_INS }

/** A record as the list counts it: the local day it belongs to and the package that wrote it. */
data class Stamp(val day: LocalDate, val origin: String?)

/** A day's step total from Health Connect's aggregate and the packages that wrote that day's steps. */
data class DayTotal(val day: LocalDate, val count: Long, val origins: List<String>)

/** One row: how many (null when Kal may not read this kind) and the packages that wrote them. */
data class KindCount(val kind: InventoryKind, val count: Int?, val origins: List<String>)

/** Samsung Health or Renpho Health as the warning names them: installed, and sharing or not. */
enum class AppState { NOT_INSTALLED, NOT_SHARING, SHARING }

data class AppRow(val name: String, val state: AppState, val packageName: String?)

/** An installed app: its package and the label the launcher shows. */
data class InstalledApp(val packageName: String, val label: String)

object Inventory {
    /** The window: today and the 29 days before it. */
    const val DAYS = 30L

    const val SAMSUNG_HEALTH = "com.sec.android.app.shealth"

    /** Renpho's apps by package; the package differs by region, so labels are matched too. */
    val RENPHO_PACKAGES = listOf("com.renpho.health", "com.qingniu.renpho")

    /** Names for packages that commonly write to Health Connect (when the launcher has no label). */
    private val KNOWN = mapOf(
        SAMSUNG_HEALTH to "Samsung Health",
        "com.samsung.android.wear.shealth" to "Samsung Health",
        "com.renpho.health" to "Renpho Health",
        "com.qingniu.renpho" to "Renpho",
        "com.google.android.apps.fitness" to "Google Fit",
        "com.fitbit.FitbitMobile" to "Fitbit",
        "com.google.android.apps.healthdata" to "Health Connect",
    )

    fun knownName(packageName: String): String? = KNOWN[packageName]

    fun isRenpho(packageName: String, label: String?): Boolean =
        packageName in RENPHO_PACKAGES ||
            packageName.contains("renpho", ignoreCase = true) ||
            label?.contains("renpho", ignoreCase = true) == true

    /** The packages that wrote [stamps], most records first (then by name); blanks left out. */
    fun origins(stamps: List<Stamp>): List<String> =
        stamps.mapNotNull { it.origin?.takeIf(String::isNotBlank) }
            .groupingBy { it }
            .eachCount()
            .entries
            .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
            .map { it.key }

    /** Days with steps above 0; the apps of those days, the ones with most days first. */
    fun stepDays(days: List<DayTotal>): KindCount {
        val withSteps = days.filter { it.count > 0 }.distinctBy { it.day }
        val origins = origins(withSteps.flatMap { day -> day.origins.map { Stamp(day.day, it) } })
        return KindCount(InventoryKind.STEP_DAYS, withSteps.size, origins)
    }

    fun workouts(stamps: List<Stamp>) = KindCount(InventoryKind.WORKOUTS, stamps.size, origins(stamps))

    /** Days with a resting heart rate (several readings a day count once). */
    fun restingDays(stamps: List<Stamp>) =
        KindCount(InventoryKind.RESTING_DAYS, stamps.map { it.day }.distinct().size, origins(stamps))

    /** Nights of sleep: sessions by the day they ended (a nap the same day counts with the night). */
    fun sleepNights(stamps: List<Stamp>) =
        KindCount(InventoryKind.SLEEP_NIGHTS, stamps.map { it.day }.distinct().size, origins(stamps))

    fun weighIns(stamps: List<Stamp>) = KindCount(InventoryKind.WEIGH_INS, stamps.size, origins(stamps))

    fun noAccess(kind: InventoryKind) = KindCount(kind, null, emptyList())

    /**
     * "Health Connect has nothing to share yet": Kal may read at least one of the kinds, and every
     * kind it may read has nothing in the window.
     */
    fun isEmpty(counts: List<KindCount>): Boolean =
        counts.any { it.count != null } && counts.all { (it.count ?: 0) == 0 }

    /**
     * The warning's rows for Samsung Health and Renpho Health: not installed, or installed and
     * sharing when any counted record came from it, else not sharing.
     */
    fun appRows(counts: List<KindCount>, samsung: InstalledApp?, renpho: InstalledApp?): List<AppRow> {
        val origins = counts.flatMap { it.origins }.toSet()
        fun row(name: String, app: InstalledApp?, wrote: (String) -> Boolean) =
            AppRow(
                name,
                when {
                    app == null -> AppState.NOT_INSTALLED
                    origins.any(wrote) -> AppState.SHARING
                    else -> AppState.NOT_SHARING
                },
                app?.packageName,
            )
        return listOf(
            row("Samsung Health", samsung) { it == SAMSUNG_HEALTH || it == samsung?.packageName },
            row("Renpho Health", renpho) { it == renpho?.packageName || isRenpho(it, null) },
        )
    }
}
