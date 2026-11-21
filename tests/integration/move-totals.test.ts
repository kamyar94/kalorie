// Move with the phone's day totals (Kal for Android 1.2) against Postgres: the day's totals next to
// Kal's workouts (which alone give the points), which Kal for Android the person has, Today's
// card, the goals on Move and its week card, "Every day" for a month (the phone's or Move's
// numbers, empty days, earlier months) and its route. Every value is made up.
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { activities } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/accounts";
import type { HcSyncResult } from "@/lib/contracts/health-connect";
import type { EveryDayMonthDto } from "@/lib/contracts/move";
import { claimLinkCode, createLinkCode, phoneAppOf } from "@/lib/devices/service";
import { localParts, shiftLocalDate } from "@/lib/meals/time";
import { setMoveGoal } from "@/lib/move/goals";
import { getEveryDayMonth, getMoveDay, getMoveDayView, getMoveSummary } from "@/lib/move/service";
import { createUser } from "@/tests/helpers/factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => session.user,
  requireUser: async () => {
    if (!session.user) throw new Error("Sign in first.");
    return session.user;
  },
  secureCookies: () => false,
}));
vi.mock("@/lib/ui/viewer-time", () => ({ TZ_COOKIE: "cal_tz" }));

const syncRoute = await import("@/app/api/health-connect/sync/route");
const daysRoute = await import("@/app/api/move/days/route");

const ORIGIN = "http://127.0.0.1:3201";
const TZ = "Europe/Berlin";
const SAMSUNG = "com.sec.android.app.shealth";
const METHOD = "sessions+steps60";

const today = () => localParts(new Date(), TZ).date;
const day = (n: number) => shiftLocalDate(today(), -n);

const linkPhone = async (userId: string, appVersion = "1.2 (3)") => {
  const { code } = await createLinkCode(userId);
  const result = await claimLinkCode(code, { name: "samsung SM-S928B", appVersion });
  if (typeof result === "string") throw new Error(result);
  return result.token;
};

const send = async (token: string, body: unknown) => {
  const response = await syncRoute.POST(
    new NextRequest(`${ORIGIN}/api/health-connect/sync`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    body: (await response.json()) as HcSyncResult & { error?: string },
  };
};

const sessionOf = (user: { id: string; username: string; timeZone: string }): SessionUser =>
  ({
    id: user.id,
    username: user.username,
    displayName: "Test Person",
    role: "member",
    timeZone: user.timeZone,
  }) as SessionUser;

beforeEach(async () => {
  session.user = null;
  await db.execute(sql`delete from rate_limits`);
});

describe("Move with the phone's numbers", () => {
  it("compares with the person's goals on the day and in the week", async () => {
    const eve = await createUser({ timeZone: TZ });
    await setMoveGoal(eve.id, "steps", 9000);
    await setMoveGoal(eve.id, "activeKcal", 650);
    // Move and its week card follow them.
    const view = await getMoveDayView(eve.id, today(), today());
    expect(view.goals).toEqual({ steps: 9000, activeMinutes: 60, activeKcal: 650 });
    expect(view.stepGoal).toBe(9000);
    const summary = await getMoveSummary(eve.id, today());
    expect(summary.week.rows.find((r) => r.category === "walking")!.target).toBe(9000 * 7);
  });

  it("shows the day's totals next to Kal's workouts, which alone give the points", async () => {
    const fay = await createUser({ timeZone: TZ });
    expect(await phoneAppOf(fay.id)).toBe("none");
    expect((await getMoveDayView(fay.id, today(), today())).phone).toBe("none");
    const token = await linkPhone(fay.id);
    await send(token, {
      tz: TZ,
      appVersion: "1.2 (3)",
      steps: [{ date: today(), count: 8123, sourceApp: SAMSUNG }],
      dayTotals: [
        {
          date: today(),
          steps: 8123,
          stepsApp: SAMSUNG,
          activeMinutes: 71,
          activeMethod: METHOD,
          activeApp: SAMSUNG,
          activeKcal: 455,
          kcalApp: SAMSUNG,
        },
      ],
    });
    const view = await getMoveDayView(fay.id, today(), today());
    expect(view.phone).toBe("current");
    expect(view.totals).toMatchObject({ steps: 8123, activeMinutes: 71, activeKcal: 455 });
    // Points come from Kal's records only: 8 x 5 for the steps, nothing for the phone's minutes.
    expect(view.points).toBe(40);
    // Only the owner sees them.
    const stranger = await createUser({ timeZone: TZ });
    expect((await getMoveDayView(stranger.id, today(), today())).totals).toBeNull();
    expect(view.workouts).toBe(0);
    expect(view.activeMinutes).toBe(0);
    const card = await getMoveDay(fay.id, today());
    expect(card.totals).toMatchObject({ activeMinutes: 71, activeKcal: 455 });
    expect(card.points).toBe(40);
    // A day without totals.
    expect((await getMoveDayView(fay.id, day(3), today())).totals).toBeNull();
  });

  it("lists a month's days newest first, the phone's or Move's numbers, and earlier months", async () => {
    const gus = await createUser({ timeZone: TZ });
    const token = await linkPhone(gus.id);
    // A month that is over: two months back, then the one before it.
    const month = shiftLocalDate(`${today().slice(0, 7)}-01`, -40).slice(0, 7);
    const before = shiftLocalDate(`${month}-01`, -1).slice(0, 7);
    await send(token, {
      tz: TZ,
      dayTotals: [
        {
          date: `${month}-10`,
          steps: 6905,
          stepsApp: SAMSUNG,
          activeMinutes: 54,
          activeMethod: METHOD,
          activeApp: SAMSUNG,
          activeKcal: 402,
          kcalApp: SAMSUNG,
        },
      ],
    });
    await db.insert(activities).values({
      userId: gus.id,
      category: "walking",
      type: "steps",
      title: "Steps",
      startedAt: new Date(`${month}-05T12:00:00Z`),
      tz: TZ,
      localDate: `${month}-05`,
      steps: 4388,
      source: "import",
      sourceApp: "samsung-health",
      externalId: `import:steps:${month}-05`,
    });
    const view = await getEveryDayMonth(gus.id, month, today());
    expect(view.month).toBe(month);
    expect(view.days[0]!.date > view.days.at(-1)!.date).toBe(true);
    expect(view.days.at(-1)!.date).toBe(`${month}-01`);
    expect(view.days.find((d) => d.date === `${month}-10`)).toEqual({
      date: `${month}-10`,
      steps: 6905,
      activeMinutes: 54,
      activeKcal: 402,
      fromPhone: true,
    });
    expect(view.days.find((d) => d.date === `${month}-05`)).toEqual({
      date: `${month}-05`,
      steps: 4388,
      activeMinutes: null,
      activeKcal: null,
      fromPhone: false,
    });
    expect(view.days.find((d) => d.date === `${month}-07`)).toEqual({
      date: `${month}-07`,
      steps: null,
      activeMinutes: null,
      activeKcal: null,
      fromPhone: false,
    });
    // Nothing is stored before this month yet.
    expect(view.earlier).toBeNull();
    await db.insert(activities).values({
      userId: gus.id,
      category: "cardio",
      type: "run",
      title: "Run",
      startedAt: new Date(`${before}-20T07:00:00Z`),
      tz: TZ,
      localDate: `${before}-20`,
      durationMin: 30,
      intensity: "vigorous",
    });
    expect((await getEveryDayMonth(gus.id, month, today())).earlier).toBe(before);

    // This month: today first, nothing after today.
    const now = await getEveryDayMonth(gus.id, today().slice(0, 7), today());
    expect(now.days[0]!.date).toBe(today());
    expect(now.earlier).toBe(shiftLocalDate(`${today().slice(0, 7)}-01`, -1).slice(0, 7));
    // A month to come has no days.
    const next = shiftLocalDate(`${today().slice(0, 7)}-01`, 40).slice(0, 7);
    expect((await getEveryDayMonth(gus.id, next, today())).days).toEqual([]);

    // The route: signed in, a month, only the person's own days.
    const get = (query: string, cookie = "") =>
      daysRoute.GET(
        new NextRequest(`${ORIGIN}/api/move/days${query}`, {
          headers: cookie ? { cookie } : {},
        }),
      );
    expect((await get(`?month=${month}`)).status).toBe(401);
    session.user = sessionOf(gus);
    expect((await get("?month=2026-13")).status).toBe(400);
    expect((await get("")).status).toBe(400);
    const answer = await get(`?month=${month}`, "cal_tz=Pacific%2FAuckland");
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as EveryDayMonthDto;
    expect(body.days.find((d) => d.date === `${month}-10`)).toMatchObject({ fromPhone: true });
    session.user = sessionOf(await createUser({ timeZone: TZ }));
    const stranger = (await (await get(`?month=${month}`)).json()) as EveryDayMonthDto;
    expect(stranger.days.every((d) => !d.fromPhone && d.steps === null)).toBe(true);
  });
});
