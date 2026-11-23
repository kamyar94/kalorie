// "What should I eat?" (docs/DESIGN.md section 7): the arithmetic, as plain functions for the
// service (lib/suggest/service.ts) and unit tests (lib/suggest/compute.test.ts). Every weight and
// window is in SUGGEST below.
//
// - Left today: the day's targets minus what was eaten (meals, not water on its own): energy,
//   protein and fiber still open, and the room left under sodium, saturated fat and added sugar.
// - Pattern: the last 28 days before today. The meals within 90 minutes either side of now give
//   the usual meal name (the most common) and size (the median of each day's energy in that
//   window, over the days that had one); "after" is the mean energy eaten from now to the end of
//   the day over the logged days. Under three logged days is too little to call a pattern.
// - The size that suits now: the usual size now (without a pattern: the middle of the usual band
//   for the meal name of this hour, lib/balance/score.ts, times the energy target), scaled down
//   when what is left is less than that meal plus what usually comes after it, and never more
//   than what is left.
// - Candidates: favorites and the distinct meals of the last 90 days (the same foods are one
//   meal, had N times). One that is more than what is left is never suggested. The rest are
//   ranked by fit to the size, how much of the open protein and fiber they fill (for their part
//   of what is left), how well they stay under the room left by the limits, their balance score,
//   a bonus for a favorite or a meal had often, and a penalty when had in the last two days.
import { BALANCE, balanceWord } from "@/lib/balance/score";
import type { MealSlot } from "@/lib/contracts/meals";
import { MEAL_SLOT_LABELS } from "@/lib/contracts/meals";
import type { NutrientCode, NutrientMap } from "@/lib/contracts/nutrients";
import type { NutrientTarget } from "@/lib/contracts/targets";
import type {
  BalancedIdeaDto,
  EatingPatternDto,
  LeftTodayDto,
  LimitCode,
} from "@/lib/contracts/suggest";
import { formatKcal } from "@/lib/ui/format";

export const SUGGEST = {
  /** Days before today the pattern reads. */
  patternDays: 28,
  /** Minutes either side of now that count as "around now". */
  windowMinutes: 90,
  /** Logged days needed to speak of a pattern. */
  minPatternDays: 3,
  /** Days of past meals that are candidates (favorites always are). */
  candidateDays: 90,
  /** A meal had this recently is spaced out. */
  recentHours: 48,
  /** How many suggestions are shown. */
  shown: 3,
  weights: {
    size: 0.3,
    fill: 0.25,
    limits: 0.15,
    balance: 0.2,
    /** Added for a favorite. */
    favorite: 0.08,
    /** Added for each time beyond the first in 90 days, at most `oftenMax`. */
    often: 0.02,
    oftenMax: 0.08,
    /** Taken off a meal had in the last two days. */
    recent: 0.25,
  },
} as const;

export const LIMIT_CODES: readonly LimitCode[] = ["sodium", "fat_sat", "sugars_added"];

type Targets = Partial<Record<NutrientCode, NutrientTarget>>;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const clamp = (value: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, value));
const targetOf = (targets: Targets, code: NutrientCode) => {
  const value = targets[code]?.target;
  return finite(value) && value > 0 ? value : null;
};

/** What is still open today (water on its own is not a meal; its nutrients are none anyway). */
export const leftToday = (eaten: NutrientMap, targets: Targets, pending = 0): LeftTodayDto => {
  const energyTarget = targetOf(targets, "energy") ?? BALANCE.defaultEnergy;
  const ate = (code: NutrientCode) => (finite(eaten[code]) ? eaten[code] : 0);
  const open = (code: NutrientCode) => {
    const target = targetOf(targets, code);
    return target === null ? null : Math.max(0, target - ate(code));
  };
  return {
    energyTarget,
    eaten: ate("energy"),
    energyLeft: energyTarget - ate("energy"),
    protein: open("protein"),
    fiber: open("fiber"),
    limits: LIMIT_CODES.flatMap((code) => {
      const limit = targetOf(targets, code);
      return limit === null ? [] : [{ code, limit, room: Math.max(0, limit - ate(code)) }];
    }),
    pending,
  };
};

/** One past meal as the pattern reads it. */
export type PatternMeal = {
  localDate: string;
  /** Minutes since local midnight, in the meal's own zone. */
  minutes: number;
  slot: MealSlot;
  energy: number;
  /** Has food (not drinks on their own). */
  food: boolean;
};

const circular = (a: number, b: number) => {
  const d = Math.abs(a - b) % 1440;
  return Math.min(d, 1440 - d);
};

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** The usual meal around `nowMinutes`, from meals of the days before today. */
export const eatingPattern = (
  meals: PatternMeal[],
  nowMinutes: number,
): EatingPatternDto & { afterWindow: number } => {
  const days = [...new Set(meals.map((m) => m.localDate))];
  const near = meals.filter(
    (m) => m.food && circular(m.minutes, nowMinutes) <= SUGGEST.windowMinutes,
  );
  const perDay = new Map<string, number>();
  for (const m of near) perDay.set(m.localDate, (perDay.get(m.localDate) ?? 0) + m.energy);
  const counts = new Map<MealSlot, { n: number; latest: string }>();
  for (const m of near) {
    const entry = counts.get(m.slot) ?? { n: 0, latest: "" };
    entry.n += 1;
    if (m.localDate > entry.latest) entry.latest = m.localDate;
    counts.set(m.slot, entry);
  }
  const usualSlot =
    [...counts.entries()].sort(
      (a, b) => b[1].n - a[1].n || b[1].latest.localeCompare(a[1].latest),
    )[0]?.[0] ?? null;
  const sumWhere = (keep: (m: PatternMeal) => boolean) =>
    days.length
      ? meals.filter(keep).reduce((sum, m) => sum + (finite(m.energy) ? m.energy : 0), 0) /
        days.length
      : 0;
  const usualKcal = median([...perDay.values()]);
  return {
    days: days.length,
    enough: days.length >= SUGGEST.minPatternDays,
    usualSlot,
    usualKcal: usualKcal === null ? null : Math.round(usualKcal),
    often: days.length ? perDay.size / days.length : 0,
    after: Math.round(sumWhere((m) => m.minutes >= nowMinutes)),
    afterWindow: Math.round(sumWhere((m) => m.minutes > nowMinutes + SUGGEST.windowMinutes)),
  };
};

/**
 * The energy that suits now: the usual size now (or the middle of the band of this hour's meal
 * name), scaled down when what is left is less than it plus what usually comes after, never more
 * than what is left.
 */
export const sizeNow = (
  left: Pick<LeftTodayDto, "energyLeft" | "energyTarget">,
  pattern: Pick<EatingPatternDto, "enough" | "usualKcal"> & { afterWindow: number },
  slotNow: MealSlot,
) => {
  if (left.energyLeft <= 0) return 0;
  const [lo, hi] = BALANCE.bands[slotNow];
  const usual =
    pattern.enough && pattern.usualKcal ? pattern.usualKcal : ((lo + hi) / 2) * left.energyTarget;
  const rest = usual + (pattern.enough ? pattern.afterWindow : 0);
  const scaled = rest > 0 ? usual * Math.min(1, left.energyLeft / rest) : usual;
  return Math.round(Math.min(left.energyLeft, scaled));
};

/** A meal that could be suggested (one per distinct meal). */
export type Candidate = {
  mealId: string;
  title: string;
  slot: MealSlot;
  totals: NutrientMap;
  favorite: boolean;
  /** Times had in the last 90 days. */
  times: number;
  /** The last time it was had. */
  lastAt: Date;
  /** Its balance score, null when not judged. */
  score: number | null;
};

export type RankContext = {
  now: Date;
  left: LeftTodayDto;
  pattern: EatingPatternDto;
  size: number;
};

export type Ranked = Candidate & {
  rank: number;
  parts: {
    size: number;
    fill: number;
    limits: number;
    balance: number;
    bonus: number;
    recent: number;
  };
  reason: string;
};

const an = (slot: MealSlot) => {
  const name = MEAL_SLOT_LABELS[slot].toLowerCase();
  return slot === "snack" || slot === "drink" ? `a ${name}` : name;
};

/** The one-line reason for a suggestion. */
const reasonFor = (
  c: Candidate,
  ctx: RankContext,
  expected: { protein: number; fiber: number },
  limitPenalties: { code: LimitCode; penalty: number; over: boolean }[],
) => {
  const energy = c.totals.energy ?? 0;
  const { left, pattern, size } = ctx;
  const protein = finite(c.totals.protein) ? c.totals.protein : 0;
  const fiber = finite(c.totals.fiber) ? c.totals.fiber : 0;
  let nutrient: string | null = null;
  if (
    left.protein !== null &&
    left.protein >= 5 &&
    protein >= 0.6 * expected.protein &&
    protein >= 5
  )
    nutrient = `covers ${Math.round(Math.min(protein, left.protein))} g of the ${Math.round(left.protein)} g protein you still need`;
  else if (left.fiber !== null && left.fiber >= 2 && fiber >= 0.6 * expected.fiber && fiber >= 2)
    nutrient = `${Math.round(Math.min(fiber, left.fiber))} g of the ${Math.round(left.fiber)} g fiber you are short of today`;

  const usual = pattern.enough && pattern.usualSlot && pattern.usualKcal;
  const name = usual ? MEAL_SLOT_LABELS[pattern.usualSlot!].toLowerCase() : null;
  const scaled = usual && size < pattern.usualKcal! * 0.85;
  let sizeText: string;
  if (size > 0 && Math.abs(energy - size) <= 0.15 * size)
    sizeText =
      usual && !scaled
        ? `fits your usual ${formatKcal(pattern.usualKcal)} kcal ${name}`
        : `fits the ${formatKcal(size)} kcal that suits now`;
  else if (energy < size)
    sizeText =
      usual && !scaled
        ? `${energy < 0.6 * size ? "smaller" : "a bit smaller"} than your usual ${name}`
        : `${energy < 0.6 * size ? "smaller" : "a bit smaller"} than the ${formatKcal(size)} kcal that suits now`;
  else
    sizeText =
      usual && !scaled
        ? `a bit bigger than your usual ${name}`
        : `a bit bigger than the ${formatKcal(size)} kcal that suits now`;

  const worst = [...limitPenalties].sort((a, b) => b.penalty - a.penalty)[0];
  const limitText =
    worst && worst.penalty > 0
      ? worst.over
        ? `${balanceWord(worst.code)} would go over today's limit`
        : `${balanceWord(worst.code)} near its share of what is left, so keep the rest of the day light`
      : null;

  const parts = nutrient ? [nutrient, limitText ?? sizeText] : [sizeText, limitText];
  const text = parts.filter(Boolean).join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
};

/**
 * Ranks the candidates for now, best first; a candidate with more energy than is left today (or
 * none at all) is left out.
 */
export const rankCandidates = (candidates: Candidate[], ctx: RankContext): Ranked[] => {
  const { left, size, now } = ctx;
  const W = SUGGEST.weights;
  if (left.energyLeft <= 0) return [];
  // The part of what is left that suits this meal: what it "should" bring of the open nutrients.
  const part = clamp(size / left.energyLeft);
  const expected = {
    protein: (left.protein ?? 0) * part,
    fiber: (left.fiber ?? 0) * part,
  };
  const ranked: Ranked[] = [];
  for (const c of candidates) {
    const energy = c.totals.energy;
    if (!finite(energy) || energy <= 0 || energy > left.energyLeft) continue;
    const sizeFit = size > 0 ? clamp(1 - Math.abs(energy - size) / size) : 0;
    const cover = (amount: unknown, open: number | null, want: number) =>
      open === null || open <= 0 || want <= 0 ? 1 : clamp((finite(amount) ? amount : 0) / want);
    const fill =
      (cover(c.totals.protein, left.protein, expected.protein) +
        cover(c.totals.fiber, left.fiber, expected.fiber)) /
      2;
    const limitPenalties = left.limits.map(({ code, room }) => {
      const amount = c.totals[code];
      if (!finite(amount) || amount <= 0) return { code, penalty: 0, over: false };
      if (amount > room) return { code, penalty: 1, over: true };
      const allowed = room * part;
      return {
        code,
        penalty: allowed > 0 ? clamp(amount / allowed - 1) : 1,
        over: false,
      };
    });
    const limits = limitPenalties.length
      ? 1 - limitPenalties.reduce((sum, p) => sum + p.penalty, 0) / limitPenalties.length
      : 1;
    const balance = c.score === null ? 0.5 : c.score / 100;
    const bonus =
      (c.favorite ? W.favorite : 0) + Math.min(W.oftenMax, W.often * Math.max(0, c.times - 1));
    const recent =
      now.getTime() - c.lastAt.getTime() < SUGGEST.recentHours * 3_600_000 ? W.recent : 0;
    const rank =
      W.size * sizeFit + W.fill * fill + W.limits * limits + W.balance * balance + bonus - recent;
    ranked.push({
      ...c,
      rank,
      parts: { size: sizeFit, fill, limits, balance, bonus, recent },
      reason: reasonFor(c, ctx, expected, limitPenalties),
    });
  }
  return ranked.sort((a, b) => b.rank - a.rank || b.lastAt.getTime() - a.lastAt.getTime());
};

/** The label on a suggestion: the best one, else a favorite, else how often it was had. */
export const badgeFor = (c: Pick<Candidate, "favorite" | "times">, index: number) =>
  index === 0 ? "Best fit" : c.favorite ? "Favorite" : c.times >= 2 ? `Had ${c.times} times` : null;

/** "It is 13:05. You usually have lunch now, about 600 kcal, and eat about 1,400 kcal more ..." */
export const introFor = (time: string, pattern: EatingPatternDto) => {
  if (!pattern.enough)
    return `It is ${time}. Kal needs a few more days of meals to learn when and how much you usually eat.`;
  const after =
    pattern.after >= 50
      ? `eat about ${formatKcal(Math.round(pattern.after / 50) * 50)} kcal more after this hour`
      : "usually eat nothing more after this hour";
  if (!pattern.usualSlot || !pattern.usualKcal || pattern.often < 0.3)
    return `It is ${time}. You do not usually eat around now, and ${after.replace("usually ", "")}.`;
  return `It is ${time}. You usually have ${an(pattern.usualSlot)} now, about ${formatKcal(
    Math.round(pattern.usualKcal / 10) * 10,
  )} kcal, and ${after}.`;
};

/** A note above the list, or null. */
export const noteFor = (left: LeftTodayDto, ranked: number, candidates: number) => {
  const pending =
    left.pending > 0
      ? ` ${left.pending === 1 ? "One meal is" : `${left.pending} meals are`} still being worked out and not counted yet.`
      : "";
  if (left.energyLeft <= 0)
    return `You have eaten today's ${formatKcal(left.energyTarget)} kcal; anything more goes over it.${pending}`;
  if (candidates > 0 && ranked === 0)
    return `Nothing you have had fits in the ${formatKcal(left.energyLeft)} kcal left today.${pending}`;
  return pending ? pending.trim() : null;
};

/**
 * A balanced idea from the targets alone: the size that suits now with its part of the open
 * protein and fiber and of the room under sodium, and the plate method as an example.
 */
export const balancedIdea = (left: LeftTodayDto, size: number): BalancedIdeaDto | null => {
  if (size <= 0) return null;
  const part = left.energyLeft > 0 ? clamp(size / left.energyLeft) : 0;
  const protein = Math.round((left.protein ?? 0) * part);
  const fiber = Math.round((left.fiber ?? 0) * part);
  const room = left.limits.find((l) => l.code === "sodium");
  const sodium = room ? Math.round((room.room * part) / 10) * 10 : null;
  const wants = [
    protein > 0 ? `${protein} g protein` : null,
    fiber > 0 ? `${fiber} g fiber` : null,
  ].filter(Boolean);
  return {
    energy: size,
    protein,
    fiber,
    sodium,
    text:
      `About ${formatKcal(size)} kcal` +
      (wants.length ? ` with at least ${wants.join(" and ")}` : "") +
      (sodium !== null ? `, under ${formatKcal(sodium)} mg sodium` : "") +
      ". For example, a plate that is half vegetables, a quarter protein (fish, eggs, beans or lean meat) and a quarter whole grains.",
  };
};

/** The distinct-meal key: the same foods (names, in any order) are one meal. */
export const candidateKey = (title: string, itemNames: string[]) => {
  const names = [...new Set(itemNames.map((n) => n.trim().toLowerCase()).filter(Boolean))].sort();
  return names.length ? names.join("|") : `title:${title.trim().toLowerCase()}`;
};
