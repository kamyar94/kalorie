package app.kal.android

import org.junit.Assert.assertEquals
import org.junit.Test

/** The address the app opens Kal at tells the site it runs inside the app. */
class AppUrlTest {
    private val host = "kal.example.com"

    @Test
    fun marksKalsOwnAddresses() {
        assertEquals(
            "https://kal.example.com/?source=android-app&hc=1&appVersion=3",
            AppUrl.withMarker("https://kal.example.com/?source=android-app", host, true, 3),
        )
        assertEquals(
            "https://kal.example.com/more/android?tab=x&source=android-app&hc=0&appVersion=1#get",
            AppUrl.withMarker("https://kal.example.com/more/android?hc=1&tab=x#get", host, false, 1),
        )
        assertEquals(
            "https://KAL.example.com/?source=android-app&hc=1&appVersion=2",
            AppUrl.withMarker("https://KAL.example.com", host, true, 2),
        )
        assertEquals(
            "https://kal.example.com/today?source=android-app&hc=1&appVersion=1",
            AppUrl.page(host, "/today", true, 1),
        )
    }

    @Test
    fun leavesOtherAddressesAlone() {
        assertEquals("https://elsewhere.example.org/x", AppUrl.withMarker("https://elsewhere.example.org/x", host, true, 1))
        assertEquals("http://kal.example.com/", AppUrl.withMarker("http://kal.example.com/", host, true, 1))
        assertEquals("not a url %%", AppUrl.withMarker("not a url %%", host, true, 1))
    }
}
