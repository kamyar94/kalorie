// The meal's name on the timeline (its slot): breakfast, lunch, dinner, supper, snack, drink or
// dessert. classifyMeal runs after every analysis and every item change; a slot the person chose
// by hand (meals.slot_locked) is never changed by it. Plain functions, safe for client components.
//
//   1. Only drinks: "drink".
//   2. The analysis model's meal_type, when it gave a valid one (it judges the food, the amount and
//      the local time it was told).
//   3. Rules for manual and Mealie meals and as the fallback:
//      - the time window (Settings, meal windows) gives breakfast, lunch or dinner;
//      - in the lunch and dinner windows, under SNACK_KCAL is a snack (a breakfast is often small,
//        so the breakfast window keeps breakfast);
//      - outside the windows: SNACK_KCAL or more after the dinner window and before 04:00 is
//        supper, anything else a snack.
import { isMealSlot, type MealSlot } from "@/lib/contracts/meals";

import { isDrink } from "./hydration";
import { DEFAULT_MEAL_WINDOWS, slotForMinutes, type MealWindows } from "./time";

/** Below this many kcal a meal is a snack rather than a main meal. */
export const SNACK_KCAL = 250;
/** Late food counts as supper until 04:00. */
export const SUPPER_UNTIL_MINUTES = 4 * 60;

export type ClassifyItem = {
  name: string;
  foodName?: string | null;
  kind: string;
  /** kcal of the item. */
  energy?: number | null;
};

const toMinutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** After the end of the dinner window, or before 04:00. */
export const isLate = (minutes: number, windows: MealWindows = DEFAULT_MEAL_WINDOWS) => {
  const end = toMinutes((windows.dinner ?? DEFAULT_MEAL_WINDOWS.dinner)[1]);
  return minutes < SUPPER_UNTIL_MINUTES || (!Number.isNaN(end) && minutes > end);
};

/** The slot of a meal from its items, the model's judgment and its local time (minutes). */
export const classifyMeal = (input: {
  items: ClassifyItem[];
  modelType?: string | null;
  minutes: number;
  windows?: MealWindows | null;
}): MealSlot => {
  const windows = input.windows ?? DEFAULT_MEAL_WINDOWS;
  const window = slotForMinutes(input.minutes, windows);
  if (!input.items.length) return window;
  if (input.items.every(isDrink)) return "drink";
  // The model may call food a snack, a supper or a dessert; "drink" only fits drinks alone.
  if (isMealSlot(input.modelType) && input.modelType !== "drink") return input.modelType;
  const energy = input.items.reduce(
    (sum, item) =>
      sum + (typeof item.energy === "number" && Number.isFinite(item.energy) ? item.energy : 0),
    0,
  );
  if (window === "snack")
    return energy >= SNACK_KCAL && isLate(input.minutes, windows) ? "supper" : "snack";
  if (window !== "breakfast" && energy < SNACK_KCAL) return "snack";
  return window;
};
