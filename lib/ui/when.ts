// "When did you eat this?": the quick choices of the When sheet, the check of its date and time
// fields, and the label of the When chip. Plain functions over an IANA time zone, safe for client
// components and unit tests (pass `now`).
import { localParts, shiftLocalDate } from "@/lib/meals/time";

import { fromLocalInputValue } from "./format";

export type WhenChoice = "now" | "30min" | "1h" | "2h" | "morning" | "yesterday";

export const WHEN_CHOICES: { id: WhenChoice; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "30min", label: "30 min ago" },
  { id: "1h", label: "1 hour ago" },
  { id: "2h", label: "2 hours ago" },
  { id: "morning", label: "This morning" },
  { id: "yesterday", label: "Yesterday" },
];

/** "This morning" means 08:00 today. */
export const MORNING = "08:00";

/** How far back a meal can be logged (the meal routes accept the last 366 days). */
export const OLDEST_DAYS = 365;

const MINUTE = 60_000;

/** The moment a wall-clock day and time name in a time zone, or null when not valid. */
const atLocal = (date: string, time: string, tz: string) => {
  const iso = fromLocalInputValue(`${date}T${time}`, tz);
  return iso ? new Date(iso) : null;
};

/**
 * The moment a quick choice names, or null when it would lie in the future ("This morning" before
 * 08:00). "Yesterday" is the same clock time a day earlier.
 */
export const whenForChoice = (choice: WhenChoice, now: Date, tz: string): Date | null => {
  const ago = (minutes: number) => new Date(now.getTime() - minutes * MINUTE);
  switch (choice) {
    case "now":
      return now;
    case "30min":
      return ago(30);
    case "1h":
      return ago(60);
    case "2h":
      return ago(120);
    case "morning": {
      const at = atLocal(localParts(now, tz).date, MORNING, tz);
      return at && at.getTime() <= now.getTime() ? at : null;
    }
    case "yesterday": {
      const parts = localParts(now, tz);
      return atLocal(shiftLocalDate(parts.date, -1), parts.time, tz);
    }
  }
};

/** The values of the date and time fields for a moment. */
export const whenInputs = (at: Date, tz: string) => {
  const parts = localParts(at, tz);
  return { date: parts.date, time: parts.time };
};

/** The first day the date field offers (YYYY-MM-DD). */
export const oldestDay = (now: Date, tz: string) =>
  shiftLocalDate(localParts(now, tz).date, -OLDEST_DAYS);

/**
 * The moment of the date and time fields, or why it cannot be used: not a real day and time, in
 * the future, or more than a year ago.
 */
export const parseWhenInputs = (
  date: string,
  time: string,
  tz: string,
  now: Date,
): { at: Date } | { error: string } => {
  const at =
    /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) && atLocal(date, time, tz);
  if (!at || Number.isNaN(at.getTime())) return { error: "Pick a day and a time." };
  // A minute of slack: "now" picked a moment ago is not the future.
  if (at.getTime() > now.getTime() + MINUTE)
    return { error: "That time is still to come. Pick an earlier one." };
  if (date < oldestDay(now, tz)) return { error: "Pick a day within the last year." };
  return { at };
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const dayParts = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  return { weekday: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth() };
};

/**
 * The chip's text: "Now" while nothing is chosen, else "Today, 12:15", "Yesterday, 19:30" or
 * "Mon 9 Nov, 19:30".
 */
export const whenLabel = (at: Date | null, now: Date, tz: string) => {
  if (!at) return "Now";
  const today = localParts(now, tz).date;
  const { date, time } = localParts(at, tz);
  if (date === today) return `Today, ${time}`;
  if (date === shiftLocalDate(today, -1)) return `Yesterday, ${time}`;
  const p = dayParts(date);
  return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month]}, ${time}`;
};

/** The same for screen readers: "now", "today at 12:15", "Monday 9 November at 19:30". */
export const whenSpoken = (at: Date | null, now: Date, tz: string) => {
  if (!at) return "now";
  const today = localParts(now, tz).date;
  const { date, time } = localParts(at, tz);
  if (date === today) return `today at ${time}`;
  if (date === shiftLocalDate(today, -1)) return `yesterday at ${time}`;
  const p = dayParts(date);
  return `${WEEKDAYS_LONG[p.weekday]} ${p.day} ${MONTHS_LONG[p.month]} at ${time}`;
};

/**
 * The time a new meal is logged at: the time chosen in the camera wins, then the first photo's
 * (EXIF or shutter), then the moment it is sent.
 */
export const mealTime = (chosen: Date | null, firstPhoto: Date | null, sentAt: Date) =>
  chosen ?? firstPhoto ?? sentAt;
