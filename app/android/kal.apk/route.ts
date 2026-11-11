// GET /android/kal.apk: the Kal Android app, for signed-in people only, as a download named
// "Kal-<version>.apk". 404 when the server has no app to hand out (lib/android/release.ts).
import type { NextRequest } from "next/server";

import { openApk, readAndroidRelease } from "@/lib/android/release";
import { apkFileName } from "@/lib/contracts/android";
import { apiUser, errorJson } from "@/lib/http/route";

export const dynamic = "force-dynamic";

export const GET = async (req: NextRequest) => {
  const { error } = await apiUser(req);
  if (error) return error;
  const release = await readAndroidRelease();
  if (!release) return errorJson(404, "The Android app is not set up on this server yet.");
  return new Response(openApk(), {
    headers: {
      "content-type": "application/vnd.android.package-archive",
      "content-length": String(release.size),
      "content-disposition": `attachment; filename="${apkFileName(release.versionName)}"`,
      "cache-control": "private, no-store",
    },
  });
};
