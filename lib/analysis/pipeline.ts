// One analysis run of a meal (docs/DESIGN.md section 4 steps 2 to 5): the vision call with the
// 1280 px analysis copies and the meal's context (a text meal sends its description and no
// image), matching, nutrients, and writing items, totals, questions and status in one transaction. lib/analysis/handler.ts wraps it with the job's status
// changes, retries and error messages.
//
// Items the person edited by hand (meal_items.edited) are kept as they are unless the request asked
// to replace edits; the model is told they are fixed, and any item it lists for them again is
// dropped.
import crypto from "node:crypto";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { mealItems, mealPhotos, meals, users, type MealQuestionRow } from "@/db/schema";
import { runAiTask } from "@/lib/ai/service";
import type { AiImage } from "@/lib/ai/types";
import { healthForAnalysis } from "@/lib/body/health";
import {
  ANALYZE_MEAL_JOB,
  type AnalysisItem,
  type AnalysisOutput,
  type AnalyzeMealPayload,
  type PlannedRecipe,
} from "@/lib/contracts/analysis";
import type { FoodResult } from "@/lib/contracts/food-search";
import type { MealStatus } from "@/lib/contracts/meals";
import { emojiFor } from "@/lib/food/emoji";
import { getFood } from "@/lib/food/search";
import { normalizeFoodText } from "@/lib/food/normalize";
import { recomputeMealTotals } from "@/lib/meals/service";
import { localParts } from "@/lib/meals/time";
import { readPhotoFile } from "@/lib/photos/storage";

import { mealError, notFoodPhotoDetail, type MealError } from "./errors";
import { foodFromLabel, labelFood, labelPer100g } from "./labels";
import { findByBarcode, matchSubjects, type MatchSubject } from "./matching";
import { findMemory, getUsualMeals, memoryKey, touchUsualMeals, type UsualMeal } from "./memory";
import { computeItemNutrients, type ComputedItem, type UsualSnapshot } from "./nutrients";
import { parseAnalysis } from "./parse";
import { getPlannedRecipes } from "./planned";
import { ANALYSIS_SYSTEM, buildAnalysisPrompt, type AnalysisContext } from "./prompt";
import { ANALYSIS_SCHEMA } from "./schema";

/** Questions per meal over all rounds, so answering never turns into an endless interview. */
export const MAX_QUESTIONS_PER_MEAL = 4;

/** Output tokens for the vision call; a retry after a cut-off reply gets more room. */
export const analysisTokenLimit = (attempt: number) => (attempt > 1 ? 16_384 : 8_192);

export class NoPhotosError extends Error {
  constructor() {
    super("The meal's photos could not be read.");
    this.name = "NoPhotosError";
  }
}

export type AnalyseOptions = {
  attempt?: number;
  signal?: AbortSignal;
  log?: (message: string) => void;
  /** Use the trigram fallback only (no matching call). */
  aiMatching?: boolean;
  /** false: count a label without saving it as the person's food (the eval script). */
  saveLabels?: boolean;
  db?: DbOrTx;
};

export type AnalyseOutcome = {
  /** The meal was deleted meanwhile; nothing was written. */
  missing?: boolean;
  status: MealStatus;
  items: number;
  questions: number;
  error?: MealError;
};

type MealRow = typeof meals.$inferSelect;
type ItemRow = typeof mealItems.$inferSelect;

const ownMeal = (userId: string, mealId: string) =>
  and(eq(meals.id, mealId), eq(meals.userId, userId), isNull(meals.deletedAt));

const WEEKDAY = new Map<string, Intl.DateTimeFormat>();
const weekdayOf = (at: Date, tz: string) => {
  let formatter = WEEKDAY.get(tz);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: tz });
    } catch {
      formatter = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" });
    }
    WEEKDAY.set(tz, formatter);
  }
  return formatter.format(at);
};

/** Everything the run reads, loaded once. Null when the meal is not the person's or deleted. */
export const loadAnalysisInput = async (userId: string, mealId: string, dbx: DbOrTx) => {
  const meal = (await dbx.select().from(meals).where(ownMeal(userId, mealId)).limit(1))[0];
  if (!meal) return null;
  const [photos, items, user, usual, planned, health] = await Promise.all([
    dbx
      .select()
      .from(mealPhotos)
      .where(and(eq(mealPhotos.mealId, mealId), eq(mealPhotos.userId, userId)))
      .orderBy(asc(mealPhotos.position)),
    dbx
      .select()
      .from(mealItems)
      .where(and(eq(mealItems.mealId, mealId), eq(mealItems.userId, userId)))
      .orderBy(asc(mealItems.position)),
    dbx
      .select({ units: users.units, cuisines: users.cuisines })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then((rows) => rows[0]),
    getUsualMeals(userId, undefined, dbx),
    getPlannedRecipes(userId, meal.localDate),
    healthForAnalysis(userId, dbx),
  ]);
  return { meal, photos, items, user, usual, planned, health };
};

export type AnalysisInput = NonNullable<Awaited<ReturnType<typeof loadAnalysisInput>>>;

/** The prompt context of a meal (exported for tests and the eval script). */
export const analysisContext = (input: AnalysisInput, keepEdits: boolean): AnalysisContext => {
  const { meal } = input;
  const local = localParts(meal.eatenAt, meal.tz);
  return {
    photoCount: input.photos.length,
    note: meal.note,
    localTime: local.time,
    weekday: weekdayOf(meal.eatenAt, meal.tz),
    slot: meal.slot,
    units: input.user?.units ?? "metric",
    cuisines: input.user?.cuisines ?? [],
    health: input.health ?? null,
    usual: input.usual.map((u) => ({
      id: u.id,
      name: u.name,
      localName: u.localName,
      typicalGrams: u.typicalGrams,
    })),
    planned: input.planned,
    answers: (meal.questions ?? [])
      .filter((q) => q.answer)
      .map((q) => ({ question: q.text, answer: q.answer! })),
    corrections: (meal.corrections ?? []).map((c) => c.text),
    current: input.items.map((item) => ({
      id: item.id,
      name: item.name,
      grams: item.grams * (item.count || 1),
      ml: item.ml,
      fixed: keepEdits && item.edited,
    })),
  };
};

const readImages = async (photos: AnalysisInput["photos"]): Promise<AiImage[]> => {
  const files = await Promise.all(photos.map((p) => readPhotoFile(p.analysisPath)));
  const images: AiImage[] = [];
  for (const file of files)
    if (file && file.length > 0)
      images.push({ mediaType: "image/jpeg", data: file.toString("base64") });
  return images;
};

const usualSnapshot = (usual: UsualMeal | undefined): UsualSnapshot | null =>
  usual?.snapshot && usual.snapshot.grams > 0
    ? {
        grams: usual.snapshot.grams,
        nutrients: usual.snapshot.nutrients,
        components: usual.snapshot.components,
      }
    : null;

type Resolved = {
  item: AnalysisItem;
  food: FoodResult | null;
  usual: UsualSnapshot | null;
  planned: PlannedRecipe | null;
  needsMatch: boolean;
  memoryFoodId: string | null;
  /** The usual meal used, to mark it as used again. */
  usualId: string | null;
};

/** Steps 3 and 4: links, matching and nutrients for the items to write. */
export const resolveItems = async (
  userId: string,
  items: AnalysisItem[],
  input: Pick<AnalysisInput, "usual" | "planned">,
  options: AnalyseOptions & { mealId?: string } = {},
): Promise<{ computed: ComputedItem[]; usedUsual: string[] }> => {
  const dbx = options.db ?? defaultDb;
  const usualById = new Map(input.usual.map((u) => [u.id, u]));
  const plannedById = new Map(input.planned.map((p) => [p.id, p]));
  const memory = await findMemory(
    userId,
    items.flatMap((item) => [item.name, item.local_name ?? ""]),
    dbx,
  );

  const resolved: Resolved[] = [];
  for (const item of items) {
    const entry: Resolved = {
      item,
      food: null,
      usual: null,
      planned: null,
      needsMatch: false,
      memoryFoodId: null,
      usualId: null,
    };
    // The model linked a usual meal, or the name is one the person corrected before.
    const usual =
      (item.matches_usual ? usualById.get(item.matches_usual) : undefined) ??
      memory.get(memoryKey(item.name)) ??
      (item.local_name ? memory.get(memoryKey(item.local_name)) : undefined);
    const planned = item.matches_planned ? (plannedById.get(item.matches_planned) ?? null) : null;

    if (usual) entry.usualId = usual.id;
    if (usual?.foodId) {
      entry.memoryFoodId = usual.foodId;
      entry.needsMatch = true;
    } else if (usual && usualSnapshot(usual)) {
      entry.usual = usualSnapshot(usual);
    } else if (planned?.nutritionPerServing) {
      entry.planned = planned;
    } else if (item.label && (item.label.barcode || labelPer100g(item.label))) {
      const byBarcode = item.label.barcode
        ? await findByBarcode(userId, item.label.barcode, dbx)
        : null;
      entry.food =
        byBarcode ??
        (options.saveLabels === false ? labelFood(item) : await foodFromLabel(userId, item, dbx));
      entry.needsMatch = !entry.food;
    } else if (planned?.foodId) {
      entry.food = await getFood(planned.foodId, userId, dbx);
      entry.needsMatch = !entry.food;
    } else {
      entry.needsMatch = true;
    }
    resolved.push(entry);
  }

  const subjects: MatchSubject[] = [];
  resolved.forEach((entry, index) => {
    if (!entry.needsMatch) return;
    const { item } = entry;
    subjects.push({
      key: `item:${index}`,
      name: item.name,
      localName: item.local_name,
      kind: item.kind,
      preparation: item.preparation,
      grams: item.grams ?? 0,
      searchTerms: item.search_terms,
      partOf: null,
      barcode: null,
      memoryFoodId: entry.memoryFoodId,
    });
    if (entry.memoryFoodId) return;
    item.components.forEach((component, c) => {
      const remembered = memory.get(memoryKey(component.name));
      subjects.push({
        key: `item:${index}:c:${c}`,
        name: component.name,
        localName: null,
        kind: "ingredient",
        preparation: null,
        grams: component.grams,
        searchTerms: [component.name],
        partOf: item.name,
        barcode: null,
        memoryFoodId: remembered?.foodId ?? null,
      });
    });
  });

  const matches = subjects.length
    ? await matchSubjects(userId, subjects, {
        useAi: options.aiMatching !== false,
        mealId: options.mealId,
        signal: options.signal,
        log: options.log,
        db: dbx,
      })
    : new Map();

  const computed = resolved.map((entry, index) => {
    const food = entry.food ?? matches.get(`item:${index}`)?.food ?? null;
    return computeItemNutrients({
      item: entry.item,
      food,
      usual: entry.usual,
      planned: entry.planned,
      components: entry.item.components.map((component, c) => ({
        ...component,
        food: matches.get(`item:${index}:c:${c}`)?.food ?? null,
      })),
    });
  });
  const usedUsual = resolved.flatMap((entry) => (entry.usualId ? [entry.usualId] : []));
  return { computed, usedUsual };
};

const estimateRow = (item: AnalysisItem) => {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(item.estimate))
    if (typeof value === "number") out[key] = value;
  return out;
};

const questionId = () => `q_${crypto.randomBytes(5).toString("hex")}`;

/** Whether another analysis of this meal is already waiting (an answer came in meanwhile). */
const hasQueuedJob = async (mealId: string, dbx: DbOrTx) =>
  (
    await dbx.execute(sql`
      select 1 from jobs where kind = ${ANALYZE_MEAL_JOB} and dedupe_key = ${`meal:${mealId}`}
         and status = 'queued' limit 1`)
  ).rows.length > 0;

/** The title the analysis may set: the person's own title (changed by hand) stays. */
const nextTitle = (meal: MealRow, title: string) => {
  const previous = (meal.analysis as AnalysisOutput | null)?.title ?? null;
  const ownTitle = meal.title && meal.title !== previous;
  return ownTitle ? meal.title : title || meal.title;
};

/** Runs steps 2 to 5 for one meal. Throws AiError and NoPhotosError for the handler to sort. */
export const analyseMeal = async (
  payload: AnalyzeMealPayload,
  options: AnalyseOptions = {},
): Promise<AnalyseOutcome> => {
  const dbx = options.db ?? defaultDb;
  const { userId, mealId } = payload;
  const keepEdits = !payload.replaceEdits;
  const input = await loadAnalysisInput(userId, mealId, dbx);
  if (!input) return { missing: true, status: "failed", items: 0, questions: 0 };

  // A text meal is described in words: the model gets the description and no image.
  const textOnly = input.meal.source === "text" && !input.photos.length;
  if (textOnly && !input.meal.note?.trim()) throw new NoPhotosError();
  const images = textOnly ? [] : await readImages(input.photos);
  if (!textOnly && !images.length) throw new NoPhotosError();
  const context = analysisContext(input, keepEdits);
  context.photoCount = images.length;
  const { prompt, refs } = buildAnalysisPrompt(context);

  const response = await runAiTask(
    userId,
    "analysis",
    {
      system: ANALYSIS_SYSTEM,
      prompt,
      images,
      json: { name: "meal_analysis", schema: ANALYSIS_SCHEMA },
      maxOutputTokens: analysisTokenLimit(options.attempt ?? 1),
      signal: options.signal,
    },
    { mealId, db: dbx },
  );
  const { output, sameAs } = parseAnalysis(response.json, refs, {
    provider: response.provider,
    usage: response.usage,
  });

  if (!output.is_food) {
    const detail = output.title && !textOnly ? notFoodPhotoDetail(output.title) : undefined;
    // What it is instead, kept with the error: a medicine or supplement offers "Log as a medicine".
    const error = mealError("not-food", {
      detail,
      textOnly,
      notFoodKind: output.not_food_kind ?? "other",
    });
    const done = await dbx
      .update(meals)
      .set({
        status: "failed",
        error,
        analysis: output,
        analysisCount: sql`${meals.analysisCount} + 1`,
        analysedAt: new Date(),
      })
      .where(ownMeal(userId, mealId))
      .returning({ id: meals.id });
    if (!done.length) return { missing: true, status: "failed", items: 0, questions: 0 };
    return { status: "failed", items: 0, questions: 0, error };
  }

  // Items for hand-edited ones are dropped: the person's edits stay.
  const fixed = keepEdits ? input.items.filter((i) => i.edited) : [];
  const fixedIds = new Set(fixed.map((i) => i.id));
  const fixedNames = new Set(fixed.map((i) => normalizeFoodText(i.name)));
  const fresh = output.items.filter(
    (item, index) =>
      !(sameAs[index] && fixedIds.has(sameAs[index]!)) &&
      !fixedNames.has(normalizeFoodText(item.name)),
  );

  const { computed, usedUsual } = await resolveItems(userId, fresh, input, {
    ...options,
    mealId,
    db: dbx,
  });

  const written = await dbx.transaction(async (tx) => {
    const meal = (
      await tx.select().from(meals).where(ownMeal(userId, mealId)).for("update").limit(1)
    )[0];
    if (!meal) return null;
    // Read the kept items again: the person may have edited one while the model was thinking.
    const kept: ItemRow[] = keepEdits
      ? await tx
          .select()
          .from(mealItems)
          .where(and(eq(mealItems.mealId, mealId), eq(mealItems.edited, true)))
      : [];
    const keptIds = new Set(kept.map((k) => k.id));
    const keptNames = new Set(kept.map((k) => normalizeFoodText(k.name)));
    await tx
      .delete(mealItems)
      .where(
        and(eq(mealItems.mealId, mealId), keepEdits ? eq(mealItems.edited, false) : undefined),
      );

    let position = kept.reduce((max, k) => Math.max(max, k.position), -1) + 1;
    const rows: (typeof mealItems.$inferInsert)[] = [];
    fresh.forEach((item, index) => {
      const sameAsId = sameAs[output.items.indexOf(item)];
      if ((sameAsId && keptIds.has(sameAsId)) || keptNames.has(normalizeFoodText(item.name)))
        return;
      const result = computed[index]!;
      rows.push({
        mealId,
        userId,
        position: position++,
        name: item.name,
        localName: item.local_name,
        kind: item.kind,
        emoji: item.emoji ?? emojiFor(item.name, item.kind, [item.local_name]),
        preparation: item.preparation,
        foodId: result.foodId,
        grams: result.grams,
        ml: result.ml,
        portionText: item.portion_text,
        count: 1,
        modelGrams: item.grams,
        gramsLow: result.gramsLow,
        gramsHigh: result.gramsHigh,
        confidence: item.confidence,
        estimate: estimateRow(item),
        searchTerms: item.search_terms,
        photoIndexes: item.photo_indexes,
        edited: false,
        nutrients: result.nutrients,
        nutrientSource: result.source,
        components: result.components,
      });
    });
    if (rows.length) await tx.insert(mealItems).values(rows);

    const answered = (meal.questions ?? []).filter((q) => q.answer);
    const room = Math.max(0, MAX_QUESTIONS_PER_MEAL - answered.length);
    const open: MealQuestionRow[] = output.questions.slice(0, room).map((q) => ({
      id: questionId(),
      text: q.question,
      answers: q.answers,
      answer: null,
    }));
    const status: MealStatus = (await hasQueuedJob(mealId, tx))
      ? "queued"
      : open.length
        ? "needs_input"
        : "ready";
    await tx
      .update(meals)
      .set({
        status,
        title: nextTitle(meal, output.title),
        analysis: output,
        questions: [...answered, ...open],
        error: null,
        analysisCount: sql`${meals.analysisCount} + 1`,
        analysedAt: new Date(),
      })
      .where(eq(meals.id, mealId));
    // Totals, and the meal's name from the new items and the model's meal_type.
    await recomputeMealTotals(mealId, tx);
    return { status, items: kept.length + rows.length, questions: open.length };
  });
  if (!written) return { missing: true, status: "failed", items: 0, questions: 0 };
  await touchUsualMeals(userId, usedUsual, dbx).catch(() => undefined);
  return written;
};
