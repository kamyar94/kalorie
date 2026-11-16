package app.kal.android.hc

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Board 35: counting what Health Connect holds for 30 days, and when to say it has nothing. */
class InventoryTest {
    private val samsung = "com.sec.android.app.shealth"
    private val renpho = "com.renpho.health"
    private val day = LocalDate.of(2026, 11, 16)
    private fun ago(days: Long) = day.minusDays(days)

    @Test
    fun stepDaysCountDaysAboveZeroAndTheirApps() {
        val count = Inventory.stepDays(
            listOf(
                DayTotal(ago(2), 0, emptyList()),
                DayTotal(ago(1), 8412, listOf(samsung)),
                DayTotal(day, 120, listOf(samsung, "com.google.android.apps.fitness")),
                // The same day twice counts once.
                DayTotal(day, 120, listOf(samsung)),
            ),
        )
        assertEquals(InventoryKind.STEP_DAYS, count.kind)
        assertEquals(2, count.count)
        assertEquals(listOf(samsung, "com.google.android.apps.fitness"), count.origins)
        assertEquals(0, Inventory.stepDays(listOf(DayTotal(day, 0, listOf(samsung)))).count)
        assertEquals(emptyList<String>(), Inventory.stepDays(listOf(DayTotal(day, 0, listOf(samsung)))).origins)
    }

    @Test
    fun recordsCountOnePerRecordOrPerDay() {
        val stamps = listOf(
            Stamp(day, renpho),
            Stamp(day, renpho),
            Stamp(ago(3), samsung),
            Stamp(ago(5), null),
            Stamp(ago(6), " "),
        )
        assertEquals(5, Inventory.workouts(stamps).count)
        assertEquals(5, Inventory.weighIns(stamps).count)
        // Several readings or sessions of one day count once.
        assertEquals(4, Inventory.restingDays(stamps).count)
        assertEquals(4, Inventory.sleepNights(stamps).count)
        // Most records first; no blank packages.
        assertEquals(listOf(renpho, samsung), Inventory.weighIns(stamps).origins)
        assertEquals(listOf("a.b", "c.d"), Inventory.origins(listOf(Stamp(day, "c.d"), Stamp(day, "a.b"))))
    }

    @Test
    fun emptyWhenEveryKindKalMayReadIsZero() {
        val zeros = listOf(
            Inventory.stepDays(emptyList()),
            Inventory.workouts(emptyList()),
            Inventory.restingDays(emptyList()),
            Inventory.sleepNights(emptyList()),
            Inventory.weighIns(emptyList()),
        )
        assertTrue(Inventory.isEmpty(zeros))
        // A kind without access does not count against "empty".
        assertTrue(Inventory.isEmpty(zeros.drop(1) + Inventory.noAccess(InventoryKind.STEP_DAYS)))
        assertFalse(Inventory.isEmpty(zeros.drop(1) + Inventory.weighIns(listOf(Stamp(day, renpho)))))
        assertFalse(Inventory.isEmpty(zeros.drop(4) + Inventory.stepDays(listOf(DayTotal(day, 1, emptyList())))))
        // Nothing readable at all: the access rows say so, not the warning.
        assertFalse(Inventory.isEmpty(InventoryKind.entries.map { Inventory.noAccess(it) }))
        assertFalse(Inventory.isEmpty(emptyList()))
        assertNull(Inventory.noAccess(InventoryKind.WORKOUTS).count)
    }

    @Test
    fun appRowsSayInstalledAndWhetherSharing() {
        val nothing = listOf(Inventory.workouts(emptyList()))
        assertEquals(
            listOf(
                AppRow("Samsung Health", AppState.NOT_INSTALLED, null),
                AppRow("Renpho Health", AppState.NOT_INSTALLED, null),
            ),
            Inventory.appRows(nothing, null, null),
        )
        val galaxy = InstalledApp(samsung, "Samsung Health")
        val scale = InstalledApp("com.renpho.health.eu", "RENPHO Health")
        assertEquals(
            listOf(
                AppRow("Samsung Health", AppState.NOT_SHARING, samsung),
                AppRow("Renpho Health", AppState.NOT_SHARING, "com.renpho.health.eu"),
            ),
            Inventory.appRows(nothing, galaxy, scale),
        )
        val shared = listOf(
            Inventory.weighIns(listOf(Stamp(day, "com.qingniu.renpho"))),
            Inventory.workouts(listOf(Stamp(day, samsung))),
        )
        assertEquals(
            listOf(AppState.SHARING, AppState.SHARING),
            Inventory.appRows(shared, galaxy, scale).map { it.state },
        )
    }

    @Test
    fun renphoByKnownPackageOrLabel() {
        assertTrue(Inventory.isRenpho("com.qingniu.renpho", null))
        assertTrue(Inventory.isRenpho("com.renpho.health", "Renpho Health"))
        assertTrue(Inventory.isRenpho("cn.example.scale", "RENPHO"))
        assertTrue(Inventory.isRenpho("com.example.renphofit", null))
        assertFalse(Inventory.isRenpho(samsung, "Samsung Health"))
        assertEquals("Samsung Health", Inventory.knownName(samsung))
        assertNull(Inventory.knownName("com.example.unknown"))
    }
}
