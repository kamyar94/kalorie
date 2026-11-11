// "Log as a medicine" against Postgres: a medicine photographed in Meal mode fails as not food with
// its kind kept; the label is read from the meal's own photos (a copy of the cover becomes the label
// photo); saving logs it at the meal's time and removes the meal with its photos. Also: meals
// analysed before the kind was kept (keywords in the stored words), meals typed in words, no AI
// key, unreadable photos, a double tap, the owner-only rule, the export and "Delete my data".
// Every medicine here is made up.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { jobs, mealPhotos, meals, medicineLogs, medicines, medicineScans } from "@/db/schema";
import { deleteUserData, exportUserData } from "@/lib/account/data";
import { saveProviderKey } from "@/lib/ai/service";
import { mealError, notFoodPhotoDetail } from "@/lib/analysis/errors";
import { analyzeMealHandler } from "@/lib/analysis/handler";
import type { SessionUser } from "@/lib/auth/accounts";
import { ANALYZE_MEAL_JOB } from "@/lib/contracts/analysis";
import {
  READ_MEDICINE_LABEL_JOB,
  type LoggedMedicine,
  type MedicineScanDto,
} from "@/lib/contracts/medicines";
import { createPhotoMeal } from "@/lib/meals/create";
import { getMeal } from "@/lib/meals/service";
import { localParts } from "@/lib/meals/time";
import { readMedicineLabelHandler } from "@/lib/medicines/label";
import { getMedicineScan } from "@/lib/medicines/scans";
import { medicineDay } from "@/lib/medicines/service";
import { resolvePhotoPath } from "@/lib/photos/storage";
import { drainJobs } from "@/lib/queue/worker";
import { imagesOf, NOT_FOOD_MEDICINE, promptOf } from "@/tests/fixtures/analysis";
import {
  aiReplies,
  startAiMock,
  TEST_API_KEY,
  useAiMock,
  type AiMock,
} from "@/tests/helpers/ai-mock";
import { createUser } from "@/tests/helpers/factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => session.user,
}));

const scanRoute = await import("@/app/api/meals/[id]/medicine-scan/route");
const logRoute = await import("@/app/api/meals/[id]/medicine/route");

const ORIGIN = "http://127.0.0.1:3201";
const HEADERS = { origin: ORIGIN, "x-forwarded-host": "127.0.0.1:3201" };
const TZ = "Europe/Berlin";
let ai: AiMock;
let restore: () => void;
let root: string;

const asUser = async () => {
  const row = await createUser();
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    timeZone: row.timeZone,
    units: row.units,
  };
};

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const post = (url: string, body?: unknown, origin = ORIGIN) =>
  new NextRequest(`${ORIGIN}${url}`, {
    method: "POST",
    headers: { ...HEADERS, origin, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const startScan = (mealId: string, origin = ORIGIN) =>
  scanRoute.POST(post(`/api/meals/${mealId}/medicine-scan`, undefined, origin), ctx(mealId));

const save = (mealId: string, body: Record<string, unknown>) =>
  logRoute.POST(post(`/api/meals/${mealId}/medicine`, body), ctx(mealId));

const jpeg = (colour: string) =>
  sharp({ create: { width: 800, height: 600, channels: 3, background: colour } })
    .jpeg()
    .toBuffer();

const LABEL = {
  is_medicine: true,
  name: "Examplazole",
  strength: "10 mg",
  form: "tablet",
  active_ingredients: [{ name: "examplazole", strength: "10 mg" }],
};

/** A meal with photos (or a description), eaten three hours ago, waiting for its analysis. */
const newMeal = async (userId: string, photos = 2, note: string | null = null) => {
  const eatenAt = new Date(Date.now() - 3 * 3_600_000);
  eatenAt.setMilliseconds(0);
  const { meal } = await createPhotoMeal({
    userId,
    clientId: null,
    eatenAt,
    tz: TZ,
    note,
    photos: await Promise.all(
      ["#204060", "#f1f2ee", "#a03030"].slice(0, photos).map((c) => jpeg(c)),
    ),
  });
  return meal;
};

/** Leaves a meal failed as not food, as an analysis from before not_food_kind would have. */
const failOld = async (mealId: string, title: string, textOnly = false) =>
  db
    .update(meals)
    .set({
      status: "failed",
      error: mealError("not-food", {
        detail: textOnly ? undefined : notFoodPhotoDetail(title),
        textOnly,
      }),
      analysis: { is_food: false, title, items: [], questions: [] },
    })
    .where(eq(meals.id, mealId));

const photoFiles = async (mealId: string) =>
  (await db.select().from(mealPhotos).where(eq(mealPhotos.mealId, mealId))).flatMap((p) => [
    resolvePhotoPath(p.originalPath)!,
    resolvePhotoPath(p.analysisPath)!,
    resolvePhotoPath(p.thumbPath)!,
  ]);

const scanFiles = async (scanId: string) =>
  (await db.select().from(medicineScans).where(eq(medicineScans.id, scanId))).flatMap((s) => [
    resolvePhotoPath(s.originalPath)!,
    resolvePhotoPath(s.analysisPath)!,
    resolvePhotoPath(s.thumbPath)!,
  ]);

beforeAll(async () => {
  ai = await startAiMock();
  restore = useAiMock(ai);
  root = mkdtempSync(path.join(os.tmpdir(), "cal-meal-medicine-"));
  process.env.PHOTO_ROOT = root;
});

afterAll(async () => {
  restore();
  await ai.close();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  ai.reset();
  await db.execute(sql`delete from rate_limits`);
  await db.delete(jobs);
});

describe("a medicine photographed as a meal", () => {
  it("reads the label from the meal's photos, logs it at the meal's time and removes the meal", async () => {
    const person = await asUser();
    session.user = person;
    await saveProviderKey(person.id, "google", TEST_API_KEY);
    const meal = await newMeal(person.id, 2);
    // The analysis: not food, a medicine.
    ai.queue("google", aiReplies.google.json(NOT_FOOD_MEDICINE));
    expect(await drainJobs({ [ANALYZE_MEAL_JOB]: analyzeMealHandler })).toBe(1);
    const failed = (await getMeal(person.id, meal.id))!;
    expect(failed).toMatchObject({ status: "failed" });
    expect(failed.error).toMatchObject({ kind: "not-food", notFoodKind: "medicine" });
    const mealFiles = await photoFiles(meal.id);
    expect(mealFiles).toHaveLength(6);

    // The label, read from both photos.
    const started = await startScan(meal.id);
    expect(started.status).toBe(202);
    const queued = (await started.json()) as MedicineScanDto;
    expect(queued.status).toBe("queued");
    const [job] = await db
      .select()
      .from(jobs)
      .where(sql`${jobs.payload}->>'scanId' = ${queued.id}`);
    expect(job!.payload).toEqual({ scanId: queued.id, userId: person.id, mealId: meal.id });
    ai.queue("google", aiReplies.google.json(LABEL));
    expect(await drainJobs({ [READ_MEDICINE_LABEL_JOB]: readMedicineLabelHandler })).toBe(1);
    const request = ai.requests.at(-1)!;
    expect(imagesOf("google", request)).toBe(2);
    expect(promptOf("google", request)).toContain("These photos show the same medicine");
    expect(await getMedicineScan(person.id, queued.id)).toMatchObject({
      status: "done",
      reading: { name: "Examplazole", strength: "10 mg", form: "tablet" },
    });
    // The label photo is a copy of the cover, the person's own.
    const copies = await scanFiles(queued.id);
    expect(copies.every((file) => existsSync(file))).toBe(true);
    expect(copies.some((file) => mealFiles.includes(file))).toBe(false);

    // Saved: taken at the meal's time, kept in the list, the meal and its photos gone.
    const body = {
      name: "Examplazole",
      strength: "10 mg",
      form: "tablet",
      amount: 1,
      unit: "tablet",
      ingredients: [{ name: "examplazole", strength: "10 mg" }],
      takenAt: failed.eatenAt,
      tz: TZ,
      scanId: queued.id,
      keep: true,
    };
    const response = await save(meal.id, body);
    expect(response.status).toBe(201);
    const logged = (await response.json()) as LoggedMedicine;
    expect(logged.log).toMatchObject({
      name: "Examplazole",
      strength: "10 mg",
      amount: 1,
      unit: "tablet",
      takenAt: failed.eatenAt,
      tz: TZ,
      localDate: failed.localDate,
      localTime: localParts(new Date(failed.eatenAt), TZ).time,
      photo: { thumb: `/api/medicine-scans/${queued.id}/thumb` },
    });
    expect(logged.medicine).toMatchObject({ name: "Examplazole", usualAmount: 1 });
    expect(await getMeal(person.id, meal.id)).toBeNull();
    expect(await db.$count(meals, eq(meals.id, meal.id))).toBe(0);
    expect(await db.$count(mealPhotos, eq(mealPhotos.mealId, meal.id))).toBe(0);
    expect(mealFiles.some((file) => existsSync(file))).toBe(false);
    expect(copies.every((file) => existsSync(file))).toBe(true);
    const day = await medicineDay(person.id, failed.localDate);
    expect(day.logs.map((l) => l.id)).toEqual([logged.log.id]);

    // A double tap: the same answer, one log; the meal stays gone.
    const again = await save(meal.id, body);
    expect(again.status).toBe(200);
    expect(((await again.json()) as LoggedMedicine).log.id).toBe(logged.log.id);
    expect(await db.$count(medicineLogs, eq(medicineLogs.userId, person.id))).toBe(1);
    expect(await db.$count(medicines, eq(medicines.userId, person.id))).toBe(1);
    expect((await startScan(meal.id)).status).toBe(404);
  });

  it("answers two taps at the same moment with one log", async () => {
    const person = await asUser();
    session.user = person;
    const meal = await newMeal(person.id, 1);
    await failOld(meal.id, "A bottle of examplazole tablets");
    const scan = (await (await startScan(meal.id)).json()) as MedicineScanDto;
    const body = {
      name: "Examplazole",
      takenAt: meal.eatenAt,
      tz: TZ,
      scanId: scan.id,
      keep: false,
    };
    const [first, second] = await Promise.all([save(meal.id, body), save(meal.id, body)]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    const ids = await Promise.all([first, second].map(async (r) => (await r.json()).log.id));
    expect(ids[0]).toBe(ids[1]);
    expect(await db.$count(medicineLogs, eq(medicineLogs.userId, person.id))).toBe(1);
    expect(await db.$count(medicines, eq(medicines.userId, person.id))).toBe(0);
  });
});

describe("which meals can be logged as a medicine", () => {
  it("reads older meals from their stored words; other meals answer 409", async () => {
    const person = await asUser();
    session.user = person;
    const vitamins = await newMeal(person.id, 1);
    await failOld(vitamins.id, "A bottle of vitamin D capsules");
    expect((await getMeal(person.id, vitamins.id))!.error).toMatchObject({
      kind: "not-food",
      notFoodKind: "supplement",
    });

    const laptop = await newMeal(person.id, 1);
    await failOld(laptop.id, "A laptop on a desk");
    expect((await getMeal(person.id, laptop.id))!.error!.notFoodKind).toBe("other");
    const ready = await newMeal(person.id, 1);
    await db.update(meals).set({ status: "ready" }).where(eq(meals.id, ready.id));
    const noKey = await newMeal(person.id, 1);
    await db
      .update(meals)
      .set({ status: "failed", error: mealError("no-key") })
      .where(eq(meals.id, noKey.id));
    expect((await getMeal(person.id, noKey.id))!.error!.notFoodKind).toBeNull();
    for (const meal of [laptop, ready, noKey]) {
      expect((await startScan(meal.id)).status, meal.id).toBe(409);
      expect(
        (await save(meal.id, { name: "Something", takenAt: meal.eatenAt, tz: TZ })).status,
      ).toBe(409);
      expect(await db.$count(meals, eq(meals.id, meal.id))).toBe(1);
    }

    // Without an AI key: the label photo is kept at once, unread, and the typed medicine saves.
    const started = (await (await startScan(vitamins.id)).json()) as MedicineScanDto;
    expect(started).toMatchObject({ status: "failed", reading: null });
    expect(started.error!.kind).toBe("no-key");
    expect(await db.$count(jobs, sql`${jobs.payload}->>'scanId' = ${started.id}`)).toBe(0);
    const saved = await save(vitamins.id, {
      name: "Vitamin D",
      strength: "1000 IU",
      form: "capsule",
      takenAt: vitamins.eatenAt,
      tz: TZ,
      scanId: started.id,
      keep: true,
    });
    expect(saved.status).toBe(201);
    expect(((await saved.json()) as LoggedMedicine).log.photo).not.toBeNull();
    expect(await db.$count(meals, eq(meals.id, vitamins.id))).toBe(0);
  });

  it("logs a meal typed in words without a photo, from its description", async () => {
    const person = await asUser();
    session.user = person;
    const typed = await newMeal(person.id, 0, "two allergy pills after lunch");
    // The title names nothing; the description does.
    await failOld(typed.id, "Something else", true);
    const dto = (await getMeal(person.id, typed.id))!;
    expect(dto.source).toBe("text");
    expect(dto.error!.notFoodKind).toBe("medicine");
    // Nothing to read: the sheet is typed.
    expect((await startScan(typed.id)).status).toBe(409);
    const saved = await save(typed.id, {
      name: "Allergy relief",
      amount: 2,
      takenAt: typed.eatenAt,
      tz: "Not/AZone",
    });
    expect(saved.status).toBe(201);
    // An unknown time zone falls back to the meal's.
    expect(((await saved.json()) as LoggedMedicine).log).toMatchObject({ amount: 2, tz: TZ });
    expect(await db.$count(meals, eq(meals.id, typed.id))).toBe(0);
    // Again: nothing to recognise it by, so the meal is simply gone.
    expect(
      (await save(typed.id, { name: "Allergy relief", takenAt: typed.eatenAt, tz: TZ })).status,
    ).toBe(404);
  });

  it("says when the meal's photo files cannot be read", async () => {
    const person = await asUser();
    session.user = person;
    const meal = await newMeal(person.id, 1);
    await failOld(meal.id, "Pill bottle");
    for (const file of await photoFiles(meal.id)) rmSync(file);
    const response = await startScan(meal.id);
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: string }).error).toMatch(
      /could not be read\. Type the medicine instead\./,
    );
    expect(await db.$count(medicineScans, eq(medicineScans.userId, person.id))).toBe(0);
  });
});

describe("owner only", () => {
  it("keeps someone else's meal out of reach", async () => {
    const owner = await asUser();
    const other = await asUser();
    session.user = owner;
    const meal = await newMeal(owner.id, 1);
    await failOld(meal.id, "Pill bottle");
    const body = { name: "Examplazole", takenAt: meal.eatenAt, tz: TZ };

    session.user = other;
    expect((await startScan(meal.id)).status).toBe(404);
    expect((await save(meal.id, body)).status).toBe(404);
    session.user = null;
    expect((await startScan(meal.id)).status).toBe(401);
    expect((await save(meal.id, body)).status).toBe(401);
    session.user = owner;
    expect((await startScan(meal.id, "https://elsewhere.example.org")).status).toBe(403);
    expect((await startScan("not-a-meal")).status).toBe(404);
    // A label photo of someone else cannot go with the log.
    session.user = other;
    const theirs = await newMeal(other.id, 1);
    await failOld(theirs.id, "Pill bottle");
    const theirScan = (await (await startScan(theirs.id)).json()) as MedicineScanDto;
    session.user = owner;
    expect((await save(meal.id, { ...body, scanId: theirScan.id })).status).toBe(404);
    expect(await db.$count(meals, eq(meals.id, meal.id))).toBe(1);
    expect(await db.$count(medicineLogs, eq(medicineLogs.userId, owner.id))).toBe(0);
  });
});

describe("export and delete my data", () => {
  it("exports the log instead of the meal, and deleting removes the label photo", async () => {
    const person = await asUser();
    session.user = person;
    const meal = await newMeal(person.id, 1);
    await failOld(meal.id, "Pill bottle");
    const scan = (await (await startScan(meal.id)).json()) as MedicineScanDto;
    const files = await scanFiles(scan.id);
    await save(meal.id, {
      name: "Examplazole",
      takenAt: meal.eatenAt,
      tz: TZ,
      scanId: scan.id,
      keep: true,
    });

    const data = (await exportUserData(person.id))!;
    expect(data.meals.map((m) => m.id)).not.toContain(meal.id);
    expect(data.medicineLogs).toMatchObject([{ name: "Examplazole", localDate: meal.localDate }]);
    expect(data.medicines).toMatchObject([{ name: "Examplazole" }]);

    expect(files.every((file) => existsSync(file))).toBe(true);
    await deleteUserData(person.id);
    expect(await db.$count(medicineScans, eq(medicineScans.userId, person.id))).toBe(0);
    expect(await db.$count(medicineLogs, eq(medicineLogs.userId, person.id))).toBe(0);
    expect(files.some((file) => existsSync(file))).toBe(false);
  });
});
