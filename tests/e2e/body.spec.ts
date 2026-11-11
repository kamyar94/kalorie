// Body end to end (phone, desktop, phone-dark): logging measurements with where to measure and a
// part of one's own, the health profile (goal, height, allergies, "use in analysis"), changes since
// an earlier day judged from the goal, a Renpho export read in the browser, removing a weigh-in;
// and body photos with the camera's Body tab (pose outline, self-timer, Skip, gallery) compared
// with an earlier day.
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { expectAccessible, installE2eHooks, localDay, pool, signUp, zone } from "./helpers";

installE2eHooks();

const RENPHO = (days: number[]) =>
  [
    "Time of Measurement,Weight(lb),BMI,Body Fat(%),Body Water(%),Muscle Mass(lb),Visceral Fat,BMR(kcal)",
    ...days.map((d, i) => {
      const [y, m, day] = localDay(d).split("-");
      return `"${m}/${day}/${y}, 7:${10 + i}:00 AM",${(185 - 2 * i).toFixed(1)},24.1,25.${i},55.2,130.2,9,1700`;
    }),
  ].join("\n");

test("body: log measurements, the health profile, changes judged from the goal, a Renpho import", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);

  await page.goto("/body");
  await expect(page.getByRole("heading", { level: 1, name: "Body" })).toBeVisible();
  await expect(page.getByTestId("body-goal")).toHaveText(
    "No goal yet: set it in your health profile.",
  );
  await expectAccessible(page);

  // An older day, as if logged 40 days ago.
  await pool().query(
    `insert into body_measurements (user_id, code, unit, value, measured_at, tz, local_date,
       source, external_id)
     select $1, code, unit, value, $2, $3, $4::date, 'manual', $4::text || ':' || code
     from (values ('weight', 'kg', 84.0), ('waist', 'cm', 96.0), ('hips', 'cm', 108.0),
                  ('body_fat', '%', 27.0)) as v(code, unit, value)`,
    [userId, new Date(`${localDay(-40)}T12:00:00Z`), zone(), localDay(-40)],
  );

  // Log measurements: scale, tape with its hint, left and right, a part of one's own.
  await page.getByRole("link", { name: "Log measurements" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Log measurements" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Date: today. Change the date" })).toBeVisible();
  await expect(page.getByLabel("Weight, kg")).toHaveAttribute("placeholder", "last 84");
  await page.getByLabel("Weight, kg").fill("82.4");
  await page.getByLabel("Body fat, %").fill("25.5");
  const waist = page.getByLabel("Waist, cm");
  await waist.fill("93");
  await expect(page.getByText("At the navel, relaxed, breathing out")).toBeVisible();
  await page.getByLabel("Hips, cm").fill("106");
  await page.getByLabel("Upper arm, right, cm").fill("38");
  await page.getByRole("button", { name: /More parts/ }).click();
  await page.getByRole("button", { name: "Add a part" }).click();
  await page.getByLabel("Name of the part").fill("Arm span");
  await page.getByLabel("Arm span, cm").fill("181");
  await expectAccessible(page);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/body$/);
  await expect(page.getByRole("status").filter({ hasText: "6 measurements saved" })).toBeVisible();
  await expect(page.getByTestId("body-weight")).toHaveText("82.4 kg");
  // No goal yet: weight and sizes are "changed", fat and the waist are judged anyway.
  const table = page.getByTestId("measurements");
  await expect(table.getByRole("row", { name: /Waist 93 cm/ })).toContainText("−3 · better");
  await expect(table.getByRole("row", { name: /Hips/ })).toContainText("−2 · changed");
  await expect(table.getByRole("row", { name: /Arm span/ })).toContainText("181 cm");

  // The health profile: a goal and a height; allergies kept private until the switch is on.
  await page.getByRole("link", { name: /Health profile/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Health profile" })).toBeVisible();
  await page.getByLabel("Height, cm").fill("180");
  await page.getByLabel("Goal", { exact: true }).selectOption("lose");
  await page.getByLabel("How fast").selectOption("0.5");
  await page.getByLabel("Allergies and intolerances").fill("peanuts");
  const share = page.getByRole("switch", { name: "Use in meal analysis" });
  await expect(share).toHaveAttribute("aria-checked", "false");
  await expectAccessible(page);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Health profile saved" })).toBeVisible();
  const saved = await pool().query(
    "select h.allergies, h.use_in_analysis, u.goal, u.height_cm from health_profiles h join users u on u.id = h.user_id where h.user_id = $1",
    [userId],
  );
  expect(saved.rows[0]).toEqual({
    allergies: "peanuts",
    use_in_analysis: false,
    goal: "lose",
    height_cm: 180,
  });

  // Back on Body: judged from the goal now.
  await page.getByRole("link", { name: "Back to Body" }).click();
  await expect(page.getByTestId("body-goal")).toHaveText("Goal: lose about 0.5 kg a week");
  await expect(page.getByTestId("body-weight-change")).toContainText(
    "1.6 kg down in 40 days · better",
  );
  await expect(table.getByRole("row", { name: /Hips/ })).toContainText("−2 · better");
  await expect(table.getByRole("row", { name: /Waist to height/ })).toContainText("0.52");
  await expect(page.getByTestId("composition")).toContainText("−1.5 · better");
  await expectAccessible(page);

  // A Renpho export (pounds), read on this device.
  await page.getByRole("link", { name: "Import a Renpho or Samsung Health file" }).click();
  await page.getByTestId("import-input").setInputFiles({
    name: "renpho.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(RENPHO([-20, -10])),
  });
  await expect(page.getByTestId("import-datasets")).toContainText(
    "Weight and body composition: 2 weigh-ins",
  );
  await expect(page.getByTestId("import-datasets")).toContainText("from Renpho");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("import-result")).toHaveText(["14 added"]);
  await page.getByRole("link", { name: "See Body" }).click();

  // Every weigh-in, newest first, from both sources; remove the Renpho one of 10 days ago.
  await page.getByText(/All weigh-ins/).click();
  const history = page.getByTestId("weight-history");
  await expect(history.getByRole("listitem")).toHaveCount(4);
  await expect(history.getByRole("listitem").nth(1)).toContainText("Renpho");
  await expect(history.getByRole("listitem").nth(1)).toContainText("83 kg");
  await expectAccessible(page);
  await history.getByRole("listitem").nth(1).getByRole("button").click();
  await expect(history.getByRole("listitem")).toHaveCount(3);
});

test("body photos: the camera's Body tab with a pose outline, self-timer and Skip; two days compared", async ({
  page,
  baseURL,
}, info) => {
  const userId = await signUp(page, info.project.name);

  // An earlier set, sent the way the camera sends it.
  const fixture = readFileSync("tests/fixtures/meal.jpg");
  for (const pose of ["front", "back"]) {
    const response = await page.request.post("/api/body-photos", {
      headers: { origin: baseURL! },
      multipart: {
        photo: { name: `${pose}.jpg`, mimeType: "image/jpeg", buffer: fixture },
        pose,
        takenAt: new Date(`${localDay(-30)}T09:00:00`).toISOString(),
        tz: zone(),
        source: "gallery",
      },
    });
    expect(response.status()).toBe(201);
  }

  await page.goto("/body");
  const photos = page.getByRole("region", { name: "Photos" });
  await expect(photos.getByTestId("body-photo-compare").getByRole("figure")).toHaveCount(1);
  await photos.getByRole("button", { name: "Take today's 4 photos" }).click();

  const camera = page.getByRole("dialog", { name: "Camera" });
  await expect(page.getByTestId("camera")).toHaveAttribute("data-camera-state", "live");
  await expect(camera.getByRole("tab", { name: "Body" })).toHaveAttribute("aria-selected", "true");
  await expect(camera.getByTestId("body-pose")).toHaveText("Front · 1 of 4");
  await expect(camera.getByTestId("pose-guide")).toHaveAttribute("data-pose", "front");
  await expect(camera).toContainText("Stand about 2 m away");
  await expect(camera).toContainText(
    "Body photos stay on your own server, visible only to you, and are never sent to an AI.",
  );

  // The self-timer goes off, 3 s, 10 s and back; 3 s for the front photo.
  const timer = camera.getByRole("button", { name: /^Self-timer/ });
  await expect(timer).toHaveAccessibleName("Self-timer: off. Change it");
  await timer.click();
  await expect(timer).toHaveAccessibleName("Self-timer: 3 seconds. Change it");
  await camera.getByRole("button", { name: "Take the front photo" }).click();
  await expect(camera.getByTestId("body-countdown")).toBeVisible();
  await expect(camera.getByTestId("body-pose")).toHaveText("Left · 2 of 4", { timeout: 8000 });
  await expect(camera.getByTestId("pose-guide")).toHaveAttribute("data-pose", "left");
  await timer.click();
  await timer.click();
  await expect(timer).toHaveAccessibleName("Self-timer: off. Change it");

  // Left at once, Back skipped, Right from the gallery.
  await camera.getByRole("button", { name: "Take the left photo" }).click();
  await expect(camera.getByTestId("body-pose")).toHaveText("Back · 3 of 4");
  await camera.getByRole("button", { name: "Skip the back photo" }).click();
  await expect(camera.getByTestId("body-pose")).toHaveText("Right · 4 of 4");
  await expect(camera.getByRole("list", { name: "Poses" })).toContainText("Back, skipped");
  await camera.getByTestId("gallery-input").setInputFiles("tests/fixtures/meal.jpg");

  // All four done: Body shows today's set next to the earlier one.
  await expect(camera).toBeHidden();
  await expect(page).toHaveURL(/\/body$/);
  await expect(page.getByRole("status").filter({ hasText: "3 body photos saved" })).toContainText(
    "1 pose skipped.",
  );
  const compare = photos.getByTestId("body-photo-compare");
  await expect(compare.getByRole("figure")).toHaveCount(2);
  await expect(compare.getByRole("img", { name: /^Front photo, / })).toHaveCount(2);
  await expectAccessible(page);
  await photos.getByRole("radio", { name: "Left" }).click();
  await expect(compare).toContainText("No left photo that day");
  await expect(compare.getByRole("img", { name: /^Left photo, / })).toHaveCount(1);
  await photos.getByRole("radio", { name: "Back" }).click();
  await expect(compare.getByRole("img", { name: /^Back photo, / })).toHaveCount(1);

  const stored = await pool().query(
    `select s.local_date::text as day, p.pose, p.source, p.width from body_photos p
       join body_photo_sessions s on s.id = p.session_id where p.user_id = $1
      order by s.local_date, p.pose`,
    [userId],
  );
  expect(stored.rows.map((r) => [r.day, r.pose, r.source])).toEqual([
    [localDay(-30), "back", "gallery"],
    [localDay(-30), "front", "gallery"],
    [localDay(0), "front", "camera"],
    [localDay(0), "left", "camera"],
    [localDay(0), "right", "gallery"],
  ]);

  // Remove the earlier back photo.
  await compare.getByRole("button", { name: /^Remove the back photo of / }).click();
  await expect(compare.getByRole("img", { name: /^Back photo, / })).toHaveCount(0);
});
