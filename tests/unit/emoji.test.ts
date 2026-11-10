import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cleanEmoji, emojiFor, shortFoodName } from "@/lib/food/emoji";

describe("emojiFor", () => {
  it("knows the Persian dishes Cal seeds, by their Latin and Persian names", () => {
    const dishes = (
      JSON.parse(
        readFileSync(path.join(process.cwd(), "scripts/data/persian-dishes.json"), "utf8"),
      ) as { dishes: { nameEn: string; nameFa: string }[] }
    ).dishes;
    const expected: Record<string, string> = {
      Chelow: "🍚",
      Tahdig: "🍚",
      "Zereshk polo": "🍚",
      "Sabzi polo": "🍚",
      "Adas polo": "🍚",
      "Lubia polo": "🍚",
      "Ghormeh sabzi": "🍲",
      Gheymeh: "🍲",
      Fesenjan: "🍲",
      "Khoresh bademjan": "🍲",
      "Kabab koobideh": "🍢",
      "Joojeh kabab": "🍢",
      "Ash reshteh": "🍲",
      "Kashk bademjan": "🍆",
      "Mirza ghasemi": "🍆",
      "Kuku sabzi": "🍳",
      Kotlet: "🧆",
      Olivieh: "🥗",
      "Shirazi salad": "🥗",
      "Sholeh zard": "🍮",
      Doogh: "🥛",
    };
    expect(dishes.length).toBe(Object.keys(expected).length);
    for (const dish of dishes) {
      const short = shortFoodName(dish.nameEn);
      expect(emojiFor(dish.nameEn, "dish"), dish.nameEn).toBe(expected[short]);
      // The Persian name alone finds the same family.
      expect(emojiFor("", "dish", [dish.nameFa]), dish.nameFa).toBe(expected[short]);
    }
  });

  it("covers common foods and drinks", () => {
    const cases: [string, string, string][] = [
      ["Rice, white, cooked", "dish", "🍚"],
      ["Chicken breast, roasted", "ingredient", "🍗"],
      ["Beef steak, grilled", "ingredient", "🥩"],
      ["Salmon, baked", "ingredient", "🐟"],
      ["Egg, fried", "ingredient", "🍳"],
      ["Bread, whole wheat", "ingredient", "🍞"],
      ["Toast with butter", "dish", "🍞"],
      ["Cheese, feta", "ingredient", "🧀"],
      ["Milk, whole", "drink", "🥛"],
      ["Yogurt, plain", "ingredient", "🥣"],
      ["Coffee with milk", "drink", "☕"],
      ["Tea with sugar", "drink", "🍵"],
      ["Water", "drink", "💧"],
      ["Sparkling water", "drink", "💧"],
      ["Orange juice", "drink", "🧃"],
      ["Cola", "drink", "🥤"],
      ["Beer, lager", "drink", "🍺"],
      ["Red wine", "drink", "🍷"],
      ["Apple", "ingredient", "🍎"],
      ["Banana", "ingredient", "🍌"],
      ["Watermelon", "ingredient", "🍉"],
      ["Mixed green salad", "dish", "🥗"],
      ["Potato, boiled", "ingredient", "🥔"],
      ["French fries", "dish", "🍟"],
      ["Pizza, margherita", "dish", "🍕"],
      ["Cheeseburger", "dish", "🍔"],
      ["Spaghetti bolognese", "dish", "🍝"],
      ["Lentil soup", "dish", "🍲"],
      ["Chocolate cake", "dish", "🍰"],
      ["Pancakes", "dish", "🥞"],
      ["Oatmeal cookie", "dish", "🍪"],
      ["Dark chocolate", "ingredient", "🍫"],
      ["Vanilla ice cream", "dish", "🍨"],
      ["Almonds", "ingredient", "🥜"],
      ["Peanut butter", "ingredient", "🥜"],
      ["Cashews", "ingredient", "🥜"],
      ["Olive oil", "ingredient", "🫒"],
      ["Vegetable oil", "ingredient", "🫒"],
      ["Butter", "ingredient", "🧈"],
      ["Honey", "ingredient", "🍯"],
      ["Chicken sandwich", "dish", "🥪"],
      ["Corn flakes cereal", "dish", "🥣"],
      ["Eggplant, grilled", "ingredient", "🍆"],
      ["Steak", "ingredient", "🥩"],
    ];
    for (const [name, kind, emoji] of cases) expect(emojiFor(name, kind), name).toBe(emoji);
  });

  it("falls back on the food's name, then the kind", () => {
    expect(emojiFor("Plate leftovers", "dish", ["Rice, brown, cooked"])).toBe("🍚");
    expect(emojiFor("Something unusual", "drink")).toBe("🥤");
    expect(emojiFor("Something unusual", "dish")).toBe("🍽️");
    expect(emojiFor(null, null)).toBe("🍽️");
  });
});

describe("cleanEmoji", () => {
  it("keeps exactly one emoji, joined sequences included", () => {
    expect(cleanEmoji("🍚")).toBe("🍚");
    expect(cleanEmoji(" 🍽️ ")).toBe("🍽️");
    expect(cleanEmoji("🧑‍🍳")).toBe("🧑‍🍳");
  });

  it("refuses text, two emojis and anything else", () => {
    for (const value of ["", "rice", "🍚🍗", "🍚 rice", ":)", "1", null, 3, undefined])
      expect(cleanEmoji(value), String(value)).toBeNull();
  });
});

describe("shortFoodName", () => {
  it("keeps the part before the first detail", () => {
    expect(shortFoodName("Rice, white, cooked")).toBe("Rice");
    expect(shortFoodName("Chicken breast, roasted")).toBe("Chicken breast");
    expect(shortFoodName("Lubia polo (green bean rice with beef)")).toBe("Lubia polo");
    expect(shortFoodName("Mixed green salad")).toBe("Mixed green salad");
  });
});
