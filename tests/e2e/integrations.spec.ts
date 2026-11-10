// End to end with every part working together (tests/e2e/serve.mjs runs the app, the worker and
// the mocks of tests/helpers/mock-integrations.ts on real fixture food data):
//   - a photo analysed by the mock provider, items matched to imported FoodData Central foods,
//     an edit, and the day in trends;
//   - Mealie: connect with a token, log a planned recipe with servings, generate a plan and
//     confirm it on the screen that says plans are shared with the household;
//   - openGym: pair with a code, the latest weigh-in in Settings, the workout with its estimate;
//   - notifications: subscribe (the browser's push service is mocked), a notification after the
//     analysis, decrypted with this device's keys, and unsubscribe.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { runCommand } from "../../scripts/cal.mjs";
import { decryptPush, MEALIE_TOKEN } from "../helpers/mock-integrations";

const PASSWORD = "e2e password that is long";
let pool: pg.Pool;
let mockUrl: string;

test.beforeAll(() => {
  pool = new pg.Pool({ connectionString: process.env.E2E_DATABASE_URL, max: 2 });
  mockUrl = (
    JSON.parse(readFileSync(path.join("test-results", "e2e-mocks.json"), "utf8")) as { url: string }
  ).url;
});
test.afterAll(async () => {
  await pool.end();
});

const errors: string[] = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(() => {
  expect(errors).toEqual([]);
});

const control = async <T = unknown>(route: string, body?: unknown): Promise<T> => {
  const response = await fetch(`${mockUrl}/__control${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await response.json()) as T;
};

const expectAccessible = async (page: Page) => {
  // Colours are checked once sheets and toasts have finished their transitions.
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => null))),
  );
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
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

/** The browser's local day (it runs in this machine's time zone). */
const localToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

let counter = 0;
const signUp = async (page: Page, project: string) => {
  const { code } = await runCommand(pool, ["invite", "--note", "e2e"], () => undefined);
  const username = `i_${project.replace(/\W/g, "")}_${Date.now().toString(36)}${counter++}`;
  await page.goto(`/invite?code=${encodeURIComponent(code)}`);
  await page.getByLabel("Your name").fill("Test Person");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Password again").fill(PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page).toHaveURL(/\/today$/);
  return (await pool.query("select id from users where username = $1", [username])).rows[0]
    .id as string;
};

const saveGoogleKey = async (page: Page) => {
  await page.goto("/settings");
  const card = page.locator('li[data-provider="google"]');
  await card.getByLabel("Google (Gemini) API key").fill("e2e-mock-key-0123456789");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("key-state-google")).toHaveText(/Saved key/);
};

/** Sends one photo from Today and waits until the worker has analysed it. */
const sendPhotoAndWait = async (page: Page) => {
  await page.goto("/today");
  await page.getByRole("button", { name: "Take a photo of a meal" }).click();
  const camera = page.getByRole("dialog", { name: "Camera" });
  await camera.getByTestId("capture-input").setInputFiles("tests/fixtures/meal.jpg");
  await camera.getByRole("button", { name: "Send meal with 1 photo" }).click();
  const card = page.locator('article[data-state="ready"]');
  await expect(card).toHaveCount(1, { timeout: 30_000 });
  return card;
};

const connectMealie = async (page: Page) => {
  await page.goto("/settings");
  const mealie = page.locator('li[data-integration="mealie"]');
  await mealie.getByLabel("Mealie API token").fill(MEALIE_TOKEN);
  await mealie.getByRole("button", { name: "Test and connect" }).click();
  await expect(page.getByTestId("mealie-status")).toContainText("Connected");
};

test("photo to trends: mock provider, imported foods, an edit", async ({ page }, info) => {
  const userId = await signUp(page, info.project.name);
  await saveGoogleKey(page);
  const card = await sendPhotoAndWait(page);
  await expect(card).toContainText("Chicken with rice");
  const mealId = (await card.getAttribute("data-meal-id"))!;

  const items = await pool.query(
    `select i.name, f.source, f.name_en from meal_items i join foods f on f.id = i.food_id
     where i.meal_id = $1 order by i.position`,
    [mealId],
  );
  expect(items.rows.map((r) => r.name)).toEqual(["Rice, white, cooked", "Chicken breast, roasted"]);
  expect(items.rows.every((r) => String(r.source).startsWith("fdc_"))).toBe(true);

  await page.goto(`/meals/${mealId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Chicken with rice" })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: /^Rice, white, cooked/ }).click();
  const sheet = page.getByRole("dialog", { name: "Rice, white, cooked" });
  const grams = sheet.getByRole("textbox", { name: "Grams" });
  await grams.fill("300");
  await grams.press("Enter");
  await expect(sheet.getByTestId("save-state")).toHaveText("Saved");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  const total = await pool.query("select totals from meals where id = $1", [mealId]);
  const kcal = Math.round(Number(total.rows[0].totals.energy));
  await expect(page.getByRole("region", { name: "Total" }).getByTestId("kcal")).toHaveText(
    String(kcal),
  );
  const edited = await pool.query(
    "select edited, grams from meal_items where meal_id = $1 and position = 0",
    [mealId],
  );
  expect(edited.rows[0]).toMatchObject({ edited: true, grams: 300 });
  expect((await pool.query("select 1 from meals where user_id = $1", [userId])).rowCount).toBe(1);

  await page.goto("/trends?range=day");
  await expect(page.getByTestId("average-energy")).toHaveText(kcal.toLocaleString("en-US"));
});

test("a meal in words is analysed by the mock provider without a photo", async ({ page }, info) => {
  const userId = await signUp(page, info.project.name);
  await saveGoogleKey(page);
  await page.goto("/today");
  await page.getByRole("button", { name: "Take a photo of a meal" }).click();
  const camera = page.getByRole("dialog", { name: "Camera" });
  await camera.getByRole("button", { name: /^Type/ }).click();
  await camera
    .getByRole("textbox", { name: "What did you eat?" })
    .fill("A cup of white rice and a roasted chicken breast");
  await camera.getByRole("button", { name: "Send the meal (text only)" }).click();
  const card = page.locator('article[data-state="ready"]');
  await expect(card).toHaveCount(1, { timeout: 30_000 });
  await expect(card).toContainText("Chicken with rice");

  const meal = await pool.query(
    `select m.source, count(i.id)::int as items from meals m join meal_items i on i.meal_id = m.id
     where m.user_id = $1 group by m.id`,
    [userId],
  );
  expect(meal.rows).toEqual([{ source: "text", items: 2 }]);
  await card.getByRole("link").click();
  await expect(page.getByRole("region", { name: "What you wrote" })).toContainText(
    "A cup of white rice",
  );
  await expectAccessible(page);
});

test("Mealie: connect, then log a planned recipe with servings", async ({ page }, info) => {
  const userId = await signUp(page, info.project.name);
  await connectMealie(page);
  await expectAccessible(page);
  const today = localToday();
  await control("/mealie/today", { date: today });
  // The household's plan is shared: other runs may have planned the same dish today.
  const entry = await control<{ id: number }>("/mealie/plan", {
    date: today,
    entryType: "dinner",
    slug: "chicken-and-rice",
  });

  await page.goto("/today");
  const chip = page
    .getByRole("list", { name: "Planned meals" })
    .locator(`button[data-plan-id="${entry.id}"]`);
  await expect(chip).toContainText("650 kcal");
  await expectAccessible(page);
  await chip.click();
  const sheet = page.getByRole("dialog", { name: "Log Chicken and rice" });
  await expect(sheet.getByTestId("recipe-source")).toHaveText("Nutrition per serving from Mealie.");
  await sheet.getByRole("button", { name: "More (Servings)" }).click();
  await expectAccessible(page);
  await sheet.getByRole("button", { name: /^Log 1\.5 servings/ }).click();
  await expect(page).toHaveURL(/\/meals\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: "Chicken and rice" })).toBeVisible();

  const meal = await pool.query(
    `select m.source, i.count, i.nutrient_source, (i.nutrients->>'energy')::float as kcal
     from meals m join meal_items i on i.meal_id = m.id where m.user_id = $1`,
    [userId],
  );
  expect(meal.rows[0]).toMatchObject({ source: "mealie", count: 1.5, nutrient_source: "recipe" });
  expect(meal.rows[0].kcal).toBeCloseTo(975, 0);

  await page.goto("/today");
  await expect(chip).toBeDisabled();
  await expect(chip).toContainText("Logged");
});

test("Mealie: generate a meal plan and confirm it", async ({ page }, info) => {
  await signUp(page, info.project.name);
  await connectMealie(page);
  await page.goto("/plan");
  await expect(page.getByRole("heading", { level: 1, name: "Plan meals" })).toBeVisible();
  await page.getByRole("group", { name: "Meals" }).getByRole("button", { name: "Lunch" }).click();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Suggest a plan" }).click();

  const days = page.getByRole("list", { name: "Suggested plan" }).getByTestId("plan-day");
  await expect(days).toHaveCount(3);
  await expect(days.first()).toContainText("Lunch:");
  await expect(days.first()).toContainText("Dinner:");
  await expectAccessible(page);
  const before = (await control<unknown[]>("/mealie/plans")).length;

  await page.getByRole("button", { name: "Add to Mealie…" }).click();
  const confirm = page.getByRole("region", { name: "Add to your household's plan?" });
  await expect(confirm).toContainText("shared with everyone in your household");
  // Nothing written before the confirmation.
  expect((await control<unknown[]>("/mealie/plans")).length).toBe(before);
  await expectAccessible(page);
  await confirm.getByRole("button", { name: "Add 6 meals to Mealie" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Added 6 meals to Mealie." }),
  ).toBeVisible();
  expect((await control<unknown[]>("/mealie/plans")).length).toBe(before + 6);
});

test("openGym: pair with a code, weigh-ins and the workout estimate", async ({ page }, info) => {
  await signUp(page, info.project.name);
  await control("/opengym/today", { date: localToday() });
  const { code } = await control<{ code: string }>("/opengym/code", {});
  await page.goto("/settings");
  const gym = page.locator('li[data-integration="opengym"]');
  await expect(gym).toContainText("Paste the 8-character code here within 5 minutes.");
  await gym.getByLabel("Pairing code").fill(code.toLowerCase());
  await gym.getByRole("button", { name: "Pair openGym" }).click();
  await expect(page.getByTestId("opengym-status")).toContainText("Connected");
  await expect(page.getByTestId("opengym-weight")).toContainText("79.6 kg");
  await expectAccessible(page);

  await page.goto("/today");
  const workout = page.getByTestId("workout");
  await expect(workout).toContainText("Legs");
  await expect(workout).toContainText("60 min");
  await expect(workout).toContainText("kcal burned");
  await expect(workout).toContainText("estimate");
  await expectAccessible(page);
  const requests = await control<{ service: string; method: string; path: string }[]>("/requests");
  expect(
    requests.filter(
      (r) => r.service === "opengym" && r.method !== "GET" && r.path !== "/api/pair/redeem",
    ),
  ).toEqual([]);
});

test("notifications: subscribe, get one after the analysis, unsubscribe", async ({
  page,
  context,
}, info) => {
  const userId = await signUp(page, info.project.name);
  await context.grantPermissions(["notifications"]);
  // This device's push keys; the browser's push service is replaced by the mock's endpoint.
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const id = `e2e-${info.project.name}-${Date.now()}`;
  const subscriber = {
    endpoint: `${mockUrl}/push/${id}`,
    keys: {
      p256dh: ecdh.getPublicKey().toString("base64url"),
      auth: crypto.randomBytes(16).toString("base64url"),
    },
    privateKey: ecdh.getPrivateKey().toString("base64url"),
  };
  await page.addInitScript(
    ({ endpoint, keys }) => {
      // Like a real browser, the subscription outlives page loads (kept in session storage).
      const subscription = {
        endpoint,
        expirationTime: null,
        toJSON: () => ({ endpoint, expirationTime: null, keys }),
        unsubscribe: async () => {
          sessionStorage.removeItem("e2e-push");
          sessionStorage.setItem("e2e-unsubscribed", "1");
          return true;
        },
      };
      PushManager.prototype.getSubscription = async () =>
        (sessionStorage.getItem("e2e-push") ? subscription : null) as PushSubscription | null;
      PushManager.prototype.subscribe = async () => {
        sessionStorage.setItem("e2e-push", "1");
        return subscription as unknown as PushSubscription;
      };
    },
    { endpoint: subscriber.endpoint, keys: subscriber.keys },
  );
  await saveGoogleKey(page);
  await page.reload();
  const ready = page.getByRole("switch", { name: "When the analysis is ready" });
  await expect(ready).toBeEnabled();
  await expectAccessible(page);
  await ready.click();
  await expect(ready).toHaveAttribute("aria-checked", "true");
  const stored = await pool.query("select endpoint from push_subscriptions where user_id = $1", [
    userId,
  ]);
  expect(stored.rows.map((r) => r.endpoint)).toEqual([subscriber.endpoint]);

  const card = await sendPhotoAndWait(page);
  const mealId = await card.getAttribute("data-meal-id");
  await expect
    .poll(
      async () =>
        (await control<{ id: string }[]>("/push/received")).filter((r) => r.id === id).length,
      {
        timeout: 20_000,
      },
    )
    .toBe(1);
  const [received] = (
    await control<{ id: string; body: string; headers: Record<string, string> }[]>("/push/received")
  ).filter((r) => r.id === id);
  expect(received!.headers["content-encoding"]).toBe("aes128gcm");
  const message = decryptPush(Buffer.from(received!.body, "base64"), subscriber);
  expect(message).toMatchObject({ title: "Your meal is analysed", url: `/meals/${mealId}` });

  await page.goto("/settings");
  await page.getByRole("switch", { name: "When the analysis is ready" }).click();
  await expect(page.getByRole("switch", { name: "When the analysis is ready" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect
    .poll(
      async () =>
        (await pool.query("select 1 from push_subscriptions where user_id = $1", [userId]))
          .rowCount,
    )
    .toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem("e2e-unsubscribed"))).toBe("1");
});
