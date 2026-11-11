// The Android app this server hands out: kal.apk and its version.json in ANDROID_APK_DIR (a
// folder mounted read-only; scripts/android-build.mjs writes both files). Nothing is in git.
//
// version.json: { versionName, versionCode, size, sha256, minSdk } (targetSdk too when known).
// The page "Kal for Android" shows the version and size, GET /android/version.json answers the
// app's update check, GET /android/kal.apk streams the file to signed-in people.
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import type { AndroidRelease } from "@/lib/contracts/android";

import { androidConfig, type AndroidConfig } from "./config";

const APK = "kal.apk";
const VERSION = "version.json";

const int = (value: unknown, min: number, max: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;

/** The release described by version.json, when kal.apk is there too; null otherwise. */
export const readAndroidRelease = async (
  config: AndroidConfig = androidConfig(),
): Promise<AndroidRelease | null> => {
  if (!config.apkDir) return null;
  try {
    const [raw, file] = await Promise.all([
      readFile(path.join(config.apkDir, VERSION), "utf8"),
      stat(path.join(config.apkDir, APK)),
    ]);
    if (!file.isFile() || file.size === 0) return null;
    const data = JSON.parse(raw) as Record<string, unknown>;
    const versionName = typeof data.versionName === "string" ? data.versionName.trim() : "";
    const versionCode = int(data.versionCode, 1, 2_100_000_000);
    const minSdk = int(data.minSdk, 1, 100);
    const sha256 = typeof data.sha256 === "string" ? data.sha256.toLowerCase() : "";
    if (!/^[0-9A-Za-z.+_-]{1,32}$/.test(versionName) || !versionCode || !minSdk) return null;
    if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
    return {
      versionName,
      versionCode,
      // The file itself says how big it is; version.json may be older than a copied file.
      size: file.size,
      sha256,
      minSdk,
      targetSdk: int(data.targetSdk, 1, 100),
    };
  } catch {
    return null;
  }
};

/** The APK as a stream for a download response. */
export const openApk = (config: AndroidConfig = androidConfig()) =>
  Readable.toWeb(
    createReadStream(path.join(config.apkDir ?? ".", APK)),
  ) as unknown as ReadableStream<Uint8Array>;
