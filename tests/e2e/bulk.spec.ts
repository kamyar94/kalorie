// "Add photos" end to end (phone, desktop, phone-dark) with axe (boards 44 to 47): from Today on
// yesterday, photos made by a script with made-up EXIF times are read on the device and grouped
// into meals (by time, the cap of 3, a photo with no time joining the one it looks like, one with
// no time on its own); a note and a changed time; two photos selected and moved with "Move to…";
// a drag onto a full meal refused and a drag to New meal (the mouse on the desktop, touch and
// hold on the phones); "Add 7 meals" through the upload queue to the cards of that day, each
// meal analysed once; and the camera's Gallery with more than 3 photos opening the same screen.
// Board 48 to 50: "+ Add" on a meal (with photos that do not fit starting a new meal), "More
// photos" for the batch (an edited meal only gains photos), a tap opening the photo larger
// (next, previous, Escape), touch and hold making it the cover (Undo, and sent first), the
// viewer's "Make it the cover" and "Select", and the circle that selects.
import { expect, test, type Locator, type Page } from "@playwright/test";

import { dayHeading } from "../../lib/bulk/times";
import { expectAccessible, holdOn, installE2eHooks, localDay, pool, signUp } from "./helpers";
import { exifTime, fixtureFiles, type FixturePhoto } from "./fixture-photos";

installE2eHooks();

/** Board 45's day (made-up foods and colours), and two photos with no time taken. */
const dayOfPhotos = (day: string): FixturePhoto[] => [
  { name: "oats", colours: ["#5b4a2e", "#a88a54"], takenAt: exifTime(day, "08:12") },
  {
    name: "coffee",
    colours: ["#3b2a20", "#7a5a40"],
    shape: "ring",
    takenAt: exifTime(day, "08:14"),
  },
  { name: "salad", colours: ["#2f4a2a", "#6f9a4a"], takenAt: exifTime(day, "12:47") },
  { name: "rice", colours: ["#4a4436", "#a39a7c"], shape: "bar", takenAt: exifTime(day, "12:48") },
  { name: "lemon", colours: ["#4a4a1e", "#b3a93a"], takenAt: exifTime(day, "12:51") },
  { name: "apple", colours: ["#4a1e1e", "#a8433a"], takenAt: exifTime(day, "16:05") },
  { name: "pasta", colours: ["#4a2e1e", "#b0663a"], takenAt: exifTime(day, "19:52") },
  { name: "bread", colours: ["#4a3a22", "#a3804a"], shape: "bar", takenAt: exifTime(day, "19:53") },
  {
    name: "juice",
    colours: ["#3a1e2a", "#7a3a55"],
    shape: "ring",
    takenAt: exifTime(day, "19:58"),
  },
  // No time: the same picture as the apple, so it joins that meal.
  { name: "apple again", colours: ["#4a1e1e", "#a8433a"] },
  // No time and like nothing else: a meal of its own at 12:00 of the day.
  { name: "soup", colours: ["#1e2f4a", "#5a86c8"], shape: "ring" },
];

const screenOf = (page: Page) => page.getByRole("dialog", { name: /^Add \d+ photos?$/ });
const mealOf = (screen: Locator, n: number) =>
  screen.getByRole("region", { name: `Meal ${n}`, exact: true });
const chipOf = (screen: Locator, n: number) =>
  mealOf(screen, n).getByRole("button", { name: new RegExp(`^Change the time of meal ${n}:`) });
const photoName = (time: string) =>
  new RegExp(`^Photo \\d(, the cover)?, taken ${time}: open it larger$`);
const photoAt = (screen: Locator, time: string) =>
  screen.getByRole("button", { name: photoName(time) });
/** The circle on the photo's corner that selects it. */
const selectAt = (screen: Locator, time: string) =>
  screen
    .getByRole("listitem")
    // The inner locator is looked up inside each list item.
    .filter({ has: screen.page().getByRole("button", { name: photoName(time) }) })
    .getByRole("button", { name: /^Select photo \d$/ });

/** The meals on the screen: each one's photo count and its chip. */
const mealsShown = async (screen: Locator) => {
  const cards = screen.getByTestId("bulk-meal");
  const shown: string[] = [];
  for (let i = 0; i < (await cards.count()); i++) {
    const card = cards.nth(i);
    shown.push(
      `${await card.getByTestId("bulk-meal-count").innerText()} | ${await card
        .getByRole("button", { name: /^Change the time/ })
        .innerText()}`,
    );
  }
  return shown;
};

const centre = async (locator: Locator, dy = 0) => {
  const box = (await locator.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 60) + dy };
};

/** Drags a photo onto a target: the mouse on the desktop, touch and hold on a phone. */
const dragTo = async (page: Page, project: string, photo: Locator, target: Locator) => {
  // The photo's meal at the top of the list, so the target sits away from the scrolling edges.
  await photo.evaluate((el) => el.closest("section")!.scrollIntoView({ block: "start" }));
  const from = await centre(photo);
  const to = await centre(target, 10);
  const ghost = screenOf(page).getByTestId("bulk-ghost");
  if (project === "desktop") {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 12, from.y + 12, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await expect(ghost).toBeVisible();
    await page.mouse.up();
  } else {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, point?: { x: number; y: number }) =>
      cdp.send("Input.dispatchTouchEvent", {
        type: type as "touchStart",
        touchPoints: point ? [{ x: Math.round(point.x), y: Math.round(point.y) }] : [],
      });
    await touch("touchStart", from);
    // Touch and hold to lift it (a shorter touch opens it larger, a swipe scrolls).
    await page.waitForTimeout(700);
    for (let i = 1; i <= 12; i++)
      await touch("touchMove", {
        x: from.x + ((to.x - from.x) * i) / 12,
        y: from.y + ((to.y - from.y) * i) / 12,
      });
    await expect(ghost).toBeVisible();
    await touch("touchEnd");
    await cdp.detach();
  }
  await expect(ghost).toBeHidden();
};

test("add photos from Today: meals found, a note and a time, Move to, drags, Add meals", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const day = localDay(-1);
  await page.goto(`/today?date=${day}`);
  await expect(page.getByRole("heading", { level: 1, name: "Yesterday" })).toBeVisible();
  // "What should I eat?" is for now; "Add photos" is on every day.
  await expect(page.getByTestId("suggest-open")).toHaveCount(0);

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add photos" }).click();
  await (await chooser).setFiles(await fixtureFiles(dayOfPhotos(day)));

  const screen = screenOf(page);
  await expect(screen).toHaveAttribute("data-phase", "sorting", { timeout: 30_000 });
  await expect(screen.getByRole("heading", { level: 1, name: "Add 11 photos" })).toBeVisible();
  await expect(screen.getByTestId("bulk-found")).toHaveText("5 meals found");
  await expect(
    screen.getByRole("heading", { level: 2, name: dayHeading(day, localDay(0)) }),
  ).toBeVisible();
  expect(await mealsShown(screen)).toEqual([
    "2 of 3 photos | 08:12 · Breakfast",
    "1 of 3 photos | 12:00 · Lunch",
    "3 of 3 photos · full | 12:47 · Lunch",
    "2 of 3 photos | 16:05 · Snack",
    "3 of 3 photos · full | 19:52 · Dinner",
  ]);
  // The photo with no time: on its own at 12:00 of the day, with the check; the apple's twin
  // joined the apple.
  await expect(mealOf(screen, 2)).toContainText(
    "No time on this photo, so the meal starts at 12:00 of this day. Check the time.",
  );
  await expect(
    mealOf(screen, 4).getByRole("button", { name: "Photo 2, no time taken: open it larger" }),
  ).toBeVisible();
  await expectAccessible(page);

  // A note, and a time.
  await mealOf(screen, 1).getByLabel("Note for meal 1").fill("Oats with banana, a coffee");
  await mealOf(screen, 5).getByLabel("Note for meal 5").fill("Pasta with tomato");
  await chipOf(screen, 2).click();
  const when = page.getByRole("dialog", { name: "When did you eat meal 2?" });
  await expect(when).toContainText("No time on this photo");
  await when.getByLabel("Time").fill("10:05");
  await expectAccessible(page);
  await when.getByRole("button", { name: "Done" }).click();
  await expect(when).toBeHidden();
  // The meal name follows the time; the check is gone.
  await expect(chipOf(screen, 2)).toHaveText("10:05 · Breakfast");
  await expect(chipOf(screen, 2)).toBeFocused();
  await expect(mealOf(screen, 2)).not.toContainText("No time on this photo");

  // Select two photos of the full lunch (the circles) and move them to a new meal with Move to.
  await selectAt(screen, "12:48").click();
  await selectAt(screen, "12:51").click();
  await expect(selectAt(screen, "12:48")).toHaveAttribute("aria-pressed", "true");
  const bar = screen.getByRole("group", { name: "2 photos selected" });
  await expect(bar).toContainText("2 selected");
  await bar.getByRole("button", { name: "Move to…" }).click();
  const moveSheet = page.getByRole("dialog", { name: "Move 2 photos to" });
  const targets = moveSheet.getByTestId("move-targets");
  await expect(targets.getByRole("button", { name: /^Meal 1 / })).toBeDisabled();
  await expect(targets.getByRole("button", { name: /^Meal 1 / })).toContainText(
    "08:12 · Breakfast · 2 of 3 photos: room for 1",
  );
  await expect(targets.getByRole("button", { name: /^Meal 2 / })).toBeEnabled();
  // The lunch itself is not offered (both photos are in it).
  await expect(targets.getByRole("button", { name: /^Meal 3 / })).toHaveCount(0);
  await expect(targets.getByRole("button", { name: /^Meal 5 / })).toContainText("full");
  await expect(targets.getByRole("button", { name: /^Meal 5 / })).toBeDisabled();
  await expectAccessible(page);
  await targets.getByRole("button", { name: "A new meal" }).click();
  await expect(moveSheet).toBeHidden();
  await expect(bar).toBeHidden();
  await expect(screen.getByTestId("bulk-found")).toHaveText("6 meals");
  expect(await mealsShown(screen)).toEqual([
    "2 of 3 photos | 08:12 · Breakfast",
    "1 of 3 photos | 10:05 · Breakfast",
    "1 of 3 photos | 12:47 · Lunch",
    "2 of 3 photos | 12:48 · Lunch",
    "2 of 3 photos | 16:05 · Snack",
    "3 of 3 photos · full | 19:52 · Dinner",
  ]);
  await expect(photoAt(screen, "12:48")).toBeFocused();

  // A drag onto the full dinner is refused with the board's message; nothing moves.
  await dragTo(page, info.project.name, photoAt(screen, "16:05"), mealOf(screen, 6));
  await expect(screen.getByTestId("bulk-notice")).toHaveText(
    "Meal 6 already has 3 photos. Drop on another meal or on New meal.",
  );
  expect((await mealsShown(screen))[4]).toBe("2 of 3 photos | 16:05 · Snack");

  // A drag to New meal makes the juice a meal of its own.
  await dragTo(
    page,
    info.project.name,
    photoAt(screen, "19:58"),
    screen.getByTestId("bulk-new-meal"),
  );
  await expect(screen.getByTestId("bulk-found")).toHaveText("7 meals");
  expect((await mealsShown(screen)).slice(5)).toEqual([
    "2 of 3 photos | 19:52 · Dinner",
    "1 of 3 photos | 19:58 · Dinner",
  ]);
  await expect(mealOf(screen, 6).getByLabel("Note for meal 6")).toHaveValue("Pasta with tomato");

  if (info.project.name === "desktop") {
    // Escape puts a lifted photo back.
    await photoAt(screen, "08:14").scrollIntoViewIfNeeded();
    const from = await centre(photoAt(screen, "08:14"));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 80, { steps: 5 });
    await expect(screen.getByTestId("bulk-ghost")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(screen.getByTestId("bulk-ghost")).toBeHidden();
    await page.mouse.up();
    await expect(screen).toBeVisible();
    await expect(selectAt(screen, "08:14")).toHaveAttribute("aria-pressed", "false");
  }
  await expectAccessible(page);

  // Add the meals: each goes through the upload queue, then the day shows them.
  await screen.getByRole("button", { name: "Add 7 meals" }).click();
  await expect(page).toHaveURL(new RegExp(`/today\\?date=${day}$`));
  await expect(screen).toBeHidden({ timeout: 30_000 });
  const cards = page.locator("article[data-meal-id]");
  await expect(cards).toHaveCount(7);
  await expect(cards.locator(".tabular")).toHaveText([
    "08:12",
    "10:05",
    "12:47",
    "12:48",
    "16:05",
    "19:52",
    "19:58",
  ]);
  for (const card of await cards.all())
    await expect(card).toHaveAttribute("data-state", /^(queued|analysing|failed)$/);
  await expectAccessible(page);

  const rows = await pool().query<{
    local_time: string;
    note: string | null;
    photos: number;
    jobs: number;
  }>(
    `select to_char(m.eaten_at at time zone m.tz, 'HH24:MI') as local_time, m.note,
            (select count(*)::int from meal_photos p where p.meal_id = m.id) as photos,
            (select count(*)::int from jobs j where j.payload->>'mealId' = m.id::text) as jobs
       from meals m where m.user_id = $1 and m.local_date = $2 and m.deleted_at is null
      order by m.eaten_at`,
    [userId, day],
  );
  expect(rows.rows).toEqual([
    { local_time: "08:12", note: "Oats with banana, a coffee", photos: 2, jobs: 1 },
    { local_time: "10:05", note: null, photos: 1, jobs: 1 },
    { local_time: "12:47", note: null, photos: 1, jobs: 1 },
    { local_time: "12:48", note: null, photos: 2, jobs: 1 },
    { local_time: "16:05", note: null, photos: 2, jobs: 1 },
    { local_time: "19:52", note: "Pasta with tomato", photos: 2, jobs: 1 },
    { local_time: "19:58", note: null, photos: 1, jobs: 1 },
  ]);
});

test("the camera's Gallery with more than 3 photos opens Add photos", async ({ page }, info) => {
  await signUp(page, info.project.name);
  const day = localDay(-2);
  await page.getByRole("button", { name: "Open the camera" }).click();
  const camera = page.getByRole("dialog", { name: "Camera" });
  await camera
    .getByTestId("gallery-input")
    .setInputFiles(await fixtureFiles(dayOfPhotos(day).slice(0, 4)));
  const offer = camera.getByTestId("too-many-photos");
  await expect(offer).toContainText(
    "You picked 4 photos. Sort them into meals, or pick up to 3 for this meal.",
  );
  await expect(offer.getByRole("button", { name: "Sort them into meals" })).toBeFocused();
  await expectAccessible(page);
  await offer.getByRole("button", { name: "Sort them into meals" }).click();
  await expect(camera).toBeHidden();

  const screen = screenOf(page);
  await expect(screen).toHaveAttribute("data-phase", "sorting", { timeout: 30_000 });
  await expect(screen.getByText("Add 4 photos")).toBeVisible();
  expect(await mealsShown(screen)).toEqual([
    "2 of 3 photos | 08:12 · Breakfast",
    "2 of 3 photos | 12:47 · Lunch",
  ]);
  await expectAccessible(page);

  // Closing asks first; nothing is added.
  await screen.getByRole("button", { name: "Close", exact: true }).first().click();
  const confirm = page.getByRole("dialog", { name: "Close without adding the meals?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Keep sorting" }).click();
  await expect(confirm).toBeHidden();
  await expect(screen).toBeVisible();
  await page.keyboard.press("Escape");
  await confirm.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(screen).toBeHidden();
  await expect(page.locator("article[data-meal-id]")).toHaveCount(0);
});

test("more photos while sorting: + Add with a new meal after it, More photos, the photo larger, hold for the cover", async ({
  page,
}, info) => {
  const project = info.project.name;
  const userId = await signUp(page, project);
  const day = localDay(-1);
  await page.goto(`/today?date=${day}`);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add photos" }).click();
  await (
    await chooser
  ).setFiles(
    await fixtureFiles(
      dayOfPhotos(day).filter((p) => ["oats", "coffee", "salad", "apple"].includes(p.name)),
    ),
  );

  const screen = screenOf(page);
  await expect(screen).toHaveAttribute("data-phase", "sorting", { timeout: 30_000 });
  await expect(screen.getByTestId("bulk-found")).toHaveText("3 meals found");
  await expect(screen.getByTestId("bulk-total")).toHaveText(" · 4 of 30 photos");
  await expect(screen).toContainText(
    "Tap a photo to see it larger. Touch and hold it to make it the meal’s cover, or hold and move to drag it. Tap the circle to select photos.",
  );
  await expectAccessible(page);

  // + Add on the breakfast (room for one): the oldest goes in, the other two start a meal after it.
  const more = page.waitForEvent("filechooser");
  await mealOf(screen, 1)
    .getByRole("button", { name: "Add photos to meal 1 from the gallery" })
    .click();
  await (
    await more
  ).setFiles(
    await fixtureFiles([
      {
        name: "tea",
        colours: ["#2a3a1e", "#7a9a4a"],
        shape: "ring",
        takenAt: exifTime(day, "08:25"),
      },
      { name: "banana", colours: ["#4a4416", "#b8a838"], takenAt: exifTime(day, "08:16") },
      {
        name: "toast",
        colours: ["#4a3a22", "#a3804a"],
        shape: "bar",
        takenAt: exifTime(day, "08:20"),
      },
    ]),
  );
  await expect(screen.getByTestId("bulk-said")).toHaveText(
    "1 photo added to Meal 1 (08:12). 2 did not fit, so they start a new meal after it: Meal 2.",
  );
  expect(await mealsShown(screen)).toEqual([
    "3 of 3 photos · full | 08:12 · Breakfast",
    "2 of 3 photos | 08:20 · Breakfast",
    "1 of 3 photos | 12:47 · Lunch",
    "1 of 3 photos | 16:05 · Snack",
  ]);
  // A full meal has no + Add.
  await expect(mealOf(screen, 1).getByTestId("bulk-meal-add")).toHaveCount(0);
  await expect(mealOf(screen, 2).getByTestId("bulk-meal-add")).toBeVisible();
  await expect(screen.getByRole("heading", { level: 1, name: "Add 7 photos" })).toBeVisible();
  await expect(screen.getByTestId("bulk-found")).toHaveText("4 meals");

  // A note makes the lunch an edited meal; More photos then only adds to it.
  await mealOf(screen, 3).getByLabel("Note for meal 3").fill("Salad with lemon");
  const batch = page.waitForEvent("filechooser");
  await screen.getByRole("button", { name: "More photos" }).click();
  await (
    await batch
  ).setFiles(
    await fixtureFiles([
      // Four minutes after the salad: joins the lunch. Portrait, to find it in the database.
      {
        name: "lemon",
        colours: ["#4a4a1e", "#b3a93a"],
        takenAt: exifTime(day, "12:51"),
        portrait: true,
      },
      { name: "apple again", colours: ["#4a1e1e", "#a8433a"], takenAt: exifTime(day, "16:07") },
      {
        name: "soup",
        colours: ["#1e2f4a", "#5a86c8"],
        shape: "ring",
        takenAt: exifTime(day, "19:30"),
      },
    ]),
  );
  await expect(screen.getByTestId("bulk-said")).toHaveText(
    "3 photos sorted: 2 joined meals already here, 1 started a new meal.",
  );
  expect(await mealsShown(screen)).toEqual([
    "3 of 3 photos · full | 08:12 · Breakfast",
    "2 of 3 photos | 08:20 · Breakfast",
    "2 of 3 photos | 12:47 · Lunch",
    "2 of 3 photos | 16:05 · Snack",
    "1 of 3 photos | 19:30 · Dinner",
  ]);
  await expect(mealOf(screen, 3).getByLabel("Note for meal 3")).toHaveValue("Salad with lemon");
  await expect(screen.getByTestId("bulk-total")).toHaveText(" · 10 of 30 photos");
  await expectAccessible(page);

  // A tap opens the photo larger: next, previous with the arrow key, Escape back to the photo.
  await photoAt(screen, "12:47").click();
  const viewer = page.getByTestId("photo-viewer");
  await expect(viewer.getByRole("heading", { name: "Photo 1 of 2" })).toBeVisible();
  await expect(viewer).toContainText("Lunch · taken 12:47");
  await expect(viewer.getByRole("img", { name: "Photo 1 of 2, taken at 12:47" })).toBeVisible();
  // The cover has no "Make it the cover".
  await expect(viewer.getByRole("button", { name: "Make it the cover" })).toHaveCount(0);
  await expectAccessible(page);
  await viewer.getByRole("button", { name: "Next photo" }).click();
  await expect(viewer.getByRole("heading", { name: "Photo 2 of 2" })).toBeVisible();
  await expect(viewer).toContainText("Lunch · taken 12:51");
  await expect(viewer.getByRole("button", { name: "Make it the cover" })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByRole("heading", { name: "Photo 1 of 2" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(screen).toBeVisible();
  await expect(photoAt(screen, "12:47")).toBeFocused();

  // Touch and hold (press and hold) the lemon: the ring fills, then it is the cover, with Undo.
  await holdOn(page, project, photoAt(screen, "12:51"), {
    during: async () => {
      await expect(screen.getByTestId("hold-ring")).toHaveAttribute("data-held", "true");
    },
  });
  await expect(screen.getByTestId("bulk-said")).toContainText("Cover changed.");
  await expect(
    mealOf(screen, 3).getByRole("button", {
      name: "Photo 1, the cover, taken 12:51: open it larger",
    }),
  ).toBeVisible();
  await expect(viewer).toBeHidden();
  await screen.getByTestId("bulk-said").getByRole("button", { name: "Undo" }).click();
  await expect(screen.getByTestId("bulk-said")).toHaveText("The cover is as it was.");
  await expect(
    mealOf(screen, 3).getByRole("button", {
      name: "Photo 1, the cover, taken 12:47: open it larger",
    }),
  ).toBeVisible();

  // The viewer's "Make it the cover" does the same without a gesture.
  await photoAt(screen, "12:51").click();
  await viewer.getByRole("button", { name: "Make it the cover" }).click();
  await expect(viewer.getByTestId("photo-viewer-status")).toContainText("Cover changed.");
  await expect(viewer.getByRole("heading", { name: "Photo 1 of 2" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Make it the cover" })).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Select" })).toBeFocused();
  // "Select" there selects the photo.
  await viewer.getByRole("button", { name: "Select" }).click();
  await expect(viewer.getByRole("button", { name: "Select" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expectAccessible(page);
  await viewer.getByRole("button", { name: "Close" }).click();
  await expect(viewer).toBeHidden();
  await expect(selectAt(screen, "12:51")).toHaveAttribute("aria-pressed", "true");

  // The circle selects; on a computer Shift-click on the photo adds to the selection too.
  await selectAt(screen, "08:14").click();
  await expect(screen.getByRole("group", { name: "2 photos selected" })).toBeVisible();
  if (project === "desktop") {
    await photoAt(screen, "16:05").click({ modifiers: ["Shift"] });
    await expect(screen.getByRole("group", { name: "3 photos selected" })).toBeVisible();
    await expect(viewer).toBeHidden();
  }
  await screen.getByRole("button", { name: "Clear the selection" }).click();
  await expect(screen.getByTestId("bulk-selection")).toHaveCount(0);

  // Add: the lunch's first photo is the lemon (the cover is sent first).
  await screen.getByRole("button", { name: "Add 5 meals" }).click();
  await expect(screen).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("article[data-meal-id]")).toHaveCount(5);
  const rows = await pool().query<{
    local_time: string;
    note: string | null;
    photos: number;
    portrait: boolean;
  }>(
    `select to_char(m.eaten_at at time zone m.tz, 'HH24:MI') as local_time, m.note,
            (select count(*)::int from meal_photos p where p.meal_id = m.id) as photos,
            (select p.width < p.height from meal_photos p where p.meal_id = m.id
              order by p.position limit 1) as portrait
       from meals m where m.user_id = $1 and m.local_date = $2 and m.deleted_at is null
      order by m.eaten_at`,
    [userId, day],
  );
  expect(rows.rows).toEqual([
    { local_time: "08:12", note: null, photos: 3, portrait: false },
    { local_time: "08:20", note: null, photos: 2, portrait: false },
    { local_time: "12:47", note: "Salad with lemon", photos: 2, portrait: true },
    { local_time: "16:05", note: null, photos: 2, portrait: false },
    { local_time: "19:30", note: null, photos: 1, portrait: false },
  ]);
});
