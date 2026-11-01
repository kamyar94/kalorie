// Trends (docs/DESIGN.md section 7): pure aggregation over the person's meals of a period. The
// service (lib/trends/service.ts) loads the rows; this file turns them into what the charts show.
// Plain functions, safe for client components and unit tests.
import type { MealSlot } from "@/lib/contracts/meals";
import { MEAL_SLOTS } from "@/lib/contracts/meals";
import type { NutrientCode, NutrientMap } from "@/lib/contracts/nutrients";
import { NUTRIENT_CATALOGUE } from "@/lib/contracts/nutrients";
import type { NutrientTarget } from "@/lib/contracts/targets";
import type { WeightPointDto } from "@/lib/contracts/integrations";
import { localParts, shiftLocalDate } from "@/lib/meals/time";

export const TREND_RANGES = ["day", "week", "month"] as const;
export type TrendRange = (typeof TREND_RANGES)[number];
export const RANGE_DAYS: Record<TrendRange, number> = { day: 1, week: 7, month: 30 };

export type TrendMeal = {
  localDate: string;
  eatenAt: Date | string;
  tz: string;
  slot: MealSlot;
  totals: NutrientMap;
};

export type TrendItem = {
  name: string;
  foodId: string | null;
  foodName: string | null;
  energy: number;
};

export type DayTotals = {
  date: string;
  meals: number;
  /** Energy and macros (and every other known nutrient) of the day. */
  totals: NutrientMap;
};

export type SlotAverage = { slot: MealSlot; energy: number; share: number; meals: number };

export type NutrientStatus = {
  code: NutrientCode;
  name: string;
  unit: string;
  kind: NutrientTarget["kind"];
  target: number;
  /** Mean per logged day. */
  average: number;
  /** average / target. */
  ratio: number;
  daysBelow: number;
  daysAbove: number;
  /** "low": usually under a minimum or goal; "high": usually over a maximum or goal; else "ok". */
  verdict: "low" | "high" | "ok";
};

export type TopFood = { name: string; foodId: string | null; times: number; energy: number };

export type TrendsData = {
  range: TrendRange;
  start: string;
  end: string;
  dates: string[];
  days: DayTotals[];
  /** Days with at least one meal. */
  loggedDays: number;
  /** Mean per logged day. */
  average: NutrientMap;
  targets: Partial<Record<NutrientCode, NutrientTarget>>;
  bySlot: SlotAverage[];
  /** Mean energy per logged day by local hour, 24 values. */
  byHour: number[];
  nutrients: NutrientStatus[];
  topFoods: TopFood[];
  weight: WeightPointDto[];
};

/** The first and last day of a period that ends on `end`. */
export const rangeDates = (range: TrendRange, end: string) => {
  const days = RANGE_DAYS[range];
  return Array.from({ length: days }, (_, i) => shiftLocalDate(end, i - days + 1));
};

const add = (into: NutrientMap, from: NutrientMap) => {
  for (const [code, value] of Object.entries(from))
    if (typeof value === "number" && Number.isFinite(value)) into[code] = (into[code] ?? 0) + value;
};

/** How many logged days must show a pattern before it is called one. */
export const MIN_DAYS_FOR_PATTERN = 3;

export const computeTrends = (input: {
  range: TrendRange;
  end: string;
  meals: TrendMeal[];
  items: TrendItem[];
  targets: Partial<Record<NutrientCode, NutrientTarget>>;
  weight?: WeightPointDto[];
}): TrendsData => {
  const dates = rangeDates(input.range, input.end);
  const inRange = new Set(dates);
  const meals = input.meals.filter((m) => inRange.has(m.localDate));

  const byDate = new Map<string, DayTotals>(
    dates.map((date) => [date, { date, meals: 0, totals: {} }]),
  );
  const slotTotals = new Map<MealSlot, { energy: number; meals: number }>(
    MEAL_SLOTS.map((slot) => [slot, { energy: 0, meals: 0 }]),
  );
  const byHour = Array.from({ length: 24 }, () => 0);

  for (const meal of meals) {
    const day = byDate.get(meal.localDate)!;
    day.meals += 1;
    add(day.totals, meal.totals);
    const slot = slotTotals.get(meal.slot)!;
    slot.energy += meal.totals.energy ?? 0;
    slot.meals += 1;
    const at = typeof meal.eatenAt === "string" ? new Date(meal.eatenAt) : meal.eatenAt;
    const hour = Math.floor(localParts(at, meal.tz).minutes / 60);
    byHour[hour] = (byHour[hour] ?? 0) + (meal.totals.energy ?? 0);
  }

  const days = dates.map((date) => byDate.get(date)!);
  const logged = days.filter((d) => d.meals > 0);
  const loggedDays = logged.length;
  const average: NutrientMap = {};
  if (loggedDays) {
    const sum: NutrientMap = {};
    for (const day of logged) add(sum, day.totals);
    for (const [code, value] of Object.entries(sum)) average[code] = value / loggedDays;
  }

  const energyTotal = [...slotTotals.values()].reduce((s, v) => s + v.energy, 0);
  const bySlot: SlotAverage[] = MEAL_SLOTS.map((slot) => {
    const v = slotTotals.get(slot)!;
    return {
      slot,
      energy: loggedDays ? v.energy / loggedDays : 0,
      share: energyTotal > 0 ? v.energy / energyTotal : 0,
      meals: v.meals,
    };
  });

  const nutrients: NutrientStatus[] = [];
  for (const info of NUTRIENT_CATALOGUE) {
    const target = input.targets[info.code];
    if (!target?.target || target.target <= 0 || !loggedDays) continue;
    const values = logged.map((d) => d.totals[info.code] ?? 0);
    const avg = values.reduce((s, v) => s + v, 0) / loggedDays;
    const upper = target.kind === "range" && target.upper ? target.upper : target.target;
    const daysBelow = values.filter((v) => v < target.target! * 0.9).length;
    const daysAbove = values.filter((v) => v > upper * 1.1).length;
    const enough = loggedDays >= Math.min(MIN_DAYS_FOR_PATTERN, dates.length);
    const mostly = (n: number) => n / loggedDays >= 0.6;
    let verdict: NutrientStatus["verdict"] = "ok";
    if (enough) {
      if (target.kind !== "max" && mostly(daysBelow) && avg < target.target * 0.9) verdict = "low";
      else if (target.kind !== "min" && mostly(daysAbove) && avg > upper * 1.1) verdict = "high";
    }
    nutrients.push({
      code: info.code,
      name: info.name,
      unit: info.unit,
      kind: target.kind,
      target: target.target,
      average: avg,
      ratio: avg / target.target,
      daysBelow,
      daysAbove,
      verdict,
    });
  }

  const foods = new Map<string, TopFood>();
  for (const item of input.items) {
    const name = item.foodName ?? item.name;
    const key = item.foodId ?? `name:${name.toLowerCase()}`;
    const entry = foods.get(key) ?? { name, foodId: item.foodId, times: 0, energy: 0 };
    entry.times += 1;
    entry.energy += Number.isFinite(item.energy) ? item.energy : 0;
    foods.set(key, entry);
  }
  const topFoods = [...foods.values()]
    .sort((a, b) => b.times - a.times || b.energy - a.energy)
    .slice(0, 8);

  return {
    range: input.range,
    start: dates[0]!,
    end: input.end,
    dates,
    days,
    loggedDays,
    average,
    targets: input.targets,
    bySlot,
    byHour: byHour.map((v) => (loggedDays ? v / loggedDays : 0)),
    nutrients,
    topFoods,
    weight: (input.weight ?? []).filter((w) => w.date >= dates[0]! && w.date <= input.end),
  };
};
