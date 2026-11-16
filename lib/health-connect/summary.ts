// The words "Kal for Android" shows for a phone's updates (board 34): one line per update saying
// what arrived ("6,812 steps today · 1 workout · 1 weigh-in", "Nothing new", "First read, 30 days:
// Health Connect was empty"), and the warning shown while a phone sends but nothing is stored.
// Pure functions of the counts, safe for client components.
import type { HcUpdateCounts } from "@/lib/contracts/health-connect";

const number = new Intl.NumberFormat("en-US");

const count = (n: number, one: string, many = `${one}s`) =>
  `${number.format(n)} ${n === 1 ? one : many}`;

/** One piece of an update's line: an emoji (decoration, hidden from screen readers) and words. */
export type SummaryPart = { emoji: string | null; text: string };

/**
 * content: records arrived; nothing: an update with nothing to store; empty-read: a read of the
 * whole window that found Health Connect empty (shown in the warning colour, and the words say
 * it too).
 */
export type SummaryTone = "content" | "nothing" | "empty-read";

export type UpdateSummary = {
  /** "First read, 30 days:" before the parts, or the whole line when there are no parts. */
  lead: string | null;
  parts: SummaryPart[];
  tone: SummaryTone;
};

/**
 * What one update brought. `sameDay`: the update is from the viewer's today, so the phone's step
 * total reads "steps today" (else "steps that day").
 */
export const updateSummary = (u: HcUpdateCounts, sameDay: boolean): UpdateSummary => {
  const parts: SummaryPart[] = [];
  if (u.firstReadDays === null && u.stepsToday !== null && u.stepsToday > 0)
    parts.push({
      emoji: "👟",
      text: `${number.format(u.stepsToday)} steps ${sameDay ? "today" : "that day"}`,
    });
  else if (u.stepDays > 0)
    parts.push({ emoji: "👟", text: count(u.stepDays, "day of steps", "days of steps") });
  if (u.workouts > 0) parts.push({ emoji: "🏋️", text: count(u.workouts, "workout") });
  if (u.restingDays > 0)
    parts.push({
      emoji: "❤️",
      text: count(u.restingDays, "day of resting heart rate", "days of resting heart rate"),
    });
  if (u.sleepSessions > 0)
    parts.push({ emoji: "😴", text: count(u.sleepSessions, "night of sleep", "nights of sleep") });
  if (u.weighIns > 0) parts.push({ emoji: "⚖️", text: count(u.weighIns, "weigh-in") });
  else if (u.bodyRecords > 0) parts.push({ emoji: "⚖️", text: count(u.bodyRecords, "body value") });
  if (u.height) parts.push({ emoji: "📏", text: "height" });
  const stored = parts.length > 0;
  if (u.deleted > 0)
    parts.push({ emoji: "🗑️", text: `${number.format(u.deleted)} removed in Health Connect` });
  if (u.skipped > 0) parts.push({ emoji: null, text: `${count(u.skipped, "record")} left out` });

  const tone: SummaryTone = stored || u.deleted > 0 ? "content" : "nothing";
  if (u.firstReadDays !== null) {
    const days = count(u.firstReadDays, "day");
    if (!parts.length)
      return { lead: `First read, ${days}: Health Connect was empty`, parts, tone: "empty-read" };
    return { lead: `First read, ${days}:`, parts, tone };
  }
  return { lead: parts.length ? null : "Nothing new", parts, tone };
};

/** The summary as one line of text (for tests and screen readers). */
export const summaryText = (s: UpdateSummary) =>
  [s.lead, s.parts.map((p) => p.text).join(" · ")].filter(Boolean).join(" ");

/**
 * The "Nothing has arrived yet" warning's first sentence: how many updates the phone sent (in
 * the kept window; 0 when it sent before the log existed).
 */
export const nothingArrivedText = (updates: number) =>
  `${updates > 0 ? `The phone sent ${count(updates, "update")}` : "The phone has sent updates"}, but Health Connect had no steps, workouts, heart rate, sleep or weigh-ins to share. Usually Samsung Health or the Renpho app is not sharing with Health Connect yet.`;
