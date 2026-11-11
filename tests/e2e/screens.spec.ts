// End-to-end tests of the screens at phone and desktop sizes (and the phone in dark mode), with
// Chromium's fake camera: capture three photos, the offline queue, editing an item, answering a
// question (the analysis is stubbed by writing the meal straight into the database), a barcode
// add (BarcodeDetector mocked), saving an AI key, and an admin invite. Assertions use the DOM
// and the accessibility tree only.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";

import { runCommand } from "../../scripts/cal.mjs";

const PASSWORD = "e2e password that is long";
let pool: pg.Pool;

test.beforeAll(() => {
  pool = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL, max: 2 });
});
test.afterAll(async () => {
  await pool.end();
});

// Browser errors (a CSP violation shows up here) fail the test, except the ones a test expects.
const errors: string[] = [];
let allowedErrors: RegExp | null = null;
test.beforeEach(({ page }) => {
  errors.length = 0;
  allowedErrors = null;
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(() => {
  expect(errors.filter((e) => !allowedErrors?.test(e))).toEqual([]);
});

/**
 * Phone first: nothing may be wider than the screen (no sideways page scroll), and the fixed
 * navigation bar is no wider than the screen either (it stretches with the page when something
 * overflows, and phones then zoom the whole app out).
 */
const expectNoSidewaysScroll = async (page: Page) => {
  const sizes = await page.evaluate(() => {
    const root = document.documentElement;
    const nav = document.querySelector('nav[aria-label="Main"]');
    return {
      overflow: root.scrollWidth - root.clientWidth,
      navOverflow: nav ? nav.getBoundingClientRect().width - root.clientWidth : 0,
    };
  });
  expect(sizes.overflow, "page wider than the screen").toBeLessThanOrEqual(0);
  expect(sizes.navOverflow, "navigation wider than the screen").toBeLessThanOrEqual(0);
};

const expectAccessible = async (page: Page) => {
  // Colours are checked once fades and transitions have finished (spinners run forever).
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => null)),
    ),
  );
  await expectNoSidewaysScroll(page);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.flatMap((v) =>
      v.nodes.map(
        (n) => `${v.id} ${n.target.join(" ")}: ${n.failureSummary?.replace(/\s+/g, " ")}`,
      ),
    ),
  ).toEqual([]);
};

let counter = 0;
/** A new account through an invite; returns its id. */
const signUp = async (page: Page, project: string, admin = false) => {
  const args = ["invite", "--note", "e2e", ...(admin ? ["--admin"] : [])];
  const { code } = await runCommand(pool, args, () => undefined);
  const username = `s_${project.replace(/\W/g, "")}_${Date.now().toString(36)}${counter++}`;
  await page.goto(`/invite?code=${encodeURIComponent(code)}`);
  await page.getByLabel("Your name").fill(admin ? "Admin Person" : "Test Person");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Password again").fill(PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page).toHaveURL(/\/today$/);
  const row = await pool.query("select id from users where username = $1", [username]);
  return row.rows[0].id as string;
};

const food = async (values: {
  name: string;
  energy: number;
  barcode?: string;
  portions?: [string, number][];
}) => {
  const { rows } = await pool.query(
    `insert into foods (source, kind, name_en, nutrients, search_text, barcode)
     values ('fdc_sr_legacy', $1, $2, $3, $4, $5) returning id`,
    [
      values.barcode ? "packaged" : "food",
      values.name,
      JSON.stringify({ energy: values.energy, protein: 3, carbs: 20, fat: 1 }),
      values.name.toLowerCase(),
      values.barcode ?? null,
    ],
  );
  const id = rows[0].id as string;
  for (const [i, [label, grams]] of (values.portions ?? []).entries())
    await pool.query(
      "insert into food_portions (food_id, label, grams, position) values ($1, $2, $3, $4)",
      [id, label, grams, i],
    );
  return id;
};

/** A meal written straight into the database, as the analysis would leave it. */
const meal = async (
  userId: string,
  values: {
    status: string;
    title: string;
    questions?: unknown[];
    source?: string;
    /** Adds a photo row (no file), so the meal can be analysed again. */
    photo?: boolean;
  },
) => {
  const now = new Date();
  // The browser runs in this machine's time zone, so "today" is the same day for both.
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const { rows } = await pool.query(
    `insert into meals (user_id, eaten_at, tz, local_date, slot, title, status, source, questions)
     values ($1, $2, $8, $3, 'lunch', $4, $5, $6, $7) returning id`,
    [
      userId,
      now,
      local,
      values.title,
      values.status,
      values.source ?? "photo",
      JSON.stringify(values.questions ?? []),
      zone,
    ],
  );
  const id = rows[0].id as string;
  if (values.photo)
    await pool.query(
      `insert into meal_photos (meal_id, user_id, position, original_path, analysis_path,
         thumb_path, width, height, bytes, sha256)
       values ($1, $2, 0, 'none/o.jpg', 'none/a.jpg', 'none/t.jpg', 10, 10, 10, $3)`,
      [id, userId, "0".repeat(64)],
    );
  return id;
};

/** A meal the server has: waiting for the worker, being analysed, or already finished. */
const SERVER_CARD =
  'article[data-state="queued"], article[data-state="analysing"], article[data-state="failed"]';

const openCamera = async (page: Page) => {
  await page.getByRole("button", { name: "Open the camera" }).click();
  const camera = page.getByRole("dialog", { name: "Camera" });
  await expect(camera).toBeVisible();
  await expect(page.getByTestId("camera")).toHaveAttribute("data-camera-state", "live");
  return camera;
};

const photosInStrip = (page: Page) =>
  page.getByRole("list", { name: "Photos of this meal" }).getByRole("listitem");

test("capture three photos with the in-app camera, with a note", async ({ page }, info) => {
  const userId = await signUp(page, info.project.name);
  await expectAccessible(page);
  const camera = await openCamera(page);

  const shutter = camera.getByRole("button", { name: "Take photo" });
  for (let n = 1; n <= 3; n++) {
    await shutter.click();
    await expect(photosInStrip(page)).toHaveCount(n);
  }
  await expect(
    camera.getByRole("button", { name: "Three photos taken, the most for one meal" }),
  ).toBeDisabled();

  // Tap a thumbnail to remove it, then take another one.
  await camera.getByRole("button", { name: "Remove photo 2" }).click();
  await expect(photosInStrip(page)).toHaveCount(2);
  await camera.getByRole("button", { name: "Take photo" }).click();
  await expect(photosInStrip(page)).toHaveCount(3);

  // A tap on the note button types; holding it would dictate.
  await camera.getByRole("button", { name: /^Note:/ }).click();
  await camera.getByRole("textbox", { name: "Note about the meal" }).fill("ate half");
  await camera.getByRole("button", { name: "Done" }).click();
  await expect(page.getByTestId("capture-note")).toHaveText("ate half");

  await camera.getByRole("button", { name: "Send meal with 3 photos" }).click();
  await expect(camera).toBeHidden();
  // No AI key in this account: the worker may already have stopped the analysis with a message.
  const card = page.locator(SERVER_CARD);
  await expect(card).toHaveCount(1);

  const stored = await pool.query(
    `select m.note, count(p.id)::int as photos from meals m join meal_photos p on p.meal_id = m.id
     where m.user_id = $1 group by m.id`,
    [userId],
  );
  expect(stored.rows).toEqual([{ note: "ate half", photos: 3 }]);
  await expectAccessible(page);
});

/**
 * The live picture is on screen: the video plays the camera stream, and the middle of the
 * viewfinder is not a white sheet (the shutter flash once stayed white after a second open).
 */
const expectLiveViewfinder = async (page: Page) => {
  await expect(page.getByTestId("camera")).toHaveAttribute("data-camera-state", "live");
  await expect
    .poll(() =>
      page.getByTestId("camera").evaluate((root) => {
        const video = root.querySelector("video");
        return !!video && video.srcObject instanceof MediaStream && !video.paused
          ? video.srcObject.getVideoTracks()[0]?.readyState
          : "none";
      }),
    )
    .toBe("live");
  // The shutter flash lasts 160 ms; after that the middle of the screen shows the camera.
  await page.waitForTimeout(400);
  const viewport = page.viewportSize()!;
  const shot = await page.screenshot({
    clip: {
      x: viewport.width / 2 - 40,
      y: viewport.height / 2 - 40,
      width: 80,
      height: 80,
    },
  });
  const { default: sharp } = await import("sharp");
  const { channels } = await sharp(shot).stats();
  const brightness = channels.slice(0, 3).reduce((sum, c) => sum + c.mean, 0) / 3;
  expect(brightness, "the viewfinder is white").toBeLessThan(235);
};

test("camera: send a meal, open the camera again, and it is live for the next meal", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  let camera = await openCamera(page);
  await expectLiveViewfinder(page);
  await camera.getByRole("button", { name: "Take photo" }).click();
  await expect(photosInStrip(page)).toHaveCount(1);
  await expectLiveViewfinder(page);
  await camera.getByRole("button", { name: "Send meal with 1 photo" }).click();
  await expect(camera).toBeHidden();
  await expect(page.locator(SERVER_CARD)).toHaveCount(1);

  // The next meal: the camera opens live again, without a white screen.
  camera = await openCamera(page);
  await expectLiveViewfinder(page);
  await expect(photosInStrip(page)).toHaveCount(0);
  await camera.getByRole("button", { name: "Take photo" }).click();
  await expect(photosInStrip(page)).toHaveCount(1);
  await expectLiveViewfinder(page);
  await camera.getByRole("button", { name: "Send meal with 1 photo" }).click();
  await expect(camera).toBeHidden();
  await expect(page.locator(SERVER_CARD)).toHaveCount(2);
  await expect
    .poll(
      async () =>
        (await pool.query("select count(*)::int as n from meals where user_id = $1", [userId]))
          .rows[0]?.n,
    )
    .toBe(2);

  // Closed and opened again right away: live again.
  camera = await openCamera(page);
  await page.keyboard.press("Escape");
  await expect(camera).toBeHidden();
  camera = await openCamera(page);
  await expectLiveViewfinder(page);
  await page.keyboard.press("Escape");
  await expect(camera).toBeHidden();
});

/** The browser's local day, shifted by some days (it runs in this machine's time zone). */
const localDay = (days = 0) => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const day = new Date(`${today}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
};

test("a meal in words: Type, a time yesterday, Send; the meal page shows the words and moves it", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const camera = await openCamera(page);

  // The When chip opens the time sheet over the camera; Yesterday is the same clock time.
  await camera.getByRole("button", { name: "When: now. Change the time" }).click();
  const sheet = page.getByRole("dialog", { name: "When did you eat this?" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Now" })).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByLabel("Date")).toHaveValue(localDay());
  await expectAccessible(page);
  await sheet.getByRole("button", { name: "Yesterday" }).click();
  await expect(sheet.getByRole("button", { name: "Yesterday" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(sheet.getByLabel("Date")).toHaveValue(localDay(-1));
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
  const chip = camera.getByTestId("when-chip");
  // Focus goes back to the chip that opened the sheet.
  await expect(chip).toBeFocused();
  await expect(chip).toHaveAccessibleName(/^When: yesterday at \d\d:\d\d\. Change the time$/);
  await expect(chip).toHaveText(/^Yesterday, \d\d:\d\d$/);

  // Type: the camera stops and a text field takes its place; Photo brings the camera back.
  await camera.getByRole("button", { name: /^Type/ }).click();
  await expect(page.getByTestId("camera")).toHaveAttribute("data-camera-state", "off");
  await expect(page.getByTestId("camera").locator("video")).toHaveCount(0);
  await camera.getByRole("button", { name: "Photo", exact: true }).click();
  await expectLiveViewfinder(page);
  await camera.getByRole("button", { name: /^Type/ }).click();
  const words = camera.getByRole("textbox", { name: "What did you eat?" });
  await expect(words).toBeFocused();
  await expect(
    camera.getByRole("button", { name: "Send meal (take a photo or type what you ate first)" }),
  ).toBeDisabled();
  await words.fill("Two fried eggs, a slice of toast with butter and a mug of tea");
  await expectAccessible(page);
  await camera.getByRole("button", { name: "Send the meal (text only)" }).click();
  await expect(camera).toBeHidden();

  // The meal lands on yesterday, without a photo.
  await expect(page).toHaveURL(new RegExp(`/today\\?date=${localDay(-1)}$`));
  const card = page.locator(SERVER_CARD);
  await expect(card).toHaveCount(1);
  const stored = await pool.query(
    `select m.source, m.note, m.local_date::text as day,
       (select count(*) from meal_photos p where p.meal_id = m.id)::int as photos
     from meals m where m.user_id = $1`,
    [userId],
  );
  expect(stored.rows).toEqual([
    {
      source: "text",
      note: "Two fried eggs, a slice of toast with butter and a mug of tea",
      day: localDay(-1),
      photos: 0,
    },
  ]);

  await card.locator(`a[href^="/meals/"]`).click();
  await expect(page.getByRole("region", { name: "What you wrote" })).toContainText(
    "Two fried eggs, a slice of toast",
  );
  await expectAccessible(page);

  // Time moves the meal: Now puts it on today.
  await page.getByRole("button", { name: "Time" }).click();
  const when = page.getByRole("dialog", { name: "When did you eat this?" });
  await when.getByRole("button", { name: "Now" }).click();
  await when.getByRole("button", { name: "Done" }).click();
  await expect(when).toBeHidden();
  await expect(page.getByText(/^Today · \d\d:\d\d/)).toBeVisible();
  const moved = await pool.query("select local_date::text as day from meals where user_id = $1", [
    userId,
  ]);
  expect(moved.rows[0].day).toBe(localDay());
});

test("food emojis: the plate of a meal without a photo, its food line and the item tiles", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const mealId = await meal(userId, { status: "ready", title: "Rice plate", source: "text" });
  await pool.query(
    `insert into meal_items (meal_id, user_id, position, name, kind, emoji, grams, nutrients)
     values ($1, $2, 0, 'Rice, white, cooked', 'dish', '🍚', 180, '{"energy":232}'),
            ($1, $2, 1, 'Chicken breast, roasted', 'ingredient', null, 120, '{"energy":198}'),
            ($1, $2, 2, 'Mixed green salad', 'dish', '🥗', 90, '{"energy":18}')`,
    [mealId, userId],
  );
  await pool.query(
    `update meals set totals = '{"energy":448,"protein":42}',
       note = 'Rice with roast chicken and a salad' where id = $1`,
    [mealId],
  );

  await page.goto("/today");
  const card = page.locator(`article[data-meal-id="${mealId}"]`);
  await expect(
    card.getByRole("img", { name: "Plate with rice, chicken breast and mixed green salad" }),
  ).toBeVisible();
  await expect(card.getByTestId("meal-foods")).toHaveText(
    "🍚 Rice · 🍗 Chicken breast · 🥗 Mixed green salad",
  );
  await expectAccessible(page);

  await page.goto(`/meals/${mealId}`);
  await expect(
    page.getByTestId("plate-header").getByRole("img", { name: /^Plate with rice, chicken/ }),
  ).toBeVisible();
  await expect(page.getByTestId("item-emoji")).toHaveText(["🍚", "🍗", "🥗"]);
  await expect(page.getByRole("button", { name: /^Rice, white, cooked/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "What you wrote" })).toContainText("roast chicken");
  await expectAccessible(page);
});

test("water: a glass from Today and undo, a bottle on an earlier day, the goal in Settings", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const water = page.getByRole("region", { name: "Water" });
  const total = water.getByTestId("water-total");
  await expect(total).toHaveText("0 of 1.8 L");
  await expect(water).toContainText("From the drinks in your meals. Alcohol does not count.");
  await expect(water.getByRole("progressbar", { name: "Water today" })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await expectAccessible(page);

  await water.getByRole("button", { name: "+ Glass, 250 ml" }).click();
  await expect(total).toHaveText("0.25 of 1.8 L");
  await expect(water.getByRole("progressbar", { name: "Water today" })).toHaveAttribute(
    "aria-valuenow",
    "250",
  );
  const card = page.locator("article[data-meal-id]");
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("meal-water")).toHaveText("+250 ml water");
  await expect(card.getByRole("img", { name: "Plate with water" })).toBeVisible();
  await expect(card.getByTestId("meal-foods")).toContainText("💧 Water");
  await expectAccessible(page);
  const logged = await pool.query(
    `select i.name, i.kind, i.ml, i.emoji, (i.nutrients->>'energy')::float as kcal
     from meal_items i join meals m on m.id = i.meal_id where m.user_id = $1`,
    [userId],
  );
  expect(logged.rows).toEqual([{ name: "Water", kind: "drink", ml: 250, emoji: "💧", kcal: 0 }]);

  // Undo takes it back.
  await page
    .getByRole("status")
    .filter({ hasText: "250 ml of water logged" })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(total).toHaveText("0 of 1.8 L");
  await expect(card).toHaveCount(0);

  // On an earlier day the water is logged at 12:00 of that day.
  await page.goto(`/today?date=${localDay(-1)}`);
  await water.getByRole("button", { name: "+ Bottle, 500 ml" }).click();
  await expect(total).toHaveText("0.50 of 1.8 L");
  const bottle = await pool.query(
    `select local_date::text as day, to_char(eaten_at at time zone tz, 'HH24:MI') as time
     from meals where user_id = $1 and deleted_at is null`,
    [userId],
  );
  expect(bottle.rows).toEqual([{ day: localDay(-1), time: "12:00" }]);

  // The goal: the person's own, then back to the standard one.
  await page.goto("/settings");
  const goal = page.getByTestId("water-goal");
  await expect(goal).toContainText("1.8 L");
  await goal.getByRole("button", { name: "Change the water goal" }).click();
  await goal.getByLabel("Water goal in litres").fill("2.5");
  await goal.getByRole("button", { name: "Save" }).click();
  await expect(goal).toContainText("2.5 L");
  await expect(goal).toContainText("set by you");
  await page.goto("/today");
  await expect(total).toHaveText("0 of 2.5 L");
  await page.goto("/settings");
  await goal.getByRole("button", { name: "Reset the water goal" }).click();
  await expect(goal).toContainText("1.8 L");
});

test("meal names: water alone is a Drink, and a name picked by hand stays", async ({
  page,
}, info) => {
  await signUp(page, info.project.name);
  await page
    .getByRole("region", { name: "Water" })
    .getByRole("button", { name: "+ Glass, 250 ml" })
    .click();
  const card = page.locator("article[data-meal-id]");
  await expect(card.locator("p").first()).toHaveText(/^\d\d:\d\d · Drink$/);
  const mealId = (await card.getAttribute("data-meal-id"))!;

  await page.goto(`/meals/${mealId}`);
  await expect(page.getByText(/^Today · \d\d:\d\d · Drink$/)).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  const sheet = page.getByRole("dialog", { name: "Meal details" });
  const names = sheet.getByRole("radiogroup", { name: "Meal" });
  await expect(names.getByRole("radio")).toHaveCount(7);
  await expect(names.getByRole("radio", { name: "Drink" })).toHaveAttribute("aria-checked", "true");
  await expect(sheet).toContainText(
    "Kal names the meal from its food and time until you pick one.",
  );
  await expectAccessible(page);
  await names.getByRole("radio", { name: "Supper" }).click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText(/^Today · \d\d:\d\d · Supper$/)).toBeVisible();

  // Food added now does not rename it.
  const status = await page.evaluate(
    async (id) =>
      (
        await fetch(`/api/meals/${id}/items`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Toast", nutrients: { energy: 300 } }),
        })
      ).status,
    mealId,
  );
  expect(status).toBe(201);
  const row = await pool.query("select slot, slot_locked from meals where id = $1", [mealId]);
  expect(row.rows[0]).toEqual({ slot: "supper", slot_locked: true });
});

test("a camera that never answers: the phone's camera is offered while it starts", async ({
  page,
}, info) => {
  await signUp(page, info.project.name);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise<MediaStream>(() => undefined);
  });
  await page.getByRole("button", { name: "Open the camera" }).click();
  const camera = page.getByRole("dialog", { name: "Camera" });
  await expect(page.getByTestId("camera")).toHaveAttribute("data-camera-state", "starting");
  const fallback = camera.getByRole("button", { name: "Use the phone's camera" });
  await expect(fallback).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await fallback.click();
  await (await chooser).setFiles("tests/fixtures/meal.jpg");
  await expect(photosInStrip(page)).toHaveCount(1);
});

test("a camera without a picture (older phones): Kal gives up and offers the phone's camera", async ({
  page,
}, info) => {
  await signUp(page, info.project.name);
  // A stream whose track never delivers a frame, like a stuck camera driver; count the requests.
  await page.evaluate(() => {
    const w = window as unknown as { cameraRequests: number };
    w.cameraRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      w.cameraRequests += 1;
      return document.createElement("canvas").captureStream(0);
    };
  });
  await page.getByRole("button", { name: "Open the camera" }).click();
  const camera = page.getByRole("dialog", { name: "Camera" });
  await expect(page.getByTestId("camera")).toHaveAttribute("data-camera-state", "unavailable", {
    timeout: 20_000,
  });
  await expect(camera.getByText("The camera did not start")).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { cameraRequests: number }).cameraRequests),
  ).toBe(2);
  await expect(camera.getByRole("button", { name: "Take a photo", exact: true })).toBeFocused();
  await expectAccessible(page);
});

test("offline: the meal waits on the device and uploads when back online", async ({
  page,
  context,
}, info) => {
  const userId = await signUp(page, info.project.name);
  // Requests fail while offline; that is the point of this test.
  allowedErrors = /ERR_INTERNET_DISCONNECTED|Failed to load resource|Failed to fetch/;
  const camera = await openCamera(page);
  await context.setOffline(true);
  await camera.getByRole("button", { name: "Take photo" }).click();
  await expect(photosInStrip(page)).toHaveCount(1);
  await camera.getByRole("button", { name: "Send meal with 1 photo" }).click();

  const waiting = page.locator('article[data-state="waiting"]');
  await expect(waiting).toHaveCount(1);
  await expect(waiting.getByTestId("meal-state")).toHaveText("Waiting to upload");
  await expect(waiting).toContainText("Sends when you are back online.");
  expect((await pool.query("select 1 from meals where user_id = $1", [userId])).rowCount).toBe(0);

  await context.setOffline(false);
  await expect(page.locator(SERVER_CARD)).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(waiting).toHaveCount(0);
  expect((await pool.query("select 1 from meals where user_id = $1", [userId])).rowCount).toBe(1);
});

test("edit an item: grams, a portion and undo; the totals follow", async ({ page }, info) => {
  const userId = await signUp(page, info.project.name);
  const rice = await food({ name: "Rice, white, cooked", energy: 130, portions: [["1 cup", 158]] });
  const mealId = await meal(userId, { status: "ready", title: "Rice plate" });
  await pool.query(
    `insert into meal_items (meal_id, user_id, name, food_id, grams, nutrients, nutrient_source,
       grams_low, grams_high, model_grams)
     values ($1, $2, 'Rice', $3, 200, '{"energy":260,"protein":6,"carbs":40,"fat":2}', 'food',
       150, 260, 200)`,
    [mealId, userId, rice],
  );
  await pool.query(`update meals set totals = '{"energy":260}' where id = $1`, [mealId]);

  await page.goto(`/meals/${mealId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Rice plate" })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: /^Rice/ }).click();
  const sheet = page.getByRole("dialog", { name: "Rice" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("slider", { name: "Grams" })).toHaveAttribute(
    "aria-valuenow",
    "200",
  );

  const grams = sheet.getByRole("textbox", { name: "Grams" });
  await grams.fill("300");
  await grams.press("Enter");
  await expect(sheet.getByTestId("kcal")).toHaveText("390");
  await expect(sheet.getByTestId("save-state")).toHaveText("Saved");

  await sheet.getByRole("button", { name: /^1 cup/ }).click();
  await expect(sheet.getByRole("button", { name: /^1 cup/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(sheet.getByTestId("kcal")).toHaveText("205");
  await expect(sheet.getByTestId("save-state")).toHaveText("Saved");

  await sheet.getByRole("button", { name: "Undo" }).click();
  await expect(sheet.getByTestId("kcal")).toHaveText("390");
  await expect(sheet.getByTestId("save-state")).toHaveText("Saved");
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  await expect(page.getByTestId("item-kcal")).toHaveText("390");
  await expect(page.getByRole("region", { name: "Total" }).getByTestId("kcal")).toHaveText("390");
  const saved = await pool.query("select grams from meal_items where meal_id = $1", [mealId]);
  expect(saved.rows[0].grams).toBe(300);
  // Closing the sheet after changes remembered the correction.
  await expect
    .poll(
      async () =>
        (await pool.query("select count from food_memory where user_id = $1", [userId])).rows[0]
          ?.count,
    )
    .toBe(1);

  await page.goto("/trends");
  await expect(page.getByRole("heading", { level: 1, name: "Trends" })).toBeVisible();
  await expect(page.getByTestId("average-energy")).toHaveText("390");
  await expectAccessible(page);
});

test("answer a question about a meal", async ({ page }, info) => {
  const userId = await signUp(page, info.project.name);
  // The meal's photo row has no file behind it, so its image answers 404.
  allowedErrors = /status of 404/;
  const mealId = await meal(userId, {
    status: "needs_input",
    title: "Kabab",
    photo: true,
    questions: [
      { id: "q1", text: "Was the meat grilled or fried?", answers: ["Grilled", "Fried"] },
    ],
  });
  await page.goto("/today");
  const card = page.locator(`article[data-meal-id="${mealId}"]`);
  await expect(card.getByTestId("meal-state")).toHaveText("Needs an answer");
  await card.getByRole("link", { name: "Kabab" }).click();
  await expect(page).toHaveURL(new RegExp(`/meals/${mealId}$`));

  const question = page.getByRole("group", { name: "Was the meat grilled or fried?" });
  await expectAccessible(page);
  await question.getByRole("button", { name: "Grilled" }).click();
  await expect(question.getByRole("button", { name: "Grilled" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("status").filter({ hasText: "Analysing your photos" })).toBeVisible();

  const row = await pool.query("select questions, status from meals where id = $1", [mealId]);
  expect(["queued", "analysing", "failed"]).toContain(row.rows[0].status);
  expect(row.rows[0].questions[0].answer).toBe("Grilled");
  const job = await pool.query("select payload from jobs where payload->>'mealId' = $1", [mealId]);
  expect(job.rows[0].payload).toMatchObject({ reason: "answer" });
});

test("answer in your own words: the field grows over lines and Answer sits under it", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const mealId = await meal(userId, {
    status: "needs_input",
    title: "Chicken",
    source: "text",
    questions: [
      {
        id: "q1",
        text: "How much of the chicken shown did you eat?",
        answers: ["All of it", "About half"],
      },
    ],
  });
  // A meal in words can be analysed again with the answer.
  await pool.query("update meals set note = 'Chicken drumsticks with rice' where id = $1", [
    mealId,
  ]);
  await page.goto(`/meals/${mealId}`);
  const question = page.getByRole("group", { name: "How much of the chicken shown did you eat?" });
  const field = question.getByRole("textbox", { name: "Or answer in your own words" });
  const send = question.getByRole("button", { name: "Answer" });
  await expect(field).toBeVisible();
  await expect(send).toBeDisabled();
  const oneLine = (await field.boundingBox())!.height;

  // A long answer wraps instead of scrolling sideways; Enter starts a new line, it does not send.
  const long =
    "Two drumsticks, an equal amount to what is in the bowl, and about half of the rice that was left";
  await field.fill(long);
  await field.press("End");
  await field.press("Enter");
  await field.pressSequentially("no sauce");
  await expect(field).toHaveValue(`${long}\nno sauce`);
  const grown = (await field.boundingBox())!;
  expect(grown.height).toBeGreaterThan(oneLine * 1.8);
  expect(await field.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  // At most five lines; Answer is under the field, at its right edge.
  const lineHeight = await field.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
  expect(grown.height).toBeLessThanOrEqual(lineHeight * 5 + 40);
  const button = (await send.boundingBox())!;
  expect(button.y).toBeGreaterThanOrEqual(grown.y + grown.height);
  expect(Math.abs(button.x + button.width - (grown.x + grown.width))).toBeLessThanOrEqual(2);
  expect(
    (await pool.query("select status from meals where id = $1", [mealId])).rows[0].status,
  ).toBe("needs_input");
  await expectAccessible(page);

  await send.click();
  await expect
    .poll(
      async () =>
        (await pool.query("select questions from meals where id = $1", [mealId])).rows[0]
          .questions[0].answer,
    )
    .toBe(`${long} no sauce`);
});

test("meal photos: add from the gallery and the camera, choose the cover, remove one; the items stay", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const mealId = await meal(userId, { status: "ready", title: "Rice plate", source: "text" });
  await pool.query(
    `insert into meal_items (meal_id, user_id, position, name, kind, emoji, grams, nutrients)
     values ($1, $2, 0, 'Rice, white, cooked', 'dish', '🍚', 180, '{"energy":232}')`,
    [mealId, userId],
  );
  await pool.query(
    `update meals set totals = '{"energy":232}', note = 'A plate of rice' where id = $1`,
    [mealId],
  );
  const state = async () =>
    (
      await pool.query(
        `select m.status, m.source, (m.totals->>'energy')::float as kcal,
           (select count(*) from meal_items i where i.meal_id = m.id)::int as items,
           (select count(*) from jobs j where j.payload->>'mealId' = m.id::text)::int as jobs,
           array(select p.id::text from meal_photos p where p.meal_id = m.id order by p.position)
             as photos
         from meals m where m.id = $1`,
        [mealId],
      )
    ).rows[0] as {
      status: string;
      source: string;
      kcal: number;
      items: number;
      jobs: number;
      photos: string[];
    };

  await page.goto(`/meals/${mealId}`);
  const photos = page.getByRole("region", { name: "Photos", exact: true });
  const count = photos.getByTestId("photo-count");
  await expect(count).toHaveText("0 of 3");
  const update = photos.getByRole("switch", { name: "Update items from the photos" });
  await expect(update).toHaveAttribute("aria-checked", "false");
  await expect(photos).toContainText(
    "Off: added or removed photos are kept for the record; items and calories stay as they are.",
  );
  await expectAccessible(page);

  // From the gallery, then with the phone's camera.
  const addFrom = async (choice: "From the gallery" | "Take a photo") => {
    await photos.getByRole("button", { name: "Add a photo" }).click();
    const sheet = page.getByRole("dialog", { name: "Add a photo" });
    const chooser = page.waitForEvent("filechooser");
    await sheet.getByRole("button", { name: choice }).click();
    await (await chooser).setFiles("tests/fixtures/meal.jpg");
    await expect(sheet).toBeHidden();
  };
  await addFrom("From the gallery");
  await expect(count).toHaveText("1 of 3");
  await expect(photos.getByRole("button", { name: "Photo 1, the cover" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await addFrom("Take a photo");
  await expect(count).toHaveText("2 of 3 · tap to choose the cover");
  // Off: only the photos changed.
  let stored = await state();
  expect(stored).toMatchObject({ status: "ready", source: "text", kcal: 232, items: 1, jobs: 0 });
  expect(stored.photos).toHaveLength(2);
  await expect(page.getByTestId("item-kcal")).toHaveText("232");

  // Tap the second photo: it becomes the cover, also on Today's card.
  await photos.getByRole("button", { name: "Photo 2, make it the cover" }).click();
  await expect(photos.getByRole("listitem").first()).toHaveAttribute(
    "data-photo-id",
    stored.photos[1]!,
  );
  await expect(photos.getByRole("button", { name: "Photo 1, the cover" })).toBeVisible();
  expect((await state()).photos).toEqual([stored.photos[1], stored.photos[0]]);
  await expectAccessible(page);
  await page.goto("/today");
  await expect(page.locator(`article[data-meal-id="${mealId}"] img`)).toHaveAttribute(
    "src",
    `/api/photos/${stored.photos[1]}/thumb`,
  );

  // Remove the cover after a confirmation; the other photo moves up, the items stay.
  const [coverId, otherId] = (await state()).photos;
  await page.goto(`/meals/${mealId}`);
  await photos.getByRole("button", { name: "Remove photo 1" }).click();
  const confirm = page.getByRole("dialog", { name: "Remove photo 1?" });
  await expect(confirm).toContainText("The photo is deleted. Items and calories stay as they are.");
  await confirm.getByRole("button", { name: "Remove" }).click();
  await expect(confirm).toBeHidden();
  await expect(count).toHaveText("1 of 3");
  stored = await state();
  expect(stored).toMatchObject({ status: "ready", kcal: 232, items: 1, jobs: 0 });
  expect(stored.photos).toEqual([otherId]);
  expect(coverId).not.toBe(otherId);

  // On: the next change analyses the meal again from its photos.
  await update.click();
  await expect(update).toHaveAttribute("aria-checked", "true");
  await addFrom("From the gallery");
  await expect(count).toHaveText("2 of 3 · tap to choose the cover");
  await expect.poll(async () => (await state()).jobs).toBe(1);
  const job = await pool.query("select payload from jobs where payload->>'mealId' = $1", [mealId]);
  expect(job.rows[0].payload).toMatchObject({ reason: "retry", replaceEdits: false });
});

test("favorites: star a meal, log it again from Today with Undo, on an earlier day, and on the Favorites page", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const mealId = await meal(userId, { status: "ready", title: "Morning coffee" });
  await pool.query(
    `insert into meal_items (meal_id, user_id, position, name, kind, emoji, grams, ml, nutrients)
     values ($1, $2, 0, 'Coffee with milk', 'drink', '☕', 250, 250, '{"energy":40}')`,
    [mealId, userId],
  );
  await pool.query(`update meals set totals = '{"energy":40}' where id = $1`, [mealId]);
  const copies = async () =>
    (
      await pool.query(
        `select local_date::text as day, to_char(eaten_at at time zone tz, 'HH24:MI') as time
         from meals where user_id = $1 and source = 'duplicate' and deleted_at is null
         order by eaten_at`,
        [userId],
      )
    ).rows as { day: string; time: string }[];

  await page.goto("/today");
  const favorites = page.getByRole("region", { name: "Log a favorite again" });
  await expect(page.getByRole("heading", { name: "Meals" })).toBeVisible();
  await expect(favorites).toHaveCount(0);

  await page.goto(`/meals/${mealId}`);
  const starButton = page.getByRole("button", { name: "Favorite", exact: true });
  await expect(starButton).toHaveAttribute("aria-pressed", "false");
  await starButton.click();
  await expect(starButton).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("status").filter({ hasText: "Saved to your favorites" }),
  ).toBeVisible();
  await expectAccessible(page);

  // Today: one tap logs a copy now; Undo takes it back.
  await page.goto("/today");
  const chip = favorites.getByRole("button", { name: "Morning coffee" });
  await expect(chip).toContainText("☕");
  await expectAccessible(page);
  await chip.click();
  const cards = page.locator("article[data-meal-id]");
  await expect(cards).toHaveCount(2);
  expect(await copies()).toHaveLength(1);
  await page
    .getByRole("status")
    .filter({ hasText: "Morning coffee logged" })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(cards).toHaveCount(1);
  expect(await copies()).toEqual([]);

  // On an earlier day the copy lands at 12:00 of that day.
  await page.goto(`/today?date=${localDay(-1)}`);
  await favorites.getByRole("button", { name: "Morning coffee" }).click();
  await expect(cards).toHaveCount(1);
  expect(await copies()).toEqual([{ day: localDay(-1), time: "12:00" }]);

  // The Favorites page, from More: log again now, then take it off the list.
  await page.goto("/more");
  await page.getByRole("link", { name: /^Favorites/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Favorites" })).toBeVisible();
  const list = page.getByTestId("favorites");
  await expect(list).toContainText("40 kcal · ☕ Coffee with milk");
  await expectAccessible(page);
  await list.getByRole("button", { name: "Log again now: Morning coffee" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Morning coffee logged" })).toBeVisible();
  await expect.poll(async () => (await copies()).length).toBe(2);
  await list.getByRole("button", { name: "Favorite: Morning coffee" }).click();
  await expect(page.getByText("No favorites yet")).toBeVisible();
  const row = await pool.query("select favorite_at from meals where id = $1", [mealId]);
  expect(row.rows[0].favorite_at).toBeNull();
});

test("medicines: the camera's Medicine tab without an AI key, Today's card with Log now, the Medicines page", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const card = page.getByRole("region", { name: "Medicines" });
  await expect(page.getByRole("heading", { name: "Meals" })).toBeVisible();
  await expect(card).toHaveCount(0);

  // "Meal · Medicine · Body" above the shutter; arrow keys move between the tabs.
  const camera = await openCamera(page);
  const tabs = camera.getByRole("tablist", { name: "What to capture" });
  await expect(tabs.getByRole("tab")).toHaveText(["Meal", "Medicine", "Body"]);
  await expect(tabs.getByRole("tab", { name: "Meal" })).toHaveAttribute("aria-selected", "true");
  await expectAccessible(page);
  await tabs.getByRole("tab", { name: "Meal" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Medicine" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(tabs.getByRole("tab", { name: "Medicine" })).toBeFocused();
  await expect(page.getByTestId("camera")).toHaveAttribute("data-mode", "medicine");
  await expect(camera.getByRole("button", { name: /^Send/ })).toHaveCount(0);
  await expectAccessible(page);

  // One photo of the box; without an AI key the sheet opens empty with the reason.
  await camera.getByRole("button", { name: "Photograph the label" }).click();
  const sheet = page.getByRole("dialog", { name: "What did you take?" });
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expect(sheet.getByRole("status").first()).toContainText("Save an AI key in Settings");
  await expect(sheet).toContainText(
    "Kal records what you took. It does not check doses or interactions; ask a pharmacist or doctor about those.",
  );
  await sheet.getByLabel("Name").fill("Vitamin D");
  await sheet.getByLabel("Strength").fill("1000 IU");
  await sheet.getByLabel("Form").selectOption("tablet");
  await expect(sheet.getByRole("spinbutton", { name: "How many did you take?" })).toHaveAttribute(
    "aria-valuetext",
    "1 tablet",
  );
  await expect(sheet.getByRole("button", { name: "Taken: now. Change the time" })).toBeVisible();
  await expect(
    sheet.getByRole("checkbox", { name: "Keep it in my medicines for one-tap logging" }),
  ).toBeChecked();
  await expectAccessible(page);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(camera).toBeHidden();

  // Today: taken with its time.
  await expect(card.getByTestId("medicine-taken")).toContainText("Vitamin D 1000 IU · 1 tablet");
  await expect(card.getByTestId("medicine-taken")).toContainText(/Taken \d\d:\d\d/);
  const stored = await pool.query(
    `select l.name, l.strength, l.form, l.amount, l.unit, l.scan_id is not null as photo,
       m.usual_amount from medicine_logs l join medicines m on m.id = l.medicine_id
     where l.user_id = $1`,
    [userId],
  );
  expect(stored.rows).toEqual([
    {
      name: "Vitamin D",
      strength: "1000 IU",
      form: "tablet",
      amount: 1,
      unit: "tablet",
      photo: true,
      usual_amount: 1,
    },
  ]);
  await expectAccessible(page);

  // The Medicines page, from More: add one by hand.
  await page.goto("/more");
  await page.getByRole("link", { name: /^Medicines/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Medicines" })).toBeVisible();
  await page.getByRole("button", { name: "Add a medicine" }).click();
  const add = page.getByRole("dialog", { name: "Add a medicine" });
  await add.getByLabel("Name").fill("Omega-3");
  await add.getByLabel("Form").selectOption("capsule");
  await add.getByRole("button", { name: "Save" }).click();
  await expect(add).toBeHidden();
  await expect(page.getByTestId("medicine-list")).toContainText("Omega-3");
  await expect(page.getByTestId("medicine-history")).toContainText("Vitamin D 1000 IU · 1 tablet");
  await expectAccessible(page);

  // Today: Omega-3 is due; Log now with Undo.
  await page.goto("/today");
  const due = card.getByRole("button", { name: "Log now: Omega-3" });
  await expect(card.getByTestId("medicine-due")).toContainText("Omega-3 · 1 capsule");
  await due.click();
  await expect(card.getByTestId("medicine-taken")).toHaveCount(2);
  await expect(card.getByTestId("medicine-due")).toHaveCount(0);
  await page
    .getByRole("status")
    .filter({ hasText: "Omega-3 logged" })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(card.getByTestId("medicine-due")).toContainText("Omega-3");

  // Archived medicines leave Today.
  await page.goto("/medicines");
  await page.getByRole("button", { name: "Edit: Omega-3" }).click();
  await page
    .getByRole("dialog", { name: "Edit the medicine" })
    .getByRole("button", { name: "Archive" })
    .click();
  await expect(page.getByTestId("archived-medicines")).toContainText("Omega-3");
  await page.goto("/today");
  await expect(card.getByTestId("medicine-due")).toHaveCount(0);
  await expect(card.getByTestId("medicine-taken")).toHaveCount(1);
});

test("log as a medicine: a supplement photographed as a meal, from Today, without an AI key", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const camera = await openCamera(page);
  await camera.getByRole("button", { name: "Take photo" }).click();
  await camera.getByRole("button", { name: "Send meal with 1 photo" }).click();
  await expect(camera).toBeHidden();
  const mealCard = page.locator(SERVER_CARD);
  const mealId = (await mealCard.getAttribute("data-meal-id"))!;
  await expect
    .poll(
      async () =>
        (await pool.query("select status from jobs where payload->>'mealId' = $1", [mealId]))
          .rows[0]?.status,
      { timeout: 15_000 },
    )
    .toBe("done");
  // As an analysis from before not_food_kind left it: only the words say what it shows.
  await pool.query(`update meals set status = 'failed', error = $2, analysis = $3 where id = $1`, [
    mealId,
    JSON.stringify({
      kind: "not-food",
      message:
        "These photos do not seem to show food or drink. Retake them or add the items by hand. The photo seems to show: A bottle of vitamin D capsules.",
    }),
    JSON.stringify({ is_food: false, title: "A bottle of vitamin D capsules", items: [] }),
  ]);
  const { rows } = await pool.query(
    "select eaten_at, to_char(eaten_at at time zone tz, 'HH24:MI') as time from meals where id = $1",
    [mealId],
  );
  const mealTime = rows[0].time as string;
  const eatenAt = rows[0].eaten_at as Date;
  await page.reload();
  const failed = page.locator(`article[data-meal-id="${mealId}"]`);
  await expect(failed).toHaveAttribute("data-state", "failed");
  await expect(failed.getByRole("button", { name: "Try again" })).toBeVisible();
  const logAs = failed.getByRole("button", { name: "Log as a medicine" });
  await expect(logAs).toBeVisible();
  await expectAccessible(page);

  // No AI key: the sheet to type, taken at the meal's time.
  await logAs.click();
  const sheet = page.getByRole("dialog", { name: "What did you take?" });
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expect(sheet.getByRole("status").first()).toContainText("Save an AI key in Settings");
  await expect(
    sheet.getByRole("button", { name: `Taken: today at ${mealTime}. Change the time` }),
  ).toBeVisible();
  await expect(sheet.getByRole("spinbutton", { name: "How many did you take?" })).toHaveAttribute(
    "aria-valuetext",
    "1",
  );
  await expect(
    sheet.getByRole("checkbox", { name: "Keep it in my medicines for one-tap logging" }),
  ).toBeChecked();
  await sheet.getByLabel("Name").fill("Vitamin D");
  await sheet.getByLabel("Strength").fill("1000 IU");
  await sheet.getByLabel("Form").selectOption("capsule");
  await expectAccessible(page);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();

  // Today: the medicine in its card at the meal's time, the meal gone; the toast leads to it.
  const card = page.getByRole("region", { name: "Medicines" });
  await expect(card.getByTestId("medicine-taken")).toContainText("Vitamin D 1000 IU · 1 capsule");
  await expect(card.getByTestId("medicine-taken")).toContainText(`Taken ${mealTime}`);
  await expect(page.locator(`article[data-meal-id="${mealId}"]`)).toHaveCount(0);
  await expect(page.getByText("Nothing logged yet")).toBeVisible();
  await page
    .getByRole("status")
    .filter({ hasText: "Vitamin D 1000 IU logged as a medicine" })
    .getByRole("button", { name: "Show it" })
    .click();
  await expect(card.getByTestId("medicine-taken")).toBeFocused();
  await expectAccessible(page);

  const stored = await pool.query(
    `select l.name, l.form, l.scan_id is not null as photo, l.taken_at,
       (select count(*)::int from meals where user_id = $1) as meals
     from medicine_logs l where l.user_id = $1`,
    [userId],
  );
  expect(stored.rows).toEqual([
    { name: "Vitamin D", form: "capsule", photo: true, taken_at: eatenAt, meals: 0 },
  ]);
});

test("add without a photo: scan a barcode", async ({ page }, info) => {
  await signUp(page, info.project.name);
  const code = "4006381333931";
  await pool.query("delete from foods where barcode = $1", [code]);
  await food({ name: "Oat biscuits", energy: 450, barcode: code, portions: [["2 biscuits", 25]] });
  // This browser has no BarcodeDetector on Windows; a stand-in reads the code from the camera.
  await page.addInitScript((digits) => {
    class FakeDetector {
      static getSupportedFormats = async () => ["ean_13", "ean_8", "upc_a", "upc_e"];
      async detect() {
        return [{ rawValue: digits, format: "ean_13" }];
      }
    }
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = FakeDetector;
  }, code);

  await page.goto("/add");
  await expect(page.getByRole("heading", { level: 1, name: "Add food" })).toBeVisible();
  await expectAccessible(page);
  // Browsers without BarcodeDetector use the ZXing WebAssembly reader: it is served by Kal and
  // the CSP lets it compile.
  const wasm = await page.evaluate(async () => {
    const response = await fetch("/vendor/zxing_reader.wasm");
    const type = response.headers.get("content-type");
    await WebAssembly.compile(await response.arrayBuffer());
    return { status: response.status, type };
  });
  expect(wasm).toEqual({ status: 200, type: "application/wasm" });
  await page.getByRole("button", { name: /Scan a barcode/ }).click();
  const sheet = page.getByRole("dialog", { name: "Oat biscuits" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^2 biscuits/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await sheet.getByRole("button", { name: /^Log it/ }).click();
  await expect(page).toHaveURL(/\/meals\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Oat biscuits" })).toBeVisible();
  await expect(page.getByTestId("item-kcal")).toHaveText("113");

  // Recent foods list it the next time.
  await page.goto("/add");
  await expect(page.getByRole("region", { name: "Recent" })).toContainText("Oat biscuits");
});

test("settings: an AI key is saved and only ever shown masked", async ({ page }, info) => {
  await signUp(page, info.project.name);
  const key = "e2e-test-key-SECRETPART-9876";
  await page.goto("/settings");
  await expectAccessible(page);
  const card = page.locator('li[data-provider="google"]');
  await card.getByLabel("Google (Gemini) API key").fill(key);
  await card.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("key-state-google")).toHaveText("Saved key ••••9876");
  await expect(card.getByLabel("Replace the Google (Gemini) key")).toHaveValue("");
  expect(await page.content()).not.toContain("SECRETPART");

  await page.reload();
  await expect(page.getByTestId("key-state-google")).toHaveText("Saved key ••••9876");
  expect(await page.content()).not.toContain("SECRETPART");
  const stored = await pool.query("select encrypted_key from ai_keys where key_last_four = '9876'");
  expect(stored.rows[0].encrypted_key).not.toContain("SECRETPART");
});

// Ordinary data has long names: FoodData Central names run to 60 characters and more, and a meal
// title can be a whole sentence. They must not make any screen wider than a 360 px phone.
const LONG_FOOD = "Chicken, broilers or fryers, breast, meat only, cooked, roasted"; // 63 characters
const LONG_TITLE =
  "Grilled chicken breast with saffron rice, roasted peppers, garlic yogurt sauce and green salad"; // 94

test("long food names and meal titles fit the screen from 360 px up", async ({ page }, info) => {
  expect([LONG_FOOD.length, LONG_TITLE.length]).toEqual([63, 94]);
  const userId = await signUp(page, info.project.name);
  const chicken = await food({ name: LONG_FOOD, energy: 165 });
  const mealId = await meal(userId, { status: "ready", title: LONG_TITLE });
  await pool.query(
    `insert into meal_items (meal_id, user_id, name, food_id, grams, nutrients, nutrient_source)
     values ($1, $2, 'Chicken breast', $3, 150,
       '{"energy":247.5,"protein":46.5,"carbs":0,"fat":5.4}', 'food')`,
    [mealId, userId, chicken],
  );
  await pool.query(
    `update meals set totals = '{"energy":247.5,"protein":46.5,"carbs":0,"fat":5.4}' where id = $1`,
    [mealId],
  );

  const phone = !!info.project.use.isMobile;
  for (const [i, width] of (phone ? [360, 390, 430] : [768, 1280]).entries()) {
    await page.setViewportSize({ width, height: 800 });
    const check = (page: Page) => (i === 0 ? expectAccessible(page) : expectNoSidewaysScroll(page));

    await page.goto("/today");
    await expect(page.locator(`article[data-meal-id="${mealId}"]`)).toContainText(LONG_TITLE);
    await check(page);

    await page.goto(`/meals/${mealId}`);
    await expect(page.getByRole("heading", { level: 1, name: LONG_TITLE })).toBeVisible();
    await check(page);

    await page.goto("/add");
    await expect(page.getByRole("region", { name: "Recent" })).toContainText(LONG_FOOD);
    await check(page);
    await page.getByRole("searchbox").fill("chicken breast roasted");
    await expect(
      page.getByRole("list", { name: "Search results" }).getByText(LONG_FOOD).first(),
    ).toBeVisible();
    await check(page);

    for (const range of ["day", "week", "month"]) {
      await page.goto(`/trends?range=${range}`);
      await expect(page.getByRole("region", { name: "Top foods" })).toContainText(LONG_FOOD);
      await expectNoSidewaysScroll(page);
    }
  }
});

/** Every element found is at least 44 by 44 px; a checkbox counts with the label around it. */
const expectTouchTargets = async (targets: Locator, what: string) => {
  const boxes = await targets.evaluateAll((elements) =>
    elements.map((element) => {
      const target = (element instanceof HTMLInputElement && element.closest("label")) || element;
      const box = target.getBoundingClientRect();
      return {
        name: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    }),
  );
  expect(boxes.length, `${what}: none found`).toBeGreaterThan(0);
  expect(
    boxes.filter((box) => box.width < 44 || box.height < 44),
    `${what} smaller than 44 px`,
  ).toEqual([]);
};

test("touch targets: segmented controls, switches and checkboxes are at least 44 px", async ({
  page,
}, info) => {
  const userId = await signUp(page, info.project.name);
  const mealId = await meal(userId, { status: "ready", title: "Lunch" });

  await page.goto("/trends");
  await expectTouchTargets(
    page.getByRole("radiogroup", { name: "Period" }).getByRole("radio"),
    "Trends period buttons",
  );
  await page.goto("/settings");
  await expectTouchTargets(page.getByRole("radiogroup").getByRole("radio"), "Settings choices");
  await expectTouchTargets(page.getByRole("switch"), "Settings switches");
  await page.goto(`/meals/${mealId}`);
  await expectTouchTargets(page.getByRole("checkbox"), "Meal page checkboxes");
});

test("admin: create an invite, copy its link, revoke it", async ({ page, context }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
  await signUp(page, info.project.name, true);
  await page.goto("/settings");
  await page.getByRole("link", { name: /Admin: invites/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Admin" })).toBeVisible();
  await expectAccessible(page);

  const note = `friend ${info.project.name}`;
  await page.getByLabel("Who is it for? (only you see this)").fill(note);
  await page.getByRole("button", { name: "Create invite" }).click();
  const link = page.getByTestId("one-time-link");
  await expect(link).toBeVisible();
  await expect(link.getByRole("textbox", { name: "Link" })).toHaveValue(/\/invite\?code=.+/);
  await link.getByRole("button", { name: "Copy link" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /Link copied|Copy the link/ }),
  ).toBeVisible();
  await link.getByRole("button", { name: "Done" }).click();

  const invites = page.getByTestId("open-invites");
  await expect(invites).toContainText(note);
  await page.getByRole("button", { name: `Revoke the invite for ${note}` }).click();
  await expect(invites.getByText(note)).toHaveCount(0);
  await expect(page.getByTestId("usage-totals")).toBeVisible();
});
