// Turns untrusted JSON (from the browser, and from the model reading a label) into the medicine
// contract's types. Unknown fields are dropped and wrong types make a field absent. Plain functions.
import {
  isMedicineForm,
  MEDICINE_LIMITS,
  type MedicineForm,
  type MedicineIngredient,
  type MedicineLogPatch,
  type MedicinePatch,
  type MedicineReading,
  type NewMedicineLog,
} from "@/lib/contracts/medicines";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Text on one line, trimmed and cut to `max`; "" when it is not text. */
export const cleanLine = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

const optionalLine = (value: unknown, max: number) =>
  value === null ? null : typeof value === "string" ? cleanLine(value, max) || null : undefined;

/** A dose: more than 0, at most MEDICINE_LIMITS.maxAmount, in steps of a hundredth. */
export const cleanAmount = (value: unknown) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value > 0 &&
  value <= MEDICINE_LIMITS.maxAmount
    ? Math.round(value * 100) / 100
    : undefined;

export const cleanIngredients = (value: unknown): MedicineIngredient[] =>
  Array.isArray(value)
    ? value
        .map((entry) => ({
          name: cleanLine((entry as Record<string, unknown> | null)?.name, 60),
          strength: cleanLine((entry as Record<string, unknown> | null)?.strength, 40),
        }))
        .filter((entry) => entry.name)
        .slice(0, MEDICINE_LIMITS.ingredients)
    : [];

const formOf = (value: unknown): MedicineForm | null | undefined =>
  value === null ? null : isMedicineForm(value) ? value : undefined;

/** A new medicine or changes to one; for a new one the name is required (null without it). */
export const parseMedicinePatch = (body: Record<string, unknown>): MedicinePatch => {
  const patch: MedicinePatch = {};
  const name = cleanLine(body.name, MEDICINE_LIMITS.nameChars);
  if (name) patch.name = name;
  const strength = optionalLine(body.strength, MEDICINE_LIMITS.strengthChars);
  if (strength !== undefined) patch.strength = strength;
  const form = formOf(body.form);
  if (form !== undefined) patch.form = form;
  const amount = cleanAmount(body.usualAmount);
  if (amount !== undefined) patch.usualAmount = amount;
  const unit = optionalLine(body.unit, MEDICINE_LIMITS.unitChars);
  if (unit !== undefined) patch.unit = unit;
  if (Array.isArray(body.ingredients)) patch.ingredients = cleanIngredients(body.ingredients);
  if (body.notes === null) patch.notes = null;
  else if (typeof body.notes === "string")
    patch.notes = body.notes.trim().slice(0, MEDICINE_LIMITS.notesChars) || null;
  if (typeof body.archived === "boolean") patch.archived = body.archived;
  return patch;
};

/** A time taken can lie this far ahead of the server's clock (a phone's clock runs a bit fast). */
export const TAKEN_AT_SLACK_MS = 10 * 60_000;

const TIME_ERROR = "Pick a time in the past year.";

/** The time a medicine was taken, as ISO: in the past year and not in the future; else null. */
const takenAtOf = (value: unknown, now: number) => {
  const takenAt = typeof value === "string" ? new Date(value) : null;
  if (
    !takenAt ||
    Number.isNaN(takenAt.getTime()) ||
    takenAt.getTime() > now + TAKEN_AT_SLACK_MS ||
    takenAt.getTime() < now - 366 * 86_400_000
  )
    return null;
  return takenAt.toISOString();
};

const amountError = () => `Give an amount from 0.01 to ${MEDICINE_LIMITS.maxAmount}.`;

/**
 * A medicine taken. Needs a time (in the past year, not in the future) and either a medicine of
 * the list or a name. Returns an error sentence for the person otherwise.
 */
export const parseMedicineLog = (
  body: Record<string, unknown>,
  now = Date.now(),
): NewMedicineLog | { error: string } => {
  const takenAt = takenAtOf(body.takenAt, now);
  if (!takenAt) return { error: TIME_ERROR };
  const log: NewMedicineLog = {
    takenAt,
    tz: typeof body.tz === "string" ? body.tz.slice(0, 64) : "",
  };
  if (typeof body.medicineId === "string" && UUID.test(body.medicineId))
    log.medicineId = body.medicineId;
  const name = cleanLine(body.name, MEDICINE_LIMITS.nameChars);
  if (name) log.name = name;
  if (!log.medicineId && !log.name) return { error: "Write the medicine's name." };
  const strength = optionalLine(body.strength, MEDICINE_LIMITS.strengthChars);
  if (strength !== undefined) log.strength = strength;
  const form = formOf(body.form);
  if (form !== undefined) log.form = form;
  if (body.amount !== undefined) {
    const amount = cleanAmount(body.amount);
    if (amount === undefined) return { error: amountError() };
    log.amount = amount;
  }
  const unit = optionalLine(body.unit, MEDICINE_LIMITS.unitChars);
  if (unit !== undefined) log.unit = unit;
  if (Array.isArray(body.ingredients)) log.ingredients = cleanIngredients(body.ingredients);
  if (typeof body.scanId === "string" && UUID.test(body.scanId)) log.scanId = body.scanId;
  if (typeof body.keep === "boolean") log.keep = body.keep;
  return log;
};

/**
 * Changes to a log: a new time taken (same rule as a new log: the past year, not the future) with
 * its time zone, and a new amount (more than 0, in the log's unit). A field that is sent but not
 * valid is an error, and so is a body that changes nothing.
 */
export const parseMedicineLogPatch = (
  body: Record<string, unknown>,
  now = Date.now(),
): MedicineLogPatch | { error: string } => {
  const patch: MedicineLogPatch = {};
  if (body.takenAt !== undefined) {
    const takenAt = takenAtOf(body.takenAt, now);
    if (!takenAt) return { error: TIME_ERROR };
    patch.takenAt = takenAt;
  }
  if (typeof body.tz === "string") patch.tz = body.tz.slice(0, 64);
  if (body.amount !== undefined) {
    const amount = cleanAmount(body.amount);
    if (amount === undefined) return { error: amountError() };
    patch.amount = amount;
  }
  if (patch.takenAt === undefined && patch.amount === undefined)
    return { error: "Send a new time or a new amount." };
  return patch;
};

/**
 * The model's answer about a label (lib/medicines/label.ts MEDICINE_LABEL_SCHEMA), cleaned: null
 * when it found no medicine or no name. Strength and form stay empty when they are not printed.
 */
export const parseMedicineReading = (value: unknown): MedicineReading | null => {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.is_medicine !== true) return null;
  const name = cleanLine(v.name, MEDICINE_LIMITS.nameChars);
  if (!name) return null;
  return {
    name,
    strength: cleanLine(v.strength, MEDICINE_LIMITS.strengthChars) || null,
    form: isMedicineForm(v.form) ? v.form : null,
    ingredients: cleanIngredients(v.active_ingredients),
  };
};
