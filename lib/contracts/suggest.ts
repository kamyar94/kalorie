// CONTRACT: "What should I eat?" (board 42). lib/suggest/service.ts implements it, the arithmetic
// is lib/suggest/compute.ts. Plain data, safe for client components.
//
//   GET  /api/suggestions?tz=Area/City          -> SuggestionsDto   (for now, in that zone)
//   POST /api/suggestions/idea { tz }           -> { idea: MealIdeaDto }  (the person's own AI)
// "Log this" uses the existing routes: POST /api/favorites/:mealId/log for a favorite, else
// POST /api/meals/:id/duplicate, at now, with Undo (DELETE /api/meals/:id).
import type { MealFoodDto, MealSlot } from "./meals";

export type LimitCode = "sodium" | "fat_sat" | "sugars_added";

/** What is still open today against the targets, after what was eaten (water excluded). */
export type LeftTodayDto = {
  /** The day's energy target (2,000 kcal when none is set). */
  energyTarget: number;
  /** Energy eaten today. */
  eaten: number;
  /** energyTarget - eaten; below zero when over. */
  energyLeft: number;
  /** Grams still to reach the target (0 once reached); null without a target. */
  protein: number | null;
  fiber: number | null;
  /** Room left under each limit (0 once reached), in the nutrient's unit. */
  limits: { code: LimitCode; room: number; limit: number }[];
  /** Meals of today still being worked out: their nutrients are not in yet. */
  pending: number;
};

/** How the person usually eats around now, from the last four weeks (today not counted). */
export type EatingPatternDto = {
  /** Days with meals in the last 28. */
  days: number;
  /** At least three such days: enough to speak of a pattern. */
  enough: boolean;
  /** The usual meal name within 90 minutes of now, null when nothing is usually eaten then. */
  usualSlot: MealSlot | null;
  /** The usual energy of that meal (median of the days that had one). */
  usualKcal: number | null;
  /** Of the logged days, the share with a meal around now (0 to 1). */
  often: number;
  /** Mean energy eaten from this time of day to the end of the day, on logged days. */
  after: number;
};

export type SuggestionDto = {
  /** The meal "Log this" copies and "Details" opens (the favorite one when there is one). */
  mealId: string;
  title: string;
  slot: MealSlot;
  energy: number;
  /** "Best fit", "Favorite", "Had 3 times", or null. */
  badge: string | null;
  favorite: boolean;
  /** How often it was had in the last 90 days. */
  times: number;
  /** "Covers 34 g of the 52 g protein you still need; fits your usual 600 kcal lunch." */
  reason: string;
  /** Its balance score, null when it is not judged. */
  score: number | null;
  photoUrl: string | null;
  foods: MealFoodDto[];
};

/** A balanced idea from the targets alone, for when there is nothing of the person's to suggest. */
export type BalancedIdeaDto = {
  energy: number;
  protein: number;
  fiber: number;
  sodium: number | null;
  text: string;
};

export type SuggestionsDto = {
  /** Now in the person's zone: "13:05", the local date and the zone. */
  time: string;
  date: string;
  tz: string;
  /** "It is 13:05. You usually have lunch now, about 600 kcal, and eat ..." */
  intro: string;
  left: LeftTodayDto;
  pattern: EatingPatternDto;
  /** The energy that suits now: the usual size, never more than what is left. */
  size: number;
  /** At most three, best first. */
  suggestions: SuggestionDto[];
  /** "little": under three days of meals in the last four weeks. */
  history: "enough" | "little";
  /** A note above the list (the day's energy reached, nothing small enough, meals pending). */
  note: string | null;
  /** Shown when there is nothing to suggest from the person's own meals. */
  idea: BalancedIdeaDto | null;
  /** An AI key is saved, so "Something new (asks your AI)" can show. */
  aiAvailable: boolean;
};

/** One meal idea from the person's own AI, with rough nutrients. */
export type MealIdeaDto = {
  name: string;
  /** The foods with about how much of each, as typed into a text meal ("Type it"). */
  description: string;
  energy: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sodium: number;
};
