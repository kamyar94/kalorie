// Smoke test of the Docker stack (see playwright.stack.config.ts): sign up with an invite made by
// Cal.ps1, save an AI key, send a photo, let the worker analyse it through the egress proxy (the
// provider is a stand-in that the test script put behind the allowed Google host), edit an item,
// and check that one person's photo cannot be read by another person or by nobody. Assertions use
// the DOM and the network only.
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "stack test password that is long";
const inviteA = process.env.CAL_STACK_INVITE_A ?? "";
const inviteB = process.env.CAL_STACK_INVITE_B ?? "";
const suffix = Date.now().toString(36);

const errors: string[] = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(() => {
  // A CSP violation or a failed script shows up here.
  expect(errors).toEqual([]);
});

const signUp = async (page: Page, code: string, username: string) => {
  await page.goto(`/invite?code=${encodeURIComponent(code)}`);
  await page.getByLabel("Your name").fill(`Stack ${username}`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Password again").fill(PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page).toHaveURL(/\/today$/);
};

test("the Docker stack: invite, photo, analysis, edit, isolation", async ({
  page,
  browser,
  baseURL,
}) => {
  expect(inviteA, "CAL_STACK_INVITE_A").not.toBe("");
  expect(inviteB, "CAL_STACK_INVITE_B").not.toBe("");
  let mealId = "";
  let thumbUrl = "";

  await test.step("sign up by invite and save an AI key", async () => {
    await signUp(page, inviteA, `stack_a_${suffix}`);
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();

    // The saved key is what makes the worker call the provider (a stand-in in this test).
    await page.goto("/settings");
    const card = page.locator('li[data-provider="google"]');
    await card.getByLabel("Google (Gemini) API key").fill("stack-test-key-SECRETPART-4321");
    await card.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("key-state-google")).toHaveText("Saved key ••••4321");
    expect(await page.content()).not.toContain("SECRETPART");
  });

  await test.step("send a photo and see it analysed through the proxy", async () => {
    // One photo through the in-app camera (the file input stands in for the shutter).
    await page.goto("/today");
    await page.getByRole("button", { name: "Open the camera" }).click();
    const camera = page.getByRole("dialog", { name: "Camera" });
    await expect(camera).toBeVisible();
    await camera.getByTestId("capture-input").setInputFiles("tests/fixtures/meal.jpg");
    await camera.getByRole("button", { name: "Send meal with 1 photo" }).click();
    await expect(camera).toBeHidden();

    // The worker takes the job, calls the provider through the proxy, matches the foods and
    // leaves the meal ready. (While the photo uploads, the card of the device's own copy exists
    // next to the server's, so wait for the ready one.)
    const meal = page.locator('article[data-state="ready"]');
    await expect(meal).toHaveCount(1, { timeout: 120_000 });
    mealId = (await meal.getAttribute("data-meal-id")) ?? "";
    expect(mealId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(meal).toContainText("Chicken with rice");
  });

  await test.step("open the meal and change an amount", async () => {
    await page.goto(`/meals/${mealId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Chicken with rice" })).toBeVisible();
    const items = page.getByTestId("items").getByRole("button");
    await expect(items).toHaveCount(2);
    const before = Number(await items.first().getByTestId("item-kcal").innerText());
    expect(before).toBeGreaterThan(0);

    await items.first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    const grams = sheet.getByRole("textbox", { name: "Grams" });
    const current = Number(await grams.inputValue());
    await grams.fill(String(current * 2));
    await grams.press("Enter");
    await expect(sheet.getByTestId("save-state")).toHaveText("Saved");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    const after = Number(await items.first().getByTestId("item-kcal").innerText());
    expect(Math.abs(after - before * 2)).toBeLessThanOrEqual(1);

    const meal = (await (await page.request.get(`/api/meals/${mealId}`)).json()) as {
      photos: { urls: { thumb: string } }[];
    };
    thumbUrl = meal.photos[0]?.urls.thumb ?? "";
    expect(thumbUrl).toMatch(/^\/api\/photos\/[0-9a-f-]{36}\/thumb$/);
  });

  await test.step("the photo route serves the owner and nobody else", async () => {
    const mine = await page.request.get(thumbUrl);
    expect(mine.status()).toBe(200);
    expect(mine.headers()["content-type"]).toBe("image/jpeg");

    // Not signed in: refused.
    const anonymous = await browser.newContext({ baseURL: baseURL ?? "" });
    expect((await anonymous.request.get(thumbUrl)).status()).toBe(401);
    await anonymous.close();

    // Another person's account: the photo behaves as if it did not exist, and so does the meal.
    const otherContext = await browser.newContext({ baseURL: baseURL ?? "" });
    const other = await otherContext.newPage();
    await signUp(other, inviteB, `stack_b_${suffix}`);
    expect((await other.request.get(thumbUrl)).status()).toBe(404);
    expect((await other.request.get(thumbUrl.replace("/thumb", "/original"))).status()).toBe(404);
    expect((await other.request.get(`/api/meals/${mealId}`)).status()).toBe(404);
    await otherContext.close();
  });

  await test.step("food search reads Persian, push has its key, health answers", async () => {
    const found = (await (
      await page.request.get(`/api/foods?q=${encodeURIComponent("قورمه سبزی")}`)
    ).json()) as { foods: { nameEn: string }[] };
    expect(found.foods.map((f) => f.nameEn).some((n) => n.startsWith("Ghormeh sabzi"))).toBe(true);

    const key = await page.request.get("/api/push/key");
    expect(key.status()).toBe(200);
    expect(JSON.stringify(await key.json())).toMatch(/[A-Za-z0-9_-]{87}/);

    expect((await page.request.get("/api/health")).status()).toBe(200);
  });
});
