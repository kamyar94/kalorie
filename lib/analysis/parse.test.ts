import { describe, expect, it } from "vitest";

import { AiError } from "@/lib/ai/errors";

import { cleanBarcode, parseAnalysis, PARSE_LIMITS, type PromptRefs } from "./parse";

const refs = (): PromptRefs => ({
  photoCount: 2,
  usual: new Map([["u7", "7"]]),
  planned: new Map([["p1", "recipe-1"]]),
  current: new Map([["i1", "item-uuid-1"]]),
});

const item = (overrides: Record<string, unknown> = {}) => ({
  name: "Rice, white, cooked",
  local_name: "",
  kind: "dish",
  preparation: "",
  grams: 200,
  ml: 0,
  grams_low: 150,
  grams_high: 260,
  portion_text: "",
  confidence: 0.8,
  photo_indexes: [0],
  search_terms: ["white rice"],
  matches_usual: "",
  matches_planned: "",
  same_as_item: "",
  components: [],
  label: [],
  estimate: { kcal: 260, protein: 5, carbs: 56, fat: 0.6, fiber: 0.8, sugar: 0, sodium: 2 },
  ...overrides,
});

const reply = (overrides: Record<string, unknown> = {}) => ({
  is_food: true,
  cuisine: "",
  items: [item()],
  title: "Rice",
  questions: [],
  overall_confidence: 0.7,
  ...overrides,
});

describe("parseAnalysis", () => {
  it("turns empty values into null and keeps the rest", () => {
    const { output, sameAs } = parseAnalysis(reply(), refs());
    expect(output).toMatchObject({ is_food: true, title: "Rice", cuisine: null });
    expect(output.items[0]).toMatchObject({
      name: "Rice, white, cooked",
      local_name: null,
      preparation: null,
      portion_text: null,
      ml: null,
      grams: 200,
      grams_low: 150,
      grams_high: 260,
      matches_usual: null,
      matches_planned: null,
      label: null,
      estimate: { kcal: 260, protein: 5, carbs: 56, fat: 0.6, fiber: 0.8, sugar: 0, sodium: 2 },
    });
    expect(sameAs).toEqual([null]);
  });

  it("keeps one emoji per item and drops anything else", () => {
    const { output } = parseAnalysis(
      reply({
        items: [
          item({ emoji: "🍚" }),
          item({ name: "Chicken", emoji: "🍗🍖" }),
          item({ name: "Salad", emoji: "salad" }),
          item({ name: "Tea" }),
        ],
      }),
      refs(),
    );
    expect(output.items.map((i) => i.emoji)).toEqual(["🍚", null, null, null]);
  });

  it("keeps a meal_type that is one of the slots", () => {
    expect(parseAnalysis(reply({ meal_type: "supper" }), refs()).output.meal_type).toBe("supper");
    expect(parseAnalysis(reply({ meal_type: "brunch" }), refs()).output.meal_type).toBeNull();
    expect(parseAnalysis(reply(), refs()).output.meal_type).toBeNull();
    expect(
      parseAnalysis(reply({ is_food: false, meal_type: "snack" }), refs()).output.meal_type,
    ).toBeNull();
  });

  it("maps the prompt's short ids back and drops unknown ones", () => {
    const { output, sameAs } = parseAnalysis(
      reply({
        items: [
          item({ matches_usual: "U7", matches_planned: "p1", same_as_item: "i1" }),
          item({ name: "Bread", matches_usual: "u99", matches_planned: "p5", same_as_item: "i9" }),
        ],
      }),
      refs(),
    );
    expect(output.items.map((i) => [i.matches_usual, i.matches_planned])).toEqual([
      ["7", "recipe-1"],
      [null, null],
    ]);
    expect(sameAs).toEqual(["item-uuid-1", null]);
  });

  it("repairs impossible amounts and ranges", () => {
    const { output } = parseAnalysis(
      reply({
        items: [
          item({
            grams: -5,
            grams_low: 0,
            grams_high: 0,
            components: [{ name: "Oil", grams: 15 }],
          }),
          item({ name: "Tea", kind: "drink", grams: 0, ml: 250, grams_low: 300, grams_high: 100 }),
          item({ name: "Soup", grams: 99_999, grams_low: 300, grams_high: 400 }),
          item({ name: "Water", kind: "ingredient", ml: 500 }),
        ],
      }),
      refs(),
    );
    const [oil, tea, soup, water] = output.items;
    expect(oil).toMatchObject({ grams: 15, grams_low: 10.5, grams_high: 19.5 });
    expect(tea).toMatchObject({ grams: 250, ml: 250, grams_low: 175, grams_high: 325 });
    expect(soup!.grams).toBe(PARSE_LIMITS.maxAmount);
    expect(soup!.grams_high).toBe(6500);
    expect(water!.ml).toBeNull(); // only drinks carry a volume
  });

  it("cleans lists: photos in range, unique search terms, components with weight", () => {
    const { output } = parseAnalysis(
      reply({
        items: [
          item({
            kind: "unknown",
            confidence: 7,
            photo_indexes: [1, 1, 5, -1, 0.5, 0],
            search_terms: ["  rice ", "rice", "", "a", "b", "c", "d"],
            components: [
              { name: "Rice", grams: 180 },
              { name: "", grams: 10 },
              { name: "Butter", grams: 0 },
            ],
          }),
        ],
      }),
      refs(),
    );
    const [rice] = output.items;
    expect(rice).toMatchObject({ kind: "dish", confidence: 1, photo_indexes: [0, 1] });
    expect(rice!.search_terms).toEqual(["rice", "a", "b", "c", "d"]);
    expect(rice!.components).toEqual([{ name: "Rice", grams: 180 }]);
  });

  it("reads labels: barcode digits, per 100 g and per serving facts", () => {
    const { output } = parseAnalysis(
      reply({
        items: [
          item({
            kind: "packaged",
            label: [
              {
                barcode: "5 000159-407236",
                serving_grams: 30,
                facts: [
                  { nutrient: "kcal", basis: "per_100g", amount: 500 },
                  { nutrient: "fat", basis: "per_serving", amount: 9 },
                  { nutrient: "salt", basis: "per_100g", amount: 1 },
                  { nutrient: "protein", basis: "per_100ml", amount: 3 },
                ],
              },
            ],
          }),
          item({ name: "Unreadable", label: [{ barcode: "12ab", serving_grams: 0, facts: [] }] }),
        ],
      }),
      refs(),
    );
    expect(output.items[0]!.label).toEqual({
      barcode: "5000159407236",
      per100g: { kcal: 500, protein: 3 },
      perServing: { fat: 9 },
      servingGrams: 30,
    });
    expect(output.items[1]!.label).toBeNull();
  });

  it("keeps at most two questions with up to four answers", () => {
    const { output } = parseAnalysis(
      reply({
        questions: [
          { question: "Milk?", answers: ["Whole", "Skimmed", "Oat", "Soy", "None"] },
          { question: "", answers: ["x"] },
          { question: "Sugar?", answers: ["Yes", "Yes", "No"] },
          { question: "Oil?", answers: ["A little", "A lot"] },
        ],
      }),
      refs(),
    );
    expect(output.questions).toEqual([
      { question: "Milk?", answers: ["Whole", "Skimmed", "Oat", "Soy"] },
      { question: "Sugar?", answers: ["Yes", "No"] },
    ]);
  });

  it("treats a reply without items as not food, and not food as empty", () => {
    expect(parseAnalysis(reply({ items: [] }), refs()).output.is_food).toBe(false);
    const notFood = parseAnalysis(
      reply({ is_food: false, questions: [{ question: "Q?", answers: [] }] }),
      refs(),
    );
    expect(notFood.output).toMatchObject({ is_food: false, items: [], questions: [] });
  });

  it("refuses replies that are not the schema", () => {
    for (const value of [null, "text", [], { items: [] }, { is_food: true, items: {} }])
      expect(() => parseAnalysis(value, refs())).toThrow(AiError);
    try {
      parseAnalysis({ is_food: "yes" }, refs(), { provider: "google" });
    } catch (error) {
      expect(error).toMatchObject({ kind: "invalid-output", provider: "google" });
    }
  });
});

describe("cleanBarcode", () => {
  it("keeps 8 to 14 digits only", () => {
    expect(cleanBarcode("4006381333931")).toBe("4006381333931");
    expect(cleanBarcode("0 12345 67890 5")).toBe("012345678905");
    expect(cleanBarcode("1234567")).toBeNull();
    expect(cleanBarcode("40063813339X1")).toBeNull();
    expect(cleanBarcode(42)).toBeNull();
  });
});
