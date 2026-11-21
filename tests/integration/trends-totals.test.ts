// Trends and Your year with the phone's day totals (Kal for Android 1.2) against Postgres: the
// phone's active time and activity calories where it sent them, Move's rules elsewhere, the
// person's goals, and the year's active minutes against the active time goal. Values are made up.
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { activities } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/accounts";
import type { HcSyncResult } from "@/lib/contracts/health-connect";
import { claimLinkCode, createLinkCode } from "@/lib/devices/service";
import { localParts, shiftLocalDate } from "@/lib/meals/time";
import { setMoveGoal } from "@/lib/move/goals";
import { getTrends } from "@/lib/trends/service";
import { getYear } from "@/lib/trends/year-service";
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

beforeEach(async () => {
  session.user = null;
  await db.execute(sql`delete from rate_limits`);
});

describe("Trends and the year with the phone's numbers", () => {
  it("use the phone's active time and calories where it sent them, Move's rules elsewhere", async () => {
    const hal = await createUser({ timeZone: TZ });
    const token = await linkPhone(hal.id);
    await send(token, {
      tz: TZ,
      steps: [{ date: day(1), count: 7310, sourceApp: SAMSUNG }],
      dayTotals: [
        {
          date: day(1),
          steps: 7310,
          stepsApp: SAMSUNG,
          activeMinutes: 64,
          activeMethod: METHOD,
          activeApp: SAMSUNG,
          activeKcal: 520,
          kcalApp: SAMSUNG,
        },
      ],
    });
    await db.insert(activities).values({
      userId: hal.id,
      category: "strength",
      type: "weights",
      title: "Strength",
      startedAt: new Date(`${day(2)}T17:00:00Z`),
      tz: TZ,
      localDate: day(2),
      durationMin: 40,
      intensity: "moderate",
      energyKcal: 180,
    });
    await setMoveGoal(hal.id, "activeMinutes", 45);
    const trends = await getTrends(hal.id, "week", today());
    const a = trends.activity;
    expect(a.goals).toEqual({ steps: 7000, activeMinutes: 45, activeKcal: 500 });
    expect(a.phoneDays).toBe(1);
    expect(a.days.find((d) => d.date === day(1))).toMatchObject({
      fromPhone: true,
      steps: 7310,
      activeMinutes: 64,
      energyKcal: 520,
    });
    expect(a.days.find((d) => d.date === day(2))).toMatchObject({
      fromPhone: false,
      activeMinutes: 40,
      energyKcal: 180,
    });
    expect(a.averageMinutes).toBe((64 + 40) / 2);
    expect(a.averageEnergy).toBe((520 + 180) / 2);

    // The year: the phone's numbers where present; active minutes against the active time goal.
    const year = Number(today().slice(0, 4));
    const withPhone = await getYear(hal.id, {
      year: String(year),
      metric: "active_minutes",
      today: today(),
    });
    expect(withPhone.activeGoal).toEqual({ minutes: 45, fromPhone: true });
    const phoneDay = withPhone.days.find((d) => d.date === day(1));
    // Days of another year (the first days of January) are not in this one.
    if (day(1).startsWith(String(year))) {
      expect(phoneDay).toMatchObject({ activity: true, phoneMinutes: 64, phoneKcal: 520 });
    }
    const bo = await createUser({ timeZone: TZ });
    const without = await getYear(bo.id, {
      year: String(year),
      metric: "active_minutes",
      today: today(),
    });
    expect(without.activeGoal).toEqual({ minutes: 150 / 7, fromPhone: false });
    // Owner-only.
    expect(without.days).toEqual([]);
  });
});
