// Changing what was logged, end to end (phone, desktop, phone-dark): a logged medicine's time and
// amount from Today's card, from the toast after "Log now" (Change time) and from the Medicines
// page history, removing it with Undo, and the time control of the camera's Medicine mode; the
// Water card's entries, the water sheet (amount, time, Remove and Undo, "+ Other amount", another
// day), drinks inside meals opening their meal, a water card of the timeline opening the sheet,
// and "Show all".
import { expect, test, type Page } from "@playwright/test";

import { expectAccessible, installE2eHooks, localDay, pool, signUp, zone } from "./helpers";

installE2eHooks();

const addMedicine = async (userId: string, name: string, form: string, unit: string) => {
  const { rows } = await pool().query(
    `insert into medicines (user_id, name, form, usual_amount, unit)
     values ($1, $2, $3, 1, $4) returning id`,
    [userId, name, form, unit],
  );
  return rows[0].id as string;
};

const logsOf = async (userId: string) =>
  (
    await pool().query(
      `select name, amount, local_date::text as day,
         to_char(taken_at at time zone tz, 'HH24:MI') as time
       from medicine_logs where user_id = $1 order by taken_at`,
      [userId],
    )
  ).rows as { name: string; amount: number; day: string; time: string }[];

/** Picks a day and a clock time in the When sheet and closes it. */
const pickWhen = async (page: Page, title: string, day: string, time: string) => {
  const when = page.getByRole("dialog", { name: title });
  await expect(when).toBeVisible();
  await when.getByLabel("Date").fill(day);
  await when.getByLabel("Time").fill(time);
  await when.getByRole("button", { name: "Done" }).click();
  await expect(when).toBeHidden();
};

test("a logged medicine: Change time after Log now, the amount and Remove on Today, another day from the Medicines page", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  await addMedicine(userId, "Omega-3", "capsule", "capsule");
  await page.reload();
  const card = page.getByRole("region", { name: "Medicines" });

  // Log now, then Change time in the toast: the sheet of board 28 for that log.
  await card.getByRole("button", { name: "Log now: Omega-3" }).click();
  const toast = page.getByRole("status").filter({ hasText: "Omega-3 logged" });
  await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible();
  await expect(card.getByTestId("medicine-taken")).toHaveCount(1);
  await expectAccessible(page);
  await toast.getByRole("button", { name: "Change time" }).click();
  const sheet = page.getByRole("dialog", { name: "Omega-3" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Logged medicine");
  await expect(sheet).toContainText("Capsule");
  const taken = sheet.getByRole("button", { name: /^Taken: today at \d\d:\d\d\. Change the day/ });
  await expect(taken).toBeVisible();
  await expect(sheet.getByRole("spinbutton", { name: "How many" })).toHaveAttribute(
    "aria-valuetext",
    "1 capsule",
  );
  await expectAccessible(page);

  // The When sheet: today at 00:00 (always in the past).
  await taken.click();
  await pickWhen(page, "When did you take it?", localDay(), "00:00");
  await expect(
    sheet.getByRole("button", { name: "Taken: today at 00:00. Change the day and time" }),
  ).toBeFocused();
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Omega-3 changed" })).toContainText(
    "1 capsule, taken today at 00:00",
  );
  const row = card.getByTestId("medicine-taken");
  await expect(row).toContainText("Omega-3 · 1 capsule");
  await expect(row).toContainText("Taken 00:00");
  expect(await logsOf(userId)).toEqual([
    { name: "Omega-3", amount: 1, day: localDay(), time: "00:00" },
  ]);

  // The row opens the sheet: two capsules (the stepper goes in halves, as when logging).
  await row.click();
  await expect(sheet).toBeVisible();
  const more = sheet.getByRole("button", { name: "More (How many)" });
  await more.click();
  await expect(sheet.getByRole("spinbutton", { name: "How many" })).toHaveAttribute(
    "aria-valuetext",
    "1.5 capsules",
  );
  await more.click();
  await expect(sheet.getByRole("spinbutton", { name: "How many" })).toHaveAttribute(
    "aria-valuetext",
    "2 capsules",
  );
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(sheet).toBeHidden();
  await expect(row).toContainText("Omega-3 · 2 capsules");
  await expect(row).toBeFocused();

  // Remove this log, then Undo.
  await row.click();
  await sheet.getByRole("button", { name: "Remove this log" }).click();
  await expect(sheet).toBeHidden();
  await expect(card.getByTestId("medicine-taken")).toHaveCount(0);
  await expect(card.getByTestId("medicine-due")).toContainText("Omega-3");
  await page
    .getByRole("status")
    .filter({ hasText: "Omega-3 at 00:00 removed" })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(card.getByTestId("medicine-taken")).toContainText("Omega-3 · 2 capsules");
  await expect(card.getByTestId("medicine-taken")).toContainText("Taken 00:00");

  // The Medicines page: the log in the history moves to yesterday.
  await page.goto("/medicines");
  const history = page.getByTestId("medicine-history");
  await history.getByRole("button", { name: /Omega-3 · 2 capsules/ }).click();
  await expect(sheet).toBeVisible();
  await expectAccessible(page);
  await sheet.getByRole("button", { name: /^Taken: / }).click();
  const when = page.getByRole("dialog", { name: "When did you take it?" });
  await when.getByRole("button", { name: "Yesterday" }).click();
  await when.getByRole("button", { name: "Done" }).click();
  await expect(sheet.getByRole("button", { name: /^Taken: yesterday at / })).toBeVisible();
  await sheet.getByRole("button", { name: "Save changes" }).click();
  await expect(sheet).toBeHidden();
  await expect(
    page.getByRole("region", { name: "Yesterday" }).getByTestId("medicine-history-log"),
  ).toContainText("Omega-3 · 2 capsules");
  await expect(page.getByRole("region", { name: "Today" })).toHaveCount(0);
  expect((await logsOf(userId)).map((l) => l.day)).toEqual([localDay(-1)]);
  await expectAccessible(page);

  // Log now on the Medicines page offers Change time too.
  await page.getByRole("button", { name: "Log now: Omega-3" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Omega-3 logged" })
    .getByRole("button", { name: "Change time" })
    .click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Taken: today at / })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // Today: taken again today, and yesterday's log is on yesterday's card.
  await page.goto(`/today?date=${localDay(-1)}`);
  await expect(card.getByTestId("medicine-taken")).toContainText("Omega-3 · 2 capsules");
});

test("the camera's Medicine mode: the Taken chip picks another day and time", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  await page.getByRole("button", { name: "Open the camera" }).click();
  const camera = page.getByRole("dialog", { name: "Camera" });
  await expect(page.getByTestId("camera")).toHaveAttribute("data-camera-state", "live");
  await camera.getByRole("tab", { name: "Medicine" }).click();
  await camera.getByRole("button", { name: "Photograph the label" }).click();
  const sheet = page.getByRole("dialog", { name: "What did you take?" });
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await sheet.getByLabel("Name").fill("Vitamin C");
  await sheet.getByRole("button", { name: "Taken: now. Change the time" }).click();
  await pickWhen(page, "When did you take it?", localDay(-1), "08:30");
  await expect(
    sheet.getByRole("button", { name: "Taken: yesterday at 08:30. Change the time" }),
  ).toBeVisible();
  await expectAccessible(page);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(camera).toBeHidden();
  expect(await logsOf(userId)).toEqual([
    { name: "Vitamin C", amount: 1, day: localDay(-1), time: "08:30" },
  ]);
  await page.goto(`/today?date=${localDay(-1)}`);
  await expect(
    page.getByRole("region", { name: "Medicines" }).getByTestId("medicine-taken"),
  ).toContainText("Taken 08:30");
});

const waterOf = async (userId: string) =>
  (
    await pool().query(
      `select i.ml, i.grams, (i.nutrients->>'water')::float as water, m.local_date::text as day,
         to_char(m.eaten_at at time zone m.tz, 'HH24:MI') as time
       from meal_items i join meals m on m.id = i.meal_id
       where m.user_id = $1 and m.deleted_at is null order by m.eaten_at`,
      [userId],
    )
  ).rows as { ml: number; grams: number; water: number; day: string; time: string }[];

test("water: a glass becomes a bottle at another time, + Other amount, Remove and Undo, and to yesterday", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const water = page.getByRole("region", { name: "Water" });
  const total = water.getByTestId("water-total");
  const rows = water.getByTestId("water-entry");
  await expect(rows).toHaveCount(0);

  await water.getByRole("button", { name: "+ Glass, 250 ml" }).click();
  await expect(total).toHaveText("0.25 of 1.8 L");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Glass");
  await expect(rows.first()).toContainText("250 ml");
  await expectAccessible(page);

  // The row opens the sheet of board 29.
  await rows.first().getByRole("button").click();
  const sheet = page.getByRole("dialog", { name: /^Water at \d\d:\d\d$/ });
  await expect(sheet).toBeVisible();
  const amount = sheet.getByLabel("Amount in ml");
  await expect(amount).toHaveValue("250");
  await expect(sheet.getByRole("button", { name: "Glass 250 ml" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expectAccessible(page);
  await sheet.getByRole("button", { name: "Bottle 500 ml" }).click();
  await expect(amount).toHaveValue("500");
  await sheet.getByRole("button", { name: "50 ml more" }).click();
  await expect(amount).toHaveValue("550");
  await sheet.getByRole("button", { name: "50 ml less" }).click();
  await expect(amount).toHaveValue("500");
  await sheet.getByRole("button", { name: /^When: today at / }).click();
  await pickWhen(page, "When did you drink it?", localDay(), "00:00");
  await expect(
    sheet.getByRole("button", { name: "When: today at 00:00. Change the time" }),
  ).toBeFocused();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(total).toHaveText("0.50 of 1.8 L");
  await expect(water.getByRole("progressbar", { name: "Water today" })).toHaveAttribute(
    "aria-valuenow",
    "500",
  );
  await expect(rows.first()).toContainText("00:00");
  await expect(rows.first()).toContainText("Bottle");
  await expect(page.getByRole("status").filter({ hasText: "Water changed" })).toContainText(
    "500 ml of water at 00:00",
  );
  expect(await waterOf(userId)).toEqual([
    { ml: 500, grams: 500, water: 500, day: localDay(), time: "00:00" },
  ]);

  // + Other amount: new water, now. Too little is refused in the sheet.
  await water.getByRole("button", { name: "+ Other amount" }).click();
  const add = page.getByRole("dialog", { name: "Add water" });
  await expect(add.getByRole("button", { name: "When: now. Change the time" })).toBeVisible();
  await add.getByLabel("Amount in ml").fill("5");
  await add.getByRole("button", { name: "Save" }).click();
  await expect(add.getByRole("alert")).toHaveText("Give an amount from 10 to 3,000 ml.");
  await expectAccessible(page);
  await add.getByLabel("Amount in ml").fill("330");
  await add.getByRole("button", { name: "Save" }).click();
  await expect(add).toBeHidden();
  await expect(total).toHaveText("0.83 of 1.8 L");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText("Water");
  await expect(rows.nth(1)).toContainText("330 ml");
  await expect(
    page.getByRole("status").filter({ hasText: "330 ml of water logged" }),
  ).toBeVisible();

  // Remove this water, then Undo.
  await rows.first().getByRole("button").click();
  const bottle = page.getByRole("dialog", { name: "Water at 00:00" });
  await bottle.getByRole("button", { name: "Remove this water" }).click();
  await expect(bottle).toBeHidden();
  await expect(total).toHaveText("0.33 of 1.8 L");
  await expect(rows).toHaveCount(1);
  await page
    .getByRole("status")
    .filter({ hasText: "500 ml of water at 00:00 removed" })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(total).toHaveText("0.83 of 1.8 L");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("00:00");

  // To yesterday: it leaves today's card and shows on yesterday's.
  await rows.nth(1).getByRole("button").click();
  const later = page.getByRole("dialog", { name: /^Water at / });
  await later.getByRole("button", { name: /^When: / }).click();
  const when = page.getByRole("dialog", { name: "When did you drink it?" });
  await when.getByRole("button", { name: "Yesterday" }).click();
  await when.getByRole("button", { name: "Done" }).click();
  await later.getByRole("button", { name: "Save" }).click();
  await expect(later).toBeHidden();
  await expect(total).toHaveText("0.50 of 1.8 L");
  await expect(rows).toHaveCount(1);
  await expect(
    page.getByRole("status").filter({ hasText: "330 ml of water, moved to yesterday at" }),
  ).toBeVisible();
  await page.goto(`/today?date=${localDay(-1)}`);
  await expect(total).toHaveText("0.33 of 1.8 L");
  await expect(rows.first()).toContainText("330 ml");
});

test("water: a drink in a meal opens the meal, a water card of the timeline opens the sheet, Show all", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  // A lunch with a coffee, as an analysis leaves it.
  const { rows: made } = await pool().query(
    `insert into meals (user_id, eaten_at, tz, local_date, slot, title, status, source)
     values ($1, now(), $2, $3, 'lunch', 'Lunch', 'ready', 'photo') returning id`,
    [userId, zone(), localDay()],
  );
  const lunchId = made[0].id as string;
  await pool().query(
    `insert into meal_items (meal_id, user_id, position, name, kind, emoji, grams, ml, nutrients)
     values ($1, $2, 0, 'Rice', 'dish', '🍚', 200, null, '{"energy": 260}'),
            ($1, $2, 1, 'Coffee', 'drink', '☕', 180, 180, '{"energy": 4, "water": 178}')`,
    [lunchId, userId],
  );
  await page.reload();
  const water = page.getByRole("region", { name: "Water" });
  const rows = water.getByTestId("water-entry");
  await expect(water.getByTestId("water-total")).toHaveText("0.18 of 1.8 L");
  const coffee = rows.first().getByRole("link");
  await expect(coffee).toContainText("Coffee · in Lunch");
  await expect(coffee).toContainText("180 ml");
  await coffee.click();
  await expect(page).toHaveURL(new RegExp(`/meals/${lunchId}$`));
  await page.goBack();

  // Water added from the card is a card of the timeline too: it opens the water sheet.
  await water.getByRole("button", { name: "+ Glass, 250 ml" }).click();
  await expect(rows).toHaveCount(2);
  const card = page.locator("article[data-meal-id]").filter({ hasText: "Water" });
  await card.getByRole("button", { name: "Water" }).click();
  const sheet = page.getByRole("dialog", { name: /^Water at / });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel("Amount in ml")).toHaveValue("250");
  await expect(page).toHaveURL(/\/today$/);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // A busy day: the latest four, then all of them.
  for (const expected of ["0.68", "0.93", "1.18"]) {
    await water.getByRole("button", { name: "+ Glass, 250 ml" }).click();
    await expect(water.getByTestId("water-total")).toHaveText(`${expected} of 1.8 L`);
  }
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText("Glass");
  const all = water.getByRole("button", { name: "Show all 5" });
  await expect(all).toHaveAttribute("aria-expanded", "false");
  await all.click();
  await expect(rows).toHaveCount(5);
  await expect(rows.first()).toContainText("Coffee");
  await expect(water.getByRole("button", { name: "Show fewer" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expectAccessible(page);
});
