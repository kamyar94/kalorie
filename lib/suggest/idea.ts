// "Something new (asks your AI)" on the "What should I eat?" sheet: one meal idea from the person's
// own AI provider (the analysis task's provider, model and key, lib/ai/service.ts) that fits the
// same numbers as the suggestions: the size that suits now, its part of the open protein and
// fiber, and the room left under sodium. Text only, no photo; the person's preferred cuisines go
// with it, and allergies only when the health profile allows its use in analysis. Nothing is
// saved: "Type it" opens a text meal with the idea's foods for the person to send.
import { z } from "zod";

import type { DbOrTx } from "@/db";
import { runAiTask } from "@/lib/ai/service";
import type { JsonSchema } from "@/lib/ai/types";
import { healthForAnalysis } from "@/lib/body/health";
import { MEAL_SLOT_LABELS } from "@/lib/contracts/meals";
import type { MealIdeaDto } from "@/lib/contracts/suggest";

import { balancedIdea } from "./compute";
import { suggestionContext } from "./service";

const num = (description: string) => ({ type: "number", description });
const str = (description: string) => ({ type: "string", description });

/** Strict schema (every property required, objects closed), as lib/analysis/schema.ts. */
export const MEAL_IDEA_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "idea_name",
    "foods",
    "energy_kcal",
    "protein_g",
    "carbs_g",
    "fat_g",
    "fiber_g",
    "sodium_mg",
  ],
  properties: {
    idea_name: str("A short name for the meal, at most six words."),
    foods: str(
      'The foods with about how much of each, in one line as someone would type it into a food log: "150 g grilled salmon, 1 cup cooked quinoa, a handful of spinach with 1 tsp olive oil".',
    ),
    energy_kcal: num("Rough energy of the whole meal in kcal."),
    protein_g: num("Rough protein in grams."),
    carbs_g: num("Rough carbohydrate in grams."),
    fat_g: num("Rough fat in grams."),
    fiber_g: num("Rough fiber in grams."),
    sodium_mg: num("Rough sodium in milligrams."),
  },
};

export const MEAL_IDEA_SYSTEM = `You suggest one meal idea for Kal, a personal food log, and answer with JSON that matches the schema.

- Suggest one ordinary meal that can be made or bought today, that fits the numbers given: about the energy asked for (never more than the energy left), with at least the protein and fiber asked for when you can, and under the sodium given.
- Prefer the cuisines the person usually eats when they are given. Never include a food the person is allergic to.
- Give rough nutrients for the whole meal as you would estimate them. No health advice, no warnings, no other text.`;

/** The prompt: the numbers, the usual meal at this hour, cuisines, allergies when allowed. */
export const ideaPrompt = (input: {
  time: string;
  slot: string;
  size: number;
  energyLeft: number;
  protein: number;
  fiber: number;
  sodium: number | null;
  cuisines: string[];
  allergies: string | null;
}) =>
  [
    `It is ${input.time}; the meal is ${input.slot.toLowerCase()}.`,
    `Energy: about ${input.size} kcal (at most ${Math.max(0, Math.round(input.energyLeft))} kcal are left today).`,
    input.protein > 0 ? `Protein: at least ${input.protein} g.` : "",
    input.fiber > 0 ? `Fiber: at least ${input.fiber} g.` : "",
    input.sodium !== null ? `Sodium: under ${input.sodium} mg.` : "",
    input.cuisines.length ? `The person usually eats: ${input.cuisines.join(", ")}.` : "",
    input.allergies ? `Allergies to avoid: ${input.allergies}.` : "",
  ]
    .filter(Boolean)
    .join("\n");

const amount = (max: number) => z.number().finite().min(0).max(max);
const IdeaReply = z.object({
  idea_name: z.string().trim().min(1).max(120),
  foods: z.string().trim().min(1).max(600),
  energy_kcal: amount(5000),
  protein_g: amount(500),
  carbs_g: amount(1000),
  fat_g: amount(500),
  fiber_g: amount(200),
  sodium_mg: amount(20000),
});

/** The model's reply as an idea, or null when it does not fit the schema. */
export const parseIdea = (json: unknown): MealIdeaDto | null => {
  const parsed = IdeaReply.safeParse(json);
  if (!parsed.success) return null;
  const r = parsed.data;
  return {
    name: r.idea_name,
    description: r.foods,
    energy: Math.round(r.energy_kcal),
    protein: Math.round(r.protein_g),
    carbs: Math.round(r.carbs_g),
    fat: Math.round(r.fat_g),
    fiber: Math.round(r.fiber_g),
    sodium: Math.round(r.sodium_mg),
  };
};

/**
 * Asks the person's AI for one idea for now. Throws AiError (no key, the provider's errors) and
 * Error("unusable") when the reply does not fit; "nothing left" when the day's energy is reached.
 */
export const suggestIdea = async (
  userId: string,
  at: { now: Date; tz: string },
  dbx?: DbOrTx,
): Promise<MealIdeaDto | "nothing-left"> => {
  const ctx = await suggestionContext(userId, at, dbx);
  if (ctx.size <= 0) return "nothing-left";
  const target = balancedIdea(ctx.left, ctx.size)!;
  const health = await healthForAnalysis(userId, dbx);
  const slot =
    ctx.pattern.enough && ctx.pattern.usualSlot && ctx.pattern.often >= 0.3
      ? ctx.pattern.usualSlot
      : ctx.slotNow;
  const response = await runAiTask(
    userId,
    "analysis",
    {
      system: MEAL_IDEA_SYSTEM,
      prompt: ideaPrompt({
        time: ctx.time,
        slot: MEAL_SLOT_LABELS[slot],
        size: ctx.size,
        energyLeft: ctx.left.energyLeft,
        protein: target.protein,
        fiber: target.fiber,
        sodium: target.sodium,
        cuisines: ctx.cuisines,
        allergies: health?.allergies || null,
      }),
      json: { name: "meal_idea", schema: MEAL_IDEA_SCHEMA },
      maxOutputTokens: 2048,
    },
    { usageTask: "meal-idea", db: dbx },
  );
  const idea = parseIdea(response.json);
  if (!idea) throw new Error("unusable");
  return idea;
};
