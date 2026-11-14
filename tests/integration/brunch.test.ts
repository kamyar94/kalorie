// Brunch (lib/meals/classify.ts, lib/meals/service.ts reclassifyDay) against Postgres and the
// provider mock: a meal in words that says brunch, as Today shows it; the time rule for the day's
// first main meal with the default windows and the person's own; the day named again when a
// breakfast is added, moved or removed; slots chosen by hand; the meal's title; and what the
// model is told about the day, with its brunch following the day.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { sql } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { MealCard } from "@/components/app/meal-card";
import { db } from "@/db";
import { exportUserData, mealsToCsv } from "@/lib/account/data";
import { updatePreferences } from "@/lib/account/settings";
import { saveProviderKey } from "@/lib/ai/service";
import { analyzeMealHandler } from "@/lib/analysis/handler";
import { ANALYZE_MEAL_JOB } from "@/lib/contracts/analysis";
import { MEAL_SLOT_LABELS } from "@/lib/contracts/meals";
import { createPhotoMeal } from "@/lib/meals/create";
import { createManualMeal } from "@/lib/meals/manual";
import { addItem, deleteMeal, getMeal, listMealsForDay, updateMeal } from "@/lib/meals/service";
import { drainJobs } from "@/lib/queue/worker";
import { GOOD_MEAL, matchingReply, promptOf, seedFixtureFoods } from "@/tests/fixtures/analysis";
import {
  aiReplies,
  startAiMock,
  TEST_API_KEY,
  useAiMock,
  type AiMock,
} from "@/tests/helpers/ai-mock";
import { createItem, createMeal, createUser } from "@/tests/helpers/factories";

let ai: AiMock;
let restore: () => void;
let root: string;

const handlers = { [ANALYZE_MEAL_JOB]: analyzeMealHandler };
const run = () => drainJobs(handlers);
const google = aiReplies.google;

beforeAll(async () => {
  ai = await startAiMock();
  restore = useAiMock(ai);
  root = mkdtempSync(path.join(os.tmpdir(), "cal-brunch-"));
  process.env.PHOTO_ROOT = root;
  await seedFixtureFoods();
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

// Today and yesterday in UTC, at set clock times (the services take any time).
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const utc = (time: string, day = today) => `${day}T${time}:00Z`;

const person = async () => {
  const user = await createUser();
  await saveProviderKey(user.id, "google", TEST_API_KEY);
  return user.id;
};

/** A meal of one food logged by hand (no model type), named after the food. */
const plate = async (userId: string, time: string, name: string, energy: number, day = today) =>
  createManualMeal(userId, {
    eatenAt: utc(time, day),
    tz: "UTC",
    items: [{ name, nutrients: { energy } }],
  });

const slotOf = async (userId: string, mealId: string) => (await getMeal(userId, mealId))!.slot;

const jpeg = () =>
  sharp({ create: { width: 800, height: 600, channels: 3, background: "#c08040" } })
    .jpeg()
    .toBuffer();

describe("brunch", () => {
  it("names a text meal 'Brunch: eggs, toast and salad' at 11:30 a brunch, and Today shows Brunch", async () => {
    const userId = await person();
    // 08:00 UTC is 11:30 in Tehran.
    const { meal } = await createPhotoMeal({
      userId,
      clientId: null,
      eatenAt: new Date(utc("08:00")),
      tz: "Asia/Tehran",
      note: "Brunch: eggs, toast and salad",
      photos: [],
    });
    // The words name it at once, before the analysis.
    expect(meal).toMatchObject({ source: "text", localTime: "11:30", slot: "brunch" });

    // The model calls it lunch; the person's words win.
    ai.queue(
      "google",
      google.json({ ...GOOD_MEAL, title: "Eggs, toast and salad", meal_type: "lunch" }),
      matchingReply("google"),
    );
    await run();
    const prompt = promptOf("google", ai.requests[0]!);
    expect(prompt).toContain(
      'The person\'s description of the meal: "Brunch: eggs, toast and salad"',
    );
    expect(prompt).toMatch(/Eaten at 11:30 on a \w+ \(brunch\)\./);
    expect(prompt).toContain("Earlier that day: nothing logged; no breakfast logged.");

    const day = await listMealsForDay(userId, meal.localDate);
    expect(day).toHaveLength(1);
    expect(day[0]).toMatchObject({
      id: meal.id,
      status: "ready",
      slot: "brunch",
      slotLocked: false,
      title: "Eggs, toast and salad",
    });
    expect(day[0]!.totals.energy).toBeGreaterThan(250);
    expect(MEAL_SLOT_LABELS[day[0]!.slot]).toBe("Brunch");
    // Today's timeline card: "11:30 · Brunch".
    const card = renderToStaticMarkup(
      createElement(MealCard, { meal: day[0]!, href: `/meals/${meal.id}` }),
    );
    expect(card).toContain('<span class="tabular">11:30</span> · Brunch');
    expect(card).toContain('aria-label="Eggs, toast and salad at 11:30"');
    // The export says brunch too.
    const exported = (await exportUserData(userId))!;
    expect(exported.meals.map((m) => m.slot)).toEqual(["brunch"]);
    expect(mealsToCsv(exported).split("\n")[1]).toMatch(
      /^\d{4}-\d\d-\d\d,11:30,Asia\/Tehran,brunch,/,
    );
  });

  it("leaves the meals before a change as they are, so old days are not named again", async () => {
    const userId = (await createUser()).id;
    // Logged before brunch existed: the day's first meal at 12:10 was a lunch.
    const old = await createMeal(userId, {
      eatenAt: new Date(utc("12:10", yesterday)),
      localDate: yesterday,
      slot: "lunch",
      title: "Eggs, toast and salad",
    });
    await createItem(userId, old.id, {
      name: "Eggs, toast and salad",
      nutrients: { energy: 1119 },
    });
    // A dinner logged later that day does not rename it...
    expect((await plate(userId, "19:00", "Stew", 700, yesterday)).slot).toBe("dinner");
    expect(await slotOf(userId, old.id)).toBe("lunch");
    // ...a change to the meal itself does.
    await addItem(userId, old.id, { name: "Orange juice", kind: "drink", ml: 200 });
    expect(await slotOf(userId, old.id)).toBe("brunch");
  });

  it("is the day's first main meal from 10:00 to 12:30; a later meal in the lunch window stays lunch", async () => {
    const userId = (await createUser()).id;
    expect((await plate(userId, "08:05", "Coffee with milk", 60)).slot).toBe("breakfast");
    // A small breakfast is still a breakfast, so this day has no brunch.
    expect((await plate(userId, "11:30", "Eggs and toast", 640)).slot).toBe("lunch");

    const other = (await createUser()).id;
    // Drinks alone and small bites are not the day's first main meal.
    await createManualMeal(other, {
      eatenAt: utc("08:00"),
      tz: "UTC",
      items: [{ name: "Tea", kind: "drink", ml: 250, nutrients: { energy: 2 } }],
    });
    expect((await plate(other, "11:00", "Apple", 95)).slot).toBe("snack");
    const brunch = await plate(other, "11:30", "Eggs and toast", 640);
    expect(brunch.slot).toBe("brunch");
    expect((await plate(other, "12:20", "Rice and stew", 700)).slot).toBe("lunch");
    expect(await slotOf(other, brunch.id)).toBe("brunch");
    // Outside 10:00 to 12:30 on a day without breakfast: the windows name it.
    const third = (await createUser()).id;
    expect((await plate(third, "12:31", "Rice and stew", 700)).slot).toBe("lunch");
    const fourth = (await createUser()).id;
    expect((await plate(fourth, "09:59", "Omelette", 400)).slot).toBe("breakfast");
  });

  it("names the day again when a breakfast is added, moved or removed", async () => {
    const userId = (await createUser()).id;
    // The meal of the report: first of the day at 12:10, 1,119 kcal.
    const meal = await plate(userId, "12:10", "Eggs, toast and salad", 1119);
    expect(meal.slot).toBe("brunch");

    // A breakfast logged afterwards for the morning: the brunch is a lunch now.
    const breakfast = await plate(userId, "08:45", "Toast and tea", 180);
    expect(breakfast.slot).toBe("breakfast");
    expect(await slotOf(userId, meal.id)).toBe("lunch");
    // Removed: a brunch again.
    expect(await deleteMeal(userId, breakfast.id)).toBe(true);
    expect(await slotOf(userId, meal.id)).toBe("brunch");

    // A later snack moved to the morning is the breakfast, and the meal a lunch.
    const snack = await plate(userId, "16:00", "Yogurt and fruit", 300);
    expect(snack.slot).toBe("snack");
    expect(await updateMeal(userId, snack.id, { eatenAt: utc("08:00") })).toMatchObject({
      slot: "breakfast",
    });
    expect(await slotOf(userId, meal.id)).toBe("lunch");
    // Moved to the day before: the day it left has its brunch again.
    expect(await updateMeal(userId, snack.id, { eatenAt: utc("08:00", yesterday) })).toMatchObject({
      localDate: yesterday,
      slot: "breakfast",
    });
    expect(await slotOf(userId, meal.id)).toBe("brunch");
    // Moved later than the meal: the meal is the day's first main meal.
    await updateMeal(userId, snack.id, { eatenAt: utc("13:00") });
    expect(await slotOf(userId, snack.id)).toBe("lunch");
    expect(await slotOf(userId, meal.id)).toBe("brunch");
  });

  it("keeps slots chosen by hand, and they count for the rest of the day", async () => {
    const userId = (await createUser()).id;
    const meal = await plate(userId, "11:30", "Eggs and toast", 640);
    expect(await updateMeal(userId, meal.id, { slot: "brunch" })).toMatchObject({
      slot: "brunch",
      slotLocked: true,
    });
    await plate(userId, "08:30", "Toast", 180);
    expect(await getMeal(userId, meal.id)).toMatchObject({ slot: "brunch", slotLocked: true });

    // A big late-morning bite is the brunch, the meal after it a lunch...
    const other = (await createUser()).id;
    const bite = await plate(other, "10:15", "Granola with yogurt", 400);
    const next = await plate(other, "12:15", "Rice and stew", 700);
    expect([bite.slot, next.slot]).toEqual(["brunch", "lunch"]);
    // ...until the person calls it a snack: then the next meal is the brunch.
    await updateMeal(other, bite.id, { slot: "snack" });
    expect(await slotOf(other, next.id)).toBe("brunch");
    // Called a breakfast: a lunch again.
    await updateMeal(other, bite.id, { slot: "breakfast" });
    expect(await slotOf(other, next.id)).toBe("lunch");
  });

  it("follows the person's own meal windows from Settings", async () => {
    const withWindows = async (breakfast: [string, string], lunch: [string, string]) => {
      const userId = (await createUser()).id;
      await updatePreferences(userId, {
        mealWindows: { breakfast, lunch, dinner: ["19:00", "22:00"] },
      });
      return userId;
    };
    // 10:30 to 13:30 with these windows; 10:00 to 12:30 with the defaults.
    const late = (): Promise<string> => withWindows(["07:00", "11:00"], ["12:00", "16:00"]);
    expect((await plate(await late(), "13:15", "Omelette and salad", 520)).slot).toBe("brunch");
    expect((await plate(await late(), "10:15", "Omelette and salad", 520)).slot).toBe("breakfast");
    expect((await plate((await createUser()).id, "13:15", "Omelette and salad", 520)).slot).toBe(
      "lunch",
    );
    // 07:30 to 11:30 with these.
    const early = (): Promise<string> => withWindows(["05:00", "08:00"], ["10:00", "13:00"]);
    expect((await plate(await early(), "11:20", "Omelette and salad", 520)).slot).toBe("brunch");
    expect((await plate(await early(), "11:45", "Omelette and salad", 520)).slot).toBe("lunch");
  });

  it("is what the meal's title or note says, in English or Persian", async () => {
    const userId = (await createUser()).id;
    const meal = await plate(userId, "14:30", "Pancakes", 500);
    expect(meal.slot).toBe("lunch");
    expect(await updateMeal(userId, meal.id, { title: "Late brunch" })).toMatchObject({
      slot: "brunch",
      slotLocked: false,
    });
    expect(await updateMeal(userId, meal.id, { title: "Pancakes" })).toMatchObject({
      slot: "lunch",
    });
    expect(await updateMeal(userId, meal.id, { note: "برانچ با دوستان" })).toMatchObject({
      slot: "brunch",
    });
  });

  it("tells the model about the day's breakfast, and its brunch follows the day", async () => {
    const userId = await person();
    const breakfast = await plate(userId, "08:40", "Toast and tea", 180);
    const { meal } = await createPhotoMeal({
      userId,
      clientId: null,
      eatenAt: new Date(utc("11:45")),
      tz: "UTC",
      note: null,
      photos: [await jpeg()],
    });
    expect(meal.slot).toBe("lunch");
    ai.queue("google", google.json({ ...GOOD_MEAL, meal_type: "brunch" }), matchingReply("google"));
    await run();
    expect(promptOf("google", ai.requests[0]!)).toContain(
      "Earlier that day: breakfast at 08:40; a breakfast was already logged.",
    );
    // A brunch after the day's breakfast is a lunch, and a brunch again once it is removed.
    expect(await slotOf(userId, meal.id)).toBe("lunch");
    await deleteMeal(userId, breakfast.id);
    expect(await slotOf(userId, meal.id)).toBe("brunch");

    // The model's lunch for the first meal of the day at 12:10 (the report): a brunch.
    const other = await person();
    const { meal: first } = await createPhotoMeal({
      userId: other,
      clientId: null,
      eatenAt: new Date(utc("12:10")),
      tz: "UTC",
      note: null,
      photos: [await jpeg()],
    });
    ai.reset();
    ai.queue("google", google.json({ ...GOOD_MEAL, meal_type: "lunch" }), matchingReply("google"));
    await run();
    expect(promptOf("google", ai.requests[0]!)).toContain(
      "Earlier that day: nothing logged; no breakfast logged.",
    );
    expect(await getMeal(other, first.id)).toMatchObject({ status: "ready", slot: "brunch" });
  });
});
