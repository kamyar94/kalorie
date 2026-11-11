// The Android app as the server hands it out: Digital Asset Links from the environment, the
// public version check, the APK download for signed-in people only, the "not set up" answers,
// and the proxy letting the public files through without a session.
import crypto from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { parseAppId, parseFingerprints } from "@/lib/android/config";
import type { SessionUser } from "@/lib/auth/accounts";
import { androidVersionName, formatBytes } from "@/lib/contracts/android";
import { proxy } from "@/proxy";
import { createUser } from "@/tests/helpers/factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => session.user }));

const assetRoute = await import("@/app/.well-known/assetlinks.json/route");
const versionRoute = await import("@/app/android/version.json/route");
const apkRoute = await import("@/app/android/kal.apk/route");

const ORIGIN = "http://127.0.0.1:3201";
const FINGERPRINT = "AB:".repeat(31) + "CD";
const APK_BYTES = crypto.randomBytes(4096);

let dir: string;
let person: SessionUser;

const get = (url: string, cookie?: string) =>
  new NextRequest(`${ORIGIN}${url}`, {
    headers: { "x-forwarded-host": "127.0.0.1:3201", ...(cookie ? { cookie } : {}) },
  });

const writeRelease = async (extra: Record<string, unknown> = {}) => {
  await writeFile(path.join(dir, "kal.apk"), APK_BYTES);
  await writeFile(
    path.join(dir, "version.json"),
    JSON.stringify({
      versionName: "1.0",
      versionCode: 1,
      size: APK_BYTES.length,
      sha256: crypto.createHash("sha256").update(APK_BYTES).digest("hex"),
      minSdk: 24,
      targetSdk: 36,
      ...extra,
    }),
  );
};

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "kal-android-"));
  const row = await createUser();
  person = {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    timeZone: row.timeZone,
    units: row.units,
  };
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  session.user = person;
  delete process.env.ANDROID_APP_ID;
  delete process.env.ANDROID_CERT_SHA256;
  process.env.ANDROID_APK_DIR = dir;
  await rm(path.join(dir, "kal.apk"), { force: true });
  await rm(path.join(dir, "version.json"), { force: true });
});

describe("Digital Asset Links", () => {
  it("answers 404 until the app id and a fingerprint are set", async () => {
    expect((await assetRoute.GET()).status).toBe(404);
    process.env.ANDROID_APP_ID = "app.kal";
    expect((await assetRoute.GET()).status).toBe(404);
    process.env.ANDROID_CERT_SHA256 = "not a fingerprint";
    expect((await assetRoute.GET()).status).toBe(404);
  });

  it("names the app and every fingerprint, as JSON", async () => {
    process.env.ANDROID_APP_ID = "app.kal";
    const second = "0123456789abcdef".repeat(4);
    process.env.ANDROID_CERT_SHA256 = `${FINGERPRINT}, ${second},${FINGERPRINT}`;
    const response = await assetRoute.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "app.kal",
          sha256_cert_fingerprints: [FINGERPRINT, second.toUpperCase().match(/../g)!.join(":")],
        },
      },
    ]);
  });

  it("checks the app id and the fingerprints", () => {
    expect(parseAppId(" app.kal ")).toBe("app.kal");
    expect(parseAppId("kal")).toBeNull();
    expect(parseAppId("app.kal;end")).toBeNull();
    expect(parseAppId("1app.kal")).toBeNull();
    expect(parseFingerprints("ab".repeat(32))).toEqual(["AB:".repeat(31) + "AB"]);
    expect(parseFingerprints("AB:CD, 12")).toEqual([]);
  });
});

describe("the app's version and the download", () => {
  it("says the app is not set up while the folder is empty or unset", async () => {
    expect((await versionRoute.GET()).status).toBe(404);
    const apk = await apkRoute.GET(get("/android/kal.apk"));
    expect(apk.status).toBe(404);
    expect(await apk.json()).toEqual({
      error: "The Android app is not set up on this server yet.",
    });
    await writeRelease();
    delete process.env.ANDROID_APK_DIR;
    expect((await versionRoute.GET()).status).toBe(404);
  });

  it("answers the version check without a session", async () => {
    await writeRelease({ size: 1 });
    session.user = null;
    const response = await versionRoute.GET();
    expect(response.status).toBe(200);
    // The size is the file's own, whatever version.json says.
    expect(await response.json()).toEqual({
      versionName: "1.0",
      versionCode: 1,
      size: APK_BYTES.length,
      sha256: crypto.createHash("sha256").update(APK_BYTES).digest("hex"),
      minSdk: 24,
      targetSdk: 36,
    });
  });

  it("ignores a version.json it cannot use", async () => {
    await writeRelease({ versionCode: "two" });
    expect((await versionRoute.GET()).status).toBe(404);
    await writeRelease({ versionName: "1.0; rm" });
    expect((await versionRoute.GET()).status).toBe(404);
    await writeRelease({ sha256: "abc" });
    expect((await versionRoute.GET()).status).toBe(404);
    await writeFile(path.join(dir, "version.json"), "{not json");
    expect((await versionRoute.GET()).status).toBe(404);
  });

  it("streams the APK to signed-in people as a named download", async () => {
    await writeRelease({ versionName: "1.2.0" });
    session.user = null;
    expect((await apkRoute.GET(get("/android/kal.apk"))).status).toBe(401);
    session.user = person;
    const response = await apkRoute.GET(get("/android/kal.apk"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.android.package-archive");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Kal-1.2.0.apk"',
    );
    expect(response.headers.get("content-length")).toBe(String(APK_BYTES.length));
    expect(Buffer.from(await response.arrayBuffer()).equals(APK_BYTES)).toBe(true);
  });

  it("words the Android version and the size", () => {
    expect(androidVersionName(24)).toBe("7");
    expect(androidVersionName(26)).toBe("8");
    expect(androidVersionName(28)).toBe("9");
    expect(androidVersionName(30)).toBe("11");
    expect(androidVersionName(32)).toBe("12");
    expect(androidVersionName(34)).toBe("14");
    expect(androidVersionName(36)).toBe("16");
    expect(formatBytes(4_400_000)).toBe("4.2 MB");
    expect(formatBytes(880_000)).toBe("859 KB");
  });
});

describe("the proxy", () => {
  it("lets the Asset Links file and the version check through without a session", () => {
    for (const url of ["/.well-known/assetlinks.json", "/android/version.json"]) {
      const response = proxy(get(url));
      expect(response.headers.get("location"), url).toBeNull();
      expect(response.status, url).toBe(200);
    }
    const apk = proxy(get("/android/kal.apk"));
    expect(apk.status).toBe(307);
    expect(apk.headers.get("location")).toBe(`${ORIGIN}/sign-in`);
    expect(proxy(get("/android/kal.apk", "cal_session=x")).headers.get("location")).toBeNull();
  });
});
