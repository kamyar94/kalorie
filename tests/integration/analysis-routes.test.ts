// The analysis routes as the meal screen calls them: answer, correct and retry. Signed-in owner
// only, same-origin only, small JSON bodies, 202 with the queued meal.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { meals } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/accounts";
import type { MealDto } from "@/lib/contracts/meals";
import { createPhotoMeal } from "@/lib/meals/create";
import { createUser } from "@/tests/helpers/factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => session.user,
}));

const { POST: answer } = await import("@/app/api/meals/[id]/answers/route");
const { POST: correct } = await import("@/app/api/meals/[id]/corrections/route");
const { POST: retry } = await import("@/app/api/meals/[id]/retry/route");

const ORIGIN = "http://127.0.0.1:3203";
let root: string;
let ann: SessionUser;
let ben: SessionUser;
let mealId: string;

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

type Handler = typeof answer;

const call = (
  handler: Handler,
  id: string,
  body: unknown,
  options: { origin?: string; raw?: string } = {},
) =>
  handler(
    new NextRequest(`${ORIGIN}/api/meals/${id}/x`, {
      method: "POST",
      body: options.raw ?? JSON.stringify(body),
      headers: {
        origin: options.origin ?? ORIGIN,
        "content-type": "application/json",
        "x-forwarded-host": "127.0.0.1:3203",
      },
    }),
    { params: Promise.resolve({ id }) },
  );

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "cal-analysis-routes-"));
  process.env.PHOTO_ROOT = root;
  ann = await asUser();
  ben = await asUser();
  const photo = await sharp({
    create: { width: 320, height: 240, channels: 3, background: "#aa6633" },
  })
    .jpeg()
    .toBuffer();
  const created = await createPhotoMeal({
    userId: ann.id,
    clientId: null,
    eatenAt: new Date(),
    tz: "UTC",
    note: null,
    photos: [photo],
  });
  mealId = created.meal.id;
  await db
    .update(meals)
    .set({
      status: "needs_input",
      questions: [{ id: "q_1", text: "Sugar in the tea?", answers: ["Yes", "No"], answer: null }],
    })
    .where(sql`${meals.id} = ${mealId}`);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("analysis routes", () => {
  it("needs a signed-in person and a same-origin request", async () => {
    session.user = null;
    expect((await call(retry, mealId, {})).status).toBe(401);
    session.user = ann;
    expect(
      (await call(retry, mealId, {}, { origin: "https://elsewhere.example.org" })).status,
    ).toBe(403);
  });

  it("answers a question and queues the meal", async () => {
    session.user = ann;
    const response = await call(answer, mealId, { questionId: "q_1", answer: "Two cubes" });
    expect(response.status).toBe(202);
    const meal = (await response.json()) as MealDto;
    expect(meal.status).toBe("queued");
    expect(meal.questions[0]).toMatchObject({ id: "q_1", answer: "Two cubes" });
    expect(meal.openQuestions).toBe(0);
  });

  it("stores a correction and a retry", async () => {
    session.user = ann;
    const corrected = await call(correct, mealId, { text: "It was chicken", replaceEdits: true });
    expect(corrected.status).toBe(202);
    const row = (await db.execute(sql`select corrections from meals where id = ${mealId}`))
      .rows[0] as { corrections: { text: string }[] };
    expect(row.corrections.map((c) => c.text)).toEqual(["It was chicken"]);
    const job = (
      await db.execute(
        sql`select payload from jobs where payload->>'mealId' = ${mealId} and payload->>'reason' = 'correction'`,
      )
    ).rows[0] as { payload: { replaceEdits: boolean } };
    expect(job.payload.replaceEdits).toBe(true);
    expect((await call(retry, mealId, {}, { raw: "" })).status).toBe(202);
  });

  it("refuses bad bodies and other people's meals", async () => {
    session.user = ann;
    expect((await call(answer, mealId, { questionId: "q_1" })).status).toBe(400);
    expect((await call(correct, mealId, { text: "x", replaceEdits: "yes" })).status).toBe(400);
    expect((await call(correct, mealId, {}, { raw: "{not json" })).status).toBe(400);
    expect(
      (await call(correct, mealId, {}, { raw: `{"text":"${"a".repeat(5000)}"}` })).status,
    ).toBe(400);
    expect((await call(answer, mealId, { questionId: "q_9", answer: "Yes" })).status).toBe(404);
    expect((await call(retry, "not-a-uuid", {})).status).toBe(404);

    session.user = ben;
    for (const [handler, body] of [
      [answer, { questionId: "q_1", answer: "No" }],
      [correct, { text: "It was beef" }],
      [retry, {}],
    ] as const) {
      const response = await call(handler, mealId, body);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Meal not found." });
    }
  });
});
