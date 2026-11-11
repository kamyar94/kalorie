// A Renpho scale's CSV export: one row per weigh-in with a time column and the values, the unit in
// the column name ("Weight(kg)", "Weight(lb)", "Body Fat(%)", "Muscle Mass(lb)", "BMR(kcal)").
// Columns are found by keywords, so their order and exact spelling do not matter; masses without a
// unit follow the weight's unit. This was written from the shape such exports are described with,
// not checked against a real file; a file it cannot place goes to the column-mapping step.
// Plain functions.
import type { ImportedMeasurement } from "@/lib/contracts/body";
import { KG_PER_LB } from "@/lib/contracts/body";

import { guessDateOrder, parseMoment, parseNumber, type DateOrder } from "./dates";

export const RENPHO_APP = "renpho";

type Column = { index: number; code: string; mass: boolean; unit: "kg" | "lb" | null };

/** Header keywords, in the order they are tried (the first that matches names the column). */
const COLUMN_RULES: { words: RegExp; code: string; mass?: boolean }[] = [
  { words: /optimal|standard|target|ideal|goal|remark|note/i, code: "" },
  { words: /fat[\s-]*free/i, code: "fat_free", mass: true },
  { words: /subcutaneous/i, code: "subcutaneous_fat" },
  { words: /visceral/i, code: "visceral_fat" },
  { words: /body\s*fat|fat\s*(rate|%|\(%\))/i, code: "body_fat" },
  { words: /skeletal/i, code: "skeletal_muscle" },
  { words: /muscle/i, code: "muscle", mass: true },
  { words: /water/i, code: "water" },
  { words: /bone/i, code: "bone", mass: true },
  { words: /protein/i, code: "protein" },
  { words: /\bbmr\b|basal/i, code: "bmr" },
  { words: /metabolic\s*age|body\s*age/i, code: "metabolic_age" },
  { words: /\bbmi\b/i, code: "bmi" },
  { words: /weight/i, code: "weight", mass: true },
];

const unitOf = (header: string): "kg" | "lb" | null =>
  /\(\s*lbs?\s*\)|\blbs?\b/i.test(header)
    ? "lb"
    : /\(\s*kg\s*\)|\bkg\b/i.test(header)
      ? "kg"
      : null;

/** The value columns of a header row, by keyword. */
export const renphoColumns = (headers: string[]): Column[] => {
  const columns: Column[] = [];
  const used = new Set<string>();
  headers.forEach((header, index) => {
    const rule = COLUMN_RULES.find((r) => r.words.test(header));
    if (!rule?.code || used.has(rule.code)) return;
    // A muscle column in percent is the skeletal muscle share.
    const code = rule.code === "muscle" && /%/.test(header) ? "skeletal_muscle" : rule.code;
    if (used.has(code)) return;
    used.add(code);
    columns.push({
      index,
      code,
      mass: !!rule.mass && code !== "skeletal_muscle",
      unit: unitOf(header),
    });
  });
  return columns;
};

/** The time columns: one with date and time, or a date column and a time column. */
const timeColumns = (headers: string[]) => {
  const combined = headers.findIndex((h) =>
    /time\s*of\s*measurement|measured|date\s*time|timestamp/i.test(h),
  );
  if (combined >= 0) return { date: combined, time: -1 };
  const date = headers.findIndex((h) => /date|day/i.test(h));
  const time = headers.findIndex((h, i) => i !== date && /^\s*time\s*$/i.test(h));
  if (date >= 0) return { date, time };
  return { date: headers.findIndex((h) => /time/i.test(h)), time: -1 };
};

/** Whether a header row looks like a body-composition scale export Kal can read. */
export const isRenphoHeader = (headers: string[]) => {
  const columns = renphoColumns(headers);
  return (
    timeColumns(headers).date >= 0 &&
    columns.some((c) => c.code === "weight") &&
    columns.some((c) => c.code !== "weight")
  );
};

export type ScaleRead = { records: ImportedMeasurement[]; weighIns: number; skipped: number };

/** The values of every row (masses in kg), one record per value. */
export const renphoMeasurements = (rows: string[][], tz: string, order?: DateOrder): ScaleRead => {
  const [headers = [], ...body] = rows;
  const columns = renphoColumns(headers);
  const { date, time } = timeColumns(headers);
  const fileUnit = columns.find((c) => c.code === "weight")?.unit ?? "kg";
  const dateOrder = order ?? guessDateOrder(body.slice(0, 300).map((r) => r[date] ?? ""));
  const out: ScaleRead = { records: [], weighIns: 0, skipped: 0 };
  for (const row of body) {
    const text = time >= 0 ? `${row[date] ?? ""} ${row[time] ?? ""}` : (row[date] ?? "");
    const moment = parseMoment(text, dateOrder, tz);
    if (!moment) {
      out.skipped += 1;
      continue;
    }
    const at = moment.at.toISOString();
    let any = false;
    for (const column of columns) {
      const raw = parseNumber(row[column.index]);
      if (raw === null || raw <= 0) continue;
      const unit = column.unit ?? fileUnit;
      const value = column.mass && unit === "lb" ? Math.round(raw * KG_PER_LB * 100) / 100 : raw;
      out.records.push({
        externalId: `renpho:${at}:${column.code}`,
        sourceApp: RENPHO_APP,
        code: column.code,
        value,
        measuredAt: at,
        tz,
      });
      any = true;
    }
    if (any) out.weighIns += 1;
    else out.skipped += 1;
  }
  return out;
};
