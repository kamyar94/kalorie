// Food search ranking on real FoodData Central rows (fixture extracts) and the seeded dishes.
import { beforeAll, describe, expect, it } from "vitest";

import { createCustomFood } from "@/lib/food/custom-foods";
import { rememberFood } from "@/lib/food/memory";
import { getFood, getFoodsByIds, searchFoods } from "@/lib/food/search";

import { importFdcFixtures, seedDishFixtures } from "../helpers/food-data";
import { createUser } from "../helpers/factories";

let userId: string;
const names = async (query: string, limit = 5, who = userId) =>
  (await searchFoods({ query, userId: who, limit })).map((f) => f.nameEn);

beforeAll(async () => {
  await importFdcFixtures();
  await seedDishFixtures();
  userId = (await createUser()).id;
});

describe("food search on real data", () => {
  it("puts the generic food first", async () => {
    expect((await names("rice cooked"))[0]).toBe("Rice, cooked, NFS");
    expect((await names("rice"))[0]).toBe("Rice, cooked, NFS");
    expect((await names("eggs"))[0]).toBe("Egg, whole, raw");
    const tomato = await names("tomatoes");
    expect(tomato[0]).toBe("Tomatoes, raw");
  });

  it("does not count not-specified markers as a longer, more specific name", async () => {
    // "no added fat" is plain cooked rice (129 kcal per 100 g); glutinous rice is a special
    // kind (96 kcal). The matching fallback takes the first candidates, so the order matters.
    for (const query of ["white rice cooked", "white rice", "cooked white rice"]) {
      const rice = await names(query, 10);
      const at = (name: string) => (rice.includes(name) ? rice.indexOf(name) : Infinity);
      expect(at("Rice, white, cooked, no added fat"), query).toBeLessThan(
        at("Rice, white, cooked, glutinous"),
      );
    }
  });

  it("puts recipe ingredients, baby food and imitation foods after plain foods", async () => {
    const rice = await names("rice cooked", 10);
    expect(rice.indexOf("Rice, brown, cooked, as ingredient")).toBeGreaterThan(
      rice.indexOf("Rice, brown, cooked, no added fat"),
    );
    const plainRice = await names("rice", 20);
    expect(plainRice.indexOf("Babyfood, cereal, rice, dry fortified")).toBeGreaterThan(
      plainRice.indexOf("Rice, white, cooked, no added fat"),
    );
    expect((await names("chicken"))[0]).not.toBe("Chicken, meatless, NFS");
    // Asked for, they come up.
    expect((await names("baby rice cereal"))[0]).toBe("Babyfood, cereal, rice, dry fortified");
  });

  it("tolerates typos", async () => {
    const chicken = await names("chiken breast");
    expect(chicken.length).toBeGreaterThan(0);
    expect(chicken[0]).toMatch(/^Chicken.*breast/i);
    expect((await names("yoghurt"))[0]).toBe("Yogurt, NFS");
    expect((await names("tomatos"))[0]).toBe("Tomatoes, raw");
  });

  it("finds Persian dishes by Persian name, spelling variants and synonyms", async () => {
    for (const query of [
      "قورمه‌سبزی",
      "قورمه سبزی",
      "قرمه سبزی",
      "ghormeh sabzi",
      "ghorme sabzi",
      "herb stew",
    ])
      expect((await names(query))[0], query).toMatch(/^Ghormeh sabzi/);
    expect((await names("تهدیگ"))[0]).toMatch(/^Tahdig/);
    expect((await names("ته دیگ"))[0]).toMatch(/^Tahdig/);
    expect((await names("كباب كوبيده"))[0]).toMatch(/^Kabab koobideh/); // Arabic letter forms
    expect((await names("koobideh"))[0]).toMatch(/^Kabab koobideh/);
    expect((await names("dough"))[0]).toMatch(/^Doogh/); // an exact synonym of the dish
    expect((await names("barberry rice"))[0]).toMatch(/^Zereshk polo/);
    const dish = (await searchFoods({ query: "fesenjoon", userId }))[0]!;
    expect(dish).toMatchObject({ kind: "dish", source: "dish", nameFa: "فسنجان" });
    expect(dish.portions[0]).toMatchObject({ label: "1 serving", labelFa: "۱ پرس" });
    expect(dish.servingGrams).toBeGreaterThan(0);
  });

  it("filters by kind and respects the limit", async () => {
    const dishes = await searchFoods({ query: "rice", userId, kinds: ["dish"], limit: 50 });
    expect(dishes.length).toBeGreaterThan(2);
    expect(dishes.every((f) => f.kind === "dish")).toBe(true);
    expect(await searchFoods({ query: "rice", userId, limit: 2 })).toHaveLength(2);
    expect(await searchFoods({ query: "  ,  ", userId })).toEqual([]);
    expect(await searchFoods({ query: "zzzzqqq", userId })).toEqual([]);
  });

  it("ranks the person's own foods, then their remembered foods, first; only for them", async () => {
    const me = (await createUser()).id;
    const other = (await createUser()).id;
    const plain = (await searchFoods({ query: "rice", userId: me, limit: 50 })).map(
      (f) => f.nameEn,
    );
    const target = (await searchFoods({ query: "rice white cooked no added fat", userId: me }))[0]!;
    expect(target.nameEn).toBe("Rice, white, cooked, no added fat");
    expect(plain[0]).not.toBe(target.nameEn);

    await rememberFood(me, { name: "white rice", foodId: target.id, grams: 180 });
    await rememberFood(me, { name: "white rice", foodId: target.id, grams: 200 });
    const remembered = await searchFoods({ query: "rice", userId: me });
    expect(remembered[0]!.id).toBe(target.id);

    const own = await createCustomFood(me, {
      nameEn: "Rice with saffron, home style",
      per100g: { energy: 150 },
    });
    const withOwn = await searchFoods({ query: "rice", userId: me });
    expect(withOwn[0]).toMatchObject({ id: own.id, personal: true });
    expect(withOwn[1]!.id).toBe(target.id);

    // A remembered name finds its food even when the food's name does not match.
    const kuku = (await searchFoods({ query: "kuku sabzi", userId: me }))[0]!;
    await rememberFood(me, { name: "green omelette", foodId: kuku.id });
    expect((await searchFoods({ query: "green omelette", userId: me }))[0]!.id).toBe(kuku.id);

    // None of this shows for someone else.
    const theirs = await searchFoods({ query: "rice", userId: other, limit: 50 });
    expect(theirs.some((f) => f.id === own.id)).toBe(false);
    expect(theirs.map((f) => f.nameEn)).toEqual(plain);
    expect(await getFood(own.id, other)).toBeNull();
    expect((await getFoodsByIds([own.id, target.id], other)).size).toBe(1);
  });
});
