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
  await page.getByRole("button", { name: "Take a photo of a meal" }).click();
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

test("a camera that never answers: the phone's camera is offered while it starts", async ({
  page,
}, info) => {
  await signUp(page, info.project.name);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise<MediaStream>(() => undefined);
  });
  await page.getByRole("button", { name: "Take a photo of a meal" }).click();
  const camera = page.getByRole("dialog", { name: "Camera" });
  await expect(page.getByTestId("camera")).toHaveAttribute("data-camera-state", "starting");
  const fallback = camera.getByRole("button", { name: "Use the phone's camera" });
  await expect(fallback).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await fallback.click();
  await (await chooser).setFiles("tests/fixtures/meal.jpg");
  await expect(photosInStrip(page)).toHaveCount(1);
});

test("a camera without a picture (older phones): Cal gives up and offers the phone's camera", async ({
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
  await page.getByRole("button", { name: "Take a photo of a meal" }).click();
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
  // Browsers without BarcodeDetector use the ZXing WebAssembly reader: it is served by Cal and
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
