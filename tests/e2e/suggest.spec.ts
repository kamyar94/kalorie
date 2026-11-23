// "What should I eat?" end to end (phone, desktop, phone-dark) with axe (board 42): the sheet
// from Today with what is left, the usual meal now, Log this with Undo and Details; the sheet
// from the camera, where Log this closes the camera; too little history (a balanced idea from
// the targets, then a favorite); and "Something new" from the person's own AI (the mock
// provider) with Type it opening a meal in words. The person has no profile, so the targets are
// the defaults; the meals count from the moment the test runs. Values are made up.
import { expect, test, type Page } from "@playwright/test";

import { expectAccessible, installE2eHooks, pool, signUp, zone } from "./helpers";
import { addMeal, mix } from "./meal-rows";

installE2eHooks();

/** `days` days and `minutes` minutes before now. */
const ago = (days: number, minutes = 10) => ({
  sql: `now() - make_interval(days => $1, mins => $2)`,
  params: [days, minutes],
});
/** Earlier today: two hours ago, or just after midnight when it is earlier than 02:00. */
const earlierToday = () => ({
  sql: `greatest(now() - interval '2 hours', date_trunc('day', now() at time zone '${zone()}') at time zone '${zone()}' + interval '1 minute')`,
  params: [],
});

const sheetOf = (page: Page) => page.getByRole("dialog", { name: "What should I eat?" });

/** Four days of a usual lunch around now, and a meal earlier today. */
const usualLunches = async (userId: string) => {
  for (const n of [2, 3, 4])
    await addMeal(userId, ago(n), {
      title: "Chicken salad",
      totals: { ...mix(580, 1), protein: 34 },
      items: [
        { name: "Chicken salad", emoji: "🥗" },
        { name: "Chickpeas", emoji: "🫘" },
      ],
    });
  const beans = await addMeal(userId, ago(5), {
    title: "Bean bowl",
    totals: mix(600, 0.95),
    items: [{ name: "Bean bowl", emoji: "🌯" }],
  });
  await addMeal(userId, ago(6), {
    title: "Pasta",
    totals: mix(650, 0.6),
    items: [{ name: "Pasta", emoji: "🍝" }],
  });
  await addMeal(userId, earlierToday(), {
    title: "Toast",
    slot: "breakfast",
    totals: mix(400, 0.5),
    items: [{ name: "Toast", emoji: "🍞" }],
  });
  return { beans };
};

test("what should I eat, from Today: what is left, the usual meal now, Log this with Undo, Details", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const { beans } = await usualLunches(userId);

  await page.goto("/today");
  const cards = page.locator("article[data-meal-id]");
  await expect(cards).toHaveCount(1);
  await page.getByRole("button", { name: "What should I eat?" }).click();
  const sheet = sheetOf(page);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("suggest-intro")).toHaveText(
    /^It is \d{2}:\d{2}\. You usually have lunch now, about 580 kcal, and /,
  );
  // 2,000 kcal less the 400 of the toast; protein, fiber and sodium the same way.
  const left = sheet.getByTestId("suggest-left");
  await expect(left).toContainText(/kcal left\s*1,600/);
  await expect(left).toContainText("protein left");
  await expect(left).toContainText("fiber left");
  await expect(left).toContainText("sodium room");
  const list = sheet.getByTestId("suggest-list");
  // The chicken salad (had three times, lots of protein) first, then the bean bowl and the pasta.
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list.getByRole("listitem").first()).toContainText("Chicken salad");
  await expect(list.getByRole("listitem").first()).toContainText("Best fit");
  await expect(list.getByRole("listitem").first()).toContainText(
    "Covers 34 g of the 45 g protein you still need; fits your usual 580 kcal lunch.",
  );
  await expect(list.getByRole("listitem").nth(1)).toContainText("Bean bowl");
  await expect(list.getByRole("listitem").nth(2)).toContainText("Pasta");
  await expect(sheet).not.toContainText("Something new");
  await expectAccessible(page);

  // Log this: a copy at now on Today, with Undo.
  await list.getByRole("listitem").first().getByRole("button", { name: "Log this" }).click();
  await expect(sheet).toBeHidden();
  await expect(cards).toHaveCount(2);
  const copies = async () =>
    (
      await pool().query(
        "select count(*)::int as n from meals where user_id = $1 and source = 'duplicate' and deleted_at is null",
        [userId],
      )
    ).rows[0].n as number;
  expect(await copies()).toBe(1);
  await page
    .getByRole("status")
    .filter({ hasText: "Chicken salad logged" })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(cards).toHaveCount(1);
  expect(await copies()).toBe(0);

  // Details opens the past meal, with its balance card.
  await page.getByRole("button", { name: "What should I eat?" }).click();
  await sheetOf(page)
    .getByRole("listitem")
    .filter({ hasText: "Bean bowl" })
    .getByRole("button", { name: "Details" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/meals/${beans}$`));
  await expect(page.getByTestId("meal-balance")).toContainText(/Balance \d+ of 100/);
});

test("what should I eat, from the camera, and with too little history", async ({ page }, info) => {
  const userId = await signUp(page, info.project.name);

  // Nothing logged yet: a balanced idea from the targets.
  await page.goto("/today");
  await page.getByRole("button", { name: "What should I eat?" }).click();
  let sheet = sheetOf(page);
  await expect(sheet.getByTestId("suggest-intro")).toHaveText(
    /^It is \d{2}:\d{2}\. Kal needs a few more days of meals to learn when and how much you usually eat\.$/,
  );
  await expect(sheet.getByTestId("suggest-balanced")).toContainText(
    "a plate that is half vegetables, a quarter protein",
  );
  await expect(sheet.getByTestId("suggest-list")).toHaveCount(0);
  await expectAccessible(page);
  await page.keyboard.press("Escape");

  // One favorite from a few days ago: suggested even without a pattern.
  await addMeal(userId, ago(3), {
    title: "Omelette",
    slot: "breakfast",
    totals: mix(450, 0.9),
    items: [{ name: "Omelette", emoji: "🍳" }],
    favorite: true,
  });
  await page.getByRole("button", { name: "Open the camera" }).click();
  const camera = page.getByRole("dialog", { name: "Camera" });
  await expect(camera).toBeVisible();
  await camera.getByRole("button", { name: "What should I eat?" }).click();
  sheet = sheetOf(page);
  await expect(sheet.getByTestId("suggest-list").getByRole("listitem")).toHaveCount(1);
  await expect(sheet.getByTestId("suggest-list")).toContainText("Omelette");
  await expect(sheet).toContainText("the order gets better as Kal learns");
  await expectAccessible(page);

  // Log this from the camera: the camera closes and Today shows the copy, with Undo.
  await sheet.getByRole("button", { name: "Log this" }).click();
  await expect(camera).toBeHidden();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator("article[data-meal-id]")).toHaveCount(1);
  const used = await pool().query(
    "select favorite_used_at from meals where user_id = $1 and favorite_at is not null",
    [userId],
  );
  expect(used.rows[0].favorite_used_at).not.toBeNull();
  await page
    .getByRole("status")
    .filter({ hasText: "Omelette logged" })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(page.locator("article[data-meal-id]")).toHaveCount(0);
});

test("something new from your AI: an idea with rough nutrients, and Type it opens a meal in words", async ({
  page,
}, info) => {
  await signUp(page, info.project.name);
  // Without a key the button is not there; with one (the mock provider answers), it is.
  await page.goto("/today");
  await page.getByRole("button", { name: "What should I eat?" }).click();
  await expect(sheetOf(page).getByTestId("suggest-intro")).toBeVisible();
  await expect(sheetOf(page)).not.toContainText("Something new");
  await page.keyboard.press("Escape");
  await page.goto("/settings");
  const card = page.locator('li[data-provider="google"]');
  await card.getByLabel("Google (Gemini) API key").fill("e2e-mock-key-0123456789");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("key-state-google")).toHaveText("Saved key ••••6789");

  await page.goto("/today");
  await page.getByRole("button", { name: "What should I eat?" }).click();
  const sheet = sheetOf(page);
  await sheet.getByRole("button", { name: "Something new (asks your AI)" }).click();
  const idea = sheet.getByTestId("suggest-idea");
  await expect(idea.getByRole("heading", { name: "Chickpea and spinach stew" })).toBeVisible();
  await expect(idea).toContainText(
    "Roughly 520 kcal · 24 g protein · 16 g fiber · 450 mg sodium (the AI's estimate)",
  );
  await expectAccessible(page);
  await idea.getByRole("button", { name: "Type it" }).click();
  await expect(sheet).toBeHidden();
  const camera = page.getByRole("dialog", { name: "Camera" });
  await expect(camera.getByRole("textbox", { name: "What did you eat?" })).toHaveValue(
    "1 cup chickpeas, 2 handfuls spinach, half a tomato, 1 tsp olive oil, 1 slice wholegrain bread",
  );
});
