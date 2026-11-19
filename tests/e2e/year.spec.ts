// The Trends year card end to end (phone, desktop, phone-dark) with axe: the card and its squares,
// choosing another nutrient from the menu (by pointer and by keyboard), the previous year with
// back and forward, a square's summary with the day before and after, closing it by a press
// outside and by Escape with focus back on the square, and moving between squares with the arrow
// keys. Last year is used for the days that are checked, so the test does not depend on today's
// date; today's own square is checked too.
import { expect, test, type Page } from "@playwright/test";

import { expectAccessible, installE2eHooks, localDay, pool, signUp, zone } from "./helpers";

installE2eHooks();

const addMeal = (userId: string, localDate: string, totals: Record<string, number>) =>
  pool().query(
    `insert into meals (user_id, eaten_at, tz, local_date, slot, status, source, title, totals)
     values ($1, $2, $3, $4, 'lunch', 'ready', 'manual', 'Lunch', $5)`,
    [userId, new Date(`${localDate}T12:00:00Z`), zone(), localDate, JSON.stringify(totals)],
  );

/** "Tuesday 10 March" (with the year when asked), as the card names a day. */
const dayName = (date: string, withYear = false) => {
  const at = new Date(`${date}T12:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions) =>
    at.toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });
  return [
    part({ weekday: "long" }),
    part({ day: "numeric" }),
    part({ month: "long" }),
    ...(withYear ? [part({ year: "numeric" })] : []),
  ].join(" ");
};

const square = (page: Page, date: string) => page.locator(`[data-year-date="${date}"]`);

test("trends year: squares, the nutrient menu, last year, a day's summary and the keyboard", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const today = localDay();
  const year = Number(today.slice(0, 4));
  const last = year - 1;
  const d = (monthDay: string) => `${last}-${monthDay}`;
  await addMeal(userId, today, { energy: 2100, protein: 120, carbs: 250, fat: 70 });
  await addMeal(userId, d("03-10"), { energy: 2330, protein: 140, carbs: 260, fat: 90 });
  await addMeal(userId, d("03-11"), { energy: 900, protein: 30, carbs: 100, fat: 30 });
  await addMeal(userId, d("03-12"), { energy: 2000, protein: 60, carbs: 270, fat: 70 });

  await page.goto("/trends");
  const card = page.getByRole("region", { name: "Your year" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("grid", { name: `Calories by day, ${year}` })).toBeVisible();
  // 2,100 of the default 2,000 kcal: 105 %.
  await expect(square(page, today)).toHaveAttribute(
    "aria-label",
    `${dayName(today)}, 2,100 kcal, on target`,
  );
  await expect(card.getByTestId("year-counts")).toHaveText(
    "1 day logged · 1 on target · 0 over · 0 under",
  );
  await expect(card).toContainText("Compared with your current targets.");
  // The card sits above the Day / Week / Month control.
  const cardBox = (await card.boundingBox())!;
  const period = (await page.getByRole("radiogroup", { name: "Period" }).boundingBox())!;
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(period.y);
  await expectAccessible(page);

  // Another nutrient from the menu.
  await card.getByRole("button", { name: /^Show Calories against 2,000 kcal/ }).click();
  const menu = page.getByRole("listbox", { name: "Show in the year" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("group", { name: "Minerals" })).toContainText(
    "Sodium · max 2,300 mg",
  );
  await expect(menu.getByRole("option", { name: /^Calories/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expectAccessible(page);
  await menu.getByRole("option", { name: /^Protein/ }).click();
  await expect(page).toHaveURL(/\/trends\?range=week&metric=protein$/);
  await expect(card.getByRole("grid", { name: `Protein by day, ${year}` })).toBeVisible();
  await expect(menu).toBeHidden();

  // Last year, then back and forward.
  await card.getByRole("button", { name: `Previous year (${last})` }).click();
  await expect(page).toHaveURL(new RegExp(`year=${last}&metric=protein$`));
  await expect(card.getByRole("grid", { name: `Protein by day, ${last}` })).toBeVisible();
  await page.goBack();
  await expect(card.getByRole("grid", { name: `Protein by day, ${year}` })).toBeVisible();
  await page.goForward();
  await expect(card.getByRole("grid", { name: `Protein by day, ${last}` })).toBeVisible();
  await expect(card.getByRole("button", { name: `Next year (${year})` })).toBeVisible();

  // Calories again, by keyboard: the first nutrient after the three activity measures.
  const button = card.getByRole("button", { name: /^Show Protein/ });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown", { delay: 20 });
  await page.keyboard.press("ArrowDown", { delay: 20 });
  await page.keyboard.press("ArrowDown", { delay: 20 });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`year=${last}$`));
  await expect(card.getByRole("grid", { name: `Calories by day, ${last}` })).toBeVisible();
  await expect(card.getByTestId("year-counts")).toHaveText(
    "3 days logged · 1 on target · 1 over · 1 under",
  );

  // Phones scroll the strip to December; wide screens show the whole year.
  const strip = await card.getByTestId("year-scroller").evaluate((el) => ({
    left: el.scrollLeft,
    width: el.scrollWidth,
    client: el.clientWidth,
  }));
  if (info.project.use.isMobile) {
    expect(strip.width).toBeGreaterThan(strip.client);
    expect(strip.left + strip.client).toBeGreaterThanOrEqual(strip.width - 1);
  } else expect(strip.width).toBeLessThanOrEqual(strip.client);

  // A square opens its day's summary.
  await expect(square(page, d("03-10"))).toHaveAttribute(
    "aria-label",
    `${dayName(d("03-10"))}, 2,330 kcal, over`,
  );
  await square(page, d("03-10")).click();
  const summary = page.getByRole("dialog");
  await expect(summary).toBeVisible();
  await expect(summary.getByRole("heading", { name: dayName(d("03-10"), true) })).toBeVisible();
  await expect(summary.getByTestId("year-day-metric")).toContainText("2,330 kcal");
  await expect(summary.getByTestId("year-day-metric")).toContainText("117% of 2,000 kcal · over");
  await expect(summary).toContainText("Protein · 280%");
  await expect(summary).toContainText("1 meal · water 0 L · no steps logged");
  await expectAccessible(page);

  // The next day, then a press outside closes it and focus goes back to that day's square.
  await summary.getByRole("button", { name: "Next day" }).click();
  await expect(summary.getByRole("heading", { name: dayName(d("03-11"), true) })).toBeVisible();
  await expect(summary.getByTestId("year-day-metric")).toContainText(
    "45% of 2,000 kcal · far under",
  );
  await expect(summary.getByRole("link", { name: "Open this day" })).toHaveAttribute(
    "href",
    `/today?date=${d("03-11")}`,
  );
  if (info.project.use.isMobile) await page.touchscreen.tap(8, 8);
  else await page.mouse.click(8, 8);
  await expect(summary).toBeHidden();
  await expect(square(page, d("03-11"))).toBeFocused();

  // Arrow keys: up and down by a day, left and right by a week; Enter opens, Escape closes.
  await page.keyboard.press("ArrowDown");
  await expect(square(page, d("03-12"))).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(square(page, d("03-19"))).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(square(page, d("03-12"))).toBeFocused();
  await expect(square(page, d("03-12"))).toHaveAttribute("tabindex", "0");
  await expect(square(page, d("03-11"))).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("ArrowUp");
  await expect(square(page, d("03-11"))).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(summary.getByRole("heading", { name: dayName(d("03-11"), true) })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(summary).toBeHidden();
  await expect(square(page, d("03-11"))).toBeFocused();

  // A day without meals still opens, and says so.
  await square(page, d("03-13")).click();
  await expect(summary.getByTestId("year-day-metric")).toHaveText("No meals logged");
  await page.keyboard.press("Escape");
  await expect(summary).toBeHidden();
});

test("trends year: the Activity group, steps against the goal, and a day's summary that opens Move", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const last = Number(localDay().slice(0, 4)) - 1;
  const d = (monthDay: string) => `${last}-${monthDay}`;
  const move = (date: string, values: Record<string, unknown>) =>
    pool().query(
      `insert into activities (user_id, category, type, title, started_at, tz, local_date,
         duration_min, intensity, steps, energy_kcal, source, source_app, external_id)
       values ($1, $2, $3, $4, ($5::date + time '08:00') at time zone $6, $6, $5, $7, $8, $9,
         $10, $11, $12, $13)`,
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
  const steps = (date: string, count: number) =>
    move(date, {
      category: "walking",
      type: "steps",
      title: "Steps",
      steps: count,
      source: "health_connect",
      sourceApp: "com.android.healthconnect.phone.0a1b",
      externalId: `steps:${date}`,
    });
  // 3,000 (under half of 7,000), 4,701, 7,480 and 11,240 steps; a run and a session at the gym.
  await steps(d("03-09"), 3000);
  await steps(d("03-10"), 4701);
  await steps(d("03-11"), 7480);
  await steps(d("03-12"), 11_240);
  await move(d("03-10"), {
    category: "cardio",
    type: "run",
    title: "Run",
    durationMin: 20,
    intensity: "vigorous",
    energyKcal: 210,
  });
  await move(d("03-10"), {
    category: "strength",
    type: "weights",
    title: "Gym",
    durationMin: 45,
    intensity: "moderate",
    energyKcal: 190,
  });

  await page.goto(`/trends?year=${last}`);
  const card = page.getByRole("region", { name: "Your year" });
  await card.getByRole("button", { name: /^Show Calories/ }).click();
  const menu = page.getByRole("listbox", { name: "Show in the year" });
  const activity = menu.getByRole("group", { name: "Activity" });
  await expect(activity.getByRole("option")).toHaveText([
    "Steps · 7,000 a day",
    "Active minutes · 21.4 min a day",
    "Energy from activity",
  ]);
  await expectAccessible(page);
  await activity.getByRole("option", { name: /^Steps/ }).click();
  await expect(page).toHaveURL(new RegExp(`year=${last}&metric=steps$`));
  await expect(card.getByRole("grid", { name: `Steps by day, ${last}` })).toBeVisible();
  await expect(card.getByRole("button", { name: /^Show Steps goal 7,000 a day/ })).toBeVisible();
  for (const [date, words] of [
    ["03-09", "3,000 steps, under half the goal"],
    ["03-10", "4,701 steps, under the goal"],
    ["03-11", "7,480 steps, goal reached"],
    ["03-12", "11,240 steps, well past the goal"],
    ["03-13", "no steps recorded"],
  ] as const)
    await expect(square(page, d(date))).toHaveAttribute(
      "aria-label",
      `${dayName(d(date))}, ${words}`,
    );
  await expect(card.getByRole("list", { name: "Colours" })).toHaveText(
    /No data\s*under 3,500\s*3,500–6,999\s*7,000–10,499\s*10,500 and more/,
  );
  await expect(card.getByTestId("year-counts")).toHaveText(
    `4 days with steps · 2 at goal · from Health Connect since 9 Mar`,
  );
  await expect(card).toContainText("Compared with Move's step goal of 7,000 a day.");
  await expectAccessible(page);

  // A day's summary: steps, active minutes, workouts and energy, and Move for that day.
  await square(page, d("03-10")).click();
  const summary = page.getByRole("dialog");
  await expect(summary.getByTestId("year-day-metric")).toContainText("4,701 steps");
  await expect(summary.getByTestId("year-day-metric")).toContainText(
    "67% of 7,000 · under the goal",
  );
  await expect(summary.getByTestId("year-day-activity")).toHaveText(
    "Steps4,701Active minutes1 h 5 minWorkouts2Energy from activity400 kcal",
  );
  await expectAccessible(page);
  await summary.getByRole("link", { name: "Open this day in Move" }).click();
  await expect(page).toHaveURL(new RegExp(`/move\\?date=${d("03-10")}$`));
  await expect(page.getByRole("img", { name: "Steps: 4,701 of 7,000" })).toBeVisible();
  await expect(page.getByTestId("day-activities").getByTestId("activity")).toHaveCount(3);

  // Active minutes: 40 WHO minutes on the day of the run (a vigorous minute counts twice).
  await page.goto(`/trends?year=${last}&metric=active_minutes`);
  await expect(square(page, d("03-10"))).toHaveAttribute(
    "aria-label",
    `${dayName(d("03-10"))}, 40 min, well past the goal`,
  );
  await expect(square(page, d("03-11"))).toHaveAttribute(
    "aria-label",
    `${dayName(d("03-11"))}, 0 min, under half the goal`,
  );
  await expect(card.getByTestId("year-counts")).toHaveText("4 days with activity · 1 at goal");
  await expectAccessible(page);
});
