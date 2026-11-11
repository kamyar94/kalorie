// Export files read on the device (lib/imports): CSV, dates in their many spellings, the ZIP
// reader, Samsung Health's files (metadata line, prefixed columns, steps per day, exercise
// sessions), the column-mapping step, and reading picked files into datasets.
import { describe, expect, it } from "vitest";

import { parseImportedActivity } from "@/lib/activities/parse";
import { parseCsv, csvSeparator } from "@/lib/imports/csv";
import { guessDateOrder, parseMoment, parseNumber } from "@/lib/imports/dates";
import { applyMapping, guessMapping, parseDuration } from "@/lib/imports/mapping";
import { readImportFiles, type ActivityDataset } from "@/lib/imports/read";
import {
  columnName,
  offsetMinutes,
  samsungExercise,
  samsungExercises,
  samsungSteps,
  samsungTable,
  samsungTypeOf,
} from "@/lib/imports/samsung";
import { listZipEntries, readZipEntry } from "@/lib/imports/zip";
import {
  exerciseCsv,
  pedometerCsv,
  samsungFileName,
  samsungZip,
} from "@/tests/helpers/samsung-export";
import { makeZip } from "@/tests/helpers/zip";

const file = (name: string, data: string | Buffer) =>
  Object.assign(new Blob([typeof data === "string" ? data : new Uint8Array(data)]), {
    name,
  }) as Blob & { name: string };

describe("CSV", () => {
  it("reads quotes, doubled quotes, line breaks in quotes, CRLF and a byte-order mark", () => {
    expect(parseCsv('﻿a,b,c\r\n1,"two, 2","say ""hi"""\n"x\ny",,z\n\n')).toEqual([
      ["a", "b", "c"],
      ["1", "two, 2", 'say "hi"'],
      ["x\ny", "", "z"],
    ]);
  });

  it("recognises semicolon and tab files by their first line", () => {
    expect(csvSeparator("date;weight;fat\n1;2;3")).toBe(";");
    expect(parseCsv("date;weight\n2026-11-01;79,6")).toEqual([
      ["date", "weight"],
      ["2026-11-01", "79,6"],
    ]);
    expect(csvSeparator("a\tb\tc")).toBe("\t");
  });
});

describe("dates and numbers", () => {
  const tz = "Europe/Berlin";

  it("reads ISO, year-first, day-first, month-first, 12-hour clocks, zones and epochs", () => {
    const at = (text: string, order: "ymd" | "dmy" | "mdy" = "ymd") =>
      parseMoment(text, order, tz)?.at.toISOString();
    expect(at("2024-05-01 07:30:00.000")).toBe("2024-05-01T05:30:00.000Z");
    expect(at("2024/05/01 07:30")).toBe("2024-05-01T05:30:00.000Z");
    expect(at("2024.05.01")).toBe("2024-05-01T10:00:00.000Z");
    expect(at("2024-05-01T07:30:00Z")).toBe("2024-05-01T07:30:00.000Z");
    expect(at("2024-05-01 07:30 UTC+0200")).toBe("2024-05-01T05:30:00.000Z");
    expect(at("14/11/2023, 7:59:12 AM", "dmy")).toBe("2023-11-14T06:59:00.000Z");
    expect(at("11/14/2023 7:59 PM", "mdy")).toBe("2023-11-14T18:59:00.000Z");
    expect(at("1714548600000")).toBe("2024-05-01T07:30:00.000Z");
    expect(at("1714548600")).toBe("2024-05-01T07:30:00.000Z");
    expect(parseMoment("2024-05-01", "ymd", tz)?.date).toBe("2024-05-01");
    expect(at("31/02/2024", "dmy")).toBeUndefined();
    expect(at("yesterday")).toBeUndefined();
    expect(at("2024-05-01 25:00")).toBeUndefined();
  });

  it("guesses day-first or month-first from the values", () => {
    expect(guessDateOrder(["01/05/2024", "14/05/2024"])).toBe("dmy");
    expect(guessDateOrder(["05/01/2024", "05/14/2024"])).toBe("mdy");
    expect(guessDateOrder(["05/01/2024"], "dmy")).toBe("dmy");
    expect(guessDateOrder(["2024-05-01"])).toBe("ymd");
  });

  it("reads numbers with thousands separators, decimal commas, units and dashes", () => {
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("79,6")).toBe(79.6);
    expect(parseNumber(" 79.6 kg ")).toBe(79.6);
    expect(parseNumber("--")).toBeNull();
    expect(parseNumber("")).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
  });
});

describe("ZIP reader", () => {
  it("lists entries and inflates deflated and stored ones, ZIP64 fields included", async () => {
    for (const zip64 of [false, true]) {
      const blob = new Blob([
        makeZip(
          [
            { name: "folder/a.csv", data: "x,y\n1,2\n".repeat(200) },
            { name: "b.txt", data: "plain", method: "store" },
          ],
          { zip64 },
        ),
      ]);
      const entries = await listZipEntries(blob);
      expect(entries.map((e) => e.name)).toEqual(["folder/a.csv", "b.txt"]);
      const text = new TextDecoder().decode(await readZipEntry(blob, entries[0]!));
      expect(text).toBe("x,y\n1,2\n".repeat(200));
      expect(new TextDecoder().decode(await readZipEntry(blob, entries[1]!))).toBe("plain");
    }
  });

  it("refuses something that is not a ZIP file", async () => {
    await expect(listZipEntries(new Blob(["not a zip at all, just text"]))).rejects.toThrow(
      /not a ZIP/,
    );
  });
});

describe("Samsung Health files", () => {
  const tz = "Europe/Berlin";

  it("finds the data type in the file name and drops prefixes from the columns", () => {
    expect(
      samsungTypeOf("com.samsung.shealth.tracker.pedometer_day_summary.20240501123000.csv"),
    ).toBe("tracker.pedometer_day_summary");
    expect(samsungTypeOf("com.samsung.health.weight.202405011230.csv")).toBe("weight");
    expect(samsungTypeOf("steps.csv")).toBeNull();
    expect(columnName("com.samsung.health.exercise.start_time")).toBe("start_time");
    expect(offsetMinutes("UTC+0200")).toBe(120);
    expect(offsetMinutes("UTC-0330")).toBe(-210);
    expect(offsetMinutes("")).toBeNull();
  });

  it("reads steps per day, the highest count of a day when two devices report it", () => {
    const rows = parseCsv(
      pedometerCsv([
        { date: "2024-05-01", steps: 6240, device: "phone" },
        { date: "2024-05-01", steps: 8100, device: "watch" },
        { date: "2024-05-02", steps: 10250 },
        { date: "2024-05-03", steps: 0 },
      ]),
    );
    const table = samsungTable(rows, samsungFileName("tracker.pedometer_day_summary"))!;
    expect(table.type).toBe("tracker.pedometer_day_summary");
    const steps = samsungSteps(table, tz);
    expect(steps.map((s) => [s.localDate, s.steps, s.externalId])).toEqual([
      ["2024-05-01", 8100, "samsung:steps:2024-05-01"],
      ["2024-05-02", 10250, "samsung:steps:2024-05-02"],
    ]);
    expect(steps[0]).toMatchObject({
      category: "walking",
      type: "steps",
      sourceApp: "samsung-health",
      durationMin: null,
      distanceM: 6075,
      energyKcal: 324,
    });
  });

  it("reads the daily trend from its merged rows only", () => {
    const rows = parseCsv(
      [
        "com.samsung.shealth.step_daily_trend,6315012,8",
        "count,day_time,source_type,distance,calorie,deviceuuid",
        `5000,${Date.parse("2024-05-01T00:00:00Z")},0,3000,200,phone`,
        `7000,${Date.parse("2024-05-01T00:00:00Z")},-2,4500,300,all`,
        `9000,${Date.parse("2024-05-01T00:00:00Z")},1,5000,310,watch`,
      ].join("\n"),
    );
    const steps = samsungSteps(samsungTable(rows)!, tz);
    expect(steps.map((s) => s.steps)).toEqual([7000]);
  });

  it("reads exercise sessions: duration, local day from the offset, type, kcal and distance", () => {
    const start = new Date("2024-05-01T22:30:00Z");
    const rows = parseCsv(
      exerciseCsv([
        {
          uuid: "ex-1",
          start,
          minutes: 45,
          type: 1002,
          kcal: 410,
          distance: 6100,
          offset: "UTC+0200",
        },
        { uuid: "ex-2", start: new Date("2024-05-03T06:00:00Z"), minutes: 30, type: 10012 },
        { uuid: "ex-3", start: new Date("2024-05-04T06:00:00Z"), minutes: 20, type: 99999 },
        { uuid: "ex-4", start: new Date("2024-05-05T06:00:00Z"), minutes: 0, type: 1001 },
      ]),
    );
    const table = samsungTable(rows, samsungFileName("exercise", "health"))!;
    const sessions = samsungExercises(table, tz);
    expect(sessions).toHaveLength(3);
    expect(sessions[0]).toMatchObject({
      externalId: "samsung:exercise:ex-1",
      title: "Running",
      category: "cardio",
      intensity: "vigorous",
      localDate: "2024-05-02",
      tz: "Etc/GMT-2",
      durationMin: 45,
      energyKcal: 410,
      distanceM: 6100,
    });
    expect(sessions[1]).toMatchObject({ category: "strength", title: "Strength exercise" });
    expect(sessions[2]).toMatchObject({ category: "other", title: "Exercise" });
    expect(samsungExercise(15006).label).toBe("Elliptical trainer");
    // What the browser sends passes the server's check.
    for (const s of sessions)
      expect(parseImportedActivity(s, Date.parse("2024-06-01T00:00:00Z"))).toMatchObject({
        externalId: s.externalId,
      });
  });
});

describe("the column-mapping step", () => {
  it("guesses columns by name and reads steps per day", () => {
    const rows = parseCsv("Date,Step count,Distance (km)\n10/11/2024,8900,6.4\n11/11/2024,,\n");
    const [headers, ...body] = rows;
    const mapping = guessMapping(headers!, body);
    expect(mapping).toMatchObject({ kind: "steps", date: 0, fields: { steps: 1, distance_km: 2 } });
    const read = applyMapping(body, { ...mapping, order: "dmy" }, "UTC");
    expect(read.skipped).toBe(1);
    expect(read.activities).toEqual([
      expect.objectContaining({
        externalId: "file:steps:2024-11-10",
        steps: 8900,
        distanceM: 6400,
        sourceApp: "file",
      }),
    ]);
  });

  it("reads workouts with durations as minutes or clock times and a category from the name", () => {
    const rows = parseCsv(
      "Start,Activity,Duration,Calories\n2024-11-10 07:30,Morning run,0:45:00,410\n2024-11-11 18:00,Yoga,30,\n",
    );
    const [headers, ...body] = rows;
    const mapping = guessMapping(headers!, body);
    expect(mapping).toMatchObject({ kind: "workouts", fields: { duration: 2, title: 1, kcal: 3 } });
    const read = applyMapping(body, mapping, "UTC");
    expect(read.activities.map((a) => [a.title, a.category, a.durationMin, a.energyKcal])).toEqual([
      ["Morning run", "cardio", 45, 410],
      ["Yoga", "mobility", 30, null],
    ]);
    expect(parseDuration("1:05:30")).toBeCloseTo(65.5);
    expect(parseDuration("05:30")).toBeCloseTo(5.5);
  });
});

describe("reading picked files", () => {
  it("reads a Samsung Health zip: the day summary over the trend, exercise, nothing else", async () => {
    const zip = samsungZip({
      [samsungFileName("tracker.pedometer_day_summary")]: pedometerCsv([
        { date: "2024-05-01", steps: 8100 },
        { date: "2024-05-02", steps: 4000 },
      ]),
      [samsungFileName("step_daily_trend")]:
        "com.samsung.shealth.step_daily_trend,1,2\ncount,day_time\n1,2\n",
      [samsungFileName("exercise", "health")]: exerciseCsv([
        { uuid: "ex-1", start: new Date("2024-05-01T07:00:00Z"), minutes: 40, type: 1001 },
      ]),
      [samsungFileName("sleep")]: "com.samsung.shealth.sleep,1,2\nstart_time,end_time\n",
      "jsons/readme.txt": "not a csv",
    });
    const result = await readImportFiles([file("export.zip", zip)], "UTC");
    expect(result.notes).toEqual([]);
    const datasets = result.datasets as ActivityDataset[];
    expect(datasets.map((d) => [d.what, d.label, d.first, d.last])).toEqual([
      ["steps", "Steps: 2 days", "2024-05-01", "2024-05-02"],
      ["workouts", "Workouts: 1 session", "2024-05-01", "2024-05-01"],
    ]);
  });

  it("reads loose Samsung CSV files, sends unknown layouts to the mapping, notes the rest", async () => {
    const result = await readImportFiles(
      [
        file(
          samsungFileName("tracker.pedometer_day_summary"),
          pedometerCsv([{ date: "2024-05-01", steps: 5000 }]),
        ),
        file("my-watch.csv", "Day,Steps\n2024-05-01,7000\n"),
        file("empty.csv", ""),
        file("broken.zip", "PK\u0003\u0004 then nothing"),
      ],
      "UTC",
    );
    expect(result.datasets.map((d) => [d.kind, d.fileName])).toEqual([
      ["activities", samsungFileName("tracker.pedometer_day_summary")],
      ["unknown", "my-watch.csv"],
    ]);
    expect(result.notes).toEqual([
      "empty.csv has no rows to import.",
      expect.stringMatching(/^broken\.zip: /),
    ]);
  });
});
