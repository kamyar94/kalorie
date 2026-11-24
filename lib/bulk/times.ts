// Times of the meals on "Add photos": where a meal with no time taken starts, the meal name its
// time gives, whether the server will take the time, and the day headings. Plain functions over
// an IANA time zone (pass `now`), safe for client components and tests.
import type { MealSlot } from "@/lib/contracts/meals";
import { classifyMeal } from "@/lib/meals/classify";
import { localParts, shiftLocalDate, type MealWindows } from "@/lib/meals/time";
import { fromLocalInputValue, longDate } from "@/lib/ui/format";
import { oldestDay } from "@/lib/ui/when";

/** A meal with no time taken on an earlier day starts at this time of that day. */
export const EARLIER_DAY_TIME = "12:00";

/**
 * The time of a meal whose photos have no time taken: when they were picked, or 12:00 of the
 * earlier day the screen was opened for (Today's pager on another day).
 */
export const fallbackTime = (day: string | null, now: Date, tz: string): Date => {
  if (!day || day >= localParts(now, tz).date) return now;
  const iso = fromLocalInputValue(`${day}T${EARLIER_DAY_TIME}`, tz);
  return iso ? new Date(iso) : now;
};

/**
 * The meal name the time gives before the analysis, as for any new meal (classifyMeal without
 * items: the person's meal windows, brunch when the note says so).
 */
export const slotAt = (at: Date, tz: string, windows: MealWindows | null, note = ""): MealSlot =>
  classifyMeal({ items: [], minutes: localParts(at, tz).minutes, windows, words: [note] });

export type TimeProblem = "future" | "old";

/** Why the server would refuse the meal's time: still to come, or more than a year ago. */
export const timeProblem = (at: Date, now: Date, tz: string): TimeProblem | null => {
  // A minute of slack, as the When sheet.
  if (at.getTime() > now.getTime() + 60_000) return "future";
  if (localParts(at, tz).date < oldestDay(now, tz)) return "old";
  return null;
};

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });

/** "Today, November 23", "Yesterday, November 22", "Friday, November 20" (a year when not this one). */
export const dayHeading = (date: string, today: string) => {
  const day = longDate(date, today);
  if (date === today) return `Today, ${day}`;
  if (date === shiftLocalDate(today, -1)) return `Yesterday, ${day}`;
  return `${WEEKDAY.format(new Date(`${date}T12:00:00Z`))}, ${day}`;
};
