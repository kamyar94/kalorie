// Trends "Activity" end to end (phone, desktop, phone-dark) with axe: a week's steps a day, active
// minutes a day and workouts, the caption about days without data, the steps chart against the
// goal and the active minutes by category with their tables, the WHO week, "Eaten and burned";
// a day's view with its categories and "Open this day in Move". Last full week before this one,
// so every day is in the past.
import { expect, test } from "@playwright/test";

import { shiftLocalDate } from "../../lib/meals/time";
import { weekStart } from "../../lib/move/week";
import { expectAccessible, installE2eHooks, localDay, pool, signUp, zone } from "./helpers";

installE2eHooks();

const add = (userId: string, date: string, values: Record<string, unknown>) =>
  pool().query(
    `insert into activities (user_id, category, type, title, started_at, tz, local_date,
       duration_min, intensity, steps, energy_kcal, source, source_app, external_id)
     values ($1, $2, $3, $4, ($5::date + time '08:00') at time zone $6, $6, $5, $7, $8, $9, $10,
       $11, $12, $13)`,
    [
      userId,
      values.category,
      values.type,
      values.title,
      date,
      zone(),
      values.durationMin ?? null,
      values.intensity ?? null,
      values.steps ?? null,
      values.energyKcal ?? null,
      values.source ?? "manual",
      values.sourceApp ?? null,
      values.externalId ?? null,
    ],
  );

const stepsOn = (userId: string, date: string, steps: number) =>
  add(userId, date, {
    category: "walking",
    type: "steps",
    title: "Steps",
    steps,
    source: "health_connect",
    sourceApp: "com.android.healthconnect.phone.0a1b",
    externalId: `steps:${date}`,
  });

test("trends activity: a week's steps, minutes and workouts with their tables; a day in Move", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const monday = shiftLocalDate(weekStart(localDay()), -7);
  const d = (i: number) => shiftLocalDate(monday, i);
  await stepsOn(userId, d(0), 4701);
  await stepsOn(userId, d(1), 4150);
  await stepsOn(userId, d(2), 7480);
  await add(userId, d(1), {
    category: "cardio",
    type: "run",
    title: "Run",
    durationMin: 30,
    intensity: "vigorous",
    energyKcal: 320,
  });
  await add(userId, d(2), {
    category: "strength",
    type: "weights",
    title: "Gym",
    durationMin: 40,
    intensity: "moderate",
    energyKcal: 180,
  });
  await pool().query(
    `insert into meals (user_id, eaten_at, tz, local_date, slot, status, source, title, totals)
     values ($1, ($2::date + time '12:00') at time zone $3, $3, $2, 'lunch', 'ready', 'manual',
       'Lunch', $4)`,
    [userId, d(1), zone(), JSON.stringify({ energy: 1900, protein: 90, carbs: 200, fat: 60 })],
  );

  await page.goto(`/trends?range=week&end=${d(6)}`);
  const section = page.getByTestId("trends-activity");
  await expect(section.getByRole("heading", { name: "Activity" })).toBeVisible();
  // Steps on 3 days (5,444 a day), minutes on the 3 days with a record (23 min a day), 2 workouts.
  await expect(section.getByTestId("trends-steps")).toHaveText("5,444steps a day");
  await expect(section.getByTestId("trends-active")).toHaveText("23 minactive a day");
  await expect(section.getByTestId("trends-workouts")).toHaveText("2workouts");
  await expect(section).toContainText(
    "Averages leave out days without data, rather than count them as zero: steps from 3 of 7 days, active minutes from 3.",
  );
  await expect(
    section.getByRole("img", { name: /^Steps per day\. 3 of 7 with data\. Goal 7,000 steps\./ }),
  ).toBeVisible();
  await expect(
    section.getByRole("img", { name: /^Active minutes per day\. 2 of 7 with some\./ }),
  ).toBeVisible();
  await expect(section.getByRole("list", { name: "Colours" })).toHaveText(/Cardio\s*Strength/);
  await expect(section.getByTestId("trends-who")).toHaveText(
    "WHO week: cardio 60 of 150 min · strength 1 of 2 days · steps on 1 of 7 days",
  );
  const burned = page.getByTestId("trends-eaten-burned");
  await expect(burned).toContainText(
    "Daily average: eaten 1,900 kcal, burned in activity 250 kcal, target 2,000 + activity.",
  );
  await expectAccessible(page);

  // The tables: steps by day ("–" without data), minutes by category.
  const tables = section.getByText("Show as a table");
  await expect(tables).toHaveCount(2);
  await tables.first().click();
  const stepsTable = section.getByRole("table", { name: "Steps per day" });
  await expect(stepsTable.getByRole("row")).toHaveCount(8);
  await expect(stepsTable.getByRole("row").nth(3)).toContainText("7,480");
  await expect(stepsTable.getByRole("row").nth(5)).toContainText("–");
  await tables.nth(1).click();
  const minutesTable = section.getByRole("table", { name: "Active minutes per day" });
  await expect(minutesTable.getByRole("columnheader")).toHaveText([
    "",
    "Cardio",
    "Strength",
    "Total, min",
  ]);
  await expect(minutesTable.getByRole("row").nth(2)).toContainText(/30\s*0\s*30/);
  await expect(minutesTable.getByRole("row").nth(4)).toContainText(/–\s*–\s*–/);
  await expectAccessible(page);

  // A day: its numbers and categories, the WHO line of its week, and Move for that day.
  await page.goto(`/trends?range=day&end=${d(1)}`);
  await expect(section.getByTestId("trends-steps")).toHaveText("4,150steps");
  await expect(section.getByTestId("trends-categories")).toHaveText("Cardio 30 min");
  await expect(section.getByTestId("trends-who")).toHaveText(
    /^WHO week of .+: cardio 60 of 150 min/,
  );
  await expect(burned).toContainText("The day: eaten 1,900 kcal, burned in activity 320 kcal");
  await expectAccessible(page);
  await section.getByRole("link", { name: "Open this day in Move" }).click();
  await expect(page).toHaveURL(new RegExp(`/move\\?date=${d(1)}$`));
  await expect(page.getByRole("img", { name: "Steps: 4,150 of 7,000" })).toBeVisible();

  // A week without meals still shows its activity.
  await page.goto(`/trends?range=week&end=${d(0)}`);
  await expect(page.getByText("Nothing logged in this period")).toBeVisible();
  await expect(section.getByTestId("trends-steps")).toHaveText("4,701steps a day");
  await expect(section.getByTestId("trends-workouts")).toHaveText("0workouts");
  await expect(burned).toContainText("Daily average: no meals logged, no energy from activity");
  await expectAccessible(page);
});
