# Kal for Android

One Android app named Kal. It opens the Kal site full screen as a Trusted Web Activity (TWA), so
every web feature works and updates with the server, and adds a small native part that reads
Health Connect (steps, workouts, heart rate, sleep, weight and body composition, BMR and height)
and sends the records to the person's own Kal server.

- `KalLauncherActivity` opens the site at `/?source=android-app&hc=1|0&appVersion=N`
  (androidbrowserhelper; a Custom Tab where no browser can host a TWA). The site keeps that
  marker for the tab and shows "Connect Health Connect" only inside the app.
- `DelegationService` (androidbrowserhelper) shows Kal's web push messages as the app's
  notifications; Android 13's notification permission is asked through the web page's flow.
- `ui/LinkActivity` opens from the web page's intent URL
  `intent://link?code=...#Intent;scheme=kal;package=<app id>;end`, trades the one-time code
  (valid 10 minutes) over HTTPS for a device token (`POST /api/devices/claim`) and asks Health
  Connect for read access.
- `ui/HealthStatusActivity` shows what was sent and when, today's steps, active time and
  activity calories as last sent, "Send now", the access Health Connect gives and "Unlink this
  phone". Health Connect opens it for "How Kal uses this data" (the rationale intent, and the
  Android 14 `VIEW_PERMISSION_USAGE` alias). A launcher shortcut "Health Connect" opens it too,
  and so does Move's "Open Kal's Health Connect screen" (`kal://status`, app 1.2).
- The same screen counts what Health Connect holds for the last 30 days (`hc/InventoryReader`,
  `hc/Inventory`): days with steps above 0, workouts, days with resting heart rate, nights of
  sleep and weigh-ins, each with the apps that wrote them (named by their launcher labels). The
  list stays on the phone. When every kind Kal may read is empty it shows "Health Connect has
  nothing to share yet": Samsung Health and Renpho Health (installed or not, not sharing), "Open
  Samsung Health" (only when installed), "Open Health Connect permissions" (Health Connect's
  settings, by the action for the Android version) and the steps. The manifest's `<queries>`
  name Samsung Health and Renpho's known packages and launchable apps (`hc/HealthApps`; Renpho's
  package differs by region, so an app labelled "Renpho" counts too).
- `sync/SyncEngine` reads with Health Connect's changes token (the first sync reads 30 days, or
  a year with the history permission), sends steps and resting heart rate as day totals from the
  aggregate API, workouts with their energy, distance and heart rate, body values (weight, body
  fat, lean, bone and water mass, BMR, height) and sleep, in batches to
  `POST /api/health-connect/sync` (at most 2 MB each; the server takes 120 batches an hour per
  phone). Every sync sends at least one batch, and a read of the whole window carries
  `firstReadDays`, so the server's update log (shown on Kal for Android) has a line for each
  sync, also when Health Connect had nothing. WorkManager runs it about every hour when
  background reading is allowed, and when the app opens. On the server, workouts become Move
  activities, body values Body measurements (height fills an empty profile height), and heart
  rate and sleep are kept for later charts; a record sent again updates the one before, and a
  deletion in Health Connect removes it.
- From app 1.2 every day it reads (each day of a first read; later the days a change touched,
  today and yesterday) also goes as a day total (`dayTotals`, `sync/DayNumbers`): steps from
  the aggregate, activity calories from `ActiveCaloriesBurnedRecord`'s aggregate, and active
  time, which Health Connect does not keep: the minutes of the day covered by exercise sessions,
  joined with the minutes of step records walked at 60 steps a minute or more (a record's steps
  spread evenly over its time), each minute once, cut at the phone's local midnights (method
  `sessions+steps60`). Each number names the app that wrote most of it. The first sync after
  updating to 1.2 reads the whole window again, so earlier days get their totals too. Move shows
  them as the phone's numbers next to Kal's own workouts.
- `store/TokenStore` keeps the device token encrypted with an Android Keystore key. A 401 from
  the server means the phone was unlinked: the app says "Unlinked. Link again."
- `update/UpdateCheck` compares the server's `/android/version.json` with the app's version and
  offers the download page.

The app runs on Android 7 and newer (minSdk 24, target and compile SDK 37): older phones get the
web app only. Every Health Connect path is behind an Android 9 check, because the Health Connect
client library needs Android 8 and Health Connect itself Android 9 (`tools:overrideLibrary` in
the manifest).

On the server, More, then Kal for Android shows the version and size, downloads the APK
(`/android/kal.apk`, signed in), and lists the linked phones with Unlink, their recent updates
and a warning while nothing has arrived.
`/android/version.json` (the update check) and `/.well-known/assetlinks.json` (from
`ANDROID_APP_ID` and `ANDROID_CERT_SHA256`) are public.

## Building

The server's host name and the application id are build properties and never in git. Copy
`kal.properties.example` to `kal.properties` (git ignores it) and set `kal.host` and `kal.appId`
(the same id goes into `ANDROID_APP_ID` on the server), and `kal.versionName` and
`kal.versionCode` (raise the code for every build you hand out; without them the build uses the
release in `app/build.gradle.kts`, now 1.2 and 3). `KAL_HOST`, `KAL_APP_ID`,
`KAL_VERSION_NAME` and `KAL_VERSION_CODE` in the environment win over the file, and
`--properties <file>` reads another file.

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
