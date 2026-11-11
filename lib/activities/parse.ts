// Turns untrusted JSON from the browser ("+ Activity", and the records an import read from a file
// on the device) into the activities contract's types. Unknown fields are dropped; a record that
// cannot be used becomes an error sentence (manual) or is skipped (import). Plain functions.
import {
  ACTIVITY_LIMITS,
  activityType,
  isActivityCategory,
  isIntensity,
  type ImportedActivity,
  type ManualActivityInput,
} from "@/lib/contracts/activities";
import { isLocalDate, isValidTimeZone } from "@/lib/meals/time";

/** Text on one line, trimmed and cut to `max`; "" when it is not text. */
const cleanLine = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

const positive = (value: unknown, max: number) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max
    ? value
    : undefined;

/** A moment in the past (the last `days` days), not more than 10 minutes ahead. */
const pastTime = (value: unknown, now: number, days: number) => {
  if (typeof value !== "string") return null;
  const at = new Date(value);
  const ms = at.getTime();
  if (Number.isNaN(ms) || ms > now + 10 * 60_000 || ms < now - days * 86_400_000) return null;
  return at;
};

/** "+ Activity": a known type, a time in the last year, and a duration (or steps for "steps"). */
export const parseManualActivity = (
  body: Record<string, unknown>,
  now = Date.now(),
): ManualActivityInput | { error: string } => {
  const type = activityType(typeof body.type === "string" ? body.type : null);
  if (!type) return { error: "Choose what you did." };
  const startedAt = pastTime(body.startedAt, now, 366);
  if (!startedAt) return { error: "Choose a time in the last year, not in the future." };
  if (!isValidTimeZone(body.tz)) return { error: "The time zone is not valid." };
  const input: ManualActivityInput = {
    type: type.id,
    startedAt: startedAt.toISOString(),
    tz: body.tz,
    title: cleanLine(body.title, ACTIVITY_LIMITS.titleChars) || null,
    notes:
      typeof body.notes === "string"
        ? body.notes.trim().slice(0, ACTIVITY_LIMITS.notesChars) || null
        : null,
  };
  if (type.steps) {
    const steps = positive(body.steps, ACTIVITY_LIMITS.maxSteps);
    if (!steps) return { error: "Write how many steps." };
    input.steps = Math.round(steps);
    return input;
  }
  const minutes = positive(body.durationMin, ACTIVITY_LIMITS.maxMinutes);
  if (!minutes) return { error: "Write how long it took, in minutes." };
  input.durationMin = Math.round(minutes);
  input.intensity = isIntensity(body.intensity) ? body.intensity : type.intensity;
  const km = positive(body.distanceKm, ACTIVITY_LIMITS.maxDistance / 1000);
  if (km) input.distanceKm = Math.round(km * 100) / 100;
  const steps = positive(body.steps, ACTIVITY_LIMITS.maxSteps);
  if (steps) input.steps = Math.round(steps);
  return input;
};

const EXTERNAL_ID = /^[\w.:@/+=-]{1,200}$/;
const SOURCE_APP = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/**
 * One imported record, or null when it cannot be used: an external id, a category, a time in the
 * last 20 years, and a duration or a step count.
 */
export const parseImportedActivity = (raw: unknown, now = Date.now()): ImportedActivity | null => {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const externalId = typeof body.externalId === "string" ? body.externalId : "";
  const sourceApp = typeof body.sourceApp === "string" ? body.sourceApp : "";
  if (!EXTERNAL_ID.test(externalId) || !SOURCE_APP.test(sourceApp)) return null;
  if (!isActivityCategory(body.category)) return null;
  const startedAt = pastTime(body.startedAt, now, 20 * 366);
  if (!startedAt || !isValidTimeZone(body.tz)) return null;
  const durationMin = positive(body.durationMin, ACTIVITY_LIMITS.maxMinutes);
  const steps = positive(body.steps, ACTIVITY_LIMITS.maxSteps);
  if (!durationMin && !steps) return null;
  const type = cleanLine(body.type, 40) || "other";
  const title = cleanLine(body.title, ACTIVITY_LIMITS.titleChars) || "Activity";
  return {
    externalId,
    sourceApp,
    category: body.category,
    type,
    title,
    startedAt: startedAt.toISOString(),
    tz: body.tz,
    localDate: isLocalDate(body.localDate) ? body.localDate : null,
    durationMin: durationMin ? Math.round(durationMin * 10) / 10 : null,
    distanceM: positive(body.distanceM, ACTIVITY_LIMITS.maxDistance) ?? null,
    steps: steps ? Math.round(steps) : null,
    energyKcal: positive(body.energyKcal, ACTIVITY_LIMITS.maxKcal) ?? null,
    intensity: isIntensity(body.intensity) ? body.intensity : null,
  };
};
