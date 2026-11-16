// "Kal for Android" end to end (phone, desktop, phone-dark): the page in a browser while the
// server has no app ("not set up") and once it has one (version, size, the download), inside the
// app (the start URL's marker, "Connect Health Connect" making a one-time code and the intent URL,
// a newer version, an older Android without Health Connect, a second tab staying a browser tab),
// a linked phone's updates (the "Nothing has arrived yet" warning with "How to fix it" while
// nothing is stored, Recent updates, the warning gone once records arrived) and unlinking a
// phone. The server runs with the placeholder app id app.kal.
import crypto from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { localParts } from "../../lib/meals/time";

import { expectAccessible, installE2eHooks, pool, signUp } from "./helpers";

const allowed = installE2eHooks();

const APK_DIR = path.resolve("test-results", "e2e-android");
const APK = crypto.randomBytes(300 * 1024);

const putRelease = async (versionCode = 1, versionName = "1.0") => {
  await mkdir(APK_DIR, { recursive: true });
  await writeFile(path.join(APK_DIR, "kal.apk"), APK);
  await writeFile(
    path.join(APK_DIR, "version.json"),
    JSON.stringify({
      versionName,
      versionCode,
      size: APK.length,
      sha256: crypto.createHash("sha256").update(APK).digest("hex"),
      minSdk: 24,
      targetSdk: 36,
    }),
  );
};

const removeRelease = async () => {
  await rm(path.join(APK_DIR, "kal.apk"), { force: true });
  await rm(path.join(APK_DIR, "version.json"), { force: true });
};

test.beforeEach(removeRelease);
test.afterAll(removeRelease);

const openAndroidPage = async (page: Page) => {
  await page.goto("/more");
  await page
    .getByTestId("more-list")
    .getByRole("link", { name: /^Kal for Android/ })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Kal for Android" })).toBeVisible();
};

test("Kal for Android in a browser: not set up, then the version and the download", async ({
  page,
}, info) => {
  await signUp(page, info.project.name);
  await openAndroidPage(page);
  await expect(page.getByTestId("android-release")).toHaveText(
    "The Android app is not set up on this server yet.",
  );
  await expect(page.getByRole("link", { name: "Download the app" })).toHaveCount(0);
  await expect(page.getByText("No phone is linked yet.")).toBeVisible();
  const phoneBrowser = info.project.name !== "desktop";
  if (phoneBrowser) {
    await expect(page.getByRole("link", { name: "Open in the Kal app" })).toHaveAttribute(
      "href",
      /^intent:\/\/127\.0\.0\.1:\d+\/more\/android#Intent;scheme=https;package=app\.kal;S\.browser_fallback_url=http%3A%2F%2F127\.0\.0\.1%3A\d+%2Fmore%2Fandroid;end$/,
    );
  } else {
    await expect(page.getByTestId("android-connect-note")).toContainText(
      "open this page in the Kal app on your Android phone",
    );
  }
  await expect(page.getByRole("button", { name: "Connect Health Connect" })).toHaveCount(0);
  await expectAccessible(page);

  await putRelease();
  await page.reload();
  await expect(page.getByTestId("android-release")).toHaveText(
    "Version 1.0 · 300 KB · Android 7 or newer",
  );
  await expect(page.getByRole("heading", { name: "Installing it" })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download the app" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("Kal-1.0.apk");
  const saved = await download.path();
  expect(saved).toBeTruthy();
  await expectAccessible(page);

  // The update check is public; the APK is not.
  const version = await page.request.get("/android/version.json");
  expect(await version.json()).toMatchObject({ versionName: "1.0", versionCode: 1, minSdk: 24 });
  const links = await page.request.get("/.well-known/assetlinks.json");
  expect(links.headers()["content-type"]).toBe("application/json");
  expect(await links.json()).toEqual([
    expect.objectContaining({
      target: expect.objectContaining({ package_name: "app.kal" }),
    }),
  ]);
});

test("inside the app: Connect Health Connect, a newer version, an older Android", async ({
  page,
  context,
}, info) => {
  // The browser has no app for intent:// addresses; it says so on the console.
  allowed.current = /intent:|scheme does not have a registered handler|ERR_UNKNOWN_URL_SCHEME/i;
  await putRelease(2, "1.1");
  await signUp(page, info.project.name);

  // The app's start URL: the marker survives the redirect to Today, then the cookie goes.
  await page.goto("/?source=android-app&hc=1&appVersion=1");
  await expect(page).toHaveURL(/\/today$/);
  await expect
    .poll(async () => (await context.cookies()).some((c) => c.name === "kal_app"))
    .toBe(false);

  await openAndroidPage(page);
  await expect(page.getByText("A newer version of the app is ready.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download the app" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Installing it" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open in the Kal app" })).toHaveCount(0);
  const connect = page.getByRole("button", { name: "Connect Health Connect" });
  await expect(connect).toBeVisible();
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/devices/link-codes") && r.request().method() === "POST",
  );
  await connect.click();
  expect((await created).status()).toBe(201);
  const fallback = page.getByRole("link", { name: "Open Kal's Health Connect screen" });
  await expect(fallback).toHaveAttribute(
    "href",
    /^intent:\/\/link\?code=[A-Za-z0-9_-]{32}#Intent;scheme=kal;package=app\.kal;end$/,
  );
  await expectAccessible(page);

  // Another tab of the same browser is not the app.
  const tab = await context.newPage();
  await tab.goto("/more/android");
  await expect(tab.getByRole("heading", { level: 1, name: "Kal for Android" })).toBeVisible();
  await expect(tab.getByRole("button", { name: "Connect Health Connect" })).toHaveCount(0);
  await expect(tab.getByRole("heading", { name: "Installing it" })).toBeVisible();
  await tab.close();

  // An Android older than 9: no Health Connect, and this version is the newest.
  await page.goto("/?source=android-app&hc=0&appVersion=2");
  await expect(page).toHaveURL(/\/today$/);
  await page.goto("/more/android");
  await expect(page.getByTestId("android-connect-note")).toContainText(
    "Health Connect needs Android 9 or newer.",
  );
  await expect(page.getByText("You have this version, the newest there is.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Download the app" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect Health Connect" })).toHaveCount(0);
  await expectAccessible(page);
});

test("unlinking a phone", async ({ page }, info) => {
  const userId = await signUp(page, info.project.name);
  const db = pool();
  const device = await db.query(
    `insert into devices (user_id, name, token_hash, sends, last_sync_at)
     values ($1, 'Samsung SM-S928B', $2, '{steps,workouts,heart_rate}', now()) returning id`,
    [userId, crypto.randomBytes(32).toString("hex")],
  );
  for (const day of [1, 2])
    await db.query(
      `insert into heart_rates (user_id, kind, local_date, tz, started_at, bpm, external_id)
       values ($1, 'resting', current_date - $2::int, 'UTC', now(), 58, 'resting:' || $2)`,
      [userId, day],
    );
  await db.query(
    `insert into sleep_sessions (user_id, started_at, ended_at, tz, local_date, duration_min, external_id)
     values ($1, now() - interval '8 hours', now(), 'UTC', current_date, 480, 'night-1')`,
    [userId],
  );

  await openAndroidPage(page);
  const phones = page.getByTestId("android-phone");
  await expect(phones).toHaveCount(1);
  await expect(page.getByText("1 linked")).toBeVisible();
  await expect(phones.first()).toContainText("Samsung SM-S928B");
  await expect(page.getByTestId("android-phone-line")).toHaveText(/^Linked today \d{2}:\d{2}$/);
  // Records are stored, so no warning; the phone sent before the update log existed.
  await expect(page.getByTestId("android-nothing-arrived")).toHaveCount(0);
  await expect(page.getByTestId("android-updates-none")).toHaveText(
    /^Last sent Today \d{2}:\d{2}\. From the next update on, each one is listed here\.$/,
  );
  await expect(page.getByTestId("android-kept")).toHaveText(
    "Kept so far: 2 days of resting heart rate, 1 night of sleep.",
  );
  await page.getByRole("button", { name: "Unlink Samsung SM-S928B" }).click();
  await expect(page.getByText("The phone stops sending until you link it again.")).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(phones).toHaveCount(1);
  await page.getByRole("button", { name: "Unlink Samsung SM-S928B" }).click();
  await page.getByRole("button", { name: "Unlink this phone" }).click();
  await expect(page.getByText("Samsung SM-S928B unlinked")).toBeVisible();
  await expect(page.getByText("No phone is linked yet.")).toBeVisible();
  const row = await db.query("select revoked_at from devices where id = $1", [device.rows[0].id]);
  expect(row.rows[0].revoked_at).not.toBeNull();
  await page.reload();
  await expect(page.getByText("No phone is linked yet.")).toBeVisible();
});

test("a linked phone's updates: nothing has arrived, then records arrived", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  // A phone linked with a device token, sending through the real sync route.
  const token = `kal_${crypto.randomBytes(32).toString("base64url")}`;
  await pool().query(
    `insert into devices (user_id, name, token_hash, app_version) values ($1, 'Pixel 7', $2, '1.0 (1)')`,
    [userId, crypto.createHash("sha256").update(token).digest("hex")],
  );
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localParts(new Date(), tz).date;
  const sync = async (batch: Record<string, unknown>) => {
    const response = await page.request.post("/api/health-connect/sync", {
      headers: { authorization: `Bearer ${token}` },
      data: { tz, appVersion: "1.1 (2)", ...batch },
    });
    expect(response.status()).toBe(200);
  };

  await openAndroidPage(page);
  await expect(page.getByTestId("android-phone-line")).toHaveText(
    /^Linked today \d{2}:\d{2} · app 1\.0$/,
  );
  await expect(page.getByTestId("android-updates-none")).toHaveText("Nothing sent yet.");
  await expect(page.getByTestId("android-nothing-arrived")).toHaveCount(0);

  // App 1.1's first read of an empty Health Connect, then a later read with zero days.
  await sync({ firstReadDays: 30 });
  await sync({
    steps: [{ date: today, count: 0 }],
    restingHeartRate: [{ date: today, bpm: null }],
  });
  await page.reload();
  await expect(page.getByTestId("android-phone-line")).toHaveText(
    /^Linked today \d{2}:\d{2} · app 1\.1$/,
  );
  const warning = page.getByTestId("android-nothing-arrived");
  await expect(warning.getByRole("heading", { name: "Nothing has arrived yet" })).toBeVisible();
  await expect(warning).toContainText(
    "The phone sent 2 updates, but Health Connect had no steps, workouts, heart rate, sleep or weigh-ins to share.",
  );
  // "How to fix it" is open from the start.
  await expect(warning.locator("details")).toHaveAttribute("open", "");
  await expect(warning.getByRole("listitem")).toHaveCount(5);
  await expect(warning.getByRole("listitem").first()).toContainText(
    "Samsung Health: ⋮, Settings, Data management, Health Connect.",
  );
  await expect(warning.getByRole("listitem").last()).toHaveText(
    "Open Kal's Health Connect screen and tap Send now.",
  );
  const updates = page.getByTestId("android-update");
  await expect(updates).toHaveCount(2);
  await expect(updates.nth(0)).toHaveText(/^Today \d{2}:\d{2}Nothing new$/);
  await expect(updates.nth(1)).toHaveText(
    /^Today \d{2}:\d{2}First read, 30 days: Health Connect was empty$/,
  );
  await expect(
    page.getByText("Kept for 30 days. The warning above disappears once records arrive."),
  ).toBeVisible();
  await expectAccessible(page);

  // Folding "How to fix it" keeps the warning.
  await warning.getByText("How to fix it").click();
  await expect(warning.getByRole("listitem").first()).toBeHidden();

  // Samsung Health shares now: steps, a workout and a weigh-in arrive.
  const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  await sync({
    steps: [{ date: today, count: 6812, sourceApp: "com.sec.android.app.shealth" }],
    workouts: [
      {
        id: crypto.randomUUID(),
        category: "cardio",
        type: "run",
        title: "Run",
        start: at(0.75),
        end: at(0.25),
        sourceApp: "com.sec.android.app.shealth",
      },
    ],
    body: [{ id: crypto.randomUUID(), code: "weight", value: 71.3, at: at(0.5) }],
  });
  await page.reload();
  await expect(page.getByTestId("android-nothing-arrived")).toHaveCount(0);
  await expect(updates).toHaveCount(3);
  await expect(updates.nth(0)).toHaveText(
    /^Today \d{2}:\d{2}👟 6,812 steps today · 🏋️ 1 workout · ⚖️ 1 weigh-in$/,
  );
  await expect(page.getByText("Kept for 30 days.", { exact: true })).toBeVisible();
  await expectAccessible(page);
});
