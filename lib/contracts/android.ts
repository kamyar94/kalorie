// CONTRACT: the Kal Android app as the web pages describe it. Plain data, safe for client
// components. The server reads the release from ANDROID_APK_DIR (lib/android/release.ts).

export type AndroidRelease = {
  versionName: string;
  versionCode: number;
  /** Bytes. */
  size: number;
  /** Of the APK file, lower-case hex. */
  sha256: string;
  minSdk: number;
  targetSdk: number | null;
};

/** Health Connect runs on Android 9 (API level 28) and newer. */
export const HEALTH_CONNECT_MIN_SDK = 28;

/** The Android version a person knows for an API level: 24 -> "7", 28 -> "9", 34 -> "14". */
export const androidVersionName = (sdk: number) => {
  if (sdk >= 33) return String(sdk - 20);
  if (sdk >= 31) return "12";
  if (sdk >= 29) return String(sdk - 19);
  if (sdk === 28) return "9";
  if (sdk >= 26) return "8";
  if (sdk >= 24) return "7";
  if (sdk === 23) return "6";
  return "5";
};

/** "4.2 MB", "860 KB". */
export const formatBytes = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(Math.round((bytes / (1024 * 1024)) * 10) / 10).toLocaleString("en-US")} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** The file name the download gets ("Kal-1.0.apk"). */
export const apkFileName = (versionName: string) => `Kal-${versionName}.apk`;

// ---- Inside the app ----
//
// The app opens Kal at /?source=android-app&hc=1|0&appVersion=<versionCode>. The proxy keeps that
// in a short cookie across the first redirects (sign-in, Today); the page copies it into the tab's
// sessionStorage and removes the cookie (lib/client/android-app.ts), so a browser tab of the same
// Chrome, which shares cookies with the app, never takes itself for the app.

export const APP_COOKIE = "kal_app";
/** Seconds the cookie lives: long enough for the redirects of the first load. */
export const APP_COOKIE_SECONDS = 300;

export type AppContext = {
  inApp: boolean;
  /** The phone can run Health Connect (Android 9 or newer). */
  healthConnect: boolean;
  /** The app's versionCode, when it said. */
  appVersion: number | null;
};

export const NOT_IN_APP: AppContext = { inApp: false, healthConnect: false, appVersion: null };

/** The cookie value for the app's start URL parameters ("android.1.3"), or null. */
export const appMarkerFromParams = (params: URLSearchParams) => {
  if (params.get("source") !== "android-app") return null;
  const version = /^\d{1,9}$/.test(params.get("appVersion") ?? "") ? params.get("appVersion") : "0";
  return `android.${params.get("hc") === "0" ? "0" : "1"}.${version}`;
};

/** "android.1.3" -> in the app, Health Connect possible, version 3. Null for anything else. */
export const parseAppMarker = (value: string | null | undefined): AppContext | null => {
  const m = /^android\.([01])\.(\d{1,9})$/.exec(value ?? "");
  return m ? { inApp: true, healthConnect: m[1] === "1", appVersion: Number(m[2]) || null } : null;
};
