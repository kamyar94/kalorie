// What Move and Today's Move card say about a day: its title, the week strip's labels, where the
// steps came from and when a phone last sent, and the caption of an activity of the day. Friendly
// source names come from lib/contracts/activities.ts. Plain functions, safe for client components.
import {
  appLabel,
  appNote,
  formatMinutes,
  formatSteps,
  sourcePhrase,
  type ActivityDto,
} from "@/lib/contracts/activities";
import type { MoveDayDto, MoveDayViewDto, MoveWeekDayDto } from "@/lib/contracts/move";
import { shiftLocalDate } from "@/lib/meals/time";

/** "Steps · Phone, updated 23:04", "Steps · imported", "Steps" (typed in Kal, or none). */
export const stepsCaption = (
  day: Pick<MoveDayDto, "stepsSource" | "stepsFrom">,
  updated: string | null,
) =>
  day.stepsSource
    ? `Steps · ${day.stepsSource}${updated && day.stepsFrom?.source === "health_connect" ? `, updated ${updated}` : ""}`
    : "Steps";

const part = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { ...options, timeZone: "UTC" });

/** "Tuesday 17 November" (with the year when it is not this year). */
const longDay = (date: string, today: string) =>
  [
    part(date, { weekday: "long" }),
    part(date, { day: "numeric" }),
    part(date, { month: "long" }),
    ...(date.slice(0, 4) !== today.slice(0, 4) ? [part(date, { year: "numeric" })] : []),
  ].join(" ");

/** The line under Move's title: "Today, Wednesday 18 November", "Tuesday 17 November". */
export const moveDayTitle = (date: string, today: string) =>
  date === today
    ? `Today, ${longDay(date, today)}`
    : date === shiftLocalDate(today, -1)
      ? `Yesterday, ${longDay(date, today)}`
      : longDay(date, today);

/** "Mon" and "16" for a day of the week strip. */
export const stripDay = (date: string) => ({
  weekday: part(date, { weekday: "short" }),
  day: part(date, { day: "numeric" }),
});

/** The spoken name of a day of the strip: "Mon 16 November, 4,701 steps". */
export const stripLabel = (day: MoveWeekDayDto, goal: number) => {
  const name = `${part(day.date, { weekday: "short" })} ${part(day.date, { day: "numeric" })} ${part(day.date, { month: "long" })}`;
  if (day.future) return `${name}, still to come`;
  return `${name}, ${formatSteps(day.steps)} steps${day.steps >= goal ? ", goal reached" : ""}`;
};

/**
 * Where the day's steps came from, with the app's name to set apart: "Steps from Health Connect:
 * Phone (Android's step counter)." or "Steps imported from Samsung Health."; then when a phone
 * last sent ("Updated 23:04.", for Health Connect's steps or a day without any).
 */
export const stepsFromLine = (
  day: Pick<MoveDayViewDto, "steps" | "stepsFrom">,
  updated: string | null,
): { before: string; name: string | null; after: string } => {
  const from = day.stepsFrom;
  const sent = updated ? ` Updated ${updated}.` : "";
  if (!from || !day.steps)
    return {
      before: updated
        ? `No steps from Health Connect for this day. A phone last sent an update ${updated}.`
        : "No steps for this day.",
      name: null,
      after: "",
    };
  switch (from.source) {
    case "health_connect": {
      const name = appLabel(from.sourceApp);
      const note = appNote(from.sourceApp);
      return name
        ? {
            before: "Steps from Health Connect: ",
            name,
            after: `${note ? ` (${note})` : ""}.${sent}`,
          }
        : { before: `Steps from Health Connect (several apps).${sent}`, name: null, after: "" };
    }
    case "import":
      return {
        before: "Steps imported from ",
        name: sourcePhrase(from.source, from.sourceApp).replace(/^imported from /, ""),
        after: ".",
      };
    case "opengym":
      return { before: "Steps from ", name: "openGym", after: "." };
    case "manual":
      return { before: "Steps typed in Kal.", name: null, after: "" };
  }
};

/**
 * The caption of an activity on Move's day: "07:10 · 28 min · 4.1 km · Samsung Health"; a step
 * count says "4,150 steps · day total · Phone".
 */
export const dayActivityCaption = (activity: ActivityDto) => {
  const source = sourcePhrase(activity.source, activity.sourceApp);
  if (activity.durationMin === null && activity.steps !== null)
    return [`${formatSteps(activity.steps)} steps`, "day total", source].join(" · ");
  const km =
    activity.distanceM !== null && activity.distanceM > 0
      ? `${(activity.distanceM / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })} km`
      : null;
  return [
    activity.localTime,
    activity.durationMin !== null ? formatMinutes(activity.durationMin) : null,
    km,
    source,
  ]
    .filter(Boolean)
    .join(" · ");
};
