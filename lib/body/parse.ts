// Turns untrusted JSON from the browser (a day's measurements, the records an import read from a
// file on the device, the health profile) into the body contract's types. Plain functions.
import {
  CUSTOM_PREFIX,
  CUSTOM_UNITS,
  customCode,
  HEALTH_LIMITS,
  isKnownMeasure,
  measureInfo,
  VALUE_LIMITS,
  type ImportedMeasurement,
  type NewMeasurements,
} from "@/lib/contracts/body";
import { isLocalDate, isValidTimeZone } from "@/lib/meals/time";

/** A value within the limits of its unit, rounded to 2 decimals; else null. */
export const cleanValue = (value: unknown, unit: string) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const [min, max] = VALUE_LIMITS[unit] ?? VALUE_LIMITS[""]!;
  return value >= min && value <= max ? Math.round(value * 100) / 100 : null;
};

const line = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/**
 * A day's measurements: a date in the last 20 years and not ahead of tomorrow, a time zone, and
 * at least one value Kal can use. Custom parts need a name and one of CUSTOM_UNITS.
 */
export const parseNewMeasurements = (
  body: Record<string, unknown>,
  today: string,
): NewMeasurements | { error: string } => {
  const localDate = body.localDate;
  if (
    !isLocalDate(localDate) ||
    localDate > today ||
    localDate < `${Number(today.slice(0, 4)) - 20}`
  )
    return { error: "Choose a day that is not in the future." };
  if (!isValidTimeZone(body.tz)) return { error: "The time zone is not valid." };
  const values: NewMeasurements["values"] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(body.values) ? body.values.slice(0, 60) : []) {
    const entry = (raw ?? {}) as Record<string, unknown>;
    let code = typeof entry.code === "string" ? entry.code : "";
    let label: string | null = null;
    let unit: string | null = null;
    if (code === CUSTOM_PREFIX || code.startsWith(CUSTOM_PREFIX)) {
      label = line(entry.label, 40);
      unit = (CUSTOM_UNITS as readonly string[]).includes(entry.unit as string)
        ? (entry.unit as string)
        : null;
      if (!label || !unit) return { error: "Give each extra part a name and a unit." };
      code = customCode(label);
    } else if (!isKnownMeasure(code)) continue;
    const info = measureInfo(code, label, unit)!;
    const value = cleanValue(entry.value, info.unit);
    if (value === null) return { error: `${info.label}: that value looks wrong.` };
    if (seen.has(code)) continue;
    seen.add(code);
    values.push({ code, value, label, unit });
  }
  if (!values.length) return { error: "Fill in at least one measurement." };
  return { localDate, tz: body.tz, values };
};

const EXTERNAL_ID = /^[\w.:@/+=-]{1,200}$/;
const SOURCE_APP = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/** One imported value, or null: an id, an app, a known measure, a usable value, a time. */
export const parseImportedMeasurement = (
  raw: unknown,
  now = Date.now(),
): ImportedMeasurement | null => {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const externalId = typeof body.externalId === "string" ? body.externalId : "";
  const sourceApp = typeof body.sourceApp === "string" ? body.sourceApp : "";
  const code = typeof body.code === "string" ? body.code : "";
  if (!EXTERNAL_ID.test(externalId) || !SOURCE_APP.test(sourceApp) || !isKnownMeasure(code))
    return null;
  const value = cleanValue(body.value, measureInfo(code)!.unit);
  const at = typeof body.measuredAt === "string" ? new Date(body.measuredAt) : null;
  if (
    value === null ||
    !at ||
    Number.isNaN(at.getTime()) ||
    at.getTime() > now + 86_400_000 ||
    at.getTime() < now - 20 * 366 * 86_400_000 ||
    !isValidTimeZone(body.tz)
  )
    return null;
  return { externalId, sourceApp, code, value, measuredAt: at.toISOString(), tz: body.tz };
};

/** The private fields of the health profile (the rest goes through the profile's own checks). */
export const parseHealthText = (body: Record<string, unknown>) => {
  const text = (value: unknown) =>
    typeof value === "string" ? value.trim().slice(0, HEALTH_LIMITS.textChars) : undefined;
  return {
    conditions: text(body.conditions),
    allergies: text(body.allergies),
    notes: text(body.notes),
    useInAnalysis: typeof body.useInAnalysis === "boolean" ? body.useInAnalysis : undefined,
  };
};
