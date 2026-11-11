import { describe, expect, it } from "vitest";

import { localParts, shiftLocalDate } from "@/lib/meals/time";

import { EARLIER_DAY_TIME, oneTapTime } from "./log-time";

const TZ = "America/New_York";

describe("the time of a one-tap log", () => {
  it("is now on today's screen", () => {
    const now = new Date();
    const today = localParts(now, TZ).date;
    expect(oneTapTime(today, today, TZ, now)).toBe(now.toISOString());
  });

  it("is 12:00 of the day shown on an earlier day, in that day's time zone", () => {
    const now = new Date();
    const today = localParts(now, TZ).date;
    const earlier = shiftLocalDate(today, -3);
    const at = new Date(oneTapTime(earlier, today, TZ, now));
    expect(localParts(at, TZ)).toMatchObject({ date: earlier, time: EARLIER_DAY_TIME });
  });
});
