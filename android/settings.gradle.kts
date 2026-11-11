// The Kal Android app: a Trusted Web Activity of the Kal site and a native Health Connect reader
// (README.md). Plugins and libraries come from Google's Maven repository and Maven Central only.
pluginManagement {
    repositories {
        google()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "kal-android"
include(":app")
