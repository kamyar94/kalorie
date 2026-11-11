// Samsung Health's export ("Download personal data" in the app's settings): a zip of CSV files
// named com.samsung.<health|shealth>.<data type>.<timestamp>.csv. The first line of each file is a
// metadata line (the data type and a version), the second the column names, which may carry the
// data type as a prefix ("com.samsung.health.exercise.start_time"). Times are UTC
// ("2024-05-01 07:30:00.000") with the record's offset in a time_offset column ("UTC+0200"); a
// day summary's day_time is that day's UTC midnight in milliseconds.
//
// Read here: steps per day (tracker.pedometer_day_summary, or step_daily_trend when there is no
// day summary), exercise sessions (exercise) and weight with body composition (weight). This
// layout follows Samsung's documentation of its data types; it was not checked against a real
// export file, so the importer reads it loosely (any prefix, any column order) and anything it
// cannot place goes to the column-mapping step. Plain functions.
import type { ActivityCategory, ImportedActivity, Intensity } from "@/lib/contracts/activities";
import { localParts } from "@/lib/meals/time";
import { fromLocalInputValue } from "@/lib/ui/format";

import { parseNumber } from "./dates";

export const SAMSUNG_APP = "samsung-health";

/** "com.samsung.shealth.tracker.pedometer_day_summary.20240501123000.csv" -> its data type. */
export const samsungTypeOf = (fileName: string) => {
  const m = /^com\.samsung\.s?health\.(.+?)\.\d{8,}\.csv$/i.exec(fileName.trim());
  return m ? m[1]!.toLowerCase() : null;
};

/** The data types Kal reads, by what they hold. */
export const SAMSUNG_TYPES = {
  steps: ["tracker.pedometer_day_summary", "step_daily_trend"],
  exercise: ["exercise"],
  weight: ["weight", "health.weight"],
} as const;

export type SamsungTable = { type: string | null; headers: string[]; rows: string[][] };

/** "com.samsung.health.exercise.start_time" -> "start_time". */
export const columnName = (header: string) => {
  const clean = header.trim().toLowerCase();
  return clean.slice(clean.lastIndexOf(".") + 1);
};

/** Drops the metadata line and reads the column names (without their prefixes). */
export const samsungTable = (rows: string[][], fileName = ""): SamsungTable | null => {
  if (!rows.length) return null;
  let start = 0;
  const first = rows[0]!;
  let type = samsungTypeOf(fileName);
  if (/^com\.samsung\./i.test(first[0]?.trim() ?? "") && first.filter((c) => c.trim()).length < 4) {
    type ??= first[0]!
      .trim()
      .toLowerCase()
      .replace(/^com\.samsung\.s?health\./, "");
    start = 1;
  }
  const headers = (rows[start] ?? []).map(columnName);
  if (headers.filter(Boolean).length < 2) return null;
  return { type, headers, rows: rows.slice(start + 1) };
};

/** Whether rows read from a CSV look like a Samsung Health file. */
export const isSamsungCsv = (rows: string[][], fileName = "") =>
  samsungTypeOf(fileName) !== null || /^com\.samsung\./i.test(rows[0]?.[0]?.trim() ?? "");

const cell = (table: SamsungTable, row: string[], ...names: string[]) => {
  for (const name of names) {
    const index = table.headers.indexOf(name);
    if (index >= 0 && row[index] !== undefined && row[index]!.trim() !== "") return row[index]!;
  }
  return undefined;
};

/** "UTC+0200" -> minutes east of UTC (null when missing or odd). */
export const offsetMinutes = (text: string | undefined) => {
  const m = /([+-])(\d{2}):?(\d{2})/.exec(text ?? "");
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return minutes > 14 * 60 ? null : (m[1] === "-" ? -1 : 1) * minutes;
};

/** "2024-05-01 07:30:00.000" (UTC) or epoch ms -> a Date. */
export const samsungTime = (text: string | undefined) => {
  if (!text) return null;
  const value = text.trim();
  if (/^\d{11,13}$/.test(value)) return new Date(Number(value));
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?/.exec(value);
  if (!m) return null;
  const at = new Date(`${m[1]}T${m[2]}${m[2]!.length === 5 ? ":00" : ""}Z`);
  return Number.isNaN(at.getTime()) ? null : at;
};

/** The day of a day summary: its day_time (UTC midnight, ms) or a date at its start. */
const summaryDay = (text: string | undefined) => {
  if (!text) return null;
  const value = text.trim();
  if (/^\d{11,13}$/.test(value)) return new Date(Number(value)).toISOString().slice(0, 10);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return m ? m[1]! : null;
};

/** IANA zone for a whole-hour offset ("Etc/GMT-2" is UTC+2), else the person's own. */
const zoneForOffset = (minutes: number | null, fallback: string) =>
  minutes === null || minutes % 60 !== 0
    ? fallback
    : minutes === 0
      ? "UTC"
      : `Etc/GMT${minutes > 0 ? "-" : "+"}${Math.abs(minutes / 60)}`;

/** Steps per day (the highest count of a day when several devices report it). */
export const samsungSteps = (table: SamsungTable, tz: string): ImportedActivity[] => {
  // The daily trend has one row per device and one merged row (source type -2): only the merged
  // rows count when there are any.
  const merged =
    table.type === "step_daily_trend" &&
    table.rows.some((r) => parseNumber(cell(table, r, "source_type")) === -2);
  const byDay = new Map<string, { steps: number; distance: number | null; kcal: number | null }>();
  for (const row of table.rows) {
    if (merged && parseNumber(cell(table, row, "source_type")) !== -2) continue;
    const date = summaryDay(cell(table, row, "day_time", "create_time", "start_time"));
    const steps = parseNumber(cell(table, row, "step_count", "count"));
    if (!date || steps === null || steps <= 0) continue;
    const current = byDay.get(date);
    if (current && current.steps >= steps) continue;
    byDay.set(date, {
      steps: Math.round(steps),
      distance: parseNumber(cell(table, row, "distance")),
      kcal: parseNumber(cell(table, row, "calorie")),
    });
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, day]) => ({
      externalId: `samsung:steps:${date}`,
      sourceApp: SAMSUNG_APP,
      category: "walking" as const,
      type: "steps",
      title: "Steps",
      startedAt: fromLocalInputValue(`${date}T12:00`, tz) ?? `${date}T12:00:00.000Z`,
      tz,
      localDate: date,
      durationMin: null,
      distanceM: day.distance && day.distance > 0 ? Math.round(day.distance) : null,
      steps: day.steps,
      energyKcal: day.kcal && day.kcal > 0 ? Math.round(day.kcal) : null,
      intensity: null,
    }));
};

type ExerciseKind = {
  label: string;
  category: ActivityCategory;
  type: string;
  intensity?: Intensity;
};

/**
 * Samsung Health's predefined exercise types (its SDK's exercise_type codes) that Kal names; other
 * codes fall back to their range below.
 */
export const SAMSUNG_EXERCISES: Record<number, ExerciseKind> = {
  1001: { label: "Walking", category: "walking", type: "walk" },
  1002: { label: "Running", category: "cardio", type: "run", intensity: "vigorous" },
  4003: { label: "Basketball", category: "sports", type: "basketball", intensity: "vigorous" },
  4004: { label: "Football", category: "sports", type: "football", intensity: "vigorous" },
  5001: { label: "Volleyball", category: "sports", type: "volleyball" },
  6002: { label: "Tennis", category: "sports", type: "tennis", intensity: "vigorous" },
  6003: { label: "Badminton", category: "sports", type: "badminton" },
  7002: { label: "Martial arts", category: "sports", type: "martial_arts", intensity: "vigorous" },
  8002: { label: "Dancing", category: "cardio", type: "dance" },
  9001: { label: "Pilates", category: "mobility", type: "pilates" },
  9002: { label: "Yoga", category: "mobility", type: "yoga", intensity: "light" },
  10001: { label: "Stretching", category: "mobility", type: "stretching", intensity: "light" },
  10002: { label: "Jump rope", category: "cardio", type: "jump_rope", intensity: "vigorous" },
  10007: {
    label: "Circuit training",
    category: "strength",
    type: "circuit",
    intensity: "vigorous",
  },
  11007: { label: "Cycling", category: "cardio", type: "cycle" },
  12001: { label: "Aerobics", category: "cardio", type: "cardio" },
  13001: { label: "Hiking", category: "walking", type: "hike" },
  13002: { label: "Climbing", category: "sports", type: "climbing", intensity: "vigorous" },
  14001: { label: "Swimming", category: "cardio", type: "swim" },
  15001: { label: "Step machine", category: "cardio", type: "stairs", intensity: "vigorous" },
  15002: { label: "Weight machine", category: "strength", type: "weights" },
  15003: { label: "Exercise bike", category: "cardio", type: "cycle" },
  15004: { label: "Rowing machine", category: "cardio", type: "row" },
  15005: { label: "Treadmill", category: "cardio", type: "run" },
  15006: { label: "Elliptical trainer", category: "cardio", type: "elliptical" },
};

/** An exercise type by its code, with ranges for the codes Kal does not name. */
export const samsungExercise = (code: number | null): ExerciseKind => {
  if (code !== null && SAMSUNG_EXERCISES[code]) return SAMSUNG_EXERCISES[code];
  if (code !== null && code >= 10003 && code <= 10027)
    return { label: "Strength exercise", category: "strength", type: "weights" };
  if (code !== null && code >= 2001 && code <= 7999)
    return { label: "Sport", category: "sports", type: "sport" };
  return { label: "Exercise", category: "other", type: "other" };
};

const DEFAULT_INTENSITY: Record<ActivityCategory, Intensity> = {
  cardio: "moderate",
  strength: "moderate",
  walking: "moderate",
  mobility: "light",
  sports: "moderate",
  other: "moderate",
};

/** Exercise sessions with their duration, distance and Samsung's calorie count. */
export const samsungExercises = (table: SamsungTable, tz: string): ImportedActivity[] => {
  const out: ImportedActivity[] = [];
  for (const row of table.rows) {
    const start = samsungTime(cell(table, row, "start_time"));
    if (!start) continue;
    const end = samsungTime(cell(table, row, "end_time"));
    const durationMs = parseNumber(cell(table, row, "duration"));
    const minutes =
      durationMs && durationMs > 0
        ? durationMs / 60_000
        : end && end > start
          ? (end.getTime() - start.getTime()) / 60_000
          : null;
    if (!minutes || minutes < 1 || minutes > 24 * 60) continue;
    const offset = offsetMinutes(cell(table, row, "time_offset"));
    const zone = zoneForOffset(offset, tz);
    const localDate =
      offset !== null
        ? new Date(start.getTime() + offset * 60_000).toISOString().slice(0, 10)
        : localParts(start, tz).date;
    const kind = samsungExercise(parseNumber(cell(table, row, "exercise_type")));
    const id = cell(table, row, "datauuid") ?? start.toISOString();
    const distance = parseNumber(cell(table, row, "distance"));
    const kcal = parseNumber(cell(table, row, "calorie", "total_calorie"));
    out.push({
      externalId: `samsung:exercise:${id.trim().slice(0, 120)}`,
      sourceApp: SAMSUNG_APP,
      category: kind.category,
      type: kind.type,
      title: kind.label,
      startedAt: start.toISOString(),
      tz: zone,
      localDate,
      durationMin: Math.round(minutes * 10) / 10,
      distanceM: distance && distance > 0 ? Math.round(distance) : null,
      steps: null,
      energyKcal: kcal && kcal > 0 ? Math.round(kcal) : null,
      intensity: kind.intensity ?? DEFAULT_INTENSITY[kind.category],
    });
  }
  return out;
};
