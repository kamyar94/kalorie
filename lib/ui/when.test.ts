import { describe, expect, it } from "vitest";

import { localParts, shiftLocalDate } from "@/lib/meals/time";

import {
  mealTime,
  oldestDay,
  parseWhenInputs,
  whenForChoice,
  whenInputs,
  whenLabel,
  whenSpoken,
} from "./when";

const TZ = "Europe/Berlin";
/** A moment at a wall-clock time today (in TZ), relative to the real day so the test never ages. */
const todayAt = (time: string, days = 0) => {
  const date = shiftLocalDate(localParts(new Date(), TZ).date, days);
  const at = parseWhenInputs(date, time, TZ, new Date(Date.now() + 3 * 86_400_000));
  if ("error" in at) throw new Error(at.error);
  return at.at;
};

describe("the When sheet's quick choices", () => {
  it("counts back from now", () => {
    const now = todayAt("14:00");
    expect(whenForChoice("now", now, TZ)).toEqual(now);
    expect(whenInputs(whenForChoice("30min", now, TZ)!, TZ).time).toBe("13:30");
    expect(whenInputs(whenForChoice("1h", now, TZ)!, TZ).time).toBe("13:00");
    expect(whenInputs(whenForChoice("2h", now, TZ)!, TZ).time).toBe("12:00");
  });

  it("puts this morning at 08:00 today, and offers it only once it has passed", () => {
    const afternoon = todayAt("14:00");
    expect(whenInputs(whenForChoice("morning", afternoon, TZ)!, TZ)).toEqual(
      whenInputs(todayAt("08:00"), TZ),
    );
    expect(whenForChoice("morning", todayAt("06:30"), TZ)).toBeNull();
  });

  it("puts yesterday at the same clock time a day earlier", () => {
    const now = todayAt("19:30");
    const yesterday = whenForChoice("yesterday", now, TZ)!;
    expect(whenInputs(yesterday, TZ)).toEqual({
      date: shiftLocalDate(whenInputs(now, TZ).date, -1),
      time: "19:30",
    });
  });
});

describe("the date and time fields", () => {
  it("give the moment in the time zone", () => {
    const now = todayAt("20:00");
    const { date } = whenInputs(now, TZ);
    const parsed = parseWhenInputs(date, "12:15", TZ, now);
    expect("at" in parsed && whenInputs(parsed.at, TZ)).toEqual({ date, time: "12:15" });
  });

  it("refuse the future, more than a year back, and half-filled fields", () => {
    const now = todayAt("12:00");
    const { date } = whenInputs(now, TZ);
    expect(parseWhenInputs(date, "12:30", TZ, now)).toEqual({
      error: "That time is still to come. Pick an earlier one.",
    });
    expect(parseWhenInputs(shiftLocalDate(date, 1), "08:00", TZ, now)).toMatchObject({
      error: expect.stringContaining("still to come"),
    });
    expect(parseWhenInputs(shiftLocalDate(oldestDay(now, TZ), -1), "08:00", TZ, now)).toEqual({
      error: "Pick a day within the last year.",
    });
    expect(parseWhenInputs(oldestDay(now, TZ), "08:00", TZ, now)).toHaveProperty("at");
    expect(parseWhenInputs("", "08:00", TZ, now)).toEqual({ error: "Pick a day and a time." });
    expect(parseWhenInputs(date, "", TZ, now)).toEqual({ error: "Pick a day and a time." });
  });
});

describe("the When chip", () => {
  it("reads Now until a time is chosen, then today, yesterday or the day", () => {
    const now = todayAt("20:00");
    expect(whenLabel(null, now, TZ)).toBe("Now");
    expect(whenSpoken(null, now, TZ)).toBe("now");
    expect(whenLabel(todayAt("12:15"), now, TZ)).toBe("Today, 12:15");
    expect(whenLabel(todayAt("19:30", -1), now, TZ)).toBe("Yesterday, 19:30");
    expect(whenSpoken(todayAt("19:30", -1), now, TZ)).toBe("yesterday at 19:30");

    const earlier = todayAt("19:30", -3);
    const day = new Date(`${whenInputs(earlier, TZ).date}T12:00:00Z`);
    const weekday = day.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    const month = day.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
    expect(whenLabel(earlier, now, TZ)).toBe(`${weekday} ${day.getUTCDate()} ${month}, 19:30`);
    expect(whenSpoken(earlier, now, TZ)).toMatch(/^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+ at 19:30$/);
  });
});

describe("the time a new meal is logged at", () => {
  it("prefers the chosen time, then the first photo, then the moment it is sent", () => {
    const chosen = new Date(Date.now() - 3_600_000);
    const photo = new Date(Date.now() - 600_000);
    const sent = new Date();
    expect(mealTime(chosen, photo, sent)).toBe(chosen);
    expect(mealTime(null, photo, sent)).toBe(photo);
    expect(mealTime(null, null, sent)).toBe(sent);
  });
});
