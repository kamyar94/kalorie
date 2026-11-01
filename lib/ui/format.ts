// Number, amount, date and time formatting for the screens. Plain functions, safe for client and
// server components; the same output on both, so nothing shifts after hydration.
import type { MealItemDto } from "@/lib/contracts/meals";
import { localParts, shiftLocalDate } from "@/lib/meals/time";

export type Units = "metric" | "imperial";

export const GRAMS_PER_OUNCE = 28.349523125;
export const KG_PER_POUND = 0.45359237;
export const CM_PER_INCH = 2.54;

const nf = (value: number, decimals = 0) =>
  value.toLocaleString("en-US", { maximumFractionDigits: decimals });

export const formatKcal = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? nf(Math.round(value)) : "–";

/** "180 g", or "6.3 oz" for imperial. */
export const formatWeight = (grams: number, units: Units = "metric") =>
  units === "imperial" ? `${nf(grams / GRAMS_PER_OUNCE, 1)} oz` : `${nf(Math.round(grams))} g`;

export const formatVolume = (ml: number, units: Units = "metric") =>
  units === "imperial" ? `${nf(ml / 29.5735, 1)} fl oz` : `${nf(Math.round(ml))} ml`;

/** The amount of an item as a person reads it: "2 × 1 skewer (180 g)", "250 ml", "120 g". */
export const formatItemAmount = (
  item: Pick<MealItemDto, "grams" | "ml" | "count" | "portionText">,
  units: Units = "metric",
) => {
  const base = item.ml ? formatVolume(item.ml, units) : formatWeight(item.grams, units);
  const count = item.count && item.count !== 1 ? `${nf(item.count, 2)} × ` : "";
  if (item.portionText) return `${count}${item.portionText} (${base})`;
  return `${count}${base}`;
};

/** "Today", "Yesterday", "Tomorrow" or "Monday, Oct 27". */
export const dayTitle = (date: string, today: string) => {
  if (date === today) return "Today";
  if (date === shiftLocalDate(today, -1)) return "Yesterday";
  if (date === shiftLocalDate(today, 1)) return "Tomorrow";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
};

/** "October 31" (with the year when it is not the current one). */
export const longDate = (date: string, today?: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    ...(today && today.slice(0, 4) !== date.slice(0, 4) ? { year: "numeric" } : {}),
    timeZone: "UTC",
  });

/** "Oct 27" for chart axes. */
export const shortDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** "Mo" for chart axes. */
export const weekdayLetter = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

/** The value of an <input type="datetime-local"> for a moment in a time zone. */
export const toLocalInputValue = (iso: string, timeZone: string) => {
  const parts = localParts(new Date(iso), timeZone);
  return `${parts.date}T${parts.time}`;
};

const offsetMinutes = (at: Date, timeZone: string) => {
  const parts = localParts(at, timeZone);
  const asUtc = Date.parse(`${parts.date}T${parts.time}:00Z`);
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
};

/**
 * The moment a wall-clock time ("2026-10-31T12:30") names in a time zone, as ISO. Around a
 * daylight-saving change the earlier of two readings wins. Null for an invalid value.
 */
export const fromLocalInputValue = (value: string, timeZone: string) => {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  if (!m) return null;
  const wall = Date.parse(`${m[1]}T${m[2]}:00Z`);
  if (Number.isNaN(wall)) return null;
  let guess = wall - offsetMinutes(new Date(wall), timeZone) * 60_000;
  guess = wall - offsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess).toISOString();
};

/** Percent of a target, rounded, for nutrient tables ("42%"). */
export const percentOf = (value: number | undefined, target: number | null | undefined) =>
  typeof value === "number" && target && target > 0 ? `${Math.round((value / target) * 100)}%` : "";
