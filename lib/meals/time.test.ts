import { describe, expect, it } from "vitest";

import {
  isLocalDate,
  isValidTimeZone,
  localParts,
  shiftLocalDate,
  slotFor,
  slotForMinutes,
  type MealWindows,
} from "./time";

const at = (h: number, m: number) => h * 60 + m;

describe("meal slots", () => {
  it("uses the default windows with both ends included", () => {
    expect(slotForMinutes(at(4, 0))).toBe("breakfast");
    expect(slotForMinutes(at(10, 30))).toBe("breakfast");
    expect(slotForMinutes(at(10, 45))).toBe("snack");
    expect(slotForMinutes(at(11, 0))).toBe("lunch");
    expect(slotForMinutes(at(15, 0))).toBe("lunch");
    expect(slotForMinutes(at(16, 0))).toBe("snack");
    expect(slotForMinutes(at(21, 30))).toBe("dinner");
    expect(slotForMinutes(at(23, 0))).toBe("snack");
    expect(slotForMinutes(at(2, 0))).toBe("snack");
  });

  it("follows the person's own windows, also across midnight", () => {
    const late: MealWindows = {
      breakfast: ["09:00", "11:00"],
      lunch: ["13:00", "16:00"],
      dinner: ["21:00", "01:00"],
    };
    expect(slotForMinutes(at(8, 0), late)).toBe("snack");
    expect(slotForMinutes(at(23, 30), late)).toBe("dinner");
    expect(slotForMinutes(at(0, 30), late)).toBe("dinner");
  });

  it("reads the local time in the meal's time zone", () => {
    const moment = new Date("2026-10-31T05:00:00Z");
    expect(slotFor(moment, "UTC")).toBe("breakfast");
    expect(slotFor(moment, "Asia/Tehran")).toBe("breakfast"); // 08:30
    expect(slotFor(moment, "America/New_York")).toBe("snack"); // 01:00
    expect(localParts(moment, "Asia/Tehran")).toEqual({
      date: "2026-10-31",
      time: "08:30",
      minutes: 510,
    });
    expect(localParts(new Date("2026-10-31T22:30:00Z"), "Asia/Tehran").date).toBe("2026-11-01");
  });
});

describe("dates and zones", () => {
  it("checks time zones and calendar dates", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("Mars/Base")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isLocalDate("2026-02-28")).toBe(true);
    expect(isLocalDate("2026-02-30")).toBe(false);
    expect(isLocalDate("26-1-1")).toBe(false);
  });

  it("moves a day back and forth across month ends", () => {
    expect(shiftLocalDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftLocalDate("2026-12-31", 1)).toBe("2027-01-01");
  });
});
