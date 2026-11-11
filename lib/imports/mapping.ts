// The column-mapping step for a CSV whose layout Kal does not know: the person says which column
// holds the date (and the time), what the file holds, and which column holds each value. Kal
// pre-selects columns by their names. Plain functions.
import {
  categoryFromWords,
  TYPE_OF_CATEGORY,
  type ImportedActivity,
} from "@/lib/contracts/activities";

import { guessDateOrder, parseMoment, parseNumber, type DateOrder } from "./dates";

export const FILE_APP = "file";

export type MappingKind = "steps" | "workouts";

export type MappingField = { id: string; label: string; required?: boolean; words: RegExp };

export const MAPPING_KINDS: { id: MappingKind; label: string }[] = [
  { id: "steps", label: "Steps per day" },
  { id: "workouts", label: "Workouts" },
];

export const MAPPING_FIELDS: Record<MappingKind, MappingField[]> = {
  steps: [
    { id: "steps", label: "Steps", required: true, words: /step/i },
    { id: "distance_km", label: "Distance, km", words: /distance|\bkm\b/i },
    { id: "kcal", label: "Energy, kcal", words: /calor|kcal|energy/i },
  ],
  workouts: [
    {
      id: "duration",
      label: "Duration (minutes or h:mm:ss)",
      required: true,
      words: /duration|time|min/i,
    },
    {
      id: "title",
      label: "Name of the workout",
      words: /name|type|activity|title|sport|exercise/i,
    },
    { id: "kcal", label: "Energy, kcal", words: /calor|kcal|energy/i },
    { id: "distance_km", label: "Distance, km", words: /distance|\bkm\b/i },
  ],
};

export type ColumnMapping = {
  kind: MappingKind;
  /** Column of the date (or date and time). */
  date: number;
  /** A separate time column, if any. */
  time: number | null;
  order: DateOrder;
  /** Field id -> column index. */
  fields: Record<string, number | null>;
};

const DATE_WORDS = /date|day|time|start|when/i;
const TIME_ONLY = /^time$|^hour/i;

/** Columns for the fields of a kind, by their names (each column used once, the date's not). */
export const guessFields = (
  headers: string[],
  kind: MappingKind,
  taken: Set<number> = new Set(),
): Record<string, number | null> => {
  const used = new Set(taken);
  const fields: Record<string, number | null> = {};
  for (const field of MAPPING_FIELDS[kind]) {
    const index = headers.findIndex((h, i) => !used.has(i) && field.words.test(h));
    fields[field.id] = index >= 0 ? index : null;
    if (index >= 0) used.add(index);
  }
  return fields;
};

/** A first guess from the column names and the first values. */
export const guessMapping = (headers: string[], rows: string[][]): ColumnMapping => {
  const text = headers.join(" ");
  const kind: MappingKind = /step/i.test(text) && !/duration/i.test(text) ? "steps" : "workouts";
  const timeIndex = headers.findIndex((h) => TIME_ONLY.test(h.trim()));
  const time = timeIndex >= 0 ? timeIndex : null;
  const dateIndex = headers.findIndex(
    (h, i) => i !== time && DATE_WORDS.test(h) && !/duration/i.test(h),
  );
  const date = dateIndex >= 0 ? dateIndex : 0;
  const taken = new Set([date, ...(time !== null ? [time] : [])]);
  return {
    kind,
    date,
    time,
    order: guessDateOrder(rows.slice(0, 200).map((r) => r[date] ?? "")),
    fields: guessFields(headers, kind, taken),
  };
};

/** "45", "45.5" (minutes), "1:05:00" or "05:30" (h:mm:ss, mm:ss) -> minutes. */
export const parseDuration = (raw: string | undefined) => {
  if (raw === undefined) return null;
  const text = raw.trim();
  const clock = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (clock) {
    const [a, b, c] = [Number(clock[1]), Number(clock[2]), clock[3] ? Number(clock[3]) : null];
    return c === null ? a + b / 60 : a * 60 + b + c / 60;
  }
  return parseNumber(text);
};

export type MappedRecords = { activities: ImportedActivity[]; skipped: number };

/** The records of a file read with a mapping; rows that do not fit are counted as skipped. */
export const applyMapping = (
  rows: string[][],
  mapping: ColumnMapping,
  tz: string,
): MappedRecords => {
  const out: MappedRecords = { activities: [], skipped: 0 };
  const value = (row: string[], field: string) => {
    const index = mapping.fields[field];
    return index === null || index === undefined ? undefined : row[index];
  };
  for (const row of rows) {
    const dateText = row[mapping.date] ?? "";
    const timeText = mapping.time !== null ? (row[mapping.time] ?? "") : "";
    const moment = parseMoment(timeText ? `${dateText} ${timeText}` : dateText, mapping.order, tz);
    if (!moment) {
      out.skipped += 1;
      continue;
    }
    const kcal = parseNumber(value(row, "kcal"));
    const km = parseNumber(value(row, "distance_km"));
    if (mapping.kind === "steps") {
      const steps = parseNumber(value(row, "steps"));
      if (!steps || steps <= 0) {
        out.skipped += 1;
        continue;
      }
      out.activities.push({
        externalId: `file:steps:${moment.date}`,
        sourceApp: FILE_APP,
        category: "walking",
        type: "steps",
        title: "Steps",
        startedAt: moment.at.toISOString(),
        tz,
        localDate: moment.date,
        steps: Math.round(steps),
        distanceM: km && km > 0 ? Math.round(km * 1000) : null,
        energyKcal: kcal && kcal > 0 ? Math.round(kcal) : null,
      });
      continue;
    }
    const minutes = parseDuration(value(row, "duration"));
    if (!minutes || minutes <= 0 || minutes > 24 * 60) {
      out.skipped += 1;
      continue;
    }
    const title = (value(row, "title") ?? "").trim().slice(0, 80) || "Workout";
    const category = categoryFromWords(title, "other");
    out.activities.push({
      externalId: `file:workout:${moment.at.toISOString()}`,
      sourceApp: FILE_APP,
      category,
      type: TYPE_OF_CATEGORY[category],
      title,
      startedAt: moment.at.toISOString(),
      tz,
      localDate: moment.date,
      durationMin: Math.round(minutes * 10) / 10,
      distanceM: km && km > 0 ? Math.round(km * 1000) : null,
      energyKcal: kcal && kcal > 0 ? Math.round(kcal) : null,
      intensity: "moderate",
    });
  }
  return out;
};
