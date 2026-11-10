// Fixtures of the analysis tests: a few database foods (until the food phase's data arrives, the
// stub search runs on these), recorded model replies in the shape ANALYSIS_SCHEMA asks for, and
// helpers that read the prompt out of a recorded provider request and answer the matching call.
import { db } from "@/db";
import { foods } from "@/db/schema";
import type { AiProvider } from "@/lib/ai/types";
import type { RawAnalysis, RawItem } from "@/lib/analysis/schema";
import type { NutrientMap } from "@/lib/contracts/nutrients";
import { foodSearchText } from "@/lib/food/normalize";
import { aiReplies } from "@/tests/helpers/ai-mock";
import type { MockReply, RecordedRequest } from "@/tests/helpers/mock-http";

// ---- Foods ----

type FixtureFood = {
  key: string;
  nameEn: string;
  nameFa?: string;
  kind?: "food" | "dish" | "packaged";
  density?: number;
  barcode?: string;
  nutrients: NutrientMap;
};

export const FIXTURE_FOODS: FixtureFood[] = [
  {
    key: "rice",
    nameEn: "Rice, white, long-grain, cooked",
    nameFa: "برنج پخته",
    nutrients: { energy: 130, protein: 2.7, carbs: 28.2, fat: 0.3, fiber: 0.4, sodium: 1 },
  },
  {
    key: "chicken",
    nameEn: "Chicken breast, grilled",
    nutrients: { energy: 165, protein: 31, carbs: 0, fat: 3.6, sodium: 74 },
  },
  {
    key: "tomato",
    nameEn: "Tomato, grilled",
    nutrients: { energy: 22, protein: 1, carbs: 4.6, fat: 0.3, fiber: 1.4, sodium: 5 },
  },
  {
    key: "doogh",
    nameEn: "Doogh, yogurt drink",
    nameFa: "دوغ",
    density: 1.02,
    nutrients: { energy: 26, protein: 1.5, carbs: 2, fat: 1.3, sodium: 200 },
  },
  {
    key: "beef",
    nameEn: "Beef, stewed",
    nutrients: { energy: 250, protein: 30, carbs: 0, fat: 14, sodium: 60 },
  },
  {
    key: "beans",
    nameEn: "Kidney beans, cooked",
    nutrients: { energy: 127, protein: 8.7, carbs: 22.8, fat: 0.5, fiber: 6.4, sodium: 2 },
  },
  {
    key: "oil",
    nameEn: "Vegetable oil",
    nutrients: { energy: 884, fat: 100 },
  },
  {
    key: "juice",
    nameEn: "Orange juice",
    density: 1.04,
    nutrients: { energy: 45, protein: 0.7, carbs: 10.4, fat: 0.2, sugars: 8.4 },
  },
];

/** Inserts the fixture foods (shared, owner null); returns their ids by key. */
export const seedFixtureFoods = async () => {
  const ids: Record<string, string> = {};
  for (const food of FIXTURE_FOODS) {
    const [row] = await db
      .insert(foods)
      .values({
        source: "fdc_sr_legacy",
        sourceId: `fixture-${food.key}-${Math.random().toString(36).slice(2, 8)}`,
        kind: food.kind ?? "food",
        nameEn: food.nameEn,
        nameFa: food.nameFa ?? null,
        barcode: food.barcode ?? null,
        densityGPerMl: food.density ?? null,
        nutrients: food.nutrients,
        searchText: foodSearchText({ nameEn: food.nameEn, nameFa: food.nameFa }),
      })
      .returning({ id: foods.id });
    ids[food.key] = row!.id;
  }
  return ids;
};

// ---- Model replies ----

const estimate = (kcal: number, protein: number, carbs: number, fat: number) => ({
  kcal,
  protein,
  carbs,
  fat,
  fiber: 0,
  sugar: 0,
  sodium: 0,
});

/** One item with sensible "nothing" values, as the schema makes the model send them. */
export const rawItem = (
  overrides: Partial<RawItem> & { name: string; grams: number },
): RawItem => ({
  local_name: "",
  kind: "ingredient",
  emoji: "",
  preparation: "",
  ml: 0,
  grams_low: overrides.grams * 0.8,
  grams_high: overrides.grams * 1.25,
  portion_text: "",
  confidence: 0.8,
  photo_indexes: [0],
  search_terms: [overrides.name],
  matches_usual: "",
  matches_planned: "",
  same_as_item: "",
  components: [],
  label: [],
  estimate: estimate(overrides.grams, 1, 1, 1),
  ...overrides,
});

export const rawAnalysis = (overrides: Partial<RawAnalysis>): RawAnalysis => ({
  is_food: true,
  cuisine: "",
  items: [],
  title: "",
  questions: [],
  overall_confidence: 0.7,
  ...overrides,
});

/** A Persian plate: rice, chicken kabab, grilled tomato and a glass of doogh. */
export const GOOD_MEAL = rawAnalysis({
  cuisine: "Persian",
  title: "Joojeh kabab with rice",
  items: [
    rawItem({
      name: "Rice, white, cooked",
      local_name: "چلو",
      kind: "dish",
      preparation: "steamed",
      grams: 250,
      search_terms: ["white rice cooked", "chelow"],
      estimate: estimate(330, 6, 72, 3),
    }),
    rawItem({
      name: "Chicken breast, grilled",
      local_name: "جوجه کباب",
      preparation: "grilled",
      grams: 180,
      portion_text: "1 skewer",
      search_terms: ["chicken breast grilled", "joojeh kabab"],
      estimate: estimate(300, 54, 0, 8),
    }),
    rawItem({
      name: "Tomato, grilled",
      preparation: "grilled",
      grams: 80,
      search_terms: ["tomato grilled"],
      estimate: estimate(18, 1, 4, 0),
    }),
    rawItem({
      name: "Doogh",
      local_name: "دوغ",
      kind: "drink",
      grams: 255,
      ml: 250,
      portion_text: "1 glass",
      search_terms: ["doogh yogurt drink"],
      estimate: estimate(65, 4, 5, 3),
    }),
  ],
});

/** A stew with components that has no dish entry in the fixtures, plus one question. */
export const MIXED_DISH = rawAnalysis({
  cuisine: "Persian",
  title: "Ghormeh sabzi",
  items: [
    rawItem({
      name: "Ghormeh sabzi",
      local_name: "قورمه سبزی",
      kind: "dish",
      preparation: "stewed",
      grams: 350,
      search_terms: ["ghormeh sabzi", "herb stew with beef"],
      components: [
        { name: "Beef, stewed", grams: 90 },
        { name: "Kidney beans, cooked", grams: 50 },
        { name: "Sauteed herbs", grams: 175 },
        { name: "Vegetable oil", grams: 15 },
      ],
      estimate: estimate(520, 30, 25, 33),
    }),
  ],
  questions: [{ question: "Was there tahdig with it?", answers: ["Yes", "No"] }],
});

/** A drink measured in ml. */
export const DRINK = rawAnalysis({
  title: "Orange juice",
  items: [
    rawItem({
      name: "Orange juice",
      kind: "drink",
      grams: 310,
      ml: 300,
      portion_text: "1 glass",
      search_terms: ["orange juice"],
      estimate: estimate(135, 2, 31, 0),
    }),
  ],
});

export const LABEL_BARCODE = "5000159407236";

/** A chocolate bar with a readable label (per 100 g and the barcode). */
export const PACKAGED = rawAnalysis({
  title: "Chocolate bar",
  items: [
    rawItem({
      name: "Milk chocolate bar with caramel",
      kind: "packaged",
      grams: 50,
      portion_text: "1 bar",
      search_terms: ["milk chocolate caramel bar"],
      label: [
        {
          barcode: LABEL_BARCODE,
          serving_grams: 50,
          facts: [
            { nutrient: "kcal", basis: "per_100g", amount: 480 },
            { nutrient: "protein", basis: "per_100g", amount: 4.4 },
            { nutrient: "carbs", basis: "per_100g", amount: 63 },
            { nutrient: "fat", basis: "per_100g", amount: 23 },
            { nutrient: "sugar", basis: "per_100g", amount: 55 },
          ],
        },
      ],
      estimate: estimate(240, 2, 32, 12),
    }),
  ],
});

export const NOT_FOOD = rawAnalysis({
  is_food: false,
  title: "A laptop on a desk",
  overall_confidence: 0.95,
});

// ---- Reading requests ----

/** The text of the last user message of a recorded provider request. */
export const promptOf = (provider: AiProvider, request: RecordedRequest): string => {
  const body = request.body as Record<string, unknown>;
  if (provider === "openai") {
    const input = body.input as { content: { type: string; text?: string }[] }[];
    return input.at(-1)!.content.find((c) => c.type === "input_text")?.text ?? "";
  }
  if (provider === "anthropic") {
    const messages = body.messages as { content: { type: string; text?: string }[] }[];
    return messages.at(-1)!.content.find((c) => c.type === "text")?.text ?? "";
  }
  const contents = body.contents as { parts: { text?: string }[] }[];
  return contents.at(-1)!.parts.find((p) => typeof p.text === "string")?.text ?? "";
};

/** Number of images sent with the last user message. */
export const imagesOf = (provider: AiProvider, request: RecordedRequest) => {
  const body = request.body as Record<string, unknown>;
  if (provider === "openai")
    return (body.input as { content: { type: string }[] }[])
      .at(-1)!
      .content.filter((c) => c.type === "input_image").length;
  if (provider === "anthropic")
    return (body.messages as { content: { type: string }[] }[])
      .at(-1)!
      .content.filter((c) => c.type === "image").length;
  return (body.contents as { parts: { inlineData?: unknown }[] }[])
    .at(-1)!
    .parts.filter((p) => p.inlineData).length;
};

/** The numbered foods and their candidates, read back from a matching prompt. */
export const parseMatchingPrompt = (prompt: string) => {
  const entries: { number: number; name: string; candidates: { ref: string; name: string }[] }[] =
    [];
  for (const line of prompt.split("\n")) {
    const entry = /^(\d+)\. (.+?)(?: \(.*\))? - /.exec(line);
    if (entry) {
      entries.push({ number: Number(entry[1]), name: entry[2]!, candidates: [] });
      continue;
    }
    const candidate = /^\s+(c\d+): (.+?)(?: \(|$| \[)/.exec(line);
    if (candidate && entries.length)
      entries.at(-1)!.candidates.push({ ref: candidate[1]!, name: candidate[2]! });
  }
  return entries;
};

/**
 * A matching reply that picks, for each entry, the candidate whose name equals the entry's name
 * or starts with its first word (none otherwise), the way a sensible model would here.
 */
export const matchingReply =
  (
    provider: AiProvider,
    pick?: (name: string, candidates: { ref: string; name: string }[]) => string,
  ) =>
  (request: RecordedRequest): MockReply => {
    const entries = parseMatchingPrompt(promptOf(provider, request));
    const choose =
      pick ??
      ((name: string, candidates: { ref: string; name: string }[]) => {
        const first = name.split(/[ ,]/)[0]!.toLowerCase();
        return (
          candidates.find((c) => c.name.toLowerCase() === name.toLowerCase())?.ref ??
          candidates.find((c) => c.name.toLowerCase().startsWith(first))?.ref ??
          "none"
        );
      });
    return aiReplies[provider].json({
      matches: entries.map((e) => ({ entry: e.number, candidate: choose(e.name, e.candidates) })),
    });
  };
