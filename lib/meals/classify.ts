// The meal's name on the timeline (its slot): breakfast, brunch, lunch, dinner, supper, snack,
// drink or dessert. classifyDay names the meals of one local day, oldest first; after every
// analysis, item change, new meal, new time, removal, new title or note and hand-picked slot,
// lib/meals/service.ts reclassifyDay runs it for the meal and the later meals of its day. A slot
// the person chose by hand (meals.slot_locked) is never changed. Plain functions, safe for client
// components.
//
// One meal (classifyMeal):
//   1. Only drinks: "drink".
//   2. The person's words (note or description, answers, corrections) or the meal's title say
//      brunch ("brunch", Persian «برانچ»): "brunch".
//   3. The analysis model's meal_type, when it gave a valid one (it judges the food, the amount,
//      the local time and the day's earlier meals it was told). Breakfast, brunch and lunch name
//      a time of day and follow the day as it is now (the model saw it as it was when it ran):
//      in brunch time the day's first main meal is brunch whichever of the three the model said,
//      and the model's brunch is lunch when the meal is not the day's first main meal.
//   4. The brunch time rule: the first main meal of the day (SNACK_KCAL or more, not only drinks,
//      and no breakfast, brunch, lunch or dinner earlier that day) eaten in brunch time, from
//      BRUNCH_EARLY_MINUTES before the breakfast window ends to BRUNCH_LATE_MINUTES after the
//      lunch window starts (10:00 to 12:30 with the default windows), is brunch.
//   5. Rules for manual and Mealie meals and as the fallback:
//      - the time window (Settings, meal windows) gives breakfast, lunch or dinner;
//      - in the lunch and dinner windows, under SNACK_KCAL is a snack (a breakfast is often small,
//        so the breakfast window keeps breakfast);
//      - outside the windows: SNACK_KCAL or more after the dinner window and before 04:00 is
//        supper, anything else a snack.
// A meal without items yet (waiting for its analysis) keeps its time window, or brunch when the
// words say so.
import { isMealSlot, type MealSlot } from "@/lib/contracts/meals";

import { isDrink } from "./hydration";
import { DEFAULT_MEAL_WINDOWS, slotForMinutes, type MealWindows } from "./time";

/** Below this many kcal a meal is a snack rather than a main meal. */
export const SNACK_KCAL = 250;
/** Late food counts as supper until 04:00. */
export const SUPPER_UNTIL_MINUTES = 4 * 60;
/** Brunch time starts this many minutes before the breakfast window ends... */
export const BRUNCH_EARLY_MINUTES = 30;
/** ...and ends this many minutes after the lunch window starts. */
export const BRUNCH_LATE_MINUTES = 90;

/** Earlier meals of these slots make a later one not the first main meal of its day. */
const MAIN_MEALS: ReadonlySet<MealSlot> = new Set(["breakfast", "brunch", "lunch", "dinner"]);

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

/**
 * Brunch time in minutes since midnight, both ends included: from BRUNCH_EARLY_MINUTES before
 * the breakfast window ends to BRUNCH_LATE_MINUTES after the lunch window starts (600 to 750,
 * 10:00 to 12:30, with the defaults). Null when the windows do not give one.
 */
export const brunchTime = (
  windows: MealWindows = DEFAULT_MEAL_WINDOWS,
): { from: number; to: number } | null => {
  const breakfastEnd = toMinutes((windows.breakfast ?? DEFAULT_MEAL_WINDOWS.breakfast)[1]);
  const lunchStart = toMinutes((windows.lunch ?? DEFAULT_MEAL_WINDOWS.lunch)[0]);
  if (Number.isNaN(breakfastEnd) || Number.isNaN(lunchStart)) return null;
  const from = Math.max(0, breakfastEnd - BRUNCH_EARLY_MINUTES);
  const to = Math.min(24 * 60 - 1, lunchStart + BRUNCH_LATE_MINUTES);
  return from <= to ? { from, to } : null;
};

const BRUNCH_EN = /\bbrunch/i;
const BRUNCH_FA = "برانچ";

/** Whether any of the words name the meal a brunch (English or Persian). */
export const saysBrunch = (words: readonly (string | null | undefined)[] = []) =>
  words.some((w) => typeof w === "string" && (BRUNCH_EN.test(w) || w.includes(BRUNCH_FA)));

/** Whether a day's earlier meals (their slots) leave room for a first main meal. */
export const isFirstMainMeal = (earlier: readonly MealSlot[] = []) =>
  !earlier.some((slot) => MAIN_MEALS.has(slot));

export type ClassifyInput = {
  items: ClassifyItem[];
  modelType?: string | null;
  /** Local time of the meal, minutes since midnight. */
  minutes: number;
  windows?: MealWindows | null;
  /** Slots of the meals eaten earlier the same local day (see classifyDay). */
  earlier?: readonly MealSlot[];
  /** The person's words about the meal (note, answers, corrections) and the meal's title. */
  words?: readonly (string | null | undefined)[];
};

/** The slot of one meal from its items, words, the model's judgment, its time and its day. */
export const classifyMeal = (input: ClassifyInput): MealSlot => {
  const windows = input.windows ?? DEFAULT_MEAL_WINDOWS;
  const window = slotForMinutes(input.minutes, windows);
  const named = saysBrunch(input.words);
  if (!input.items.length) return named ? "brunch" : window;
  if (input.items.every(isDrink)) return "drink";
  if (named) return "brunch";
  const energy = input.items.reduce(
    (sum, item) =>
      sum + (typeof item.energy === "number" && Number.isFinite(item.energy) ? item.energy : 0),
    0,
  );
  const first = isFirstMainMeal(input.earlier);
  const range = brunchTime(windows);
  const brunch =
    first &&
    energy >= SNACK_KCAL &&
    !!range &&
    input.minutes >= range.from &&
    input.minutes <= range.to;
  // The model may call food a snack, a supper or a dessert; "drink" only fits drinks alone.
  if (isMealSlot(input.modelType) && input.modelType !== "drink") {
    const type = input.modelType;
    if (type === "breakfast" || type === "brunch" || type === "lunch") {
      if (brunch) return "brunch";
      // A brunch after the day's breakfast (or another main meal) is a lunch.
      if (type === "brunch") return first ? "brunch" : "lunch";
    }
    return type;
  }
  if (brunch) return "brunch";
  if (window === "snack")
    return energy >= SNACK_KCAL && isLate(input.minutes, windows) ? "supper" : "snack";
  if (window !== "breakfast" && energy < SNACK_KCAL) return "snack";
  return window;
};

/** One meal of a day for classifyDay. */
export type DayMeal = Omit<ClassifyInput, "windows" | "earlier"> & {
  /** The slot it has now; kept when chosen by hand. */
  slot: MealSlot;
  locked: boolean;
  /**
   * False for a meal that names nothing for its day: a failed analysis without items (not food,
   * or no key yet). It is still named by its time but does not count as an earlier meal.
   */
  counts?: boolean;
};

/**
 * The slots of one local day's meals, given oldest first: each meal is named knowing the slots
 * of the meals before it, so the day's first main meal can be a brunch and a later one a lunch.
 * Slots chosen by hand stay and count as they are.
 */
export const classifyDay = (day: readonly DayMeal[], windows?: MealWindows | null): MealSlot[] => {
  const earlier: MealSlot[] = [];
  return day.map((meal) => {
    const slot = meal.locked
      ? meal.slot
      : classifyMeal({
          items: meal.items,
          modelType: meal.modelType,
          minutes: meal.minutes,
          words: meal.words,
          windows,
          earlier: [...earlier],
        });
    if (meal.counts ?? true) earlier.push(slot);
    return slot;
  });
};
