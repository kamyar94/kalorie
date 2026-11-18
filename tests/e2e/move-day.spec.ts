// Move by day end to end (phone, desktop, phone-dark) with axe: Today's steps tile with the
// phone's friendly name and when it last sent, opening Move for that day; the day's card, the
// hint while only the phone's own step counter sends steps, its "How to fix it" on Kal for
// Android, and closing it for good; the previous and next day, the week strip, a sideways swipe
// on phones; and "+ Activity on this day" on an earlier day.
import { expect, test, type Page } from "@playwright/test";

import { expectAccessible, installE2eHooks, localDay, pool, signUp, zone } from "./helpers";

installE2eHooks();

// A made-up suffix: every phone's step counter has its own.
const PHONE = "com.android.healthconnect.phone.5e6f7a8b";

const addSteps = (userId: string, date: string, count: number) =>
  pool().query(
    `insert into activities (user_id, category, type, title, started_at, tz, local_date, steps,
       source, source_app, external_id)
     values ($1, 'walking', 'steps', 'Steps', ($2::date + time '12:00') at time zone $3, $3, $2,
       $4, 'health_connect', $5, $6)`,
    [userId, date, zone(), count, PHONE, `steps:${date}`],
  );

/** A finger moving sideways over the day's card: touch start and end events, as a phone sends. */
const swipe = async (page: Page, dx: number) => {
  const card = (await page.getByTestId("move-day").boundingBox())!;
  const y = card.y + card.height / 2;
  const x = dx > 0 ? card.x + 20 : card.x + card.width - 20;
  await page.evaluate(
    ({ x, y, dx }) => {
      const target = document.elementFromPoint(x, y)!;
      const at = (clientX: number) => new Touch({ identifier: 1, target, clientX, clientY: y });
      const fire = (type: string, touches: Touch[], changed: Touch[]) =>
        target.dispatchEvent(
          new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches,
            changedTouches: changed,
          }),
        );
      fire("touchstart", [at(x)], [at(x)]);
      fire("touchmove", [at(x + dx)], [at(x + dx)]);
      fire("touchend", [], [at(x + dx)]);
    },
    { x, y, dx },
  );
};

test("move by day: Today's steps, the day, the hint, the pager, the week strip and + Activity on this day", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  await addSteps(userId, localDay(0), 510);
  await addSteps(userId, localDay(-1), 4150);
  await addSteps(userId, localDay(-2), 7480);
  // A run yesterday at 07:10, imported from a Samsung Health file.
  await pool().query(
    `insert into activities (user_id, category, type, title, started_at, tz, local_date,
       duration_min, distance_m, intensity, source, source_app, external_id)
     values ($1, 'cardio', 'run', 'Run', ($2::date + time '07:10') at time zone $3, $3, $2, 28,
       4100, 'vigorous', 'import', 'samsung-health', 'e2e-run')`,
    [userId, localDay(-1), zone()],
  );
  // A linked phone that sent an update a minute ago.
  const phone = await pool().query(
    `insert into devices (user_id, name, token_hash, last_sync_at)
     values ($1, 'Pixel', $2, now() - interval '1 minute') returning id`,
    [userId, `e2e-${userId}`],
  );
  await pool().query(
    `insert into health_connect_updates (device_id, user_id, tz, step_days, steps_today, empty,
       received_at) values ($1, $2, $3, 1, 510, false, now() - interval '1 minute')`,
    [phone.rows[0].id, userId, zone()],
  );

  // Today: the steps say where they came from; a tap opens Move for the day.
  await page.goto("/today");
  const tile = page.getByTestId("move-card").getByTestId("move-steps");
  await expect(tile).toHaveText(/^510Steps · Phone, updated (yesterday )?\d\d:\d\d$/);
  await tile.click();
  await expect(page).toHaveURL(/\/move$/);
  await expect(page.getByTestId("move-date")).toHaveText(/^Today, /);
  await expect(page.getByRole("img", { name: "Steps: 510 of 7,000" })).toBeVisible();
  await expect(page.getByTestId("move-day-source")).toHaveText(
    /^Steps from Health Connect: Phone \(Android's step counter\)\. Updated (yesterday )?\d\d:\d\d\.$/,
  );
  await expect(page.getByTestId("day-activities")).toContainText("510 steps · day total · Phone");
  await expect(page.getByRole("link", { name: "Next day" })).toHaveCount(0);

  // The hint: only the phone's own step counter sends steps.
  const hint = page.getByTestId("move-steps-hint");
  await expect(hint).toContainText("Only the phone's own step counter is sending steps.");
  await expect(hint).toContainText("Your watch's steps come through Samsung Health");
  await expectAccessible(page);
  await hint.getByRole("link", { name: "How to fix it" }).click();
  await expect(page).toHaveURL(/\/more\/android#how-to-fix$/);
  const fix = page.locator("details#how-to-fix");
  await expect(fix).toHaveAttribute("open", "");
  await expect(fix).toContainText("Samsung Health:");
  await expect(fix).toContainText("Open Kal's Health Connect screen and tap Send now.");
  await expectAccessible(page);
  await page.goBack();
  await hint.getByRole("button", { name: "Close this hint" }).click();
  await expect(hint).toBeHidden();
  await expect
    .poll(async () => {
      const row = await pool().query("select dismissed_hints from users where id = $1", [userId]);
      return row.rows[0].dismissed_hints;
    })
    .toEqual(["phone-steps-only"]);
  await page.reload();
  await expect(page.getByTestId("move-day")).toBeVisible();
  await expect(hint).toHaveCount(0);

  // The day before, with the arrow: its steps, the run and the step count with their points.
  await page.getByRole("link", { name: "Previous day" }).click();
  await expect(page).toHaveURL(new RegExp(`/move\\?date=${localDay(-1)}$`));
  await expect(page.getByTestId("move-date")).toHaveText(/^Yesterday, /);
  await expect(page.getByRole("img", { name: "Steps: 4,150 of 7,000" })).toBeVisible();
  const day = page.getByTestId("day-activities");
  await expect(day.getByTestId("activity")).toHaveCount(2);
  await expect(day.getByTestId("activity").first()).toContainText(
    "07:10 · 28 min · 4.1 km · imported from Samsung Health",
  );
  await expect(day.getByTestId("activity").first()).toContainText("+56 points");
  await expect(day.getByTestId("activity").nth(1)).toContainText("+20 points");
  await expect(page.getByTestId("move-day-points")).toHaveText("Points+76");
  await expect(page.getByRole("heading", { name: "That day" })).toBeVisible();

  // The week strip marks the day; another day of the strip opens it.
  const strip = page.getByTestId("move-week-strip");
  const current = strip.locator('[aria-current="date"]');
  await expect(current).toHaveAttribute("data-strip-date", localDay(-1));
  await expect(current).toHaveAccessibleName(/, 4,150 steps$/);
  await expectAccessible(page);
  const other = strip.locator("a:not([aria-current])").first();
  const otherDate = (await other.getAttribute("data-strip-date"))!;
  await other.click();
  await expect(page).toHaveURL(
    otherDate === localDay(0) ? /\/move$/ : new RegExp(`/move\\?date=${otherDate}$`),
  );
  await expect(strip.locator('[aria-current="date"]')).toHaveAttribute(
    "data-strip-date",
    otherDate,
  );

  // Two days ago: the goal reached; on phones a swipe goes to the day before and back.
  await page.goto(`/move?date=${localDay(-2)}`);
  await expect(
    page.getByRole("img", { name: "Steps: 7,480 of 7,000, goal reached" }),
  ).toBeVisible();
  if (info.project.name.startsWith("phone")) {
    await swipe(page, 200);
    await expect(page).toHaveURL(new RegExp(`/move\\?date=${localDay(-3)}$`));
    await expect(page.getByTestId("move-day-source")).toHaveText(
      /^No steps from Health Connect for this day\. A phone last sent an update /,
    );
    await swipe(page, -200);
    await expect(page).toHaveURL(new RegExp(`/move\\?date=${localDay(-2)}$`));
  } else {
    await page.getByRole("link", { name: "Previous day" }).click();
    await expect(page).toHaveURL(new RegExp(`/move\\?date=${localDay(-3)}$`));
    await page.getByRole("link", { name: "Next day" }).click();
    await expect(page).toHaveURL(new RegExp(`/move\\?date=${localDay(-2)}$`));
  }

  // + Activity on this day starts at noon of that day.
  await page.getByRole("button", { name: "Add an activity on this day" }).click();
  const sheet = page.getByRole("dialog", { name: "Add an activity" });
  await expect(sheet.getByLabel("Started at")).toHaveValue(`${localDay(-2)}T12:00`);
  await sheet.getByLabel("What did you do?").selectOption("yoga");
  await sheet.getByLabel("Minutes").fill("20");
  await expectAccessible(page);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(day).toContainText("12:00 · 20 min · typed in Kal");
  const saved = await pool().query(
    "select local_date::text as day from activities where user_id = $1 and type = 'yoga'",
    [userId],
  );
  expect(saved.rows).toEqual([{ day: localDay(-2) }]);
});
