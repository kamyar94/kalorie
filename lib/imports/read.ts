// Reads export files picked on the device into datasets Kal can import: a Samsung Health zip (or
// the CSV files from inside it), a Renpho scale's CSV, and any other CSV, which goes to the
// column-mapping step. The files never leave the device; only the records read from them are sent
// to Kal (lib/client/api.ts importActivities and importMeasurements), in batches. Plain async
// functions on Blobs; the import screen calls them.
import type { ImportedActivity } from "@/lib/contracts/activities";
import type { ImportedMeasurement } from "@/lib/contracts/body";

import { decodeText, parseCsv } from "./csv";
import { FILE_APP, type ColumnMapping, type MappedRecords } from "./mapping";
import { isRenphoHeader, RENPHO_APP, renphoMeasurements } from "./renpho";
import {
  isSamsungCsv,
  SAMSUNG_APP,
  SAMSUNG_TYPES,
  samsungExercises,
  samsungSteps,
  samsungTable,
  samsungTypeOf,
  samsungWeights,
} from "./samsung";
import { baseName, listZipEntries, looksLikeZip, readZipEntry } from "./zip";

/** A file the person picked (a File has both). */
export type PickedFile = Blob & { name: string };

export type ActivityDataset = {
  id: string;
  fileName: string;
  app: string;
  kind: "activities";
  what: "steps" | "workouts";
  label: string;
  records: ImportedActivity[];
  first: string | null;
  last: string | null;
};

export type MeasurementDataset = {
  id: string;
  fileName: string;
  app: string;
  kind: "measurements";
  label: string;
  records: ImportedMeasurement[];
  first: string | null;
  last: string | null;
};

/** A CSV Kal could not place: its columns go to the mapping step. */
export type UnknownDataset = {
  id: string;
  fileName: string;
  kind: "unknown";
  headers: string[];
  rows: string[][];
};

export type KnownDataset = ActivityDataset | MeasurementDataset;
export type ImportDataset = KnownDataset | UnknownDataset;

export type ReadResult = { datasets: ImportDataset[]; notes: string[] };

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

const range = (dates: string[]) => {
  const sorted = [...dates].sort();
  return { first: sorted[0] ?? null, last: sorted.at(-1) ?? null };
};

const activityDataset = (
  fileName: string,
  what: "steps" | "workouts",
  records: ImportedActivity[],
): ActivityDataset => ({
  id: `${fileName}#${what}`,
  fileName,
  app: records[0]?.sourceApp ?? SAMSUNG_APP,
  kind: "activities",
  what,
  label:
    what === "steps"
      ? `Steps: ${plural(records.length, "day", "days")}`
      : `Workouts: ${plural(records.length, "session", "sessions")}`,
  records,
  ...range(records.map((r) => r.localDate ?? r.startedAt.slice(0, 10))),
});

/** Values of a scale or a measurement file: counted by the weigh-ins (distinct times). */
const measurementDataset = (
  fileName: string,
  app: string,
  records: ImportedMeasurement[],
): MeasurementDataset => {
  const times = new Set(records.map((r) => r.measuredAt));
  return {
    id: `${fileName}#body`,
    fileName,
    app,
    kind: "measurements",
    label: `Weight and body composition: ${plural(times.size, "weigh-in", "weigh-ins")}`,
    records,
    ...range([...times].map((t) => t.slice(0, 10))),
  };
};

/** A file read with the person's column mapping. */
export const mappedDataset = (
  dataset: UnknownDataset,
  mapping: ColumnMapping,
  records: MappedRecords,
): KnownDataset =>
  mapping.kind === "measurements"
    ? {
        ...measurementDataset(dataset.fileName, FILE_APP, records.measurements),
        id: `${dataset.fileName}#mapped`,
      }
    : {
        ...activityDataset(
          dataset.fileName,
          mapping.kind === "steps" ? "steps" : "workouts",
          records.activities,
        ),
        id: `${dataset.fileName}#mapped`,
      };

const SAMSUNG_READ = [...SAMSUNG_TYPES.steps, ...SAMSUNG_TYPES.exercise, ...SAMSUNG_TYPES.weight];

/** Datasets of one Samsung Health CSV (by its data type), or null for a type Kal does not read. */
const samsungDatasets = (
  fileName: string,
  rows: string[][],
  tz: string,
): ImportDataset[] | null => {
  const table = samsungTable(rows, fileName);
  if (!table) return null;
  const type = table.type ?? "";
  if ((SAMSUNG_TYPES.steps as readonly string[]).includes(type)) {
    const records = samsungSteps(table, tz);
    return records.length ? [activityDataset(fileName, "steps", records)] : [];
  }
  if ((SAMSUNG_TYPES.exercise as readonly string[]).includes(type)) {
    const records = samsungExercises(table, tz);
    return records.length ? [activityDataset(fileName, "workouts", records)] : [];
  }
  if ((SAMSUNG_TYPES.weight as readonly string[]).includes(type)) {
    const records = samsungWeights(table, tz);
    return records.length ? [measurementDataset(fileName, SAMSUNG_APP, records)] : [];
  }
  return null;
};

const unknownDataset = (fileName: string, rows: string[][]): UnknownDataset | null => {
  const [headers, ...rest] = rows;
  if (!headers || headers.length < 2 || !rest.length) return null;
  return { id: `${fileName}#columns`, fileName, kind: "unknown", headers, rows: rest };
};

/** One CSV file: Samsung Health by its name or first line, a scale by its columns, else mapping. */
export const readCsv = (fileName: string, text: string, tz: string): ReadResult => {
  const rows = parseCsv(text);
  if (isSamsungCsv(rows, fileName)) {
    const datasets = samsungDatasets(fileName, rows, tz);
    if (datasets)
      return { datasets, notes: datasets.length ? [] : [`${fileName} has no records.`] };
    const table = samsungTable(rows, fileName);
    const unknown = table ? unknownDataset(fileName, [table.headers, ...table.rows]) : null;
    return unknown
      ? { datasets: [unknown], notes: [] }
      : { datasets: [], notes: [`${fileName} could not be read.`] };
  }
  if (rows[0] && isRenphoHeader(rows[0])) {
    const read = renphoMeasurements(rows, tz);
    if (read.records.length)
      return { datasets: [measurementDataset(fileName, RENPHO_APP, read.records)], notes: [] };
  }
  const unknown = unknownDataset(fileName, rows);
  return unknown
    ? { datasets: [unknown], notes: [] }
    : { datasets: [], notes: [`${fileName} has no rows to import.`] };
};

/** A Samsung Health export zip: the steps, exercise and weight files inside it. */
export const readZip = async (file: PickedFile, tz: string): Promise<ReadResult> => {
  const entries = (await listZipEntries(file)).filter((e) => /\.csv$/i.test(e.name));
  const typed = entries
    .map((entry) => ({ entry, type: samsungTypeOf(baseName(entry.name)) }))
    .filter(
      (e): e is { entry: (typeof entries)[number]; type: string } =>
        e.type !== null && (SAMSUNG_READ as readonly string[]).includes(e.type),
    );
  // The day summary is the better steps file; the daily trend only when there is none.
  const hasSummary = typed.some((e) => e.type === SAMSUNG_TYPES.steps[0]);
  const wanted = typed.filter((e) => !(hasSummary && e.type === "step_daily_trend"));
  const result: ReadResult = { datasets: [], notes: [] };
  for (const { entry } of wanted) {
    const text = decodeText(await readZipEntry(file, entry));
    const read = readCsv(baseName(entry.name), text, tz);
    result.datasets.push(...read.datasets.filter((d) => d.kind !== "unknown"));
  }
  if (!result.datasets.length)
    result.notes.push(`Kal found no steps, workouts or weight in ${file.name}.`);
  return result;
};

/** Every picked file, in order. A file that cannot be read adds a note instead of failing. */
export const readImportFiles = async (files: PickedFile[], tz: string): Promise<ReadResult> => {
  const result: ReadResult = { datasets: [], notes: [] };
  for (const file of files) {
    try {
      const part =
        /\.zip$/i.test(file.name) || (await looksLikeZip(file))
          ? await readZip(file, tz)
          : readCsv(file.name, decodeText(new Uint8Array(await file.arrayBuffer())), tz);
      result.datasets.push(...part.datasets);
      result.notes.push(...part.notes);
    } catch (error) {
      result.notes.push(
        `${file.name}: ${error instanceof Error ? error.message : "it could not be read."}`,
      );
    }
  }
  return result;
};
