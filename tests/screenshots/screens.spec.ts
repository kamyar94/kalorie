// The README's screenshots (playwright.screenshots.config.ts; `pnpm run screenshots`). Each
// project signs up a demo person, fills the account with made-up data (demo-data.ts), sends one
// photo meal through the app (tests/fixtures/meal.jpg, analysed by the mock provider) and saves
// its screens to docs/screenshots/ as WebP: phones in light and dark, Trends on a desktop.
import crypto from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";
import sharp from "sharp";

import { runCommand } from "../../scripts/cal.mjs";
import { shiftLocalDate } from "../../lib/meals/time";
import { installE2eHooks, pool } from "../e2e/helpers";

import { addTodayDinner, PHOTO_ANALYSIS, seedDemo } from "./demo-data";

installE2eHooks();

const OUT = path.resolve("docs", "screenshots");
const APK_DIR = path.resolve("test-results", "e2e-android");
const PASSWORD = "demo password that is long";

/** Today in UTC, the zone the browser runs in. */
const todayUtc = () => new Date().toISOString().slice(0, 10);

const control = async (route: string, body: unknown) => {
  const { url } = JSON.parse(
    await readFile(path.join("test-results", "e2e-mocks.json"), "utf8"),
  ) as { url: string };
  const response = await fetch(`${url}/__control${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
};

const signUpDemo = async (page: Page, project: string) => {
  const { code } = await runCommand(pool(), ["invite", "--note", "demo"], () => undefined);
  const username = `demo_${project.replace(/\W/g, "")}`;
  await page.goto(`/invite?code=${encodeURIComponent(code)}`);
  await page.getByLabel("Your name").fill("Demo");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Password again").fill(PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page).toHaveURL(/\/today$/);
  const row = await pool().query("select id from users where username = $1", [username]);
  return row.rows[0].id as string;
};

/** Waits for fonts, images and finite animations, then saves the viewport as WebP. */
const shoot = async (page: Page, name: string) => {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].filter((i) => !i.complete).map((i) => i.decode().catch(() => null)),
    );
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => null)),
    );
  });
  const png = await page.screenshot({ animations: "disabled", caret: "hide" });
  await mkdir(OUT, { recursive: true });
  const webp = await sharp(png).webp({ quality: 82, effort: 6, smartSubsample: true }).toBuffer();
  await writeFile(path.join(OUT, `${name}.webp`), webp);
};

/** Scrolls so the element sits at the top of the screen, with a little room above it. */
const scrollToTop = (element: Locator) =>
  element.evaluate((el) => {
    el.scrollIntoView({ block: "start" });
    window.scrollBy(0, -16);
  });

/** A made-up release of the Android app for the server to describe (not a real APK). */
const putRelease = async () => {
  const apk = crypto.randomBytes(Math.round(3.6 * 1024 * 1024));
  await mkdir(APK_DIR, { recursive: true });
  await writeFile(path.join(APK_DIR, "kal.apk"), apk);
  await writeFile(
    path.join(APK_DIR, "version.json"),
    JSON.stringify({
      versionName: "1.0",
      versionCode: 1,
      size: apk.length,
      sha256: crypto.createHash("sha256").update(apk).digest("hex"),
      minSdk: 24,
      targetSdk: 37,
    }),
  );
};

const removeRelease = async () => {
  await rm(path.join(APK_DIR, "kal.apk"), { force: true });
  await rm(path.join(APK_DIR, "version.json"), { force: true });
};

test.afterAll(removeRelease);

test("screenshots", async ({ page }, info) => {
  const project = info.project.name;
  const theme = project.endsWith("dark") ? "dark" : "light";
  const desktop = project.startsWith("desktop");
  const today = todayUtc();
  // The install hint is not part of the screens.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("cal.install-hint.dismissed", "1");
    } catch {
      // Private mode: the hint may show.
    }
  });

  const userId = await signUpDemo(page, project);
  const { energyTarget } = await seedDemo(pool(), userId, today);

  // Trends: the year, and on phones yesterday's summary open too.
  const yearShots = async (name: string) => {
    await page.goto("/trends");
    const card = page.getByRole("region", { name: "Your year" });
    await expect(card.getByRole("grid")).toBeVisible();
    await shoot(page, name);
    if (desktop) return;
    const day = today.endsWith("-01-01") ? today : shiftLocalDate(today, -1);
    await page.locator(`[data-year-date="${day}"]`).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await shoot(page, name.replace("trends-", "trends-day-"));
  };

  if (desktop) {
    await addTodayDinner(pool(), userId, today, energyTarget);
    await yearShots("desktop-trends-light");
    return;
  }

  // The photo meal: an AI key (the mock provider), the photo from the camera, the analysis.
  await page.goto("/settings");
  const google = page.locator('li[data-provider="google"]');
  await google.getByLabel("Google (Gemini) API key").fill("demo-mock-key-0123456789");
  await google.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("key-state-google")).toHaveText(/Saved key/);
  await control("/google/analysis", { analysis: PHOTO_ANALYSIS });
  await page.goto("/today");
  await page.getByRole("button", { name: "Open the camera" }).click();
  const camera = page.getByRole("dialog", { name: "Camera" });
  await camera.getByTestId("capture-input").setInputFiles("tests/fixtures/meal.jpg");
  await camera.getByRole("button", { name: "Send meal with 1 photo" }).click();
  await expect(camera).toBeHidden();
  await expect
    .poll(
      async () =>
        (
          await pool().query("select status from meals where user_id = $1 and source = 'photo'", [
            userId,
          ])
        ).rows[0]?.status,
      { timeout: 60_000 },
    )
    .toMatch(/^(ready|needs_input)$/);
  const photo = await pool().query<{ id: string }>(
    `update meals set eaten_at = $2, local_date = $3, tz = 'UTC'
     where user_id = $1 and source = 'photo' returning id`,
    [userId, new Date(`${today}T13:10:00Z`), today],
  );
  const photoMealId = photo.rows[0]!.id;
  await addTodayDinner(pool(), userId, today, energyTarget);

  // Today.
  await page.goto("/today");
  await expect(page.locator(`article[data-meal-id="${photoMealId}"]`)).toBeVisible();
  await shoot(page, `today-${theme}`);
  await scrollToTop(page.locator("#favorites-heading"));
  await shoot(page, `today-meals-${theme}`);

  // The photo meal's page: the photo, then its question, the sentence field and the items.
  await page.goto(`/meals/${photoMealId}`);
  await expect(page.getByRole("heading", { name: PHOTO_ANALYSIS.title })).toBeVisible();
  await shoot(page, `meal-${theme}`);
  await scrollToTop(page.locator("#questions-heading"));
  await shoot(page, `meal-details-${theme}`);

  // The camera in words, with a time chosen with the When chip.
  await page.goto("/today");
  await page.getByRole("button", { name: "Open the camera" }).click();
  await expect(camera).toBeVisible();
  await camera.getByTestId("when-chip").click();
  const when = page.getByRole("dialog", { name: "When did you eat this?" });
  await when.getByLabel("Date").fill(shiftLocalDate(today, -1));
  await when.getByLabel("Time").fill("08:15");
  await when.getByRole("button", { name: "Done" }).click();
  await expect(when).toBeHidden();
  await camera.getByRole("button", { name: /^Type/ }).click();
  await camera
    .getByRole("textbox", { name: "What did you eat?" })
    .fill("Two boiled eggs, cucumber, a tomato and a cup of black tea");
  await shoot(page, `camera-text-${theme}`);
  await camera.getByRole("button", { name: "Close the camera" }).click();
  await expect(camera).toBeHidden();

  // Move, Body, Trends, Medicines.
  await page.goto("/move");
  await expect(page.getByRole("heading", { level: 1, name: "Move" })).toBeVisible();
  await shoot(page, `move-${theme}`);

  await page.goto("/body");
  await expect(page.getByRole("heading", { level: 1, name: "Body" })).toBeVisible();
  await shoot(page, `body-${theme}`);

  await yearShots(`trends-${theme}`);

  await page.goto("/medicines");
  await expect(page.getByRole("heading", { level: 1, name: "Medicines" })).toBeVisible();
  await shoot(page, `medicines-${theme}`);

  // Kal for Android with a made-up release and the linked phone.
  await putRelease();
  await page.goto("/more/android");
  await expect(page.getByRole("heading", { level: 1, name: "Kal for Android" })).toBeVisible();
  await expect(page.getByTestId("android-phone")).toBeVisible();
  await shoot(page, `android-${theme}`);
  await removeRelease();
});
