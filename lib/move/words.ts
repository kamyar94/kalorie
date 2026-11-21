// What Move and Today's Move card say about a day: its title, the week strip's labels, where the
// steps came from and when a phone last sent, and the caption of an activity of the day. Friendly
// source names come from lib/contracts/activities.ts. Plain functions, safe for client components.
import {
  appLabel,
  appNote,
  formatMinutes,
  formatSteps,
  SAMSUNG_HEALTH_APPS,
  sourcePhrase,
  type ActivityDto,
} from "@/lib/contracts/activities";
import type {
  DayTotalDto,
  EveryDayRowDto,
  MoveDayDto,
  MoveDayViewDto,
  MoveGoals,
  MoveWeekDayDto,
  PhoneApp,
} from "@/lib/contracts/move";
import { localParts, shiftLocalDate } from "@/lib/meals/time";

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

// ---- The day's three numbers (boards 39 and 40) ----

/** A piece of a sentence; `bold` sets an app's name apart. */
export type Segment = { text: string; bold?: boolean };

const KINDS = [
  { key: "steps", app: "stepsApp", words: "steps" },
  { key: "activeMinutes", app: "activeApp", words: "active time" },
  { key: "activeKcal", app: "kcalApp", words: "activity calories" },
] as const;

const listWords = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/**
 * Where the phone's numbers came from, with each app's friendly name: "From Health Connect:
 * Samsung Health." or "From Health Connect: Samsung Health (steps and active time) and Phone
 * (Android's step counter; activity calories)."; then, with the time of the last update, "Last
 * update from your phone 10:56; Samsung Health may already show more until the next one."
 */
export const totalsSourceLine = (totals: DayTotalDto, updated: string | null): Segment[] => {
  const apps: { app: string; what: string[] }[] = [];
  for (const kind of KINDS) {
    const app = totals[kind.app];
    const value = totals[kind.key];
    if (!app || !value) continue;
    const entry = apps.find((a) => a.app === app);
    if (entry) entry.what.push(kind.words);
    else apps.push({ app, what: [kind.words] });
  }
  const out: Segment[] = [{ text: apps.length ? "From Health Connect: " : "From Health Connect." }];
  apps.forEach((entry, i) => {
    if (i > 0) out.push({ text: i === apps.length - 1 ? " and " : ", " });
    out.push({ text: appLabel(entry.app)!, bold: true });
    const note = appNote(entry.app);
    const what = apps.length > 1 ? listWords(entry.what) : null;
    const extra = [note, what].filter(Boolean).join("; ");
    if (extra) out.push({ text: ` (${extra})` });
  });
  if (apps.length) out.push({ text: "." });
  if (updated) {
    const samsung = apps.some((a) => (SAMSUNG_HEALTH_APPS as readonly string[]).includes(a.app));
    out.push({
      text: ` Last update from your phone ${updated}; ${samsung ? "Samsung Health may already show" : "Health Connect may already hold"} more until the next one.`,
    });
  }
  return out;
};

/** The words of a ring's centre: "8,412" and "steps", "1 h 12" and "min", "486" and "kcal". */
export const ringValue = (key: keyof MoveGoals, value: number | null) => {
  if (value === null)
    return {
      value: "–",
      unit: key === "steps" ? "steps" : key === "activeMinutes" ? "min" : "kcal",
    };
  if (key === "steps") return { value: formatSteps(value), unit: "steps" };
  if (key === "activeKcal")
    return { value: Math.round(value).toLocaleString("en-US"), unit: "kcal" };
  const m = Math.round(value);
  if (m < 60) return { value: String(m), unit: "min" };
  return m % 60
    ? { value: `${Math.floor(m / 60)} h ${m % 60}`, unit: "min" }
    : { value: `${m / 60} h`, unit: "active" };
};

/** "goal 7,000", "goal 60 min", "goal 500 kcal". */
export const goalCaption = (key: keyof MoveGoals, goal: number) =>
  key === "steps"
    ? `goal ${formatSteps(goal)}`
    : key === "activeMinutes"
      ? `goal ${formatMinutes(goal)}`
      : `goal ${Math.round(goal).toLocaleString("en-US")} kcal`;

const RING_NAMES: Record<keyof MoveGoals, string> = {
  steps: "Steps",
  activeMinutes: "Active time",
  activeKcal: "Activity calories",
};

/**
 * A ring's spoken name: "Steps: 8,412 of 7,000, goal reached", "Active time: 54 min of 1 h",
 * "Activity calories: no number from the phone".
 */
export const ringLabel = (key: keyof MoveGoals, value: number | null, goal: number) => {
  const name = RING_NAMES[key];
  if (value === null) return `${name}: no number from the phone`;
  const of =
    key === "steps"
      ? `${formatSteps(value)} of ${formatSteps(goal)}`
      : key === "activeMinutes"
        ? `${formatMinutes(value)} of ${formatMinutes(goal)}`
        : `${Math.round(value).toLocaleString("en-US")} of ${Math.round(goal).toLocaleString("en-US")} kcal`;
  return `${name}: ${of}${value >= goal ? ", goal reached" : ""}`;
};

/**
 * What a day without the phone's numbers says about active time and activity calories, by the
 * person's Kal for Android; `link` names the way there.
 */
export const noTotalsNote = (phone: PhoneApp): { text: string; link: string | null } => {
  if (phone === "old")
    return {
      text: "Active time and activity calories come with Kal for Android 1.2. Update the app on your phone to see them here.",
      link: "Update Kal for Android",
    };
  if (phone === "current")
    return { text: "The phone sent no active time or activity calories for this day.", link: null };
  return {
    text: "Active time and activity calories come from Health Connect, through Kal for Android.",
    link: "Kal for Android",
  };
};

/** Two hours: an update older than this is called out on the day. */
export const STALE_MS = 2 * 60 * 60 * 1000;

/**
 * Whether the shown day may be missing what the phone has counted since its last update: the
 * update is more than two hours old, and the day is today, or it ended after the update.
 */
export const isStale = (input: {
  lastUpdate: string | null;
  date: string;
  today: string;
  zone: string;
  now?: number;
}) => {
  if (!input.lastUpdate) return false;
  const at = new Date(input.lastUpdate);
  if ((input.now ?? Date.now()) - at.getTime() <= STALE_MS) return false;
  if (input.date === input.today) return true;
  return localParts(at, input.zone).date <= input.date;
};

/** "Workouts in Kal": "2 · 46 min", "1 · 30 min · 212 kcal", "None". */
export const kalWorkoutsText = (
  day: Pick<MoveDayViewDto, "workouts" | "activeMinutes" | "energyKcal">,
) =>
  day.workouts
    ? [
        day.workouts.toLocaleString("en-US"),
        formatMinutes(day.activeMinutes),
        day.energyKcal !== null ? `${day.energyKcal.toLocaleString("en-US")} kcal` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "None";

/** "Today, Sat 21", "Fri 20" for a row of "Every day". */
export const everyDayLabel = (date: string, today: string) => {
  const short = `${part(date, { weekday: "short" })} ${part(date, { day: "numeric" })}`;
  return date === today ? `Today, ${short}` : short;
};

/** A day of "Every day" without anything to show. */
export const isEmptyRow = (row: EveryDayRowDto) =>
  !row.fromPhone && row.steps === null && row.activeMinutes === null && row.activeKcal === null;

/**
 * Today's Move card (board 9 with the phone's numbers): the three tiles' values and captions.
 * With a day total: the phone's steps, active time and activity calories; without one, Move's
 * steps, Kal's active minutes and the energy of Kal's activities.
 */
export const todayTiles = (day: MoveDayDto, updated: string | null) => {
  const t = day.totals;
  const kcal = t?.activeKcal ?? (t ? null : day.energyKcal);
  return {
    steps: { value: formatSteps(t?.steps ?? day.steps), caption: stepsCaption(day, updated) },
    active: {
      value:
        t && t.activeMinutes !== null
          ? formatMinutes(t.activeMinutes)
          : t
            ? "–"
            : formatMinutes(day.activeMinutes),
      caption: t ? "Active time · phone" : (day.activeLabel ?? "Active"),
    },
    kcal: {
      value: kcal === null ? "–" : `${kcal.toLocaleString("en-US")}`,
      caption: t ? "Activity kcal · phone" : "Activity kcal",
    },
  };
};
