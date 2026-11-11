// Move end to end (phone, desktop, phone-dark): "+ Activity" with its energy estimate, the list
// and its details with Remove, importing a Samsung Health zip read in the browser (a second import
// updates instead of copying), and a CSV of an unknown layout through the column mapping.
import { expect, test } from "@playwright/test";

import { exerciseCsv, pedometerCsv, samsungFileName, samsungZip } from "../helpers/samsung-export";
import { expectAccessible, installE2eHooks, localDay, pool, signUp, zone } from "./helpers";

installE2eHooks();

test("move: + Activity, a Samsung Health zip imported twice, and a CSV with its columns chosen", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  await pool().query("update users set weight_kg = 80 where id = $1", [userId]);

  await page.goto("/move");
  await expect(page.getByRole("heading", { level: 1, name: "Move" })).toBeVisible();
  await expect(page.getByText(/^This week, /)).toBeVisible();
  await expectAccessible(page);

  // + Activity: a run of 30 minutes, about 320 kcal at 80 kg.
  await page.getByRole("button", { name: "Add an activity" }).click();
  const sheet = page.getByRole("dialog", { name: "Add an activity" });
  await sheet.getByLabel("What did you do?").selectOption("run");
  await sheet.getByLabel("Minutes").fill("30");
  await expect(sheet.getByRole("radio", { name: "Vigorous" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(sheet.getByTestId("activity-estimate")).toHaveText(
    "About 320 kcal (an estimate from your weight).",
  );
  await expectAccessible(page);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Running added" })).toBeVisible();
  const list = page.getByTestId("activity-list");
  await expect(list.getByTestId("activity")).toHaveCount(1);
  await expect(list).toContainText("Running");
  await expect(list).toContainText("30 min");
  await expect(list).toContainText("~320 kcal");

  // A Samsung Health export, read on this device.
  const zip = samsungZip({
    [samsungFileName("tracker.pedometer_day_summary")]: pedometerCsv([
      { date: localDay(-2), steps: 6240 },
      { date: localDay(-1), steps: 8900 },
    ]),
    [samsungFileName("exercise", "health")]: exerciseCsv([
      {
        uuid: "e2e-cycle",
        start: new Date(`${localDay(-1)}T08:00:00Z`),
        minutes: 40,
        type: 11007,
        kcal: 300,
      },
    ]),
  });
  await page.getByRole("link", { name: "Import Samsung Health file" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Import a file" })).toBeVisible();
  const pick = page.getByTestId("import-input");
  await pick.setInputFiles({ name: "export.zip", mimeType: "application/zip", buffer: zip });
  const found = page.getByTestId("import-datasets");
  await expect(found).toContainText("Steps: 2 days");
  await expect(found).toContainText("Workouts: 1 session");
  await expect(found).toContainText("from Samsung Health");
  await expectAccessible(page);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("import-result")).toHaveText(["2 added", "1 added"]);

  // The same file again updates the records it brought.
  await pick.setInputFiles({ name: "export.zip", mimeType: "application/zip", buffer: zip });
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("import-result")).toHaveText([
    "0 added, 2 already there, updated",
    "0 added, 1 already there, updated",
  ]);
  const imported = await pool().query(
    "select count(*)::int as n from activities where user_id = $1 and source = 'import'",
    [userId],
  );
  expect(imported.rows[0].n).toBe(3);

  // A CSV Kal does not know: choose its columns.
  await pick.setInputFiles({
    name: "watch.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`Day,Total steps\n${localDay(-3)},7000\n`),
  });
  await page.getByRole("button", { name: "Choose the columns" }).click();
  const mapping = page.getByRole("dialog", { name: "Choose the columns" });
  await expect(mapping.getByLabel("What does the file hold?")).toHaveValue("steps");
  await expect(mapping.getByTestId("mapping-preview")).toContainText("7,000 steps");
  await expectAccessible(page);
  await mapping.getByRole("button", { name: "Use 1 row" }).click();
  await expect(found).toContainText("Steps: 1 day");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("import-result")).toHaveText(["1 added"]);

  // Back on Move: everything in the list; the details of one, and Remove.
  await page.getByRole("link", { name: "See Move" }).click();
  await expect(list.getByTestId("activity")).toHaveCount(5);
  await expect(list).toContainText("imported from Samsung Health");
  await expect(list).toContainText("8,900");
  await list.getByRole("button", { name: /Running/ }).click();
  const details = page.getByRole("dialog", { name: "Running" });
  await expect(details).toContainText("320 kcal (an estimate)");
  await expectAccessible(page);
  await details.getByRole("button", { name: "Remove" }).click();
  await expect(details).toBeHidden();
  await expect(list.getByTestId("activity")).toHaveCount(4);
  await expect(list).not.toContainText("Running");
});

test("move: level, streak, the week by category and badges; Today's Move card", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const add = (date: string, values: Record<string, unknown>) =>
    pool().query(
      `insert into activities (user_id, category, type, title, started_at, tz, local_date,
         duration_min, intensity, steps, source, source_app, external_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        userId,
        values.category,
        values.type,
        values.title,
        new Date(`${date}T07:30:00Z`),
        zone(),
        date,
        values.durationMin ?? null,
        values.intensity ?? null,
        values.steps ?? null,
        values.source ?? "manual",
        values.sourceApp ?? null,
        values.externalId ?? null,
      ],
    );
  await add(localDay(0), {
    category: "strength",
    type: "weights",
    title: "Full body A",
    durationMin: 45,
    intensity: "moderate",
    source: "opengym",
    externalId: "e2e-gym",
  });
  await add(localDay(0), {
    category: "walking",
    type: "steps",
    title: "Steps",
    steps: 6240,
    source: "import",
    sourceApp: "samsung-health",
    externalId: `samsung:steps:${localDay(0)}`,
  });
  await add(localDay(-1), { category: "walking", type: "steps", title: "Steps", steps: 10_400 });
  await add(localDay(-2), {
    category: "cardio",
    type: "run",
    title: "Running",
    durationMin: 30,
    intensity: "vigorous",
  });

  // Today: 45 min of strength from openGym, imported steps, 90 points.
  await page.goto("/today");
  const card = page.getByTestId("move-card");
  await expect(card.getByTestId("move-minutes")).toHaveText("45 minStrength, openGym");
  await expect(card.getByTestId("move-steps")).toHaveText("6,240Steps, imported");
  await expect(card.getByTestId("move-points")).toHaveText("+90Points today");
  await expectAccessible(page);

  // Move: 90 + 50 + 60 = 200 points, level 2, a 3-day streak, badges.
  await card.getByRole("link", { name: "Details" }).click();
  await expect(page).toHaveURL(/\/move$/);
  await expect(page.getByTestId("move-level")).toHaveText("Level 2 · 200 points");
  await expect(page.getByText("250 points to level 3")).toBeVisible();
  await expect(page.getByTestId("move-streak")).toHaveText("3-day streak");
  await expect(page.getByRole("progressbar", { name: "Progress to level 3" })).toHaveAttribute(
    "aria-valuenow",
    "200",
  );
  const week = page.getByTestId("week-rows");
  await expect(week).toContainText("Strength1 of 2 days");
  const badges = page.getByTestId("badges");
  for (const code of ["first_workout", "streak_3", "steps_10k"])
    await expect(badges.locator(`[data-badge="${code}"]`)).toHaveAttribute("data-earned", "true");
  const locked = badges.locator('[data-badge="streak_30"]');
  await expect(locked).toHaveAttribute("data-earned", "false");
  await expect(locked).toContainText("locked: Be active 30 days in a row");
  await expectAccessible(page);
});
