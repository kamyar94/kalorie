package app.kal.android.sync

import org.junit.Assert.assertEquals
import org.junit.Test

class JsonTest {
    @Test
    fun writesValuesInOrder() {
        assertEquals(
            """{"a":1,"b":[true,null,2.5],"c":{"d":"x"}}""",
            Json.write(linkedMapOf("a" to 1, "b" to listOf(true, null, 2.5), "c" to linkedMapOf("d" to "x"))),
        )
    }

    @Test
    fun escapesStrings() {
        assertEquals(
            "\"quote \\\" back \\\\ line \\n tab \\t bell \\u0007 sep \\u2028\"",
            Json.write("quote \" back \\ line \n tab \t bell \u0007 sep \u2028"),
        )
        assertEquals("\"Läuft 🏃\"", Json.write("Läuft 🏃"))
    }

    @Test
    fun writesWholeNumbersWithoutFractionAndNoNaN() {
        assertEquals("[80,80.25,-3,null,null,123456789012]", Json.write(listOf(80.0, 80.25, -3.0, Double.NaN, Double.POSITIVE_INFINITY, 123456789012L)))
    }
}
