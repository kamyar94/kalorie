// GET /android/version.json -> { versionName, versionCode, size, sha256, minSdk, targetSdk }
// The app's update check (it compares versionCode with its own). Public: it says nothing about
// anyone. 404 when the server has no app to hand out (lib/android/release.ts).
import { readAndroidRelease } from "@/lib/android/release";

export const dynamic = "force-dynamic";

export const GET = async () => {
  const release = await readAndroidRelease();
  if (!release)
    return Response.json(
      { error: "The Android app is not set up on this server yet." },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  return Response.json(release, { headers: { "cache-control": "no-cache" } });
};
