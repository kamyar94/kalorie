// The analysis end to end against Postgres and the provider mock: upload, job, items and totals;
// answering a question; "fix with a sentence" that keeps hand edits (or replaces them); learning
// usual meals from corrections; planned recipes; the trigram fallback; retries and the last
// attempt; and that one person cannot touch another person's meal.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { aiUsage, foodMemory, jobs, mealItems } from "@/db/schema";
import { saveProviderKey } from "@/lib/ai/service";
import { setAnalysisFinishedListener } from "@/lib/analysis/events";
import { analyzeMealHandler } from "@/lib/analysis/handler";
import { setPlannedRecipesSource } from "@/lib/analysis/planned";
import { answerQuestion, correctMeal, retryAnalysis } from "@/lib/analysis/requests";
import { ANALYZE_MEAL_JOB, type AnalysisFinishedEvent } from "@/lib/contracts/analysis";
import { createPhotoMeal } from "@/lib/meals/create";
import { getMeal, updateItem, updateMeal } from "@/lib/meals/service";
import { claimJob } from "@/lib/queue/queue";
import { drainJobs, runJob } from "@/lib/queue/worker";
import {
  GOOD_MEAL,
  imagesOf,
  matchingReply,
  MIXED_DISH,
  promptOf,
  rawAnalysis,
  rawItem,
  seedFixtureFoods,
} from "@/tests/fixtures/analysis";
import {
  aiReplies,
  startAiMock,
  TEST_API_KEY,
  useAiMock,
  type AiMock,
} from "@/tests/helpers/ai-mock";
import { createMeal, createUser } from "@/tests/helpers/factories";

let ai: AiMock;
let restore: () => void;
let root: string;
let food: Record<string, string>;

const handlers = { [ANALYZE_MEAL_JOB]: analyzeMealHandler };
const run = () => drainJobs(handlers);
const google = aiReplies.google;

beforeAll(async () => {
  ai = await startAiMock();
  restore = useAiMock(ai);
  root = mkdtempSync(path.join(os.tmpdir(), "cal-analysis-"));
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

afterEach(() => {
  setPlannedRecipesSource(null);
  setAnalysisFinishedListener(null);
});

const jpeg = (color = "#c08040") =>
  sharp({ create: { width: 800, height: 600, channels: 3, background: color } })
    .jpeg()
    .toBuffer();

const newPerson = async (overrides = {}) => {
  const user = await createUser(overrides);
  await saveProviderKey(user.id, "google", TEST_API_KEY);
  return user.id;
};

const upload = async (userId: string, options: { note?: string; photos?: number } = {}) => {
  const photos = await Promise.all(
    Array.from({ length: options.photos ?? 1 }, (_, i) => jpeg(i ? "#40a060" : "#c08040")),
  );
  const { meal } = await createPhotoMeal({
    userId,
    clientId: null,
    eatenAt: new Date("2026-10-31T16:30:00Z"), // 20:00 in Tehran
    tz: "Asia/Tehran",
    note: options.note ?? null,
    photos,
  });
  return meal.id;
};

const meal = async (userId: string, mealId: string) => (await getMeal(userId, mealId))!;

/** A meal described in words, without a photo. */
const describeMeal = async (userId: string, note: string) => {
  const { meal } = await createPhotoMeal({
    userId,
    clientId: null,
    eatenAt: new Date("2026-10-31T05:00:00Z"), // 08:30 in Tehran
    tz: "Asia/Tehran",
    note,
    photos: [],
  });
  return meal;
};

describe("analysis end to end", () => {
  it("analyses an upload: queued, then items, nutrients and totals from one job", async () => {
    const userId = await newPerson({ cuisines: ["Persian home cooking"], units: "imperial" });
    const mealId = await upload(userId, { note: "ate half of the rice", photos: 2 });
    expect((await meal(userId, mealId)).status).toBe("queued");

    ai.queue("google", google.json(GOOD_MEAL), matchingReply("google"));
    expect(await run()).toBe(1);

    const done = await meal(userId, mealId);
    expect(done.status).toBe("ready");
    expect(done.items).toHaveLength(4);
    const sum = done.items.reduce((total, item) => total + (item.nutrients.energy ?? 0), 0);
    expect(done.totals.energy).toBeCloseTo(sum, 5);
    expect(done.totals.protein).toBeGreaterThan(50);

    const prompt = promptOf("google", ai.requests[0]!);
    expect(imagesOf("google", ai.requests[0]!)).toBe(2);
    expect(prompt).toContain("Photos: 2 of the same meal");
    expect(prompt).toContain("Eaten at 20:00 on a Saturday (dinner).");
    expect(prompt).toContain('The person\'s note: "ate half of the rice"');
    expect(prompt).toContain("Persian home cooking");
    expect(prompt).toContain("imperial");
    expect(prompt).not.toContain("Usual meals");
  });

  it("analyses a text meal from its description alone, and again after a correction", async () => {
    const userId = await newPerson();
    const created = await describeMeal(userId, "Rice with roast chicken, about a cup of rice");
    expect(created).toMatchObject({ source: "text", status: "queued", photos: [] });

    ai.queue("google", google.json(GOOD_MEAL), matchingReply("google"));
    expect(await run()).toBe(1);
    const done = await meal(userId, created.id);
    expect(done.status).toBe("ready");
    expect(done.items.length).toBeGreaterThan(0);
    expect(done.totals.energy).toBeGreaterThan(0);

    const request = ai.requests[0]!;
    expect(imagesOf("google", request)).toBe(0);
    const prompt = promptOf("google", request);
    expect(prompt).toContain("No photo: the person described this meal in words.");
    expect(prompt).toContain(
      `The person's description of the meal: "Rice with roast chicken, about a cup of rice"`,
    );
    expect(prompt).toContain("Analyse the description");
    expect(prompt).not.toContain("Photos:");

    // A text meal can be fixed with a sentence and analysed again, like a photo meal.
    expect(await correctMeal(userId, created.id, "Only half the rice")).toMatchObject({ ok: true });
    ai.queue("google", google.json(GOOD_MEAL), matchingReply("google"));
    await run();
    expect(promptOf("google", ai.requests.at(-2)!)).toContain('"Only half the rice"');
    expect(await retryAnalysis(userId, created.id)).toMatchObject({ ok: true });
  });

  it("tells a text meal that names no food apart from a photo of no food", async () => {
    const userId = await newPerson();
    const created = await describeMeal(userId, "hello there");
    ai.queue("google", google.json(rawAnalysis({ is_food: false, title: "A greeting" })));
    await run();
    const done = await meal(userId, created.id);
    expect(done.status).toBe("failed");
    expect(done.error?.kind).toBe("not-food");
    expect(done.error?.message).toContain("This description does not seem to name a food");
    expect(done.error?.message).not.toContain("photo");
  });

  it("stores the model's emoji per item, or one found from the name", async () => {
    const userId = await newPerson();
    const mealId = await upload(userId);
    const reply = {
      ...GOOD_MEAL,
      items: GOOD_MEAL.items.map((item, i) =>
        i === 0 ? { ...item, emoji: "🍛" } : i === 1 ? { ...item, emoji: "chicken" } : item,
      ),
    };
    ai.queue("google", google.json(reply), matchingReply("google"));
    await run();
    const rows = await db
      .select({ emoji: mealItems.emoji })
      .from(mealItems)
      .where(eq(mealItems.mealId, mealId))
      .orderBy(mealItems.position);
    expect(rows.map((r) => r.emoji)).toEqual(["🍛", "🍗", "🍅", "🥛"]);
  });

  it("names the meal from the model's meal_type, drinks alone as a drink, and keeps a hand-picked slot", async () => {
    const userId = await newPerson();
    // 20:00 in Tehran: the dinner window; the model calls it supper.
    const mealId = await upload(userId);
    ai.queue("google", google.json({ ...GOOD_MEAL, meal_type: "supper" }), matchingReply("google"));
    await run();
    expect(await meal(userId, mealId)).toMatchObject({ slot: "supper", slotLocked: false });

    // Only drinks: a drink, whatever the model says.
    const drinkId = await upload(userId);
    ai.queue(
      "google",
      google.json(
        rawAnalysis({
          title: "Doogh",
          meal_type: "dinner",
          items: [rawItem({ name: "Doogh", kind: "drink", grams: 250, ml: 250 })],
        }),
      ),
      matchingReply("google"),
    );
    await run();
    expect((await meal(userId, drinkId)).slot).toBe("drink");

    // Chosen by hand: it stays through item changes and a new analysis.
    expect(await updateMeal(userId, mealId, { slot: "dinner" })).toMatchObject({
      slot: "dinner",
      slotLocked: true,
    });
    const first = (await meal(userId, mealId)).items[0]!;
    await updateItem(userId, first.id, { grams: 20 });
    expect((await meal(userId, mealId)).slot).toBe("dinner");
    expect(await retryAnalysis(userId, mealId)).toMatchObject({ ok: true });
    ai.queue("google", google.json({ ...GOOD_MEAL, meal_type: "snack" }), matchingReply("google"));
    await run();
    expect((await meal(userId, mealId)).slot).toBe("dinner");
  });

  it("re-analyses with an answer and stops asking", async () => {
    const userId = await newPerson();
    const mealId = await upload(userId);
    ai.queue("google", google.json(MIXED_DISH), matchingReply("google"));
    await run();
    const asked = await meal(userId, mealId);
    expect(asked.status).toBe("needs_input");
    const question = asked.questions[0]!;

    const result = await answerQuestion(userId, mealId, question.id, "  No ");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.meal.status).toBe("queued");
    expect(result.meal.questions[0]!.answer).toBe("No");
    expect(result.meal.items).toHaveLength(1); // the earlier items stay until the new run

    ai.reset();
    ai.queue("google", google.json({ ...MIXED_DISH, questions: [] }), matchingReply("google"));
    await run();
    expect(promptOf("google", ai.requests[0]!)).toContain('Was there tahdig with it? Answer: "No"');
    const answered = await meal(userId, mealId);
    expect(answered.status).toBe("ready");
    expect(answered.openQuestions).toBe(0);
    expect(answered.questions).toEqual([{ ...question, answer: "No" }]);
  });

  it("keeps hand edits through a correction, learns them, and replaces them only when asked", async () => {
    const userId = await newPerson();
    const mealId = await upload(userId);
    ai.queue("google", google.json(GOOD_MEAL), matchingReply("google"));
    await run();
    const rice = (await meal(userId, mealId)).items[0]!;

    // The person sets the rice to 150 g by hand: edited, and remembered as a usual meal.
    const edited = await updateItem(userId, rice.id, { grams: 150 });
    expect(edited).toMatchObject({ edited: true, grams: 150 });
    expect(edited!.nutrients.energy).toBeCloseTo(195, 5);
    const memory = await db.select().from(foodMemory).where(eq(foodMemory.userId, userId));
    expect(memory).toHaveLength(1);
    expect(memory[0]).toMatchObject({ foodId: food.rice, typicalGrams: 150, count: 1 });
    // Further edits of the same meal count once.
    await updateItem(userId, rice.id, { grams: 160 });
    const again = (await db.select().from(foodMemory).where(eq(foodMemory.userId, userId)))[0]!;
    expect(again).toMatchObject({ typicalGrams: 160, count: 1 });

    const corrected = await correctMeal(userId, mealId, "The drink was ayran, not doogh");
    expect(corrected.ok && corrected.meal.status).toBe("queued");

    ai.reset();
    const renamed = {
      ...GOOD_MEAL,
      items: GOOD_MEAL.items.map((item, i) =>
        i === 0 ? { ...item, same_as_item: "i1" } : i === 3 ? { ...item, name: "Ayran" } : item,
      ),
    };
    ai.queue("google", google.json(renamed), matchingReply("google"));
    await run();
    const prompt = promptOf("google", ai.requests[0]!);
    expect(prompt).toContain('"The drink was ayran, not doogh"');
    expect(prompt).toMatch(/i1: Rice, white, cooked, 160 g \[fixed/);
    expect(prompt).toContain(`u${again.id}: Rice, white, cooked (چلو), about 160 g`);

    const after = await meal(userId, mealId);
    expect(after.status).toBe("ready");
    expect(after.items.map((i) => [i.name, i.grams, i.edited])).toEqual([
      ["Rice, white, cooked", 160, true],
      ["Chicken breast, grilled", 180, false],
      ["Tomato, grilled", 80, false],
      ["Ayran", expect.any(Number), false],
    ]);
    expect(after.items[0]!.id).toBe(rice.id);

    // Asked to replace edits: the rice comes back as the model sees it.
    await correctMeal(userId, mealId, "Start over", { replaceEdits: true });
    ai.reset();
    ai.queue("google", google.json(GOOD_MEAL), matchingReply("google"));
    await run();
    expect(promptOf("google", ai.requests[0]!)).not.toContain("[fixed");
    const replaced = await meal(userId, mealId);
    expect(replaced.items[0]).toMatchObject({ grams: 250, edited: false });
    expect(replaced.items).toHaveLength(4);
  });

  it("uses a usual meal: the remembered food, or the person's own values scaled", async () => {
    const userId = await newPerson();
    // A home dish without a database food, corrected by hand once.
    const first = await upload(userId);
    ai.queue(
      "google",
      google.json(
        rawAnalysis({
          items: [
            rawItem({
              name: "Mama's kuku",
              kind: "dish",
              grams: 100,
              search_terms: ["kuku sabzi"],
              estimate: {
                kcal: 200,
                protein: 8,
                carbs: 6,
                fat: 16,
                fiber: 1,
                sugar: 1,
                sodium: 300,
              },
            }),
          ],
        }),
      ),
    );
    await run();
    const kuku = (await meal(userId, first)).items[0]!;
    expect(kuku.nutrientSource).toBe("ai_estimate");
    await updateItem(userId, kuku.id, { nutrients: { energy: 250, protein: 10, fat: 20 } });
    const memoryId = (await db.select().from(foodMemory).where(eq(foodMemory.userId, userId)))[0]!
      .id;

    // The next photo: the model links the usual meal; Cal scales the person's values.
    const second = await upload(userId);
    ai.reset();
    ai.queue(
      "google",
      google.json(
        rawAnalysis({
          items: [rawItem({ name: "Herb frittata", grams: 150, matches_usual: `u${memoryId}` })],
        }),
      ),
    );
    await run();
    expect(promptOf("google", ai.requests[0]!)).toContain(`u${memoryId}: Mama's kuku, about 100 g`);
    const [item] = (await meal(userId, second)).items;
    expect(item).toMatchObject({ nutrientSource: "usual", grams: 150 });
    expect(item!.nutrients).toEqual({ energy: 375, protein: 15, fat: 30 });
    expect(ai.requests).toHaveLength(1); // no matching call needed
  });

  it("links a planned recipe and counts its nutrition per serving", async () => {
    const userId = await newPerson();
    setPlannedRecipesSource(async (who, day) =>
      who === userId && day === "2026-10-31"
        ? [
            {
              id: "recipe-42",
              name: "Chicken curry",
              slot: "dinner",
              foodId: null,
              servingGrams: 400,
              nutritionPerServing: { energy: 600, protein: 40, carbs: 30, fat: 35 },
            },
          ]
        : [],
    );
    const mealId = await upload(userId);
    ai.queue(
      "google",
      google.json(
        rawAnalysis({
          items: [
            rawItem({ name: "Chicken curry", kind: "dish", grams: 300, matches_planned: "p1" }),
          ],
        }),
      ),
    );
    await run();
    expect(promptOf("google", ai.requests[0]!)).toContain(
      "p1: Chicken curry (dinner), one serving about 400 g",
    );
    const [item] = (await meal(userId, mealId)).items;
    expect(item).toMatchObject({ nutrientSource: "recipe", grams: 300 });
    expect(item!.nutrients).toEqual({ energy: 450, protein: 30, carbs: 22.5, fat: 26.25 });
    const analysis = (await db.execute(sql`select analysis from meals where id = ${mealId}`))
      .rows[0] as { analysis: { items: { matches_planned: string }[] } };
    expect(analysis.analysis.items[0]!.matches_planned).toBe("recipe-42");
  });

  it("falls back to trigram scores when the matching call fails", async () => {
    const userId = await newPerson();
    const mealId = await upload(userId);
    ai.queue("google", google.json(GOOD_MEAL), google.serverError);
    await run();
    const done = await meal(userId, mealId);
    expect(done.status).toBe("ready");
    expect(done.items.map((i) => i.foodId)).toEqual([
      food.rice,
      food.chicken,
      food.tomato,
      food.doogh,
    ]);
    const usage = await db.select().from(aiUsage).where(eq(aiUsage.userId, userId));
    expect(usage.map((u) => u.task)).toEqual(["analysis"]);
  });

  it("fails without a key, then succeeds on retry once a key is saved", async () => {
    const events: AnalysisFinishedEvent[] = [];
    setAnalysisFinishedListener((event) => {
      events.push(event);
      throw new Error("a broken listener never fails the job");
    });
    const user = await createUser();
    const mealId = await upload(user.id);
    await run();
    const failed = await meal(user.id, mealId);
    expect(failed.status).toBe("failed");
    expect(failed.error).toMatchObject({ kind: "no-key", settingsLink: true });
    expect(ai.requests).toHaveLength(0);

    await saveProviderKey(user.id, "google", TEST_API_KEY);
    const retried = await retryAnalysis(user.id, mealId);
    expect(retried.ok && retried.meal.status).toBe("queued");
    expect(retried.ok && retried.meal.error).toBeNull();
    ai.queue("google", google.json(GOOD_MEAL), matchingReply("google"));
    await run();
    expect((await meal(user.id, mealId)).status).toBe("ready");
    expect(events).toEqual([
      { userId: user.id, mealId, status: "failed", questions: 0, errorKind: "no-key" },
      { userId: user.id, mealId, status: "ready", questions: 0, errorKind: null },
    ]);
  });

  it("fails after the last attempt instead of waiting again", async () => {
    const userId = await newPerson();
    const mealId = await upload(userId);
    await db.execute(sql`update jobs set attempts = max_attempts - 1`);
    ai.queue("google", google.rateLimited);
    await run();
    const done = await meal(userId, mealId);
    expect(done.status).toBe("failed");
    expect(done.error).toMatchObject({ kind: "rate-limit", settingsLink: false });
    expect(done.error!.message).toContain("Try again");
    const job = (await db.select().from(jobs))[0]!;
    expect(job).toMatchObject({ status: "done" });
  });

  it("stays queued when a correction arrives while it is being analysed", async () => {
    const userId = await newPerson();
    const mealId = await upload(userId);
    const running = (await claimJob("test", [ANALYZE_MEAL_JOB]))!;
    expect(await correctMeal(userId, mealId, "Small portion")).toMatchObject({ ok: true });
    expect(await db.select().from(jobs)).toHaveLength(2);

    ai.queue("google", google.json(GOOD_MEAL), matchingReply("google"));
    await runJob(running, handlers);
    expect((await meal(userId, mealId)).status).toBe("queued");

    ai.queue("google", google.json(GOOD_MEAL), matchingReply("google"));
    expect(await run()).toBe(1);
    expect(promptOf("google", ai.requests[2]!)).toContain('"Small portion"');
    expect((await meal(userId, mealId)).status).toBe("ready");
  });
});

describe("analysis requests", () => {
  it("never touches another person's meal and needs photos", async () => {
    const owner = await newPerson();
    const other = await newPerson();
    const mealId = await upload(owner);
    ai.queue("google", google.json(MIXED_DISH), matchingReply("google"));
    await run();
    const question = (await meal(owner, mealId)).questions[0]!;

    for (const result of [
      await answerQuestion(other, mealId, question.id, "Yes"),
      await correctMeal(other, mealId, "It was chicken"),
      await retryAnalysis(other, mealId),
    ])
      expect(result).toEqual({ ok: false, status: 404, error: "Meal not found." });
    expect((await meal(owner, mealId)).status).toBe("needs_input");

    expect(await answerQuestion(owner, mealId, "q_missing", "Yes")).toMatchObject({ status: 404 });
    expect(await answerQuestion(owner, mealId, question.id, "   ")).toMatchObject({ status: 400 });
    expect(await correctMeal(owner, mealId, "")).toMatchObject({ status: 400 });

    const manual = await createMeal(owner, { source: "manual" });
    expect(await retryAnalysis(owner, manual.id)).toMatchObject({ status: 409 });
  });

  it("limits how often a person can ask for a new analysis", async () => {
    const userId = await newPerson();
    const mealId = await upload(userId);
    let last;
    for (let i = 0; i < 31; i += 1) last = await retryAnalysis(userId, mealId);
    expect(last).toMatchObject({ ok: false, status: 429 });
  });
});
