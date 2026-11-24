import { describe, expect, it } from "vitest";

import { localParts, shiftLocalDate } from "@/lib/meals/time";

import { dayHeading, fallbackTime, slotAt, timeProblem } from "./times";

const TZ = "Europe/Berlin";
const now = new Date();
const today = localParts(now, TZ).date;

describe("fallbackTime", () => {
  it("is the time the photos were picked, today or without a day", () => {
    expect(fallbackTime(null, now, TZ)).toBe(now);
    expect(fallbackTime(today, now, TZ)).toBe(now);
  });

  it("is 12:00 of an earlier day", () => {
    const day = shiftLocalDate(today, -3);
    const at = fallbackTime(day, now, TZ);
    expect(localParts(at, TZ)).toMatchObject({ date: day, time: "12:00" });
  });
});

describe("slotAt", () => {
  it("names the meal by its time and the person's windows, brunch when the note says so", () => {
    const on = (time: string) => {
      const [h, m] = time.split(":").map(Number);
      const d = new Date(now);
      d.setUTCHours(h!, m!, 0, 0);
      return d;
    };
    expect(slotAt(on("08:12"), "UTC", null)).toBe("breakfast");
    expect(slotAt(on("12:47"), "UTC", null)).toBe("lunch");
    expect(slotAt(on("16:05"), "UTC", null)).toBe("snack");
    expect(slotAt(on("19:52"), "UTC", null)).toBe("dinner");
    expect(slotAt(on("11:30"), "UTC", null, "a late brunch")).toBe("brunch");
    expect(
      slotAt(on("16:05"), "UTC", {
        breakfast: ["06:00", "09:00"],
        lunch: ["12:00", "14:00"],
        dinner: ["16:00", "20:00"],
      }),
    ).toBe("dinner");
  });
});

describe("timeProblem", () => {
  it("flags a time still to come and one more than a year ago", () => {
    expect(timeProblem(now, now, TZ)).toBeNull();
    expect(timeProblem(new Date(now.getTime() + 30_000), now, TZ)).toBeNull();
    expect(timeProblem(new Date(now.getTime() + 5 * 60_000), now, TZ)).toBe("future");
    expect(timeProblem(new Date(now.getTime() - 300 * 86_400_000), now, TZ)).toBeNull();
    expect(timeProblem(new Date(now.getTime() - 400 * 86_400_000), now, TZ)).toBe("old");
  });
});

describe("dayHeading", () => {
  it("says Today and Yesterday, else the weekday, with the year when not this one", () => {
    expect(dayHeading(today, today)).toMatch(/^Today, [A-Z][a-z]+ \d{1,2}$/);
    expect(dayHeading(shiftLocalDate(today, -1), today)).toMatch(/^Yesterday, /);
    expect(dayHeading("2025-11-21", "2026-11-23")).toBe("Friday, November 21, 2025");
    expect(dayHeading("2026-11-20", "2026-11-23")).toBe("Friday, November 20");
  });
});
