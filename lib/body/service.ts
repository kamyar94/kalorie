// Body measurements (CONTRACT: lib/contracts/body.ts): values typed on "Log measurements",
// openGym weigh-ins, and records imported from Renpho and Samsung Health files, in one table, and
// the Body screen's summary. Every function takes the signed-in person's id and touches only their
// rows. Health and body values are never logged.
import { and, asc, desc, eq, getTableColumns, gte, lte, notInArray, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { bodyMeasurements, users } from "@/db/schema";
import { sourceLabel, type ImportResult } from "@/lib/contracts/activities";
import {
  judgeChange,
  measureInfo,
  MEASURES,
  RATIOS,
  type BodySummaryDto,
  type ImportedMeasurement,
  type MeasurementDto,
  type MeasureStatDto,
  type NewMeasurements,
  type WeightEntryDto,
} from "@/lib/contracts/body";
import type { WeightPointDto } from "@/lib/contracts/integrations";
import type { Goal } from "@/lib/contracts/targets";
import { isUuid } from "@/lib/meals/service";
import { isValidTimeZone, localParts, shiftLocalDate } from "@/lib/meals/time";
import { fromLocalInputValue } from "@/lib/ui/format";

type Row = typeof bodyMeasurements.$inferSelect;
export type NewMeasurementRow = typeof bodyMeasurements.$inferInsert & { externalId: string };
type NewRow = NewMeasurementRow;

export const toMeasurementDto = (row: Row): MeasurementDto => {
  const info = measureInfo(row.code, row.label, row.unit);
  return {
    id: row.id,
    code: row.code,
    label: info?.label ?? row.label ?? row.code,
    unit: row.unit,
    value: row.value,
    measuredAt: row.measuredAt.toISOString(),
    localDate: row.localDate,
    source: row.source,
    sourceApp: row.sourceApp,
  };
};

const UPDATE_FROM_EXCLUDED = {
  label: sql`excluded.label`,
  unit: sql`excluded.unit`,
  value: sql`excluded.value`,
  measuredAt: sql`excluded.measured_at`,
  tz: sql`excluded.tz`,
  localDate: sql`excluded.local_date`,
  sourceApp: sql`excluded.source_app`,
  updatedAt: sql`now()`,
};

/**
 * Inserts or updates values by (user, source, external id); counts what was new. Used by imports,
 * openGym syncs and Health Connect (lib/health-connect/sync.ts).
 */
export const upsertMeasurements = async (rows: NewRow[], dbx: DbOrTx) => {
  const unique = [...new Map(rows.map((r) => [`${r.source}|${r.externalId}`, r])).values()];
  let added = 0;
  const written: Row[] = [];
  for (let i = 0; i < unique.length; i += 500) {
    const result = await dbx
      .insert(bodyMeasurements)
      .values(unique.slice(i, i + 500))
      .onConflictDoUpdate({
        target: [bodyMeasurements.userId, bodyMeasurements.source, bodyMeasurements.externalId],
        set: UPDATE_FROM_EXCLUDED,
      })
      .returning({ ...getTableColumns(bodyMeasurements), inserted: sql<boolean>`(xmax = 0)` });
    for (const { inserted, ...row } of result) {
      if (inserted) added += 1;
      written.push(row);
    }
  }
  return { added, written };
};

/** "Log measurements": the day's values; a measure logged again that day replaces the first. */
export const logMeasurements = async (
  userId: string,
  input: NewMeasurements,
  dbx: DbOrTx = defaultDb,
): Promise<MeasurementDto[]> => {
  if (!isUuid(userId) || !isValidTimeZone(input.tz)) return [];
  const now = new Date();
  // Today's values at this moment; an earlier day's at noon.
  const measuredAt =
    localParts(now, input.tz).date === input.localDate
      ? now
      : new Date(fromLocalInputValue(`${input.localDate}T12:00`, input.tz) ?? now);
  const rows: NewRow[] = input.values.flatMap((v) => {
    const info = measureInfo(v.code, v.label, v.unit);
    return info
      ? [
          {
            userId,
            code: v.code,
            label: v.label ?? null,
            unit: info.unit,
            value: v.value,
            measuredAt,
            tz: input.tz,
            localDate: input.localDate,
            source: "manual" as const,
            externalId: `${input.localDate}:${v.code}`,
          },
        ]
      : [];
  });
  const { written } = await upsertMeasurements(rows, dbx);
  return written.map(toMeasurementDto);
};

/** Removes a value. openGym weigh-ins come back with the next sync ("synced"). */
export const deleteMeasurement = async (
  userId: string,
  id: string,
  dbx: DbOrTx = defaultDb,
): Promise<"deleted" | "not-found" | "synced"> => {
  if (!isUuid(userId) || !isUuid(id)) return "not-found";
  const own = and(eq(bodyMeasurements.id, id), eq(bodyMeasurements.userId, userId));
  const row = (
    await dbx.select({ source: bodyMeasurements.source }).from(bodyMeasurements).where(own)
  )[0];
  if (!row) return "not-found";
  if (row.source === "opengym") return "synced";
  await dbx.delete(bodyMeasurements).where(own);
  return "deleted";
};

/** Values read from an export file (lib/imports), stored once per external id. */
export const importMeasurements = async (
  userId: string,
  records: ImportedMeasurement[],
  dbx: DbOrTx = defaultDb,
): Promise<ImportResult> => {
  if (!isUuid(userId) || !records.length) return { added: 0, updated: 0, skipped: 0 };
  const rows: NewRow[] = records.map((r) => {
    const at = new Date(r.measuredAt);
    return {
      userId,
      code: r.code,
      label: null,
      unit: measureInfo(r.code)!.unit,
      value: r.value,
      measuredAt: at,
      tz: r.tz,
      localDate: localParts(at, r.tz).date,
      source: "import",
      sourceApp: r.sourceApp,
      externalId: r.externalId,
    };
  });
  const { added, written } = await upsertMeasurements(rows, dbx);
  return { added, updated: written.length - added, skipped: 0 };
};

/**
 * openGym's weigh-ins as weight values (after every sync); weigh-ins openGym no longer lists, from
 * `windowStart` on, are removed here too.
 */
export const syncOpenGymWeights = async (
  userId: string,
  weights: WeightPointDto[],
  windowStart: string,
  dbx: DbOrTx = defaultDb,
) => {
  if (!isUuid(userId)) return;
  const user = (
    await dbx.select({ tz: users.timeZone }).from(users).where(eq(users.id, userId)).limit(1)
  )[0];
  const tz = user && isValidTimeZone(user.tz) ? user.tz : "UTC";
  const rows: NewRow[] = weights.map((w) => ({
    userId,
    code: "weight",
    label: null,
    unit: "kg",
    value: w.kg,
    measuredAt: new Date(fromLocalInputValue(`${w.date}T08:00`, tz) ?? `${w.date}T08:00:00Z`),
    tz,
    localDate: w.date,
    source: "opengym",
    sourceApp: null,
    externalId: `weight:${w.date}`,
  }));
  await dbx.transaction(async (tx) => {
    if (rows.length) await upsertMeasurements(rows, tx);
    await tx.delete(bodyMeasurements).where(
      and(
        eq(bodyMeasurements.userId, userId),
        eq(bodyMeasurements.source, "opengym"),
        gte(bodyMeasurements.localDate, windowStart),
        rows.length
          ? notInArray(
              bodyMeasurements.externalId,
              rows.map((r) => r.externalId),
            )
          : undefined,
      ),
    );
  });
};

/** One weight a day (the last of the day, any source) between two days, oldest first. */
export const weightsByDay = async (
  userId: string,
  from: string,
  to: string,
  dbx: DbOrTx = defaultDb,
): Promise<WeightPointDto[]> => {
  if (!isUuid(userId)) return [];
  const rows = await dbx
    .select({ date: bodyMeasurements.localDate, kg: bodyMeasurements.value })
    .from(bodyMeasurements)
    .where(
      and(
        eq(bodyMeasurements.userId, userId),
        eq(bodyMeasurements.code, "weight"),
        gte(bodyMeasurements.localDate, from),
        lte(bodyMeasurements.localDate, to),
      ),
    )
    .orderBy(asc(bodyMeasurements.measuredAt));
  const byDay = new Map<string, number>();
  for (const row of rows) byDay.set(row.date, Math.round(row.kg * 10) / 10);
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, kg]) => ({ date, kg }));
};

/** The last weight on or before a day, null without one. */
export const lastWeightOn = async (userId: string, localDate: string, dbx: DbOrTx = defaultDb) => {
  if (!isUuid(userId)) return null;
  const row = (
    await dbx
      .select({ kg: bodyMeasurements.value })
      .from(bodyMeasurements)
      .where(
        and(
          eq(bodyMeasurements.userId, userId),
          eq(bodyMeasurements.code, "weight"),
          lte(bodyMeasurements.localDate, localDate),
        ),
      )
      .orderBy(desc(bodyMeasurements.localDate), desc(bodyMeasurements.measuredAt))
      .limit(1)
  )[0];
  return row?.kg ?? null;
};

type Series = { code: string; label: string | null; unit: string; points: Row[] };

/** The point a change is measured from: the last on or before `since`, else the first after it. */
const thenPoint = (points: Row[], since: string) => {
  let before: Row | null = null;
  for (const p of points) if (p.localDate <= since) before = p;
  return before ?? points[0] ?? null;
};

const stat = (
  info: NonNullable<ReturnType<typeof measureInfo>>,
  now: { value: number; date: string },
  then: { value: number; date: string } | null,
  goal: Goal | null,
): MeasureStatDto => {
  const change = then && then.date < now.date ? now.value - then.value : null;
  return {
    code: info.code,
    label: info.label,
    unit: info.unit,
    decimals: info.decimals,
    group: info.group,
    value: now.value,
    date: now.date,
    then: change === null ? null : then!.value,
    thenDate: change === null ? null : then!.date,
    change,
    verdict: change === null ? null : judgeChange(info, change, goal),
  };
};

/** The Body screen (board 11): latest values, changes since a day, the weight history. */
export const getBodySummary = async (
  userId: string,
  today: string,
  requestedSince: string | null = null,
  dbx: DbOrTx = defaultDb,
): Promise<BodySummaryDto> => {
  const user = isUuid(userId)
    ? (
        await dbx
          .select({
            goal: users.goal,
            rate: users.goalRateKgPerWeek,
            heightCm: users.heightCm,
          })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
      )[0]
    : undefined;
  const rows = user
    ? await dbx
        .select()
        .from(bodyMeasurements)
        .where(and(eq(bodyMeasurements.userId, userId), lte(bodyMeasurements.localDate, today)))
        .orderBy(asc(bodyMeasurements.measuredAt))
    : [];
  const goal = user?.goal ?? null;

  const series = new Map<string, Series>();
  for (const row of rows) {
    const entry = series.get(row.code) ?? {
      code: row.code,
      label: row.label,
      unit: row.unit,
      points: [],
    };
    entry.points.push(row);
    series.set(row.code, entry);
  }

  const sinceOptions = [...new Set(rows.map((r) => r.localDate))].sort().reverse().slice(0, 120);
  const monthAgo = shiftLocalDate(today, -30);
  const since =
    requestedSince && sinceOptions.includes(requestedSince)
      ? requestedSince
      : (sinceOptions.find((d) => d <= monthAgo) ?? sinceOptions.at(-1) ?? null);

  const stats: MeasureStatDto[] = [];
  for (const s of series.values()) {
    const info = measureInfo(s.code, s.label, s.unit);
    if (!info) continue;
    const last = s.points.at(-1)!;
    const then = since ? thenPoint(s.points, since) : null;
    stats.push(
      stat(
        info,
        { value: last.value, date: last.localDate },
        then ? { value: then.value, date: then.localDate } : null,
        goal,
      ),
    );
  }

  // Ratios from the latest values and those at the compared day.
  const at = (code: string, which: "now" | "then") => {
    const s = series.get(code);
    if (!s) return null;
    const point = which === "now" ? s.points.at(-1)! : since ? thenPoint(s.points, since) : null;
    return point ? { value: point.value, date: point.localDate } : null;
  };
  const ratio = (code: string, top: string, bottom: (w: "now" | "then") => number | null) => {
    const info = RATIOS.find((r) => r.code === code)!;
    const nowTop = at(top, "now");
    const thenTop = at(top, "then");
    const nowBottom = bottom("now");
    if (!nowTop || !nowBottom) return;
    const thenBottom = bottom("then");
    stats.push(
      stat(
        info,
        { value: nowTop.value / nowBottom, date: nowTop.date },
        thenTop && thenBottom ? { value: thenTop.value / thenBottom, date: thenTop.date } : null,
        goal,
      ),
    );
  };
  if (user?.heightCm) ratio("waist_to_height", "waist", () => user.heightCm);
  ratio("waist_to_hip", "waist", (w) => at("hips", w)?.value ?? null);
  // In the catalogue's order (scale, then tape, parts of one's own, ratios).
  const rank = (code: string) => {
    const known = MEASURES.findIndex((m) => m.code === code);
    if (known >= 0) return known;
    const ratio = RATIOS.findIndex((r) => r.code === code);
    return ratio >= 0 ? 2000 + ratio : 1000;
  };
  stats.sort((a, b) => rank(a.code) - rank(b.code) || a.label.localeCompare(b.label));

  // Weight: one a day for the chart, every weigh-in for the history, the last 30 days' change.
  const weightRows = series.get("weight")?.points ?? [];
  const chartFrom = shiftLocalDate(today, -90);
  const perDay = new Map<string, number>();
  for (const row of weightRows)
    if (row.localDate >= chartFrom) perDay.set(row.localDate, Math.round(row.value * 10) / 10);
  const weights = [...perDay].map(([date, kg]) => ({ date, kg }));
  const latest = weightRows.at(-1);
  let weight30: BodySummaryDto["weight30"] = null;
  if (latest) {
    const start = thenPoint(weightRows, monthAgo);
    if (start && start.localDate < latest.localDate) {
      const change = latest.value - start.value;
      const days = Math.round(
        (Date.parse(`${latest.localDate}T12:00:00Z`) - Date.parse(`${start.localDate}T12:00:00Z`)) /
          86_400_000,
      );
      weight30 = { change, verdict: judgeChange(measureInfo("weight")!, change, goal), days };
    }
  }
  const weightHistory: WeightEntryDto[] = [...weightRows]
    .reverse()
    .slice(0, 400)
    .map((row) => ({
      id: row.id,
      date: row.localDate,
      kg: row.value,
      source: row.source,
      sourceApp: row.sourceApp,
    }));
  const weightSources = [...new Set(weightRows.map((r) => sourceLabel(r.source, r.sourceApp)))];

  return {
    goal,
    goalRateKgPerWeek: user?.rate ?? null,
    heightCm: user?.heightCm ?? null,
    stats,
    weight30,
    weights,
    weightHistory,
    weightSources,
    since,
    sinceOptions,
  };
};
