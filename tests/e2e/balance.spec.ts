// Meal balance end to end (phone, desktop, phone-dark) with axe: Trends' "Most and least
// nutritious" for a week and for all time (board 41) with "How it is worked out", and a row
// opening the meal page's balance card (board 43). The person has no profile, so the targets
// are the defaults (2,000 kcal and the US Daily Values). Last full week is used, so nothing
// depends on the day the test runs. Values are made up.
import { expect, test } from "@playwright/test";

import { shiftLocalDate } from "../../lib/meals/time";
import { weekStart } from "../../lib/move/week";
import { expectAccessible, installE2eHooks, localDay, signUp } from "./helpers";
import { addMeal, mix, onDay } from "./meal-rows";

installE2eHooks();

test("trends: most and least nutritious for the week and all time; a row opens the meal's balance", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const monday = shiftLocalDate(weekStart(localDay()), -7);
  const d = (i: number) => shiftLocalDate(monday, i);
  const lentils = await addMeal(userId, onDay(d(0)), {
    title: "Lentil stew",
    totals: mix(600, 1),
    items: [{ name: "Lentil stew", emoji: "🍲" }],
  });
  await addMeal(userId, onDay(d(1)), {
    title: "Bean salad",
    totals: mix(600, 0.9),
    items: [{ name: "Bean salad", emoji: "🥗" }],
  });
  await addMeal(userId, onDay(d(2)), {
    title: "Oats with berries",
    slot: "breakfast",
    totals: mix(500, 0.8),
    items: [{ name: "Oats", emoji: "🥣" }],
  });
  await addMeal(userId, onDay(d(3)), {
    title: "Cheese toast",
    totals: mix(600, 0.5, 1.2),
    items: [{ name: "Cheese toast", emoji: "🧀" }],
  });
  await addMeal(userId, onDay(d(4)), {
    title: "Cream pastry",
    slot: "snack",
    totals: mix(500, 0.2, 2.5),
    items: [{ name: "Cream pastry", emoji: "🥐" }],
  });
  await addMeal(userId, onDay(d(5)), {
    title: "Crisps",
    slot: "snack",
    totals: mix(300, 0.3, 1.8),
    items: [{ name: "Crisps", emoji: "🥔" }],
  });
  await addMeal(userId, onDay(d(6)), {
    title: "Party platter",
    slot: "dinner",
    totals: mix(1600, 0.6, 1.5),
    items: [{ name: "Party platter", emoji: "🍕" }],
  });
  // A drink on its own is not judged.
  await addMeal(userId, onDay(d(2)), {
    title: "Smoothie",
    slot: "drink",
    totals: mix(300, 1.5),
    items: [{ name: "Smoothie", emoji: "🥤", kind: "drink" }],
  });
  // Before the week: only in All time.
  await addMeal(userId, onDay(shiftLocalDate(monday, -60)), {
    title: "Fry-up",
    slot: "breakfast",
    totals: mix(1400, 0.2, 3),
    items: [{ name: "Fry-up", emoji: "🍳" }],
  });

  await page.goto(`/trends?range=week&end=${d(6)}`);
  const section = page.getByTestId("trends-balance");
  await expect(
    section.getByRole("heading", { name: "Most and least nutritious", exact: true }),
  ).toBeVisible();
  const best = section.getByRole("list", { name: "Most nutritious" });
  const worst = section.getByRole("list", { name: "Least nutritious" });
  await expect(best.getByRole("listitem")).toHaveCount(3);
  await expect(best.getByRole("link").nth(0)).toContainText("Lentil stew");
  await expect(best.getByRole("link").nth(1)).toContainText("Bean salad");
  await expect(best.getByRole("link").nth(2)).toContainText("Oats with berries");
  await expect(worst.getByRole("link").nth(0)).toContainText("Cream pastry");
  await expect(worst.getByRole("link").nth(1)).toContainText("Party platter");
  await expect(worst.getByRole("link").nth(2)).toContainText("Crisps");
  await expect(
    best.getByRole("img", { name: "Balance score 100 of 100, well balanced" }),
  ).toBeVisible();
  await expect(worst.getByRole("link").nth(0)).toContainText(
    "Saturated fat 2.5× its share; twice a usual snack",
  );
  await expect(worst.getByRole("link").nth(0)).toContainText("Snack · 500 kcal");
  await expect(section.getByTestId("balance-counts")).toHaveText("7 meals judged.");
  await expect(section).not.toContainText("Smoothie");
  await expectAccessible(page);

  // All time adds the fry-up from before the week, now the least nutritious.
  await section.getByRole("radio", { name: "All time" }).click();
  await expect(section.getByRole("radio", { name: "All time" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(worst.getByRole("link").nth(0)).toContainText("Fry-up");
  await expect(section.getByTestId("balance-counts")).toHaveText("8 meals judged.");

  // How it is worked out, in plain words.
  await section.getByRole("button", { name: "How it is worked out" }).click();
  const how = page.getByRole("dialog", { name: "How the balance score is worked out" });
  await expect(how).toContainText("Nutrient Rich Foods index (NRF9.3) of Drewnowski and Fulgoni");
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(how).toBeHidden();

  // A row opens the meal; its page shows the score, the rows and the share sentence.
  await section.getByRole("radio", { name: "This period" }).click();
  await best.getByRole("link").nth(0).click();
  await expect(page).toHaveURL(new RegExp(`/meals/${lentils}$`));
  const card = page.getByTestId("meal-balance");
  await expect(card.getByRole("heading", { name: "Balance 100 of 100" })).toBeVisible();
  await expect(card.getByTestId("balance-reason")).toHaveText(
    "Plenty of protein, fiber and vitamin A; little saturated fat. Right size for a lunch (30% of your day).",
  );
  const rows = card.getByRole("list", { name: "Nutrients against this meal's share" });
  await expect(rows.getByRole("listitem")).toHaveCount(12);
  await expect(rows.getByRole("listitem").first()).toHaveText(/Protein\s*15 g of 15 g\s*met/);
  await expect(rows.getByRole("listitem").last()).toHaveText(
    /Sodium\s*345 mg, limit 690 mg\s*within/,
  );
  await expect(card.getByTestId("balance-shares")).toHaveText(
    "Shares are this meal's part of your daily targets: 600 kcal of 2,000 kcal is 30%, so its protein share is 30% of 50 g.",
  );
  await expectAccessible(page);
});
