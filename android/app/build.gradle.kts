// The Kal app. The server's host name and the application id are build properties, never in git:
// from kal.properties (or the file given with -Pkal.properties=...), or KAL_HOST / KAL_APP_ID in
// the environment. Signing comes from a keystore.properties outside the repository
// (-Pkal.signing=...), written by scripts/android-build.mjs.
import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
}

val kalFile = file((findProperty("kal.properties") as String?) ?: rootProject.file("kal.properties").path)
val kalProps = Properties().apply { if (kalFile.isFile) kalFile.inputStream().use { load(it) } }

fun kal(name: String, env: String): String? =
    System.getenv(env)?.takeIf { it.isNotBlank() } ?: kalProps.getProperty("kal.$name")?.trim()

val kalHost = kal("host", "KAL_HOST")
    ?: error("Set kal.host in android/kal.properties (see kal.properties.example) or KAL_HOST.")
val kalAppId = kal("appId", "KAL_APP_ID")
    ?: error("Set kal.appId in android/kal.properties (see kal.properties.example) or KAL_APP_ID.")
require(Regex("^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$").matches(kalHost)) {
    "kal.host must be a host name such as kal.example.com, without https:// or a path."
}
require(Regex("^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+$").matches(kalAppId)) {
    "kal.appId must be a package name such as app.kal."
}
val kalVersionCode = (kal("versionCode", "KAL_VERSION_CODE") ?: "1").toInt()
val kalVersionName = kal("versionName", "KAL_VERSION_NAME") ?: "1.0"

val signingFile = (findProperty("kal.signing") as String?)?.let { file(it) }
val signingProps = Properties().apply {
    if (signingFile?.isFile == true) signingFile.inputStream().use { load(it) }
}

android {
    namespace = "app.kal.android"
    compileSdk = 37

    defaultConfig {
        applicationId = kalAppId
        minSdk = 24
        targetSdk = 37
        versionCode = kalVersionCode
        versionName = kalVersionName

        // The Trusted Web Activity: the site, its start URL and the Digital Asset Links statement
        // that ties the app to it (the site answers with /.well-known/assetlinks.json).
        manifestPlaceholders["kalHost"] = kalHost
        resValue("string", "kal_host", kalHost)
        resValue("string", "launch_url", "https://$kalHost/?source=android-app")
        resValue(
            "string",
            "asset_statements",
            "[{\\\"relation\\\": [\\\"delegate_permission/common.handle_all_urls\\\"], " +
                "\\\"target\\\": {\\\"namespace\\\": \\\"web\\\", \\\"site\\\": \\\"https://$kalHost\\\"}}]",
        )
        resValue("string", "provider_authority", "$kalAppId.fileprovider")
        buildConfigField("String", "KAL_HOST", "\"$kalHost\"")
    }

    signingConfigs {
        if (signingProps.isNotEmpty()) {
            create("release") {
                storeFile = signingFile!!.resolveSibling(signingProps.getProperty("storeFile"))
                storePassword = signingProps.getProperty("storePassword")
                keyAlias = signingProps.getProperty("keyAlias")
                keyPassword = signingProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
        resValues = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // No Google-encrypted dependency report in the APK: it is installed from the person's server.
    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/*.kotlin_module", "DebugProbesKt.bin")
    }

    testOptions {
        unitTests.isReturnDefaultValues = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
    implementation("androidx.health.connect:connect-client:1.1.0")
    implementation("androidx.work:work-runtime-ktx:2.12.0")
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")

    testImplementation("junit:junit:4.13.2")
}
