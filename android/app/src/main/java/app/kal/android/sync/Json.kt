package app.kal.android.sync

/**
 * A small JSON writer for the payloads: maps (in their order), lists, strings, numbers, booleans
 * and null. Numbers that are whole are written without a fraction; NaN and infinities as null.
 */
object Json {
    fun write(value: Any?): String = StringBuilder().also { append(it, value) }.toString()

    private fun append(out: StringBuilder, value: Any?) {
        when (value) {
            null -> out.append("null")
            is String -> string(out, value)
            is Boolean -> out.append(value)
            is Int, is Long, is Short, is Byte -> out.append(value)
            is Double -> number(out, value)
            is Float -> number(out, value.toDouble())
            is Map<*, *> -> {
                out.append('{')
                var first = true
                for ((key, item) in value) {
                    if (!first) out.append(',')
                    first = false
                    string(out, key.toString())
                    out.append(':')
                    append(out, item)
                }
                out.append('}')
            }
            is Iterable<*> -> {
                out.append('[')
                var first = true
                for (item in value) {
                    if (!first) out.append(',')
                    first = false
                    append(out, item)
                }
                out.append(']')
            }
            else -> string(out, value.toString())
        }
    }

    private fun number(out: StringBuilder, value: Double) {
        when {
            value.isNaN() || value.isInfinite() -> out.append("null")
            value == Math.rint(value) && Math.abs(value) < 1e15 -> out.append(value.toLong())
            else -> out.append(value)
        }
    }

    private fun string(out: StringBuilder, value: String) {
        out.append('"')
        for (c in value) {
            when (c) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                '\b' -> out.append("\\b")
                '\u000C' -> out.append("\\f")
                else ->
                    if (c < ' ' || c == ' ' || c == ' ') {
                        out.append("\\u").append(String.format("%04x", c.code))
                    } else {
                        out.append(c)
                    }
            }
        }
        out.append('"')
    }
}
