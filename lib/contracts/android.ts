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
