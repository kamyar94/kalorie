// The analysis job against recorded replies of all three providers (the AI provider mock): a good
// meal, a mixed dish with components, a drink, a packaged label, a photo that is not food,
// malformed JSON, a refusal, a refused key (401), a rate limit (429) and a timeout. Each case runs
// the real handler through the job queue against Postgres.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { and, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { aiUsage, foods, jobs } from "@/db/schema";
import { saveProviderKey } from "@/lib/ai/service";
import { AI_PROVIDERS, type AiProvider } from "@/lib/ai/types";
import { analyzeMealHandler } from "@/lib/analysis/handler";
import { ANALYSIS_SCHEMA } from "@/lib/analysis/schema";
import { ANALYZE_MEAL_JOB } from "@/lib/contracts/analysis";
import { createPhotoMeal } from "@/lib/meals/create";
import { getMeal } from "@/lib/meals/service";
import { drainJobs } from "@/lib/queue/worker";
import {
  DRINK,
  GOOD_MEAL,
  imagesOf,
  LABEL_BARCODE,
  matchingReply,
  MIXED_DISH,
  NOT_FOOD,
  PACKAGED,
  promptOf,
  seedFixtureFoods,
} from "@/tests/fixtures/analysis";
import {
  aiReplies,
  startAiMock,
  TEST_API_KEY,
  useAiMock,
  type AiMock,
} from "@/tests/helpers/ai-mock";
import { createUser } from "@/tests/helpers/factories";

let ai: AiMock;
let restore: () => void;
let root: string;
let food: Record<string, string>;

const handlers = { [ANALYZE_MEAL_JOB]: analyzeMealHandler };

beforeAll(async () => {
  ai = await startAiMock();
  restore = useAiMock(ai);
  root = mkdtempSync(path.join(os.tmpdir(), "cal-analysis-providers-"));
  process.env.PHOTO_ROOT = root;
  food = await seedFixtureFoods();
});

afterAll(async () => {
  restore();
  await ai.close();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  ai.reset();
  await db.execute(sql`delete from jobs`);
});

const jpeg = () =>
  sharp({ create: { width: 640, height: 480, channels: 3, background: "#c08040" } })
    .jpeg()
    .toBuffer();

const newMeal = async (provider: AiProvider) => {
  const user = await createUser();
  await saveProviderKey(user.id, provider, TEST_API_KEY);
  const { meal } = await createPhotoMeal({
    userId: user.id,
    clientId: null,
    eatenAt: new Date("2026-10-31T09:45:00Z"), // 13:15 in Tehran
    tz: "Asia/Tehran",
    note: null,
    photos: [await jpeg()],
  });
  return { userId: user.id, mealId: meal.id };
};

const jobOf = async (mealId: string) =>
  (
    await db
      .select()
      .from(jobs)
      .where(sql`${jobs.payload}->>'mealId' = ${mealId}`)
  )[0]!;

const run = () => drainJobs(handlers);

describe.each(AI_PROVIDERS)("analysis with %s", (provider) => {
  it("analyses a good meal: items matched to foods, nutrients and totals, usage per call", async () => {
    const { userId, mealId } = await newMeal(provider);
    ai.queue(provider, aiReplies[provider].json(GOOD_MEAL), matchingReply(provider));
    expect(await run()).toBe(1);

    const meal = (await getMeal(userId, mealId))!;
    expect(meal.status).toBe("ready");
    expect(meal.title).toBe("Joojeh kabab with rice");
    expect(meal.error).toBeNull();
    expect(meal.items.map((i) => [i.name, i.foodId, i.nutrientSource])).toEqual([
      ["Rice, white, cooked", food.rice, "food"],
      ["Chicken breast, grilled", food.chicken, "food"],
      ["Tomato, grilled", food.tomato, "food"],
      ["Doogh", food.doogh, "food"],
    ]);
    const doogh = meal.items[3]!;
    expect(doogh.ml).toBe(250);
    expect(doogh.grams).toBeCloseTo(255, 5); // 250 ml x 1.02 g/ml
    expect(doogh.nutrients.energy).toBeCloseTo(2.55 * 26, 5);
    expect(meal.items[0]!.nutrients.energy).toBeCloseTo(325, 5);
    expect(meal.items[0]!.localName).toBe("چلو");
    expect(meal.items[1]!.gramsLow).toBeCloseTo(144, 5);
    expect(meal.totals.energy).toBeCloseTo(325 + 297 + 17.6 + 66.3, 5);

    // One vision call with the photo and the schema, then one matching call.
    expect(ai.requests).toHaveLength(2);
    expect(imagesOf(provider, ai.requests[0]!)).toBe(1);
    expect(promptOf(provider, ai.requests[0]!)).toContain("13:15");
    expect(imagesOf(provider, ai.requests[1]!)).toBe(0);
    const body = ai.requests[0]!.body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const schema =
      provider === "openai"
        ? body.text.format.schema
        : provider === "anthropic"
          ? body.output_config.format.schema
          : body.generationConfig.responseJsonSchema;
    expect(schema).toEqual(ANALYSIS_SCHEMA);

    const usage = await db.select().from(aiUsage).where(eq(aiUsage.userId, userId));
    expect(usage.map((u) => [u.task, u.mealId, u.ok]).sort()).toEqual([
      ["analysis", mealId, true],
      ["matching", mealId, true],
    ]);
    expect((await jobOf(mealId)).result).toMatchObject({ status: "ready", items: 4, questions: 0 });
  });

  it("sums the matched components of a mixed dish and asks its question", async () => {
    const { userId, mealId } = await newMeal(provider);
    ai.queue(provider, aiReplies[provider].json(MIXED_DISH), matchingReply(provider));
    await run();

    const meal = (await getMeal(userId, mealId))!;
    expect(meal.status).toBe("needs_input");
    expect(meal.openQuestions).toBe(1);
    expect(meal.questions[0]).toMatchObject({
      text: "Was there tahdig with it?",
      answers: ["Yes", "No"],
      answer: null,
    });
    const [stew] = meal.items;
    expect(stew!.nutrientSource).toBe("components");
    expect(stew!.foodId).toBeNull();
    expect(stew!.components.map((c) => [c.name, c.foodId])).toEqual([
      ["Beef, stewed", food.beef],
      ["Kidney beans, cooked", food.beans],
      ["Sauteed herbs", null],
      ["Vegetable oil", food.oil],
    ]);
    // The components (330 g) are scaled to the item's 350 g. Matched parts come from the
    // database, the unmatched herbs are their weight share of the model's estimate.
    const scale = 350 / 330;
    const herbs = (520 * 175) / 330;
    expect(stew!.components.map((c) => c.grams)).toEqual([95.5, 53, 185.6, 15.9]);
    const parts = stew!.components.map((c) => c.grams);
    expect(stew!.nutrients.energy).toBeCloseTo(
      (parts[0]! / 100) * 250 +
        (parts[1]! / 100) * 127 +
        (parts[3]! / 100) * 884 +
        herbs * (parts[2]! / (175 * scale)),
      5,
    );
    expect(meal.totals.energy).toBeCloseTo(stew!.nutrients.energy!, 5);
  });

  it("measures a drink in ml and weighs it with the food's density", async () => {
    const { userId, mealId } = await newMeal(provider);
    ai.queue(provider, aiReplies[provider].json(DRINK), matchingReply(provider));
    await run();
    const [juice] = (await getMeal(userId, mealId))!.items;
    expect(juice).toMatchObject({
      kind: "drink",
      ml: 300,
      foodId: food.juice,
      nutrientSource: "food",
    });
    expect(juice!.grams).toBeCloseTo(312, 5);
    expect(juice!.nutrients.energy).toBeCloseTo(3.12 * 45, 5);
  });

  it("counts a packaged food from its label and saves it as the person's food", async () => {
    const { userId, mealId } = await newMeal(provider);
    ai.queue(provider, aiReplies[provider].json(PACKAGED));
    await run();
    const [bar] = (await getMeal(userId, mealId))!.items;
    const saved = (
      await db
        .select()
        .from(foods)
        .where(and(eq(foods.ownerId, userId), eq(foods.barcode, LABEL_BARCODE)))
    )[0]!;
    expect(saved).toMatchObject({ source: "ai", kind: "packaged", servingGrams: 50 });
    expect(saved.nutrients).toMatchObject({ energy: 480, protein: 4.4, fat: 23, sugars: 55 });
    expect(bar).toMatchObject({ foodId: saved.id, nutrientSource: "food", grams: 50 });
    expect(bar!.nutrients.energy).toBeCloseTo(240, 5);
    expect(ai.requests).toHaveLength(1); // nothing left to match
  });

  it("ends with a friendly message when the photo is not food, without retrying", async () => {
    const { userId, mealId } = await newMeal(provider);
    ai.queue(provider, aiReplies[provider].json(NOT_FOOD));
    await run();
    const meal = (await getMeal(userId, mealId))!;
    expect(meal.status).toBe("failed");
    expect(meal.error).toMatchObject({ kind: "not-food", settingsLink: false });
    expect(meal.error!.message).toContain("A laptop on a desk");
    expect(meal.items).toHaveLength(0);
    expect(await jobOf(mealId)).toMatchObject({ status: "done", attempts: 1 });
    expect(ai.requests).toHaveLength(1);
  });

  it("retries malformed JSON once, then gives up with a clear error", async () => {
    const { userId, mealId } = await newMeal(provider);
    ai.queue(provider, aiReplies[provider].malformed, aiReplies[provider].malformed);
    await run();
    let meal = (await getMeal(userId, mealId))!;
    expect(meal.status).toBe("queued");
    expect(meal.error).toMatchObject({ kind: "invalid-output" });
    expect(meal.error!.message).toContain("try again shortly");
    expect(await jobOf(mealId)).toMatchObject({ status: "queued", attempts: 1 });

    await db.execute(sql`update jobs set run_after = now()`);
    await run();
    meal = (await getMeal(userId, mealId))!;
    expect(meal.status).toBe("failed");
    expect(meal.error).toMatchObject({ kind: "invalid-output", settingsLink: false });
    // The second try asked for more room to answer.
    const second = ai.requests[1]!.body as Record<string, unknown>;
    const limit =
      second.max_output_tokens ??
      second.max_tokens ??
      (second.generationConfig as Record<string, unknown>).maxOutputTokens;
    expect(limit).toBe(16_384);
  });

  it("stops at a refusal", async () => {
    const { userId, mealId } = await newMeal(provider);
    ai.queue(provider, aiReplies[provider].refusal);
    await run();
    const meal = (await getMeal(userId, mealId))!;
    expect(meal.status).toBe("failed");
    expect(meal.error).toMatchObject({ kind: "refusal", settingsLink: false });
    const usage = await db.select().from(aiUsage).where(eq(aiUsage.userId, userId));
    expect(usage.map((u) => u.ok)).toEqual([false]);
  });

  it("stops at a refused key and links to the AI settings", async () => {
    const { userId, mealId } = await newMeal(provider);
    ai.queue(provider, aiReplies[provider].badKey);
    await run();
    const meal = (await getMeal(userId, mealId))!;
    expect(meal.status).toBe("failed");
    expect(meal.error).toMatchObject({ kind: "auth", settingsLink: true });
    expect(meal.error!.message).not.toContain(TEST_API_KEY);
    expect(await jobOf(mealId)).toMatchObject({ status: "done" });
  });

  it("waits and retries after a rate limit, respecting Retry-After", async () => {
    const { userId, mealId } = await newMeal(provider);
    ai.queue(provider, aiReplies[provider].rateLimited);
    await run();
    const meal = (await getMeal(userId, mealId))!;
    expect(meal.status).toBe("queued");
    expect(meal.error).toMatchObject({ kind: "rate-limit" });
    const job = await jobOf(mealId);
    expect(job.status).toBe("queued");
    expect(job.runAfter.getTime() - Date.now()).toBeGreaterThan(18_000);
  });

  it("retries after a timeout", async () => {
    const { userId, mealId } = await newMeal(provider);
    const saved = process.env.AI_REQUEST_TIMEOUT_MS;
    process.env.AI_REQUEST_TIMEOUT_MS = "200";
    try {
      ai.queue(provider, aiReplies[provider].slow(2000));
      await run();
    } finally {
      if (saved === undefined) delete process.env.AI_REQUEST_TIMEOUT_MS;
      else process.env.AI_REQUEST_TIMEOUT_MS = saved;
    }
    const meal = (await getMeal(userId, mealId))!;
    expect(meal.status).toBe("queued");
    expect(meal.error).toMatchObject({ kind: "timeout" });
    expect((await jobOf(mealId)).status).toBe("queued");
  });
});
