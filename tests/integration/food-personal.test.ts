// Personal foods and dishes, food memory and DRI targets against Postgres.
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { foods, users } from "@/db/schema";
import { createDish, getDishComponents, updateDish } from "@/lib/food/dishes";
import { FoodInputError } from "@/lib/food/errors";
import {
  forgetFood,
  frequentFoods,
  recallFoods,
  recentFoods,
  rememberFood,
  usualFoods,
} from "@/lib/food/memory";
import {
  copyFood,
  createCustomFood,
  deleteCustomFood,
  listCustomFoods,
  updateCustomFood,
} from "@/lib/food/custom-foods";
import { getFood, searchFoods } from "@/lib/food/search";
import { getTargets, setCustomTarget } from "@/lib/targets/service";

import { createFood, createItem, createMeal, createUser } from "../helpers/factories";

let rice: string;
let butter: string;

beforeAll(async () => {
  rice = (
    await createFood({
      nameEn: "Rice, cooked",
      source: "fdc_sr_legacy",
      sourceId: "1",
      nutrients: { energy: 130, protein: 2.7, carbs: 28, water: 68 },
    })
  ).id;
  butter = (
    await createFood({
      nameEn: "Butter",
      source: "fdc_sr_legacy",
      sourceId: "2",
      nutrients: { energy: 717, fat: 81, water: 16 },
    })
  ).id;
});

describe("personal foods", () => {
  it("creates foods from values per 100 g or per serving, with portions", async () => {
    const user = await createUser();
    const bar = await createCustomFood(user.id, {
      nameEn: "Date and walnut bar",
      nameFa: "شیرینی خرما",
      synonyms: ["date bar"],
      perServing: { energy: 180, protein: 4 },
      servingGrams: 40,
      barcode: "3017620422003",
    });
    expect(bar).toMatchObject({
      source: "user",
      kind: "food",
      personal: true,
      servingGrams: 40,
      barcode: "3017620422003",
      sourceNote: "Your own food",
    });
    expect(bar.per100g).toEqual({ energy: 450, protein: 10 });
    expect(bar.portions).toEqual([expect.objectContaining({ label: "1 serving", grams: 40 })]);
    expect((await searchFoods({ query: "خرما", userId: user.id }))[0]!.id).toBe(bar.id);
    expect((await searchFoods({ query: "date bar", userId: user.id }))[0]!.id).toBe(bar.id);

    await expect(createCustomFood(user.id, { nameEn: " " })).rejects.toThrow(FoodInputError);
    await expect(
      createCustomFood(user.id, { nameEn: "x", perServing: { energy: 1 } }),
    ).rejects.toThrow(/serving weight/);
    await expect(createCustomFood(user.id, { nameEn: "x", barcode: "12" })).rejects.toThrow(
      /barcode/,
    );
  });

  it("edits, copies, lists and deletes only the owner's foods", async () => {
    const owner = await createUser();
    const other = await createUser();
    const food = await createCustomFood(owner.id, { nameEn: "Lavash", per100g: { energy: 280 } });

    expect(await updateCustomFood(other.id, food.id, { nameEn: "mine" })).toBeNull();
    expect(await deleteCustomFood(other.id, food.id)).toBe(false);
    expect(await copyFood(other.id, food.id)).toBeNull();

    const edited = await updateCustomFood(owner.id, food.id, {
      nameEn: "Lavash bread",
      per100g: { energy: 275, carbs: 55 },
      portions: [{ label: "1 sheet", labelFa: "۱ عدد", grams: 45 }],
    });
    expect(edited).toMatchObject({ nameEn: "Lavash bread", per100g: { energy: 275, carbs: 55 } });
    expect(edited!.portions).toEqual([expect.objectContaining({ label: "1 sheet", grams: 45 })]);
    expect((await listCustomFoods(owner.id)).map((f) => f.id)).toEqual([food.id]);
    expect(await listCustomFoods(other.id)).toEqual([]);

    // A shared food copied becomes the person's own.
    const copy = await copyFood(other.id, rice, { nameEn: "My rice" });
    expect(copy).toMatchObject({ nameEn: "My rice", personal: true, per100g: { energy: 130 } });

    expect(await deleteCustomFood(owner.id, food.id)).toBe(true);
    expect(await getFood(food.id, owner.id)).toBeNull();
    // Shared foods cannot be changed or deleted through these functions.
    expect(await updateCustomFood(owner.id, rice, { nameEn: "x" })).toBeNull();
    expect(await deleteCustomFood(owner.id, rice)).toBe(false);
  });
});

describe("dishes", () => {
  it("computes a dish from components and keeps it up to date", async () => {
    const user = await createUser();
    const ghee = await createCustomFood(user.id, {
      nameEn: "Ghee",
      per100g: { energy: 900, fat: 100 },
    });
    const dish = await createDish(user.id, {
      nameEn: "Mum's chelow",
      nameFa: "چلو مامان",
      components: [
        { foodId: rice, grams: 200 },
        { foodId: ghee.id, grams: 10, note: "on top" },
      ],
    });
    expect(dish).toMatchObject({ kind: "dish", source: "user", personal: true, servingGrams: 210 });
    expect((dish.per100g.energy! * 210) / 100).toBeCloseTo(260 + 90, 2);
    expect(dish.portions).toEqual([expect.objectContaining({ label: "1 serving", grams: 210 })]);
    const parts = (await getDishComponents(user.id, dish.id))!;
    expect(parts.map((p) => [p.nameEn, p.grams, p.note])).toEqual([
      ["Rice, cooked", 200, null],
      ["Ghee", 10, "on top"],
    ]);
    expect(parts[1]!.nutrients.energy).toBeCloseTo(90);

    // A component's values change: the dish follows.
    await updateCustomFood(user.id, ghee.id, { per100g: { energy: 800, fat: 90 } });
    expect(((await getFood(dish.id, user.id))!.per100g.energy! * 210) / 100).toBeCloseTo(340, 2);

    // New components: the serving weight follows their sum...
    const more = await updateDish(user.id, dish.id, {
      components: [
        { foodId: rice, grams: 250 },
        { foodId: ghee.id, grams: 10 },
      ],
    });
    expect(more!.servingGrams).toBe(260);
    expect(more!.portions[0]!.grams).toBe(260);
    // ...unless a cooked weight is set; then it stays with new components.
    const cooked = await updateDish(user.id, dish.id, { servingGrams: 230 });
    expect(cooked!.servingGrams).toBe(230);
    expect((cooked!.per100g.energy! * 230) / 100).toBeCloseTo(325 + 80, 2);
    const kept = await updateDish(user.id, dish.id, {
      components: [
        { foodId: rice, grams: 240 },
        { foodId: ghee.id, grams: 10 },
      ],
    });
    expect(kept!.servingGrams).toBe(230);
    expect((await updateDish(user.id, dish.id, { servingGrams: null }))!.servingGrams).toBe(250);

    // A dish inside another dish is recomputed too.
    const plate = await createDish(user.id, {
      nameEn: "Chelow plate",
      components: [
        { foodId: dish.id, grams: 250 },
        { foodId: butter, grams: 5 },
      ],
    });
    const before = plate.per100g.energy!;
    await updateCustomFood(user.id, ghee.id, { per100g: { energy: 900, fat: 100 } });
    expect((await getFood(plate.id, user.id))!.per100g.energy!).toBeGreaterThan(before);

    // A used food cannot be deleted; a dish cannot contain itself.
    await expect(deleteCustomFood(user.id, ghee.id)).rejects.toMatchObject({ code: "in_use" });
    await expect(
      updateDish(user.id, dish.id, { components: [{ foodId: plate.id, grams: 10 }] }),
    ).rejects.toMatchObject({ code: "cycle" });
    await expect(
      updateDish(user.id, dish.id, { components: [{ foodId: dish.id, grams: 10 }] }),
    ).rejects.toMatchObject({ code: "cycle" });
  });

  it("refuses components the person cannot see, and keeps dishes private", async () => {
    const owner = await createUser();
    const other = await createUser();
    const secret = await createCustomFood(owner.id, {
      nameEn: "Secret sauce",
      per100g: { energy: 300 },
    });
    await expect(
      createDish(other.id, { nameEn: "Copycat", components: [{ foodId: secret.id, grams: 10 }] }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(createDish(other.id, { nameEn: "Empty", components: [] })).rejects.toThrow(
      /at least one/,
    );
    const dish = await createDish(owner.id, {
      nameEn: "Sauced rice",
      components: [
        { foodId: rice, grams: 100 },
        { foodId: secret.id, grams: 20 },
      ],
    });
    expect(await getDishComponents(other.id, dish.id)).toBeNull();
    expect(await updateDish(other.id, dish.id, { nameEn: "x" })).toBeNull();
    // A shared seeded dish copied keeps its components.
    const [shared] = await db
      .insert(foods)
      .values({
        source: "dish",
        sourceId: "x",
        kind: "dish",
        nameEn: "Seeded dish",
        servingGrams: 100,
      })
      .returning();
    await db.execute(
      sql`insert into dish_components (dish_id, component_id, grams) values (${shared!.id}, ${rice}, 100)`,
    );
    const copy = (await copyFood(other.id, shared!.id))!;
    expect((await getDishComponents(other.id, copy.id))!.map((p) => p.foodId)).toEqual([rice]);
  });
});

describe("food memory", () => {
  it("remembers corrections by name and Persian name and follows the typical weight", async () => {
    const user = await createUser();
    const first = await rememberFood(user.id, {
      name: "Steamed rice",
      localName: "چلو",
      foodId: rice,
      grams: 200,
      snapshot: { grams: 200 },
    });
    expect(first).toMatchObject({
      nameKey: "steamed rice",
      foodId: rice,
      foodName: "Rice, cooked",
      count: 1,
      typicalGrams: 200,
    });
    const second = await rememberFood(user.id, { name: "steamed  RICE", foodId: rice, grams: 300 });
    expect(second).toMatchObject({ count: 2, typicalGrams: 250, snapshot: { grams: 200 } });

    const recalled = await recallFoods(user.id, ["Steamed rice", "چلو", "steamed rices", "pizza"]);
    expect(recalled.get("Steamed rice")?.count).toBe(2);
    expect(recalled.get("چلو")?.foodId).toBe(rice);
    expect(recalled.get("steamed rices")?.nameKey).toBe("steamed rice"); // similar name
    expect(recalled.has("pizza")).toBe(false);

    // Corrected to another food: the memory starts over with it.
    const changed = await rememberFood(user.id, {
      name: "steamed rice",
      foodId: butter,
      grams: 10,
    });
    expect(changed).toMatchObject({ foodId: butter, count: 1, typicalGrams: 10 });

    // Most corrected first, then most recent.
    expect((await usualFoods(user.id)).map((e) => e.nameKey)).toEqual(["steamed rice", "چلو"]);
    const someone = await createUser();
    expect(await usualFoods(someone.id)).toEqual([]);
    expect((await recallFoods(someone.id, ["steamed rice"])).size).toBe(0);
    expect(await rememberFood(someone.id, { name: "x", foodId: "not-a-uuid" })).toBeNull();
    const privateFood = await createCustomFood(user.id, { nameEn: "Mine", per100g: { energy: 1 } });
    expect(await rememberFood(someone.id, { name: "mine", foodId: privateFood.id })).toBeNull();

    expect(await forgetFood(someone.id, first!.id)).toBe(false);
    expect(await forgetFood(user.id, first!.id)).toBe(true);
    expect((await recallFoods(user.id, ["steamed rice"])).size).toBe(0);
  });

  it("lists recent and frequent foods from logged items and corrections", async () => {
    const user = await createUser();
    const meal = await createMeal(user.id);
    await createItem(user.id, meal.id, { foodId: rice, grams: 180 });
    await createItem(user.id, meal.id, { foodId: rice, grams: 220 });
    // Corrected a minute from now: the latest use (database and test clocks may differ a little).
    await rememberFood(user.id, {
      name: "butter",
      foodId: butter,
      grams: 10,
      at: new Date(Date.now() + 60_000),
    });
    const deleted = await createMeal(user.id, { deletedAt: new Date() });
    await createItem(user.id, deleted.id, { foodId: butter, grams: 10 });

    const frequent = await frequentFoods(user.id);
    expect(frequent.map((f) => [f.food.id, f.count])).toEqual([
      [rice, 2],
      [butter, 1],
    ]);
    expect(frequent[0]!.typicalGrams).toBe(220);
    const recent = await recentFoods(user.id);
    expect(recent[0]!.food.id).toBe(butter);
    expect(await recentFoods((await createUser()).id)).toEqual([]);
  });
});

describe("targets with the DRI table", () => {
  it("adds vitamins and minerals by sex and age, and keeps edits", async () => {
    const user = await createUser();
    const defaults = await getTargets(user.id);
    expect(defaults.targets.iron).toMatchObject({ target: 18, basis: "default" });

    await db
      .update(users)
      .set({ sex: "male", birthYear: new Date().getUTCFullYear() - 40 })
      .where(eq(users.id, user.id));
    const dri = await getTargets(user.id);
    expect(dri.fromProfile).toBe(false);
    expect(dri.targets.iron).toMatchObject({ target: 8, upper: 45, kind: "range", basis: "dri" });
    expect(dri.targets.vit_c).toMatchObject({ target: 90, upper: 2000 });
    expect(dri.targets.fiber).toMatchObject({ target: 38, basis: "dri" });
    expect(dri.targets.sodium).toMatchObject({ target: 2300, kind: "max", basis: "dri" });

    await setCustomTarget(user.id, "iron", { target: 12 });
    expect((await getTargets(user.id)).targets.iron).toMatchObject({
      target: 12,
      custom: true,
      basis: "custom",
    });
  });
});
