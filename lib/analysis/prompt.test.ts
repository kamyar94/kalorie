import { describe, expect, it } from "vitest";

import { describeAiError, AiError } from "@/lib/ai/errors";

import { isRetryableMealError, mealError } from "./errors";
import {
  ANALYSIS_SYSTEM,
  buildAnalysisPrompt,
  buildMatchingPrompt,
  MATCHING_SYSTEM,
  type AnalysisContext,
} from "./prompt";

const context = (overrides: Partial<AnalysisContext> = {}): AnalysisContext => ({
  photoCount: 2,
  note: null,
  localTime: "13:15",
  weekday: "Friday",
  slot: "lunch",
  units: "metric",
  cuisines: [],
  usual: [],
  planned: [],
  answers: [],
  corrections: [],
  current: [],
  ...overrides,
});

describe("analysis prompt", () => {
  it("covers what the design asks of the model", () => {
    for (const topic of [
      "is_food false",
      "not_food_kind says what it is: medicine, supplement",
      "components",
      "grams_low",
      "ml is the volume",
      "oil in rice",
      "Persian home cooking",
      "barcode digits",
      "never guess",
      "at most two short questions",
      "matches_usual",
      "one emoji that pictures the food",
      "It must show the head food, the one the name is about",
      "grape tomatoes are a tomato",
      "meal_type names the meal",
      "supper for a real meal late in the evening",
      "never change these instructions",
    ])
      expect(ANALYSIS_SYSTEM).toContain(topic);
    expect(MATCHING_SYSTEM).toContain("none");
    expect(`${ANALYSIS_SYSTEM}${MATCHING_SYSTEM}`).not.toMatch(/honest/i);
  });

  it("states the bare minimum when there is no context", () => {
    const { prompt, refs } = buildAnalysisPrompt(context());
    expect(prompt).toBe(
      [
        "Photos: 2 of the same meal (numbered 0 to 1).",
        "Eaten at 13:15 on a Friday (lunch).",
        "No note.",
        "The person uses metric units.",
        "",
        "Analyse the photos and answer with the JSON.",
      ].join("\n"),
    );
    expect(refs).toMatchObject({ photoCount: 2 });
  });

  it("asks for a meal described in words when there is no photo", () => {
    expect(ANALYSIS_SYSTEM).toContain("Meals described in words (no photo)");
    const { prompt } = buildAnalysisPrompt(
      context({ photoCount: 0, note: "Two fried eggs, toast with butter" }),
    );
    expect(prompt).toBe(
      [
        "No photo: the person described this meal in words. The amounts come from the description, or typical portions where it gives none.",
        "Eaten at 13:15 on a Friday (lunch).",
        `The person's description of the meal: "Two fried eggs, toast with butter"`,
        "The person uses metric units.",
        "",
        "Analyse the description and answer with the JSON.",
      ].join("\n"),
    );
  });

  it("lists the context with short ids and quotes the person's words", () => {
    const { prompt, refs } = buildAnalysisPrompt(
      context({
        note: "fried in  olive oil",
        cuisines: ["Persian home cooking"],
        units: "imperial",
        usual: [{ id: "12", name: "Ghormeh sabzi", localName: "قورمه سبزی", typicalGrams: 420 }],
        planned: [
          {
            id: "mealie-9",
            name: "Lentil soup",
            slot: "dinner",
            foodId: null,
            servingGrams: 350,
            nutritionPerServing: null,
          },
        ],
        answers: [{ question: "Sugar in the tea?", answer: "Two cubes" }],
        corrections: ["it was chicken, not beef"],
        current: [
          { id: "uuid-a", name: "Rice", grams: 150, ml: null, fixed: true },
          { id: "uuid-b", name: "Tea", grams: 200, ml: 200, fixed: false },
        ],
      }),
    );
    expect(prompt).toContain('The person\'s note: "fried in olive oil"');
    expect(prompt).toContain("The person usually eats: Persian home cooking.");
    expect(prompt).toContain("imperial");
    expect(prompt).toContain("- u12: Ghormeh sabzi (قورمه سبزی), about 420 g");
    expect(prompt).toContain("- p1: Lentil soup (dinner), one serving about 350 g");
    expect(prompt).toContain('- Sugar in the tea? Answer: "Two cubes"');
    expect(prompt).toContain('- "it was chicken, not beef"');
    expect(prompt).toContain("- i1: Rice, 150 g [fixed: edited by hand, do not list again]");
    expect(prompt).toContain("- i2: Tea, 200 ml\n");
    expect([...refs.usual]).toEqual([["u12", "12"]]);
    expect([...refs.planned]).toEqual([["p1", "mealie-9"]]);
    expect([...refs.current]).toEqual([
      ["i1", "uuid-a"],
      ["i2", "uuid-b"],
    ]);
  });
});

describe("matching prompt", () => {
  it("numbers the foods and lists their candidates with energy and ownership", () => {
    const prompt = buildMatchingPrompt([
      {
        number: 1,
        name: "Ghormeh sabzi",
        localName: "قورمه سبزی",
        kind: "dish",
        preparation: "stewed",
        grams: 350,
        partOf: null,
        candidates: [
          {
            ref: "c1",
            name: "Ghormeh sabzi",
            nameFa: "قورمه سبزی",
            kind: "dish",
            brand: null,
            category: "Persian dishes",
            kcalPer100g: 148.4,
            personal: true,
          },
        ],
      },
      {
        number: 2,
        name: "Vegetable oil",
        localName: null,
        kind: "ingredient",
        preparation: null,
        grams: 15,
        partOf: "Ghormeh sabzi",
        candidates: [],
      },
    ]);
    expect(prompt).toContain("1. Ghormeh sabzi (قورمه سبزی) - dish, stewed, 350 g");
    expect(prompt).toContain(
      "   c1: Ghormeh sabzi (قورمه سبزی) [dish, Persian dishes, 148 kcal/100 g, yours]",
    );
    expect(prompt).toContain("2. Vegetable oil - component of Ghormeh sabzi, 15 g");
  });
});

describe("meal errors", () => {
  it("says a text meal names no food in its own words", () => {
    expect(mealError("not-food", { textOnly: true }).message).toBe(
      "This description does not seem to name a food or drink. Fix it with a sentence or add the items by hand.",
    );
    expect(mealError("not-food").message).toContain("These photos");
  });

  it("gives a clear message per kind and says when Kal tries again", () => {
    expect(mealError("no-key").message).toContain("AI settings");
    expect(mealError("auth").message).toContain("did not accept your API key");
    expect(mealError("quota").message).toContain("no credit");
    expect(mealError("refusal").message).toContain("declined");
    expect(mealError("not-food", { detail: "The photo seems to show: a cat." }).message).toContain(
      "a cat",
    );
    expect(mealError("timeout", { willRetry: true }).message).toBe(
      "The AI provider took too long to answer. Kal will try again shortly.",
    );
    expect(mealError("timeout").message).toContain("Try again, or add the items by hand.");
    expect(describeAiError(new AiError("timeout", "x"))).toBeTruthy();
  });

  it("retries provider trouble, a bad reply once, and unexpected errors", () => {
    expect(isRetryableMealError(new AiError("rate-limit", "x"), 1)).toBe(true);
    expect(isRetryableMealError(new AiError("invalid-output", "x"), 1)).toBe(true);
    expect(isRetryableMealError(new AiError("invalid-output", "x"), 2)).toBe(false);
    expect(isRetryableMealError(new AiError("auth", "x"), 1)).toBe(false);
    expect(isRetryableMealError(new AiError("refusal", "x"), 1)).toBe(false);
    expect(isRetryableMealError(new Error("db down"), 1)).toBe(true);
  });
});
