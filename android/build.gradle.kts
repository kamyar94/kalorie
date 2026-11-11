// Versions of the build plugins. The Android Gradle Plugin compiles Kotlin itself (built-in
// Kotlin); the Kotlin plugin is listed only to pin its version.
plugins {
    id("com.android.application") version "9.5.1" apply false
    id("org.jetbrains.kotlin.android") version "2.4.21" apply false
}
