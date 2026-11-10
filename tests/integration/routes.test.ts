// The meal and photo routes as the browser calls them: upload limits, content checks, the
// same-origin rule, and that photos and meals reach only their owner.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import type { SessionUser } from "@/lib/auth/accounts";
import type { CreateMealResponse, MealDto } from "@/lib/contracts/meals";
import { createUser } from "@/tests/helpers/factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => session.user,
}));

const { POST: upload, GET: listMeals } = await import("@/app/api/meals/route");
const { GET: getMealRoute } = await import("@/app/api/meals/[id]/route");
const { GET: getPhoto } = await import("@/app/api/photos/[id]/[size]/route");

const ORIGIN = "http://127.0.0.1:3201";
let root: string;
let ann: SessionUser;
let ben: SessionUser;

const asUser = async (overrides = {}) => {
  const row = await createUser(overrides);
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    timeZone: row.timeZone,
    units: row.units,
  };
};

const jpeg = (w = 640, h = 480) =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#3a8f50" } })
    .jpeg()
    .toBuffer();

const form = (photos: (Buffer | string)[], fields: Record<string, string> = {}) => {
  const body = new FormData();
  photos.forEach((photo, i) =>
    body.append(
      "photos",
      new Blob([typeof photo === "string" ? photo : new Uint8Array(photo)]),
      `p${i}.jpg`,
    ),
  );
  const all = {
    eatenAt: new Date().toISOString(),
    tz: "Europe/Berlin",
    clientId: `c-${Math.random().toString(36).slice(2, 12)}`,
    ...fields,
  };
  for (const [key, value] of Object.entries(all)) body.set(key, value);
  return body;
};

const post = (body: FormData, origin = ORIGIN) =>
  upload(
    new NextRequest(`${ORIGIN}/api/meals`, {
      method: "POST",
      body,
      headers: { origin, "x-forwarded-host": "127.0.0.1:3201" },
    }),
  );

const get = (url: string) =>
  new NextRequest(`${ORIGIN}${url}`, { headers: { "x-forwarded-host": "127.0.0.1:3201" } });

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "cal-route-photos-"));
  process.env.PHOTO_ROOT = root;
  ann = await asUser();
  ben = await asUser();
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

beforeEach(async () => {
  session.user = ann;
  await db.execute(sql`delete from rate_limits`);
});

describe("POST /api/meals", () => {
  it("creates a meal from one to three photos", async () => {
    const response = await post(
      form([await jpeg(), await jpeg(), await jpeg()], { note: "two skewers" }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as CreateMealResponse;
    expect(body.meal).toMatchObject({
      status: "queued",
      note: "two skewers",
      tz: "Europe/Berlin",
    });
    expect(body.meal.photos).toHaveLength(3);
  });

  it("returns the first copy when the device sends the same meal again", async () => {
    const fields = { clientId: "same-meal-123" };
    const first = (await (await post(form([await jpeg()], fields))).json()) as CreateMealResponse;
    const second = await post(form([await jpeg()], fields));
    expect(second.status).toBe(200);
    expect(((await second.json()) as CreateMealResponse).meal.id).toBe(first.meal.id);
  });

  it("refuses too many photos, non-images, missing times and cross-site posts", async () => {
    expect(
      (await post(form([await jpeg(), await jpeg(), await jpeg(), await jpeg()]))).status,
    ).toBe(400);
    expect((await post(form([]))).status).toBe(400);
    expect((await post(form(["<svg onload=alert(1)>"]))).status).toBe(415);
    const gif = Buffer.from("GIF89a\x01\x00\x01\x00", "latin1");
    expect((await post(form([gif]))).status).toBe(415);
    expect((await post(form([await jpeg()], { eatenAt: "yesterday-ish" }))).status).toBe(400);
    expect(
      (
        await post(
          form([await jpeg()], { eatenAt: new Date(Date.now() + 3_600_000).toISOString() }),
        )
      ).status,
    ).toBe(400);
    expect((await post(form([await jpeg()]), "https://evil.example.net")).status).toBe(403);
  });

  it("creates a text-only meal from a description, once per clientId", async () => {
    const fields = { note: "  Two fried eggs and a slice of toast  ", clientId: "text-meal-123" };
    const response = await post(form([], fields));
    expect(response.status).toBe(201);
    const body = (await response.json()) as CreateMealResponse;
    expect(body.meal).toMatchObject({
      status: "queued",
      source: "text",
      note: "Two fried eggs and a slice of toast",
      photos: [],
    });
    const again = await post(form([], fields));
    expect(again.status).toBe(200);
    expect(((await again.json()) as CreateMealResponse).meal.id).toBe(body.meal.id);
    const jobs = await db.execute(
      sql`select payload->>'reason' as reason from jobs where payload->>'mealId' = ${body.meal.id}`,
    );
    expect(jobs.rows).toEqual([{ reason: "upload" }]);

    // Neither photos nor words: nothing to log.
    const empty = await post(form([], { note: "   " }));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "Add a photo or write what you ate." });
  });

  it("takes a chosen time in the past for a meal", async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const response = await post(
      form([], { note: "lentil soup", eatenAt: yesterday.toISOString(), tz: "UTC" }),
    );
    expect(response.status).toBe(201);
    const { meal } = (await response.json()) as CreateMealResponse;
    expect(meal.eatenAt).toBe(yesterday.toISOString());
    expect(meal.localDate).toBe(yesterday.toISOString().slice(0, 10));
  });

  it("refuses photos over 8 MB", async () => {
    const big = Buffer.concat([await jpeg(), Buffer.alloc(8 * 1024 * 1024)]);
    expect((await post(form([big]))).status).toBe(413);
  });

  it("asks for sign-in", async () => {
    session.user = null;
    expect((await post(form([await jpeg()]))).status).toBe(401);
  });

  it("limits uploads per account", async () => {
    const saved = process.env.UPLOAD_RATE_PER_HOUR;
    process.env.UPLOAD_RATE_PER_HOUR = "1";
    try {
      expect((await post(form([await jpeg()]))).status).toBe(201);
      const limited = await post(form([await jpeg()]));
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    } finally {
      if (saved === undefined) delete process.env.UPLOAD_RATE_PER_HOUR;
      else process.env.UPLOAD_RATE_PER_HOUR = saved;
    }
  });
});

describe("reading meals and photos", () => {
  it("serves photos and meals to their owner only", async () => {
    const created = (await (
      await post(form([await jpeg(1600, 1200)], { eatenAt: "2026-10-31T10:00:00Z", tz: "UTC" }))
    ).json()) as CreateMealResponse;
    const photo = created.meal.photos[0]!;
    const params = (size: string) => ({ params: Promise.resolve({ id: photo.id, size }) });

    const thumb = await getPhoto(get(photo.urls.thumb), params("thumb"));
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get("content-type")).toBe("image/jpeg");
    expect(thumb.headers.get("cache-control")).toContain("private");
    const meta = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(400);
    expect((await getPhoto(get(photo.urls.original), params("original"))).status).toBe(200);
    expect((await getPhoto(get(photo.urls.original), params("../../etc"))).status).toBe(404);

    const meal = await getMealRoute(get(`/api/meals/${created.meal.id}`), {
      params: Promise.resolve({ id: created.meal.id }),
    });
    expect(((await meal.json()) as MealDto).id).toBe(created.meal.id);
    const day = await listMeals(get("/api/meals?date=2026-10-31"));
    expect(((await day.json()) as { meals: unknown[] }).meals.length).toBeGreaterThan(0);

    session.user = ben;
    expect((await getPhoto(get(photo.urls.thumb), params("thumb"))).status).toBe(404);
    expect(
      (
        await getMealRoute(get(`/api/meals/${created.meal.id}`), {
          params: Promise.resolve({ id: created.meal.id }),
        })
      ).status,
    ).toBe(404);
    expect(
      ((await (await listMeals(get("/api/meals?date=2026-10-31"))).json()) as { meals: unknown[] })
        .meals,
    ).toEqual([]);
    expect((await listMeals(get("/api/meals?date=31-10-2026"))).status).toBe(400);

    session.user = null;
    expect((await getPhoto(get(photo.urls.thumb), params("thumb"))).status).toBe(401);
  });
});
