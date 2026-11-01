// Local day, time and meal slot of a moment in an IANA time zone (docs/DESIGN.md section 3).
// Plain functions, safe for client components.
import type { MealSlot } from "@/lib/contracts/meals";

export type MealWindows = Record<Exclude<MealSlot, "snack">, [string, string]>;

/** Defaults: 04:00-10:30, 11:00-15:00, 17:00-21:30, other times snack. */
export const DEFAULT_MEAL_WINDOWS: MealWindows = {
  breakfast: ["04:00", "10:30"],
  lunch: ["11:00", "15:00"],
  dinner: ["17:00", "21:30"],
};

export const isValidTimeZone = (timeZone: unknown): timeZone is string => {
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
};

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (timeZone: string) => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

/** The calendar day (YYYY-MM-DD), wall-clock time (HH:MM) and minutes since midnight. */
export const localParts = (at: Date, timeZone: string) => {
  const parts = Object.fromEntries(
    formatterFor(isValidTimeZone(timeZone) ? timeZone : "UTC")
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const hour = parts.hour === "24" ? "00" : (parts.hour ?? "00");
  const minute = parts.minute ?? "00";
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${minute}`,
    minutes: Number(hour) * 60 + Number(minute),
  };
};

const toMinutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
};

/** The meal slot for minutes since midnight: inside a window (both ends included), else snack. */
export const slotForMinutes = (
  minutes: number,
  windows: MealWindows = DEFAULT_MEAL_WINDOWS,
): MealSlot => {
  for (const slot of ["breakfast", "lunch", "dinner"] as const) {
    const [start, end] = windows[slot] ?? DEFAULT_MEAL_WINDOWS[slot];
    const from = toMinutes(start);
    const to = toMinutes(end);
    if (Number.isNaN(from) || Number.isNaN(to)) continue;
    const inside = from <= to ? minutes >= from && minutes <= to : minutes >= from || minutes <= to;
    if (inside) return slot;
  }
  return "snack";
};

/** Slot of a moment in a time zone. */
export const slotFor = (at: Date, timeZone: string, windows?: MealWindows) =>
  slotForMinutes(localParts(at, timeZone).minutes, windows);

/** Whether a string is a real calendar date YYYY-MM-DD. */
export const isLocalDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

/** The day before or after a YYYY-MM-DD date. */
export const shiftLocalDate = (value: string, days: number) => {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
