# Kal for Android

One Android app named Kal. It opens the Kal site full screen as a Trusted Web Activity (TWA), so
every web feature works and updates with the server, and adds a small native part that reads
Health Connect (steps, workouts, heart rate, sleep, weight and body composition) and sends the
records to the person's own Kal server.

- `KalLauncherActivity` opens the site at `/?source=android-app&hc=1|0&appVersion=N`
  (androidbrowserhelper; a Custom Tab where no browser can host a TWA). The site keeps that
  marker for the tab and shows "Connect Health Connect" only inside the app.
- `DelegationService` (androidbrowserhelper) shows Kal's web push messages as the app's
  notifications; Android 13's notification permission is asked through the web page's flow.
- `ui/LinkActivity` (board 14) opens from the web page's intent URL
  `intent://link?code=...#Intent;scheme=kal;package=<app id>;end`, trades the one-time code over
  HTTPS for a device token (`POST /api/devices/claim`) and asks Health Connect for read access.
- `ui/HealthStatusActivity` (board 15) shows what was sent and when, "Send now", the access
  Health Connect gives and "Unlink this phone". Health Connect opens it for "How Kal uses this
  data" (the rationale intent, and the Android 14 `VIEW_PERMISSION_USAGE` alias). A launcher
  shortcut "Health Connect" opens it too.
- `sync/SyncEngine` reads with Health Connect's changes token (the first sync reads 30 days, or
  a year with the history permission), sends steps and resting heart rate as day totals from the
  aggregate API, workouts with their energy, distance and heart rate, body values and sleep, in
  batches to `POST /api/health-connect/sync`. WorkManager runs it about every hour when
  background reading is allowed, and when the app opens.
- `store/TokenStore` keeps the device token encrypted with an Android Keystore key. A 401 from
  the server means the phone was unlinked: the app says "Unlinked. Link again."
- `update/UpdateCheck` compares the server's `/android/version.json` with the app's version and
  offers the download page.

The app runs on Android 7 and newer (minSdk 24): older phones get the web app only. Every Health
Connect path is behind an Android 9 check, because the Health Connect client library needs
Android 8 and Health Connect itself Android 9 (`tools:overrideLibrary` in the manifest).

## Building

The server's host name and the application id are build properties and never in git. Copy
`kal.properties.example` to `kal.properties` (git ignores it) and set `kal.host` and `kal.appId`
(the same id goes into `ANDROID_APP_ID` on the server).

The build runs in Docker; nothing needs installing but Docker:

```
node scripts/android-build.mjs --out <folder for kal.apk> --signing <private folder> \
  --cache <cache folder> --accept-sdk-licenses
```

The image holds only the JDK (Eclipse Temurin 21); the Android SDK, Gradle and its caches live in
the cache folder. The first run downloads the SDK command-line tools from Google (checked against
the published SHA-256), the SDK platform and build tools, the Gradle distribution (checked by the
wrapper) and the libraries from Google's Maven repository and Maven Central, makes the release key
in the signing folder (random passwords in `keystore.properties` next to it), runs the JVM unit
tests, builds and signs the APK, checks it with `apksigner verify` and prints the certificate's
SHA-256 for `ANDROID_CERT_SHA256`. Keep the signing folder backed up: Android installs an update
only when it is signed with the same key. deploy/README.md says where the files go on the server.

No emulator runs here (Docker on Windows has no KVM), so the app itself is tested on a phone.
