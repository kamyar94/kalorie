// What a meal that is not food shows. The analysis says it (not_food_kind: medicine, supplement or
// other), and Kal keeps that with the meal's error (meals.error.notFoodKind). Meals analysed before
// the analysis said it get it from the words Kal kept: the detail of the error ("The photo seems
// to show: a bottle of vitamin D tablets."), the analysis title, and for a meal typed in words its
// description. A medicine or a supplement can be logged as a medicine ("Log as a medicine" on the
// meal page and on Today). Pure code, safe for client components.
import { isNotFoodKind, type NotFoodKind } from "@/lib/contracts/analysis";

/** The words the not-food message puts before what the photo shows (lib/analysis/errors.ts). */
export const NOT_FOOD_DETAIL = "The photo seems to show:";

// Keywords, English and Persian. Supplements are checked first: "vitamin D tablets" is a
// supplement, "ibuprofen tablets" a medicine. A tablet computer is not a medicine.
const SUPPLEMENT_EN = /\b(?:supplements?|multi-?vitamins?|vitamins?|probiotics?)\b/i;
const MEDICINE_EN =
  /\b(?:medications?|medicines?|medicinal|meds|pills?|tablets?(?!\s+(?:computers?|devices?|screens?|stands?|cases?))|caplets?|capsules?|prescriptions?|syrups?|drops|inhalers?|blister (?:packs?|strips?)|lozenges?)\b/i;
// Persian has no \b for its letters: a keyword starts a word (after a non-letter) and may carry a
// suffix (داروها, قرص‌ها).
const SUPPLEMENT_FA = /(?:^|[^\p{L}\p{M}])(?:ویتامین|مکمل)/u;
const MEDICINE_FA = /(?:^|[^\p{L}\p{M}])(?:قرص|دارو|کپسول|شربت|قطره)/u;

/** What some words say a non-food thing is: a supplement, a medicine, or something else. */
export const notFoodKindFromWords = (...texts: (string | null | undefined)[]): NotFoodKind => {
  const words = texts.filter((t): t is string => typeof t === "string" && t !== "").join("\n");
  if (SUPPLEMENT_EN.test(words) || SUPPLEMENT_FA.test(words)) return "supplement";
  if (MEDICINE_EN.test(words) || MEDICINE_FA.test(words)) return "medicine";
  return "other";
};

/** What the photo seemed to show, from a stored not-food message; null when it has no detail. */
export const notFoodDetail = (message: string | null | undefined): string | null => {
  const at = message ? message.indexOf(NOT_FOOD_DETAIL) : -1;
  if (at < 0) return null;
  return (
    message!
      .slice(at + NOT_FOOD_DETAIL.length)
      .trim()
      .replace(/\.$/, "") || null
  );
};

/** The parts of a meal row (or DTO) the kind is read from. */
export type NotFoodMeal = {
  error: { kind: string; message: string; notFoodKind?: unknown } | null;
  /** meals.analysis: the model's last output, if any. */
  analysis?: unknown;
  /** The meal's note, which is the whole description of a meal typed in words. */
  note?: string | null;
  /** Typed in words without a photo: the note is then read too. */
  textOnly?: boolean;
};

/** What a meal that ended as "not food" shows; null for every other meal. */
export const mealNotFoodKind = (meal: NotFoodMeal): NotFoodKind | null => {
  if (meal.error?.kind !== "not-food") return null;
  if (isNotFoodKind(meal.error.notFoodKind)) return meal.error.notFoodKind;
  const analysis =
    typeof meal.analysis === "object" && meal.analysis !== null
      ? (meal.analysis as { not_food_kind?: unknown; title?: unknown })
      : null;
  if (isNotFoodKind(analysis?.not_food_kind)) return analysis.not_food_kind;
  return notFoodKindFromWords(
    notFoodDetail(meal.error.message),
    typeof analysis?.title === "string" ? analysis.title : null,
    meal.textOnly ? meal.note : null,
  );
};

/** Medicines and supplements are logged as medicines. */
export const isMedicineKind = (kind: NotFoodKind | null | undefined) =>
  kind === "medicine" || kind === "supplement";

/**
 * Whether a meal offers "Log as a medicine": it failed because it is not food, and what it shows
 * is a medicine or a supplement.
 */
export const logsAsMedicine = (meal: {
  status: string;
  error: { kind: string; notFoodKind?: NotFoodKind | null } | null;
}) =>
  meal.status === "failed" &&
  meal.error?.kind === "not-food" &&
  isMedicineKind(meal.error.notFoodKind ?? null);
