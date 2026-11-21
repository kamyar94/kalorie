// The phone's day totals (Kal for Android 1.2) against Postgres: a batch through the real route
// stores each day's steps, active time and activity calories with their apps and method, sending
// again replaces, an empty day goes, a 1.0 or 1.1 phone keeps working, the update log counts them;
// owner-only reads, the export, Delete my data and the phone's cascade; the goals of the three
// numbers, set and reset in Settings. Every value is made up.
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { activityDayTotals, devices, healthConnectUpdates } from "@/db/schema";
import { deleteUserData, exportUserData } from "@/lib/account/data";
import type { SessionUser } from "@/lib/auth/accounts";
import type { HcSyncResult } from "@/lib/contracts/health-connect";
import { claimLinkCode, createLinkCode, listDevices, phoneAppOf } from "@/lib/devices/service";
import { dayTotalsBetween } from "@/lib/health-connect/day-totals";
import { hasHealthConnectRecords } from "@/lib/health-connect/log";
import { localParts, shiftLocalDate } from "@/lib/meals/time";
import { getMoveGoals, MoveGoalError, setMoveGoal } from "@/lib/move/goals";
import { getTargets, resetTarget } from "@/lib/targets/service";
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

const syncRoute = await import("@/app/api/health-connect/sync/route");
const { setTargetAction } = await import("@/app/(app)/settings/actions");

const ORIGIN = "http://127.0.0.1:3201";
const TZ = "Europe/Berlin";
const SAMSUNG = "com.sec.android.app.shealth";
// A made-up suffix: every phone's step counter has its own.
const PHONE = "com.android.healthconnect.phone.3c4d5e6f";
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

describe("a batch from app 1.2", () => {
  it("stores each day's three numbers with their apps and method; again replaces, empty removes", async () => {
    const ann = await createUser({ timeZone: TZ });
    const token = await linkPhone(ann.id);
    const first = await send(token, {
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
          activeKcal: 455.47,
          kcalApp: SAMSUNG,
        },
        {
          date: day(1),
          steps: 5230,
          stepsApp: PHONE,
          activeMinutes: 33,
          activeMethod: METHOD,
          activeApp: SAMSUNG,
          activeKcal: 0,
          kcalApp: null,
        },
        { date: day(2), steps: 0, activeMinutes: 0, activeMethod: METHOD, activeKcal: 0 },
      ],
    });
    // One step day and two day totals; the empty day is not stored.
    expect(first).toEqual({
      status: 200,
      body: { added: 3, updated: 0, removed: 0, skipped: 0 },
    });
    const stored = await dayTotalsBetween(ann.id, day(5), today());
    expect(stored.map(({ updatedAt: _u, ...t }) => t)).toEqual([
      {
        date: day(1),
        steps: 5230,
        stepsApp: PHONE,
        activeMinutes: 33,
        activeMethod: METHOD,
        activeApp: SAMSUNG,
        activeKcal: 0,
        kcalApp: null,
      },
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
    ]);
    const [row] = await db
      .select()
      .from(activityDayTotals)
      .where(and(eq(activityDayTotals.userId, ann.id), eq(activityDayTotals.localDate, today())));
    expect(row).toMatchObject({ source: "health_connect", tz: TZ });
    expect(row!.activeKcal).toBeCloseTo(455.47, 2);

    // Later the same day: more of everything for today, and yesterday turned out empty.
    const again = await send(token, {
      tz: TZ,
      appVersion: "1.2 (3)",
      dayTotals: [
        {
          date: today(),
          steps: 9040,
          stepsApp: SAMSUNG,
          activeMinutes: 80,
          activeMethod: METHOD,
          activeApp: SAMSUNG,
          activeKcal: 512,
          kcalApp: SAMSUNG,
        },
        { date: day(1), steps: 0, activeMinutes: 0, activeKcal: 0 },
      ],
    });
    expect(again.body).toEqual({ added: 0, updated: 1, removed: 1, skipped: 0 });
    const after = await dayTotalsBetween(ann.id, day(5), today());
    expect(after.map((t) => [t.date, t.steps, t.activeMinutes, t.activeKcal])).toEqual([
      [today(), 9040, 80, 512],
    ]);

    // The update log counts the days with a number; the phone now "sends" them.
    const log = await db
      .select()
      .from(healthConnectUpdates)
      .where(eq(healthConnectUpdates.userId, ann.id))
      .orderBy(healthConnectUpdates.receivedAt);
    expect(log.map((r) => [r.dayTotals, r.empty])).toEqual([
      [2, false],
      [1, false],
    ]);
    const [phone] = await listDevices(ann.id);
    expect(phone!.sends).toEqual(["steps", "day_totals"]);
    expect(phone!.appVersion).toBe("1.2 (3)");
    expect(await phoneAppOf(ann.id)).toBe("current");
  });

  it("keeps a 1.0 or 1.1 phone working and leaves out odd day totals", async () => {
    const ben = await createUser({ timeZone: TZ });
    const token = await linkPhone(ben.id, "1.1 (2)");
    const old = await send(token, {
      tz: TZ,
      appVersion: "1.1 (2)",
      steps: [{ date: today(), count: 4100, sourceApp: PHONE }],
    });
    expect(old).toEqual({ status: 200, body: { added: 1, updated: 0, removed: 0, skipped: 0 } });
    expect(await dayTotalsBetween(ben.id, day(30), today())).toEqual([]);
    expect(await phoneAppOf(ben.id)).toBe("old");
    const odd = await send(token, {
      tz: TZ,
      appVersion: "1.2 (3)",
      dayTotals: [
        { date: today(), steps: 4100, activeMinutes: 2000 },
        { date: "2026-02-30", steps: 10 },
        { date: day(1), steps: 3000, activeMinutes: 25, activeMethod: METHOD },
      ],
    });
    expect(odd.body).toEqual({ added: 1, updated: 0, removed: 0, skipped: 2 });
    expect((await send(token, { tz: TZ, dayTotals: "every day" })).status).toBe(400);
    const tooMany = await send(token, {
      tz: TZ,
      dayTotals: Array.from({ length: 2001 }, () => ({ date: today(), steps: 1 })),
    });
    expect(tooMany.status).toBe(413);
    // The newer app version shows on the phone.
    expect(await phoneAppOf(ben.id)).toBe("current");
  });

  it("is owner-only, in the export, removed by Delete my data and with its phone", async () => {
    const cy = await createUser({ timeZone: TZ });
    const other = await createUser({ timeZone: TZ });
    const token = await linkPhone(cy.id);
    await send(token, {
      tz: TZ,
      dayTotals: [
        { date: today(), steps: 6000, stepsApp: SAMSUNG, activeMinutes: 41, activeMethod: METHOD },
      ],
    });
    expect(await dayTotalsBetween(other.id, day(5), today())).toEqual([]);
    expect(await hasHealthConnectRecords(cy.id)).toBe(true);
    expect(await hasHealthConnectRecords(other.id)).toBe(false);

    const exported = await exportUserData(cy.id);
    expect(exported!.dayTotals).toEqual([
      expect.objectContaining({
        date: today(),
        steps: 6000,
        activeMinutes: 41,
        activeMethod: METHOD,
      }),
    ]);
    expect(JSON.stringify(exported!.dayTotals)).not.toMatch(/deviceId|"id"/);

    await deleteUserData(cy.id);
    expect(await dayTotalsBetween(cy.id, day(5), today())).toEqual([]);

    // A phone's row going takes its day totals with it.
    const dee = await createUser({ timeZone: TZ });
    const deeToken = await linkPhone(dee.id);
    await send(deeToken, { tz: TZ, dayTotals: [{ date: today(), steps: 500 }] });
    await db.delete(devices).where(eq(devices.userId, dee.id));
    expect(await dayTotalsBetween(dee.id, day(5), today())).toEqual([]);
  });
});

describe("the goals of the three numbers", () => {
  it("default to 7,000 steps, 60 min and 500 kcal, and are set and reset in Settings", async () => {
    const eve = await createUser({ timeZone: TZ });
    expect(await getMoveGoals(eve.id)).toEqual({ steps: 7000, activeMinutes: 60, activeKcal: 500 });
    expect((await getTargets(eve.id)).move).toEqual({
      steps: { value: 7000, custom: false },
      activeMinutes: { value: 60, custom: false },
      activeKcal: { value: 500, custom: false },
    });
    await setMoveGoal(eve.id, "steps", 8500.4);
    await expect(setMoveGoal(eve.id, "activeMinutes", 2)).rejects.toThrow(MoveGoalError);
    await expect(setMoveGoal(eve.id, "activeKcal", Number.NaN)).rejects.toThrow(
      "Give a goal from 25 to 5,000 kcal.",
    );
    expect(await getMoveGoals(eve.id)).toEqual({ steps: 8500, activeMinutes: 60, activeKcal: 500 });

    session.user = sessionOf(eve);
    const saved = await setTargetAction("move_active_kcal", 650);
    expect(saved.ok && saved.data.move.activeKcal).toEqual({ value: 650, custom: true });
    expect(await setTargetAction("move_active_minutes", 9999)).toEqual({
      ok: false,
      error: "Give a goal from 5 to 600 min.",
    });
    const reset = await setTargetAction("move_steps", null);
    expect(reset.ok && reset.data.move.steps).toEqual({ value: 7000, custom: false });
    await setMoveGoal(eve.id, "steps", 9000);

    // The export has them with the other targets.
    const exported = await exportUserData(eve.id);
    expect(exported!.targets.map((t) => [t.code, t.target]).sort()).toEqual([
      ["move_active_kcal", 650],
      ["move_steps", 9000],
    ]);
    await resetTarget(eve.id, "move_active_kcal");
    expect((await getMoveGoals(eve.id)).activeKcal).toBe(500);
  });
});
