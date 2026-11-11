// Photos of an existing meal (POST/PATCH /api/meals/:id/photos, DELETE .../photos/:photoId): the
// same checks and re-encoding as uploads, at most three photos, the cover at position 0, the files
// gone after a removal, the meal and its items kept, a new analysis only when asked, owner only.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { mealPhotos, meals } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/accounts";
import type { MealDto } from "@/lib/contracts/meals";
import { resolvePhotoPath } from "@/lib/photos/storage";
import { createItem, createMeal, createUser } from "@/tests/helpers/factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => session.user,
}));

const photosRoute = await import("@/app/api/meals/[id]/photos/route");
const photoRoute = await import("@/app/api/meals/[id]/photos/[photoId]/route");

type Change = { meal: MealDto; reanalysed: boolean; notice: string | null };

const ORIGIN = "http://127.0.0.1:3201";
const HEADERS = { origin: ORIGIN, "x-forwarded-host": "127.0.0.1:3201" };
let root: string;
let ann: SessionUser;
let ben: SessionUser;

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

const jpeg = (colour = "#3a8f50", w = 640, h = 480) =>
  sharp({ create: { width: w, height: h, channels: 3, background: colour } })
    .jpeg()
    .toBuffer();

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const add = async (
  mealId: string,
  photos: (Buffer | string)[],
  reanalyse?: boolean,
  origin = ORIGIN,
) => {
  const body = new FormData();
  photos.forEach((photo, i) =>
    body.append(
      "photos",
      new Blob([typeof photo === "string" ? photo : new Uint8Array(photo)]),
      `p${i}.jpg`,
    ),
  );
  if (reanalyse !== undefined) body.set("reanalyse", String(reanalyse));
  return photosRoute.POST(
    new NextRequest(`${ORIGIN}/api/meals/${mealId}/photos`, {
      method: "POST",
      body,
      headers: { ...HEADERS, origin },
    }),
    ctx(mealId),
  );
};

const cover = (mealId: string, body: Record<string, unknown>) =>
  photosRoute.PATCH(
    new NextRequest(`${ORIGIN}/api/meals/${mealId}/photos`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { ...HEADERS, "content-type": "application/json" },
    }),
    ctx(mealId),
  );

const remove = (mealId: string, photoId: string, reanalyse = false) =>
  photoRoute.DELETE(
    new NextRequest(`${ORIGIN}/api/meals/${mealId}/photos/${photoId}?reanalyse=${reanalyse}`, {
      method: "DELETE",
      headers: HEADERS,
    }),
    { params: Promise.resolve({ id: mealId, photoId }) },
  );

const jobsFor = async (mealId: string) =>
  (
    await db.execute(
      sql`select payload->>'reason' as reason from jobs where payload->>'mealId' = ${mealId}`,
    )
  ).rows;

/** A ready meal with one item and no photos, written as Cal would leave it. */
const readyMeal = async (userId: string, source: "photo" | "text" | "manual" = "text") => {
  const meal = await createMeal(userId, {
    eatenAt: new Date(),
    localDate: new Date().toISOString().slice(0, 10),
    source,
    note: source === "text" ? "rice and chicken" : null,
    totals: { energy: 430 },
  });
  await createItem(userId, meal.id, { name: "Rice", grams: 200, nutrients: { energy: 260 } });
  await createItem(userId, meal.id, { name: "Chicken", grams: 100, nutrients: { energy: 170 } });
  return meal;
};

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "cal-meal-photos-"));
  process.env.PHOTO_ROOT = root;
  ann = await asUser();
  ben = await asUser();
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeEach(async () => {
  session.user = ann;
  await db.execute(sql`delete from rate_limits`);
});

describe("adding photos to a meal", () => {
  it("adds photos to a meal typed in words, which stays a text meal with its items", async () => {
    const meal = await readyMeal(ann.id, "text");
    const response = await add(meal.id, [await jpeg(), await jpeg("#aa3300", 1600, 1200)]);
    expect(response.status).toBe(201);
    const change = (await response.json()) as Change;
    expect(change.reanalysed).toBe(false);
    expect(change.notice).toBeNull();
    expect(change.meal).toMatchObject({ source: "text", status: "ready", itemCount: 2 });
    expect(change.meal.photos.map((p) => p.position)).toEqual([0, 1]);
    expect(change.meal.items.map((i) => i.name)).toEqual(["Rice", "Chicken"]);
    // Off by default: no new analysis.
    expect(await jobsFor(meal.id)).toEqual([]);

    // Re-encoded like an upload: the stored original is at most 2048 px, without metadata.
    const rows = await db.select().from(mealPhotos).where(eq(mealPhotos.mealId, meal.id));
    const original = rows.find((r) => r.position === 1)!;
    const meta = await sharp(resolvePhotoPath(original.originalPath)!).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(2048);
    expect(meta.exif).toBeUndefined();
  });

  it("holds at most three photos and refuses what an upload refuses", async () => {
    const meal = await readyMeal(ann.id, "manual");
    expect((await add(meal.id, [await jpeg(), await jpeg()])).status).toBe(201);
    const over = await add(meal.id, [await jpeg(), await jpeg()]);
    expect(over.status).toBe(409);
    expect(((await over.json()) as { error: string }).error).toMatch(/at most 3 photos/);
    // Nothing was kept from the refused request, rows or files.
    expect(await db.$count(mealPhotos, eq(mealPhotos.mealId, meal.id))).toBe(2);

    const other = await readyMeal(ann.id);
    expect((await add(other.id, [])).status).toBe(400);
    expect((await add(other.id, ["<svg onload=alert(1)>"])).status).toBe(415);
    const big = Buffer.concat([await jpeg(), Buffer.alloc(8 * 1024 * 1024)]);
    expect((await add(other.id, [big])).status).toBe(413);
    expect((await add(other.id, [await jpeg()], false, "https://evil.example.net")).status).toBe(
      403,
    );
    expect(await db.$count(mealPhotos, eq(mealPhotos.mealId, other.id))).toBe(0);
  });

  it("analyses the meal again only when asked, keeping the items changed by hand", async () => {
    const meal = await readyMeal(ann.id, "photo");
    const response = await add(meal.id, [await jpeg()], true);
    expect(response.status).toBe(201);
    const change = (await response.json()) as Change;
    expect(change.reanalysed).toBe(true);
    expect(change.meal.status).toBe("queued");
    const jobs = await db.execute(
      sql`select payload from jobs where payload->>'mealId' = ${meal.id}`,
    );
    expect(jobs.rows).toEqual([
      { payload: { mealId: meal.id, userId: ann.id, reason: "retry", replaceEdits: false } },
    ]);
  });

  it("is the owner's only", async () => {
    const meal = await readyMeal(ann.id);
    session.user = ben;
    expect((await add(meal.id, [await jpeg()])).status).toBe(404);
    session.user = null;
    expect((await add(meal.id, [await jpeg()])).status).toBe(401);
    expect(await db.$count(mealPhotos, eq(mealPhotos.mealId, meal.id))).toBe(0);
  });

  it("is rate limited like uploads", async () => {
    const saved = process.env.UPLOAD_RATE_PER_HOUR;
    process.env.UPLOAD_RATE_PER_HOUR = "1";
    try {
      const meal = await readyMeal(ann.id);
      expect((await add(meal.id, [await jpeg()])).status).toBe(201);
      const limited = await add(meal.id, [await jpeg()]);
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    } finally {
      if (saved === undefined) delete process.env.UPLOAD_RATE_PER_HOUR;
      else process.env.UPLOAD_RATE_PER_HOUR = saved;
    }
  });
});

describe("the cover and removing photos", () => {
  it("makes a photo the cover and keeps the others in order", async () => {
    const meal = await readyMeal(ann.id);
    const added = (await (
      await add(meal.id, [await jpeg("#111111"), await jpeg("#222222"), await jpeg("#333333")])
    ).json()) as Change;
    const [first, second, third] = added.meal.photos;
    const response = await cover(meal.id, { cover: third!.id });
    expect(response.status).toBe(200);
    const change = (await response.json()) as Change;
    expect(change.meal.photos.map((p) => p.id)).toEqual([third!.id, first!.id, second!.id]);
    expect(change.meal.photos.map((p) => p.position)).toEqual([0, 1, 2]);
    expect(await jobsFor(meal.id)).toEqual([]);

    // A full order, too; unknown photos and other people are refused.
    const ordered = (await (
      await cover(meal.id, { order: [second!.id, first!.id, third!.id] })
    ).json()) as Change;
    expect(ordered.meal.photos.map((p) => p.id)).toEqual([second!.id, first!.id, third!.id]);
    expect((await cover(meal.id, { cover: crypto.randomUUID() })).status).toBe(404);
    expect((await cover(meal.id, { cover: 12 })).status).toBe(400);
    session.user = ben;
    expect((await cover(meal.id, { cover: first!.id })).status).toBe(404);
  });

  it("removes the files after the row; the next photo becomes the cover", async () => {
    const meal = await readyMeal(ann.id, "photo");
    const added = (await (await add(meal.id, [await jpeg(), await jpeg()])).json()) as Change;
    const [first, second] = added.meal.photos;
    const row = (await db.select().from(mealPhotos).where(eq(mealPhotos.id, first!.id)))[0]!;
    const files = [row.originalPath, row.analysisPath, row.thumbPath].map((p) =>
      resolvePhotoPath(p)!,
    );
    expect(files.every((f) => existsSync(f))).toBe(true);

    session.user = ben;
    expect((await remove(meal.id, first!.id)).status).toBe(404);
    expect(files.every((f) => existsSync(f))).toBe(true);
    session.user = ann;

    const response = await remove(meal.id, first!.id);
    expect(response.status).toBe(200);
    const change = (await response.json()) as Change;
    expect(change.meal.photos.map((p) => [p.id, p.position])).toEqual([[second!.id, 0]]);
    expect(files.some((f) => existsSync(f))).toBe(false);
    expect((await remove(meal.id, first!.id)).status).toBe(404);
  });

  it("keeps a photo meal and its items when its last photo goes, even when asked to analyse", async () => {
    const meal = await readyMeal(ann.id, "photo");
    const added = (await (await add(meal.id, [await jpeg()])).json()) as Change;
    const response = await remove(meal.id, added.meal.photos[0]!.id, true);
    expect(response.status).toBe(200);
    const change = (await response.json()) as Change;
    expect(change.reanalysed).toBe(false);
    expect(change.notice).toMatch(/no photos left to analyse/);
    expect(change.meal).toMatchObject({ source: "photo", status: "ready", photos: [] });
    expect(change.meal.items).toHaveLength(2);
    expect(change.meal.totals).toEqual({ energy: 430 });
    expect(await jobsFor(meal.id)).toEqual([]);
    const stored = await db.select().from(meals).where(eq(meals.id, meal.id));
    expect(stored[0]!.deletedAt).toBeNull();
  });

  it("does nothing to a deleted meal", async () => {
    const meal = await readyMeal(ann.id);
    const added = (await (await add(meal.id, [await jpeg()])).json()) as Change;
    await db.update(meals).set({ deletedAt: new Date() }).where(eq(meals.id, meal.id));
    expect((await remove(meal.id, added.meal.photos[0]!.id)).status).toBe(404);
    expect((await add(meal.id, [await jpeg()])).status).toBe(404);
    expect((await cover(meal.id, { cover: added.meal.photos[0]!.id })).status).toBe(404);
  });
});
