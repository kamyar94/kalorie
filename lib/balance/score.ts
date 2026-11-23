// The balance score of a meal (docs/DESIGN.md section 7, "Balance score"): 0 to 100, from the
// meal's stored totals and the person's daily targets, with its parts and a short reason. Pure
// functions, safe for client components (the meal page works it out again as items change) and
// unit tests (lib/balance/score.test.ts). Every weight, band and limit is in BALANCE below.
//
// Two parts:
//
// 1. Nutrient density, after the Nutrient Rich Foods index NRF9.3 (Drewnowski A, Fulgoni VL 3rd.
//    "Nutrient density: principles and evaluation tools." Am J Clin Nutr 2014;99(5 Suppl):
//    1223S-1228S; Fulgoni VL 3rd, Keast DR, Drewnowski A. "Development and validation of the
//    nutrient-rich foods index." J Nutr 2009;139(8):1549-1554). NRF9.3 adds the percent of the
//    daily value of nine nutrients to encourage per reference amount, each capped at 100 %, and
//    subtracts three nutrients to limit. Kal uses the person's own targets and the meal's own
//    size as the reference: the meal's share is its energy over the day's energy target (at
//    least BALANCE.shareFloor, so a tiny snack is not held to almost nothing). Each nutrient to
//    encourage scores its amount over (target x share), capped at 1; each nutrient to limit is
//    penalised for the part above (limit x share), from 0 at its share to 1 at twice it or more.
//    Density = (mean of the encouraged scores) x (1 - mean of the three limit penalties).
// 2. Portion fit: the meal's share of the day against the usual band for its meal name
//    (BALANCE.bands): 1 inside the band, falling linearly to 0 at no energy below it and at twice
//    the band's top above it.
//
// Score = round(100 x (0.7 x density + 0.3 x portion fit)).
//
// Meals still being analysed, failed meals, drinks on their own and meals with too few known
// nutrients (energy under 20 kcal or fewer than 5 of the 9 to encourage) are not judged.
import type { MealSlot, MealStatus } from "@/lib/contracts/meals";
import { MEAL_SLOT_LABELS } from "@/lib/contracts/meals";
import { formatNutrient, type NutrientCode, type NutrientMap } from "@/lib/contracts/nutrients";
import type { NutrientTarget } from "@/lib/contracts/targets";

export const ENCOURAGED = [
  "protein",
  "fiber",
  "vit_a",
  "vit_c",
  "vit_e",
  "calcium",
  "iron",
  "potassium",
  "magnesium",
] as const satisfies readonly NutrientCode[];

export const LIMITED = [
  "fat_sat",
  "sugars_added",
  "sodium",
] as const satisfies readonly NutrientCode[];

export type EncouragedCode = (typeof ENCOURAGED)[number];
export type LimitedCode = (typeof LIMITED)[number];
export type BalanceCode = EncouragedCode | LimitedCode;

/** Every number the score uses, in one place (and in docs/DESIGN.md section 7). */
export const BALANCE = {
  /** Density counts more than the portion. */
  weights: { density: 0.7, portion: 0.3 },
  /** The smallest share of the day a meal is held to (5 %, about 100 kcal of 2,000). */
  shareFloor: 0.05,
  /** Without an energy target (none set), the day is taken as 2,000 kcal. */
  defaultEnergy: 2000,
  /** Below this a meal is "not enough to judge". */
  minEnergyKcal: 20,
  minEncouragedKnown: 5,
  /** A limit's penalty reaches 1 at this many times its share. */
  limitFullAt: 2,
  /** Usual share of the day's energy by meal name (lower and upper end). */
  bands: {
    breakfast: [0.2, 0.3],
    brunch: [0.25, 0.35],
    lunch: [0.25, 0.35],
    dinner: [0.25, 0.35],
    supper: [0.15, 0.3],
    snack: [0.05, 0.15],
    dessert: [0.05, 0.15],
    drink: [0.05, 0.15],
  } satisfies Record<MealSlot, readonly [number, number]>,
  /** Score bands for the ring's colour and its word. */
  good: 70,
  fair: 40,
} as const;

export const BALANCE_NAMES: Record<BalanceCode, string> = {
  protein: "Protein",
  fiber: "Fiber",
  vit_a: "Vitamin A",
  vit_c: "Vitamin C",
  vit_e: "Vitamin E",
  calcium: "Calcium",
  iron: "Iron",
  potassium: "Potassium",
  magnesium: "Magnesium",
  fat_sat: "Saturated fat",
  sugars_added: "Added sugar",
  sodium: "Sodium",
};

/** "protein", "vitamin A", "added sugar". */
export const balanceWord = (code: BalanceCode) => {
  const name = BALANCE_NAMES[code];
  return name.charAt(0).toLowerCase() + name.slice(1);
};

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "rice", "rice and chicken", "rice, chicken and salad". */
export const listWords = (words: string[], last = "and") =>
  words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} ${last} ${words[words.length - 1]}`;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const clamp = (value: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, value));

export type ScoreBand = "good" | "fair" | "low";

export const scoreBand = (score: number): ScoreBand =>
  score >= BALANCE.good ? "good" : score >= BALANCE.fair ? "fair" : "low";

export const SCORE_BAND_WORDS: Record<ScoreBand, string> = {
  good: "well balanced",
  fair: "fairly balanced",
  low: "poorly balanced",
};

/** "Balance score 91 of 100, well balanced": the ring's spoken name. */
export const scoreLabel = (score: number) =>
  `Balance score ${score} of 100, ${SCORE_BAND_WORDS[scoreBand(score)]}`;

/** What the score needs from a meal. */
export type BalanceInput = {
  totals: NutrientMap;
  slot: MealSlot;
  status: MealStatus;
  /** Every item is a drink (water, coffee, juice): left out of the rankings. */
  drinksOnly: boolean;
};

export type NotJudged = "analysing" | "failed" | "drinks" | "few";

export const NOT_JUDGED_WORDS: Record<NotJudged, string> = {
  analysing: "Kal judges the balance once the meal is worked out.",
  failed: "The analysis did not finish, so there is nothing to judge.",
  drinks: "Drinks on their own are left out of the balance score.",
  few: "Too few of its nutrients are known: the score needs its energy and at least 5 of the 9 nutrients to encourage.",
};

export type EncouragedPart = {
  code: EncouragedCode;
  /** The meal's amount, null when not known. */
  amount: number | null;
  /** The day's target. */
  target: number;
  /** target x share: what a meal of this size "should" bring. */
  share: number;
  /** amount / share (0 when unknown). */
  ratio: number;
  /** min(1, ratio): what counts towards density. */
  points: number;
  state: "met" | "part" | "unknown";
};

export type LimitedPart = {
  code: LimitedCode;
  amount: number | null;
  /** The day's limit. */
  limit: number;
  /** limit x share. */
  share: number;
  ratio: number;
  /** 0 within the share, 1 at twice it or more. */
  penalty: number;
  state: "within" | "over" | "unknown";
};

export type Balance =
  | { judged: false; why: NotJudged }
  | {
      judged: true;
      score: number;
      band: ScoreBand;
      density: number;
      portion: number;
      /** The meal's energy over the day's energy target, unbounded. */
      share: number;
      /** The share the nutrients are compared with (at least the floor). */
      densityShare: number;
      energy: number;
      energyTarget: number;
      slot: MealSlot;
      encouraged: EncouragedPart[];
      limited: LimitedPart[];
      /** Short: "Plenty of protein, fiber and potassium; little sodium". */
      reason: string;
      /** "Right size for a lunch (30% of your day)." */
      size: string;
      /** "Shares are this meal's part of your daily targets: ..." */
      shareSentence: string;
    };

type Targets = Partial<Record<NutrientCode, NutrientTarget>>;

const targetOf = (targets: Targets, code: NutrientCode) => {
  const value = targets[code]?.target;
  return finite(value) && value > 0 ? value : null;
};

/** The portion fit of a share for a meal name (1 inside the band). */
export const portionFit = (share: number, slot: MealSlot) => {
  const [lo, hi] = BALANCE.bands[slot];
  if (share < lo) return clamp(share / lo);
  if (share > hi) return clamp(1 - (share - hi) / hi);
  return 1;
};

const pct = (share: number) => `${Math.round(share * 100)}%`;

/** "1.1×", "3×". */
export const timesText = (ratio: number) =>
  `${(Math.round(ratio * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 })}×`;

/** "a usual lunch", "a usual snack". */
const usual = (slot: MealSlot) => `a usual ${MEAL_SLOT_LABELS[slot].toLowerCase()}`;

/** The size in words, for the reason: "twice a usual dinner", "smaller than a usual lunch". */
const sizeWords = (share: number, slot: MealSlot): string | null => {
  const [lo, hi] = BALANCE.bands[slot];
  if (share >= lo && share <= hi) return null;
  const mid = (lo + hi) / 2;
  if (share > hi) {
    const times = share / mid;
    if (times >= 2.75) return `${Math.round(times)} times ${usual(slot)}`;
    if (times >= 1.75) return `twice ${usual(slot)}`;
    return `bigger than ${usual(slot)}`;
  }
  return share < lo / 2 ? `much smaller than ${usual(slot)}` : `smaller than ${usual(slot)}`;
};

/**
 * The share as a percent; with one decimal when the whole number would land on the band's edge
 * the share is outside of ("4.6%", not "5%", for a snack under its 5 to 15%).
 */
const sharePct = (share: number, lo: number, hi: number) => {
  const whole = Math.round(share * 100);
  const outside = share < lo || share > hi;
  const onEdge = whole === Math.round(lo * 100) || whole === Math.round(hi * 100);
  return outside && onEdge
    ? `${(Math.round(share * 1000) / 10).toLocaleString("en-US")}%`
    : `${whole}%`;
};

/** The sentence about size under the score: "Right size for a lunch (30% of your day)." */
const sizeSentence = (share: number, slot: MealSlot) => {
  const [lo, hi] = BALANCE.bands[slot];
  const name = MEAL_SLOT_LABELS[slot].toLowerCase();
  const words = sizeWords(share, slot);
  const percent = sharePct(share, lo, hi);
  if (!words) return `Right size for a ${name} (${percent} of your day).`;
  return `${capital(words)} (${percent} of your day; usually ${Math.round(lo * 100)} to ${Math.round(hi * 100)}%).`;
};

/** The short reason: what stands out, at most two parts. */
const reasonOf = (
  score: number,
  encouraged: EncouragedPart[],
  limited: LimitedPart[],
  share: number,
  slot: MealSlot,
  fit: number,
) => {
  const known = encouraged.filter((p) => p.state !== "unknown");
  const met = known.filter((p) => p.state === "met").map((p) => p.code);
  const over = limited.filter((p) => p.state === "over").sort((a, b) => b.ratio - a.ratio);
  // The limit furthest over its share; a little over (under 1.2 times) is said gently.
  const overText = over.length
    ? over[0]!.ratio >= 1.2
      ? `${balanceWord(over[0]!.code)} ${timesText(over[0]!.ratio)} its share`
      : `${balanceWord(over[0]!.code)} a little over its share`
    : null;
  const size = fit < 0.75 ? sizeWords(share, slot) : null;
  const lowest = [...known].sort((a, b) => a.ratio - b.ratio);
  const average = known.reduce((sum, p) => sum + p.points, 0) / Math.max(1, known.length);
  const low = lowest.filter((p) => p.ratio < 0.25).slice(0, 2);
  const lowText =
    average < 0.25
      ? "little of anything to encourage"
      : low.length
        ? `${low.every((p) => p.ratio < 0.1) ? "almost no" : "little"} ${listWords(
            low.map((p) => balanceWord(p.code)),
            "or",
          )}`
        : null;
  const knownLimits = limited.filter((p) => p.state !== "unknown");
  const leanest = [...knownLimits].sort((a, b) => a.ratio - b.ratio)[0];
  const withinText =
    knownLimits.length && knownLimits.every((p) => p.state === "within")
      ? leanest && leanest.ratio <= 0.5
        ? `little ${balanceWord(leanest.code)}`
        : "within the limits"
      : null;
  // Without one at its full share, the three closest to it (at least three quarters of it).
  const near = known
    .filter((p) => p.ratio >= 0.75)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, 3)
    .sort((a, b) => ENCOURAGED.indexOf(a.code) - ENCOURAGED.indexOf(b.code));
  const plenty = met.length
    ? `plenty of ${listWords(met.slice(0, 3).map((code) => balanceWord(code)))}`
    : near.length
      ? `good amounts of ${listWords(near.map((p) => balanceWord(p.code)))}`
      : null;

  const parts: string[] = [];
  if (score >= BALANCE.fair && plenty) {
    parts.push(plenty);
    parts.push(size ?? overText ?? withinText ?? "");
  } else {
    // The biggest problem first: a limit far over its share, then the size, then what is short.
    const first = overText ?? size ?? lowText ?? plenty;
    if (first) parts.push(first);
    const second = [size, lowText, withinText].find((text) => text && text !== first);
    if (second) parts.push(second);
  }
  const text = parts.filter(Boolean).join("; ");
  return capital(text || "some of what to encourage, within the limits");
};

/** Whether a meal of these items is drinks only (no food). */
export const drinksOnly = (items: { drink: boolean }[]) =>
  items.length > 0 && items.every((item) => item.drink);

/**
 * The balance of one meal against the person's targets, or why it is not judged. targets: the
 * map of getTargets (lib/targets/service.ts); their kinds do not change how a code is read here
 * (the nine are always encouraged, the three always limited).
 */
export const balanceOf = (meal: BalanceInput, targets: Targets): Balance => {
  if (meal.status === "queued" || meal.status === "analysing")
    return { judged: false, why: "analysing" };
  if (meal.status === "failed") return { judged: false, why: "failed" };
  if (meal.drinksOnly) return { judged: false, why: "drinks" };
  const energy = meal.totals.energy;
  if (!finite(energy) || energy < BALANCE.minEnergyKcal) return { judged: false, why: "few" };

  const energyTarget = targetOf(targets, "energy") ?? BALANCE.defaultEnergy;
  const share = energy / energyTarget;
  const densityShare = Math.max(share, BALANCE.shareFloor);

  const encouraged: EncouragedPart[] = [];
  for (const code of ENCOURAGED) {
    const target = targetOf(targets, code);
    if (target === null) continue;
    const amount = meal.totals[code];
    const portion = target * densityShare;
    if (!finite(amount)) {
      encouraged.push({
        code,
        amount: null,
        target,
        share: portion,
        ratio: 0,
        points: 0,
        state: "unknown",
      });
      continue;
    }
    const ratio = amount / portion;
    encouraged.push({
      code,
      amount,
      target,
      share: portion,
      ratio,
      points: Math.min(1, ratio),
      state: ratio >= 1 ? "met" : "part",
    });
  }
  const known = encouraged.filter((p) => p.state !== "unknown");
  if (known.length < BALANCE.minEncouragedKnown) return { judged: false, why: "few" };

  const limited: LimitedPart[] = [];
  for (const code of LIMITED) {
    const limit = targetOf(targets, code);
    if (limit === null) continue;
    const amount = meal.totals[code];
    const portion = limit * densityShare;
    if (!finite(amount)) {
      limited.push({
        code,
        amount: null,
        limit,
        share: portion,
        ratio: 0,
        penalty: 0,
        state: "unknown",
      });
      continue;
    }
    const ratio = amount / portion;
    limited.push({
      code,
      amount,
      limit,
      share: portion,
      ratio,
      penalty: clamp((ratio - 1) / (BALANCE.limitFullAt - 1)),
      state: ratio > 1 ? "over" : "within",
    });
  }

  const encouragedAverage = known.reduce((sum, p) => sum + p.points, 0) / known.length;
  // An unknown limit counts as within its share; the mean is over the three.
  const penalty = limited.reduce((sum, p) => sum + p.penalty, 0) / LIMITED.length;
  const density = clamp(encouragedAverage * (1 - penalty));
  const portion = portionFit(share, meal.slot);
  const score = Math.round(
    100 * (BALANCE.weights.density * density + BALANCE.weights.portion * portion),
  );
  const protein = encouraged.find((p) => p.code === "protein");
  const sharePart = protein
    ? `, so its protein share is ${pct(densityShare)} of ${formatNutrient("protein", protein.target)}`
    : "";
  const floorPart =
    share < BALANCE.shareFloor
      ? ` Kal counts at least ${pct(BALANCE.shareFloor)}, so a small snack is not held to tiny shares.`
      : "";
  return {
    judged: true,
    score,
    band: scoreBand(score),
    density,
    portion,
    share,
    densityShare,
    energy,
    energyTarget,
    slot: meal.slot,
    encouraged,
    limited,
    reason: reasonOf(score, encouraged, limited, share, meal.slot, portion),
    size: sizeSentence(share, meal.slot),
    shareSentence: `Shares are this meal's part of your daily targets: ${formatNutrient("energy", energy)} of ${formatNutrient("energy", energyTarget)} is ${pct(share)}${sharePart}.${floorPart}`,
  };
};

/** The state of a nutrient row on the meal page: "met", "67%", "within", "1.1×", "not known". */
export const partState = (part: EncouragedPart | LimitedPart) => {
  if (part.state === "unknown") return { text: "not known", tone: "muted" as const };
  if ("points" in part)
    return part.state === "met"
      ? { text: "met", tone: "good" as const }
      : { text: `${Math.round(part.ratio * 100)}%`, tone: "fair" as const };
  if (part.state === "within") return { text: "within", tone: "good" as const };
  return {
    text: timesText(part.ratio),
    tone: part.ratio >= BALANCE.limitFullAt ? ("low" as const) : ("fair" as const),
  };
};

/** "38 g of 33 g", "780 mg, limit 690 mg": the amount against the meal's share. */
export const partAmounts = (part: EncouragedPart | LimitedPart) => {
  const amount = part.amount === null ? "–" : formatNutrient(part.code, part.amount);
  return "points" in part
    ? `${amount} of ${formatNutrient(part.code, part.share)}`
    : `${amount}, limit ${formatNutrient(part.code, part.share)}`;
};

/** The plain-words explanation behind "How it is worked out". */
export const HOW_IT_WORKS = [
  "Each meal gets a balance score from 0 to 100. Seven tenths of it is how nutritious the meal is for its size, and three tenths is whether its size fits that kind of meal.",
  "How nutritious: the meal's share is its calories out of your day's calorie target (at least 5%, so a small snack is not held to almost nothing). For protein, fiber, vitamins A, C and E, calcium, iron, potassium and magnesium, the meal earns up to a full point each when it brings at least that share of your target. For saturated fat, added sugar and sodium, it loses points for going over that share of your limit, all of them at twice the share. This follows the Nutrient Rich Foods index (NRF9.3) of Drewnowski and Fulgoni, with your own targets.",
  "Size: breakfast usually brings 20 to 30% of the day, brunch, lunch and dinner 25 to 35%, supper 15 to 30%, a snack or dessert 5 to 15%. Inside that range the size counts in full; it counts less the further a meal is outside it.",
  "Drinks on their own, meals still being worked out, failed meals and meals with too few known nutrients are left out.",
] as const;
