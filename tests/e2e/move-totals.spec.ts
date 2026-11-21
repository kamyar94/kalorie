// The phone's steps, active time and activity calories on Move, end to end (phone, desktop,
// phone-dark) with axe: board 39's three rings against their goals with where the numbers came
// from and when the phone last sent, Kal's workouts and points next to them; a day without them
// from an older app asking for 1.2; the note when the last update is more than two hours old, in
// a browser and inside the app (the link to the app's Health Connect screen); board 40's "Every
// day" with today highlighted, a day without data, "Earlier days" and a row that opens its day;
// and Today's card with the three numbers. Every value is made up.
import { expect, test, type Page } from "@playwright/test";

import { shiftLocalDate } from "../../lib/meals/time";
import { expectAccessible, installE2eHooks, localDay, pool, signUp, zone } from "./helpers";

installE2eHooks();

const SAMSUNG = "com.sec.android.app.shealth";
// A made-up suffix: every phone's step counter has its own.
const PHONE = "com.android.healthconnect.phone.7d8e9f0a";

const phone = async (userId: string, appVersion: string, sentMinutesAgo: number) => {
  const row = await pool().query(
    `insert into devices (user_id, name, token_hash, app_version, last_sync_at)
     values ($1, 'Galaxy', $2, $3, now() - make_interval(mins => $4)) returning id`,
    [userId, `e2e-${userId}-${appVersion}`, appVersion, sentMinutesAgo],
  );
  const id = row.rows[0].id as string;
  await pool().query(
    `insert into health_connect_updates (device_id, user_id, tz, step_days, empty, received_at)
     values ($1, $2, $3, 1, false, now() - make_interval(mins => $4))`,
    [id, userId, zone(), sentMinutesAgo],
  );
  return id;
};

const stepsOn = (userId: string, date: string, count: number, app = SAMSUNG) =>
  pool().query(
    `insert into activities (user_id, category, type, title, started_at, tz, local_date, steps,
       source, source_app, external_id)
     values ($1, 'walking', 'steps', 'Steps', ($2::date + time '12:00') at time zone $3, $3, $2,
       $4, 'health_connect', $5, $6)`,
    [userId, date, zone(), count, app, `steps:${date}`],
  );

const totalOn = (
  userId: string,
  deviceId: string,
  date: string,
  steps: number,
  minutes: number,
  kcal: number,
) =>
  pool().query(
    `insert into activity_day_totals (user_id, device_id, local_date, tz, steps, steps_app,
       active_minutes, active_method, active_app, active_kcal, kcal_app)
     values ($1, $2, $3, $4, $5, $6, $7, 'sessions+steps60', $6, $8, $6)`,
    [userId, deviceId, date, zone(), steps, SAMSUNG, minutes, kcal],
  );

const ring = (page: Page, name: string) => page.getByTestId("move-day").getByRole("img", { name });

test("the day's three rings, Every day with earlier months, and Today's card", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const deviceId = await phone(userId, "1.2 (3)", 10);
  await stepsOn(userId, localDay(0), 8412);
  await totalOn(userId, deviceId, localDay(0), 8412, 72, 486);
  // A strength session in Kal today: 30 min, typed in.
  await pool().query(
    `insert into activities (user_id, category, type, title, started_at, tz, local_date,
       duration_min, intensity, source)
     values ($1, 'strength', 'weights', 'Strength', now() - interval '1 minute', $2, $3, 30,
       'moderate', 'manual')`,
    [userId, zone(), localDay(0)],
  );
  // A month that is over, and the one before it.
  const month = shiftLocalDate(`${localDay(0).slice(0, 7)}-01`, -40).slice(0, 7);
  const before = shiftLocalDate(`${month}-01`, -1).slice(0, 7);
  await stepsOn(userId, `${month}-15`, 6905);
  await totalOn(userId, deviceId, `${month}-15`, 6905, 54, 402);
  await totalOn(userId, deviceId, `${month}-14`, 4388, 31, 248);
  await stepsOn(userId, `${month}-12`, 2365, PHONE);
  await totalOn(userId, deviceId, `${before}-20`, 4701, 35, 270);

  // Today on Move: the phone's numbers in rings against their goals.
  await page.goto("/move");
  await expect(ring(page, "Steps: 8,412 of 7,000, goal reached")).toBeVisible();
  await expect(ring(page, "Active time: 1 h 12 min of 1 h, goal reached")).toBeVisible();
  await expect(ring(page, "Activity calories: 486 of 500 kcal")).toBeVisible();
  await expect(page.getByTestId("move-ring-activeMinutes")).toContainText(
    "1 h 12minActive timegoal 1 h",
  );
  await expect(page.getByTestId("move-day-source")).toHaveText(
    /^From Health Connect: Samsung Health\. Last update from your phone (yesterday )?\d\d:\d\d; Samsung Health may already show more until the next one\.$/,
  );
  await expect(page.getByTestId("move-day-source").locator("b")).toHaveText("Samsung Health");
  await expect(page.getByTestId("move-day-workouts")).toHaveText("Workouts in Kal1 · 30 min");
  // Points from Kal's own records: 40 for the steps, 30 and 15 for the strength session.
  await expect(page.getByTestId("move-day-points")).toHaveText("Points+85");
  await expect(page.getByTestId("move-stale-note")).toHaveCount(0);
  await expect(page.getByTestId("move-day-no-totals")).toHaveCount(0);

  // Every day: this month, today first and highlighted.
  const every = page.getByTestId("every-day");
  await expect(every.getByRole("heading", { name: "Every day" })).toBeVisible();
  const todayRow = every.locator('[aria-current="date"]');
  await expect(todayRow).toHaveAccessibleName(
    /^Today, \w{3} \d{1,2}\s*:\s*8,412 steps,\s*1 h 12 min active,\s*486 kcal from activity$/,
  );
  await expectAccessible(page);

  // A day of the month that is over: its rings, and its month in Every day.
  await page.goto(`/move?date=${month}-15`);
  await expect(ring(page, "Steps: 6,905 of 7,000")).toBeVisible();
  await expect(ring(page, "Active time: 54 min of 1 h")).toBeVisible();
  await expect(ring(page, "Activity calories: 402 of 500 kcal")).toBeVisible();
  const list = every.getByTestId(`every-day-${month}`);
  const rows = list.getByRole("listitem");
  const last = Number(
    shiftLocalDate(`${shiftLocalDate(`${month}-01`, 40).slice(0, 7)}-01`, -1).slice(8),
  );
  await expect(rows).toHaveCount(last);
  await expect(rows.first()).toContainText(`${last}`);
  await expect(list.locator('[aria-current="date"]')).toHaveAccessibleName(
    /:\s*6,905 steps,\s*54 min active,\s*402 kcal from activity$/,
  );
  // The 13th has nothing; the 12th only Move's steps.
  const row = (n: number) => rows.nth(last - n);
  await expect(row(13)).toHaveText(/^\w{3} 13No data from the phone$/);
  await expect(row(13).getByRole("link")).toHaveCount(0);
  await expect(row(12).getByRole("link")).toHaveAccessibleName(
    /:\s*2,365 steps,\s*no active time,\s*no activity calories$/,
  );
  await expectAccessible(page);

  // Earlier days: the month before, with its heading.

  await every.getByRole("button", { name: "Earlier days" }).click();
  const earlier = every.getByTestId(`every-day-${before}`);
  await expect(earlier.getByRole("heading", { level: 3 })).toBeVisible();

  await expect(
    earlier.getByRole("link", { name: /:\s*4,701 steps,\s*35 min active,\s*270 kcal/ }),
  ).toBeVisible();
  await expectAccessible(page);

  // A row opens its day.
  await row(14).getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/move\\?date=${month}-14$`));
  await expect(ring(page, "Steps: 4,388 of 7,000")).toBeVisible();

  // Today's card: the three numbers.
  await page.goto("/today");
  const card = page.getByTestId("move-card");
  await expect(card.getByTestId("move-steps")).toHaveText(
    /^8,412Steps · Samsung Health, updated (yesterday )?\d\d:\d\d$/,
  );
  await expect(card.getByTestId("move-minutes")).toHaveText("1 h 12 minActive time · phone");
  await expect(card.getByTestId("move-kcal")).toHaveText("486Activity kcal · phone");
  await expect(card.getByTestId("move-points")).toHaveText("+85 points today");

  await expectAccessible(page);
});

test("a day without the phone's numbers from an older app asks for 1.2", async ({ page }, info) => {
  const userId = await signUp(page, info.project.name);
  await phone(userId, "1.1 (2)", 5);
  await stepsOn(userId, localDay(0), 5120, PHONE);

  await page.goto("/move");
  await expect(ring(page, "Steps: 5,120 of 7,000")).toBeVisible();
  await expect(ring(page, "Active time: no number from the phone")).toBeVisible();
  await expect(ring(page, "Activity calories: no number from the phone")).toBeVisible();
  await expect(page.getByTestId("move-day-source")).toHaveText(
    /^Steps from Health Connect: Phone \(Android's step counter\)\. Updated (yesterday )?\d\d:\d\d\.$/,
  );
  const note = page.getByTestId("move-day-no-totals");
  await expect(note).toHaveText(
    "Active time and activity calories come with Kal for Android 1.2. Update the app on your phone to see them here. Update Kal for Android",
  );
  await expect(page.getByTestId("every-day").locator('[aria-current="date"]')).toHaveAccessibleName(
    /^Today, \w{3} \d{1,2}\s*:\s*5,120 steps,\s*no active time,\s*no activity calories$/,
  );
  await expectAccessible(page);
  await note.getByRole("link", { name: "Update Kal for Android" }).click();
  await expect(page).toHaveURL(/\/more\/android$/);

  // Today's card falls back to Kal's own numbers.
  await page.goto("/today");
  const card = page.getByTestId("move-card");
  await expect(card.getByTestId("move-minutes")).toHaveText("0 minActive");
  await expect(card.getByTestId("move-kcal")).toHaveText("–Activity kcal");
});

test("a last update more than two hours old: the note in a browser", async ({ page }, info) => {
  const userId = await signUp(page, info.project.name);
  const deviceId = await phone(userId, "1.2 (3)", 185);
  await totalOn(userId, deviceId, localDay(0), 3120, 18, 140);

  await page.goto("/move");
  const note = page.getByTestId("move-stale-note");
  await expect(note).toHaveText(
    /^Not today's latest yet\. The phone last sent (at \d\d:\d\d|yesterday \d\d:\d\d)\. Open Kal on the phone and tap Send now, or allow background updates so it sends every hour\. How to set it up$/,
  );
  await expect(note.getByRole("link", { name: "How to set it up" })).toHaveAttribute(
    "href",
    "/more/android",
  );
  await expectAccessible(page);
});

test("a last update more than two hours old: inside the app, the link opens its Health Connect screen", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const deviceId = await phone(userId, "1.2 (3)", 185);
  await totalOn(userId, deviceId, localDay(0), 3120, 18, 140);

  // The tab's marker, as the app's start address leaves it.
  await page.addInitScript(() => sessionStorage.setItem("kal.android-app", "android.1.3"));
  await page.goto("/move");
  const note = page.getByTestId("move-stale-note");
  const link = note.getByRole("link", { name: "Open Kal's Health Connect screen" });
  await expect(link).toHaveAttribute(
    "href",
    /^intent:\/\/status#Intent;scheme=kal;package=app\.kal;S\.browser_fallback_url=.+%2Fmore%2Fandroid;end$/,
  );
  await expect(note).toContainText(
    "Tap Send now on Kal's Health Connect screen, or allow background updates so it sends every hour.",
  );
  await expectAccessible(page);
});
