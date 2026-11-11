// Navigation end to end (phone, desktop, phone-dark): Today, Move, the camera, Body and More in
// that order (the bar on phones, the rail on wide screens); More holds Trends, Add food,
// Favorites, Medicines, Plan, Kal for Android, Settings and Admin; the old addresses still open and show More as
// the current place.
import { expect, test } from "@playwright/test";

import { expectAccessible, installE2eHooks, signUp } from "./helpers";

installE2eHooks();

test("navigation: Today, Move, the camera, Body and More; More holds the rest", async ({
  page,
}, info) => {
  await signUp(page, info.project.name, true);
  const nav = page.getByRole("navigation", { name: "Main" });
  const items = nav.locator(":scope > ul > li");
  await expect(items).toHaveCount(5);
  await expect(items.nth(0).getByRole("link")).toHaveAccessibleName("Today");
  await expect(items.nth(1).getByRole("link")).toHaveAccessibleName("Move");
  await expect(items.nth(2).getByRole("button")).toHaveAccessibleName("Open the camera");
  await expect(items.nth(3).getByRole("link")).toHaveAccessibleName("Body");
  await expect(items.nth(4).getByRole("link")).toHaveAccessibleName("More");
  await expect(nav.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  const camera = nav.getByRole("button", { name: "Open the camera" });
  const box = (await camera.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(56);

  // The camera opens on its Meal tab, from any page.
  await nav.getByRole("link", { name: "Move" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Move" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Move" })).toHaveAttribute("aria-current", "page");
  await camera.click();
  const dialog = page.getByRole("dialog", { name: "Camera" });
  await expect(dialog.getByRole("tab", { name: "Meal" })).toHaveAttribute("aria-selected", "true");
  await dialog.getByRole("button", { name: "Close the camera" }).click();
  await expect(dialog).toBeHidden();

  await nav.getByRole("link", { name: "Body" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Body" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Body" })).toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: "More" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "More" })).toBeVisible();
  const more = page.getByTestId("more-list").getByRole("link");
  await expect(more).toHaveText([
    /^Trends/,
    /^Add food/,
    /^Favorites/,
    /^Medicines/,
    /^Plan meals/,
    /^Kal for Android/,
    /^Settings/,
    /^Admin/,
  ]);
  await expectAccessible(page);

  // Every place in More opens, with More as the current place; old addresses keep working.
  for (const [name, heading] of [
    [/^Trends/, "Trends"],
    [/^Add food/, "Add food"],
    [/^Favorites/, "Favorites"],
    [/^Medicines/, "Medicines"],
    [/^Plan meals/, "Plan meals"],
    [/^Kal for Android/, "Kal for Android"],
    [/^Settings/, "Settings"],
    [/^Admin/, "Admin"],
  ] as const) {
    await page.goto("/more");
    await more.filter({ hasText: name }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(nav.getByRole("link", { name: "More" })).toHaveAttribute("aria-current", "page");
  }
});
