// Reading a medicine's box or blister with the person's own AI provider (the "analysis" task
// settings: provider, model and key): the job "read-medicine-label", queued by POST
// /api/medicine-scans (or POST /api/meals/:id/medicine-scan, from a meal's photos) and run by the
// worker (worker/handlers.ts). The model only transcribes the label (name, strength, form, active
// ingredients) as strict JSON; it gives no advice, doses or interactions. The screen waits for the
// result and then shows it for the person to check.
//
//   queued -> reading -> done (reading set) | failed (error: no key, not a medicine, ...)
// A provider that is busy or slow gets one more try a few seconds later; everything else fails at
// once, and the screen offers the same sheet empty for typing.
import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { mealPhotos, meals, medicineScans } from "@/db/schema";
import { describeAiError, isAiError, isRetryableAiError } from "@/lib/ai/errors";
import { runAiTask } from "@/lib/ai/service";
import type { JsonSchema } from "@/lib/ai/types";
import { isReadMedicineLabelPayload, MEDICINE_FORMS } from "@/lib/contracts/medicines";
import { isUuid } from "@/lib/meals/service";
import { readPhotoFile } from "@/lib/photos/storage";
import { JobError, type JobHandler } from "@/lib/queue/worker";

import { parseMedicineReading } from "./parse";

/** Attempts of the job: the first, and one more after a short wait for a busy provider. */
export const LABEL_MAX_ATTEMPTS = 2;
const RETRY_AFTER_MS = 3000;

const str = (description: string) => ({ type: "string", description });

/** Strict schema (every property required, objects closed), as lib/analysis/schema.ts. */
export const MEDICINE_LABEL_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["is_medicine", "name", "strength", "form", "active_ingredients"],
  properties: {
    is_medicine: {
      type: "boolean",
      description:
        "True when the photo shows a medicine or supplement package, blister, bottle or its label.",
    },
    name: str(
      "The product name as printed (brand or generic), without the strength. Empty when not readable.",
    ),
    strength: str(
      'The strength per unit as printed, with its unit: "200 mg", "1000 IU", "5 mg/ml". Empty when none is printed.',
    ),
    form: {
      type: "string",
      enum: [...MEDICINE_FORMS, "unknown"],
      description: "What one unit is: tablet, capsule, liquid, ... unknown when not printed.",
    },
    active_ingredients: {
      type: "array",
      description: "The active ingredients printed on the label, each with its strength.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "strength"],
        properties: {
          name: str("The ingredient's name as printed."),
          strength: str("Its amount per unit as printed, empty when none is printed."),
        },
      },
    },
  },
};

export const MEDICINE_LABEL_SYSTEM = `You read the label of a medicine or supplement for Kal, a personal health log. You get one photo of a box, blister, bottle or label (sometimes up to three photos of the same one) and answer with JSON that matches the schema.

- Transcribe only what is printed: the product name, the strength per unit, the form (tablet, capsule, liquid...) and the active ingredients with their amounts. Keep the spelling of the label, in its own language and script.
- Never guess. Leave a field empty (or "unknown" for the form) when it is not readable.
- When the photos show no medicine or supplement, set is_medicine false and leave the rest empty.
- Do not give advice of any kind: no doses, uses, warnings, interactions or side effects. Do not add anything that is not on the label.`;

export const MEDICINE_LABEL_PROMPT =
  "Read this medicine label and fill in the schema. Transcribe only what is printed.";

/** The prompt for several photos of the same medicine (a meal's photos). */
export const MEDICINE_LABEL_PROMPT_SEVERAL =
  "These photos show the same medicine. Read its label and fill in the schema. Transcribe only what is printed.";

/** A meal's photos (analysis size, in order) while the meal is there and the person's; else none. */
const mealImages = async (userId: string, mealId: string) => {
  if (!isUuid(mealId)) return [];
  const rows = await db
    .select({ path: mealPhotos.analysisPath })
    .from(mealPhotos)
    .innerJoin(meals, eq(meals.id, mealPhotos.mealId))
    .where(
      and(
        eq(mealPhotos.mealId, mealId),
        eq(meals.userId, userId),
        eq(mealPhotos.userId, userId),
        isNull(meals.deletedAt),
      ),
    )
    .orderBy(asc(mealPhotos.position));
  const images: Buffer[] = [];
  for (const file of await Promise.all(rows.map((row) => readPhotoFile(row.path))))
    if (file?.length) images.push(file);
  return images;
};

/** Error kinds of a reading: the AI's kinds, and the label's own. */
const LABEL_MESSAGES: Record<string, string> = {
  "no-key": "Save an AI key in Settings so Kal can read labels. Type the name for now.",
  "not-medicine":
    "Kal could not find a medicine on this photo. Type the name, or try another photo.",
  "no-photo": "The photo could not be read. Type the name, or try another photo.",
};

const SETTINGS_KINDS = new Set(["no-key", "auth", "quota", "config"]);

/** The error a scan keeps: a kind and a sentence for the person. */
export const labelError = (kind: string, error?: unknown) => ({
  kind,
  message:
    LABEL_MESSAGES[kind] ??
    `${isAiError(error) ? describeAiError(error) : "Kal could not read the label."} Type the name instead.`,
});

export const labelErrorNeedsSettings = (kind: string) => SETTINGS_KINDS.has(kind);

const setScan = (
  scanId: string,
  userId: string,
  values: Partial<typeof medicineScans.$inferInsert>,
) =>
  db
    .update(medicineScans)
    .set(values)
    .where(and(eq(medicineScans.id, scanId), eq(medicineScans.userId, userId)))
    .returning({ id: medicineScans.id });

export const readMedicineLabelHandler: JobHandler = async (payload, context) => {
  if (!isReadMedicineLabelPayload(payload))
    throw new JobError("Invalid read-medicine-label payload.", { retry: false });
  const { scanId, userId } = payload;
  const scan = (
    await db
      .select()
      .from(medicineScans)
      .where(and(eq(medicineScans.id, scanId), eq(medicineScans.userId, userId)))
      .limit(1)
  )[0];
  if (!scan) throw new JobError("The label photo no longer exists.", { retry: false });
  await setScan(scanId, userId, { status: "reading", error: null });

  // From a meal: all its photos while it is there (the label may be on any of them); else the
  // scan's own photo.
  const images: Buffer[] = payload.mealId ? await mealImages(userId, payload.mealId) : [];
  if (!images.length) {
    const own = await readPhotoFile(scan.analysisPath);
    if (own?.length) images.push(own);
  }
  if (!images.length) {
    await setScan(scanId, userId, { status: "failed", error: labelError("no-photo") });
    return { scanId, status: "failed", errorKind: "no-photo" };
  }
  try {
    const response = await runAiTask(
      userId,
      "analysis",
      {
        system: MEDICINE_LABEL_SYSTEM,
        prompt: images.length > 1 ? MEDICINE_LABEL_PROMPT_SEVERAL : MEDICINE_LABEL_PROMPT,
        images: images.map((image) => ({
          mediaType: "image/jpeg" as const,
          data: image.toString("base64"),
        })),
        json: { name: "medicine_label", schema: MEDICINE_LABEL_SCHEMA },
        maxOutputTokens: 4096,
        signal: context.signal,
      },
      { usageTask: "medicine-label" },
    );
    const reading = parseMedicineReading(response.json);
    if (!reading) {
      await setScan(scanId, userId, { status: "failed", error: labelError("not-medicine") });
      return { scanId, status: "failed", errorKind: "not-medicine" };
    }
    await setScan(scanId, userId, { status: "done", reading, error: null });
    // Only that it was read, never what: medicine data stays out of the logs.
    context.log(`read label ${scanId}`);
    return { scanId, status: "done" };
  } catch (error) {
    const kind = isAiError(error) ? error.kind : "internal";
    if (isRetryableAiError(error) && context.attempt < context.maxAttempts) {
      await setScan(scanId, userId, { status: "queued" });
      throw new JobError(`${kind}: will try again`, { retryAfterMs: RETRY_AFTER_MS });
    }
    await setScan(scanId, userId, { status: "failed", error: labelError(kind, error) });
    context.log(`label ${scanId} failed: ${kind}`);
    return { scanId, status: "failed", errorKind: kind };
  }
};
