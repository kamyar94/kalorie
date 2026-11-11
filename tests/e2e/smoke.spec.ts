// Smoke test of the foundations: invite, sign in, upload a photo, see the meal waiting for its
// analysis, and the worker run the analysis job (without an AI key it ends with a message that
// points to the AI settings). Runs at phone and desktop sizes.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
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

// Browser errors (a CSP violation shows up here) fail the test.
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

/** WCAG 2.x A and AA rules on the page as it is now. */
const expectAccessible = async (page: Page) => {
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

test("security headers and the installable app shell", async ({ page, request }) => {
  const response = await request.get("/sign-in");
  const csp = response.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).not.toContain("'unsafe-eval'");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");

  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({
    name: "Kal",
    short_name: "Kal",
    display: "standalone",
    start_url: "/today",
  });
  expect((await request.get("/icons/maskable-512.png")).status()).toBe(200);

  // Cross-site posts are refused before they reach any route.
  const forged = await request.post("/api/meals", {
    headers: { origin: "https://evil.example.net" },
  });
  expect(forged.status()).toBe(403);
  expect((await request.get("/api/meals")).status()).toBe(401);

  await page.goto("/sign-in");
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute(
    "content",
    "Kal",
  );
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute("content", "Kal");
  await expect(page).toHaveTitle("Sign in · Kal");
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/$/);
});

test("invite, sign in, upload a photo and see it analysed", async ({ page }, testInfo) => {
  const { code } = await runCommand(pool, ["invite", "--note", "e2e"], () => undefined);
  const username = `e2e_${testInfo.project.name}_${Date.now().toString(36)}`;

  await page.goto(`/invite?code=${encodeURIComponent(code)}`);
  await expect(page.getByLabel("Invite code")).toHaveValue(code);
  await expectAccessible(page);
  await page.getByLabel("Your name").fill("Test Person");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Password again").fill(PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();

  await expectAccessible(page);
  // Settings is in More.
  await page.getByRole("link", { name: "More" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "More" })).toBeVisible();
  await page.getByRole("link", { name: /^Settings/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("not the password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Wrong username or password.");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/today$/);

  const shutter = page.getByRole("button", { name: "Open the camera" });
  await expect(shutter).toBeVisible();
  const box = (await shutter.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);

  // The phone camera fallback inside the in-app camera takes a file, like a gallery pick.
  await shutter.click();
  const camera = page.getByRole("dialog", { name: "Camera" });
  await camera.getByTestId("capture-input").setInputFiles("tests/fixtures/meal.jpg");
  await camera.getByRole("button", { name: "Send meal with 1 photo" }).click();
  const card = page.locator("article[data-meal-id]");
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute("data-state", /^(queued|analysing|failed)$/);
  await expectAccessible(page);

  const thumb = await card.locator("img").getAttribute("src");
  expect(thumb).toMatch(/^\/api\/photos\/[0-9a-f-]{36}\/thumb$/);
  const photo = await page.request.get(thumb!);
  expect(photo.status()).toBe(200);
  expect(photo.headers()["content-type"]).toBe("image/jpeg");

  // The worker process ran the analysis job; with no AI key saved the meal stops with a clear
  // message instead of waiting.
  const mealId = await card.getAttribute("data-meal-id");
  await expect
    .poll(
      async () =>
        (await pool.query("select status from jobs where payload->>'mealId' = $1", [mealId]))
          .rows[0]?.status,
      { timeout: 15_000 },
    )
    .toBe("done");
  const meal = (await (await page.request.get(`/api/meals/${mealId}`)).json()) as {
    status: string;
    error: { kind: string; settingsLink: boolean } | null;
  };
  expect(meal).toMatchObject({ status: "failed", error: { kind: "no-key", settingsLink: true } });
  await page.reload();
  await expect(card).toHaveAttribute("data-state", "failed");
  await expect(card.getByTestId("meal-state")).toHaveText("Needs attention");
  // Both ways out: fix the key in Settings, then send the same photos again.
  await expect(card.getByRole("link", { name: "Open AI settings" })).toBeVisible();
  await card.getByRole("button", { name: "Try again" }).click();
  await expect(card).toHaveAttribute("data-state", /^(queued|analysing|failed)$/);
  await expect
    .poll(
      async () =>
        (
          await pool.query("select count(*)::int as n from jobs where payload->>'mealId' = $1", [
            mealId,
          ])
        ).rows[0]?.n,
      { timeout: 15_000 },
    )
    .toBe(2);
});
