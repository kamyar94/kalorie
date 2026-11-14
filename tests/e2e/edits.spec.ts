// Changing what was logged, end to end (phone, desktop, phone-dark): a logged medicine's time and
// amount from Today's card, from the toast after "Log now" (Change time) and from the Medicines
// page history, removing it with Undo, and the time control of the camera's Medicine mode.
import { expect, test, type Page } from "@playwright/test";

import { expectAccessible, installE2eHooks, localDay, pool, signUp } from "./helpers";

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
