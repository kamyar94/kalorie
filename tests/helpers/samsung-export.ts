// Samsung Health export files for tests, in the layout lib/imports/samsung.ts reads: a metadata
// first line, then column names (with or without the data type prefix), UTC times
// "YYYY-MM-DD HH:MM:SS.SSS" with a time_offset column, day summaries keyed by their UTC midnight in
// ms. Dates are passed in, so callers compute them from now.
import { makeZip } from "./zip";

const stamp = "20261110093000";
const utc = (at: Date) => at.toISOString().replace("T", " ").replace("Z", "");

export const samsungFileName = (type: string, health = "shealth") =>
  `com.samsung.${health}.${type}.${stamp}.csv`;

/** tracker.pedometer_day_summary: one row per day and device (the highest count wins). */
export const pedometerCsv = (days: { date: string; steps: number; device?: string }[]) =>
  [
    "com.samsung.shealth.tracker.pedometer_day_summary,6315012,20",
    "create_sh_ver,step_count,binning_data,active_time,recommendation,run_step_count,update_time,source_package_name,create_time,source_info,speed,distance,calorie,walk_step_count,deviceuuid,day_time,healthy_step,achievement,datauuid,pkg_name",
    ...days.map((d, i) =>
      [
        "6315012",
        d.steps,
        "",
        "3600000",
        "6000",
        "0",
        `${d.date} 23:00:00.000`,
        "com.sec.android.app.shealth",
        `${d.date} 23:00:00.000`,
        "",
        "1.3",
        Math.round(d.steps * 0.75),
        Math.round(d.steps * 0.04),
        d.steps,
        d.device ?? "phone",
        Date.parse(`${d.date}T00:00:00Z`),
        "0",
        "",
        `uuid-steps-${i}`,
        "com.sec.android.app.shealth",
      ].join(","),
    ),
  ].join("\n");

/** exercise, with the prefixed column names. */
export const exerciseCsv = (
  sessions: {
    uuid: string;
    start: Date;
    minutes: number;
    type: number;
    kcal?: number;
    distance?: number;
    offset?: string;
  }[],
) => {
  const p = "com.samsung.health.exercise.";
  return [
    "com.samsung.health.exercise,6315012,25",
    [
      `${p}start_time`,
      `${p}end_time`,
      `${p}time_offset`,
      `${p}duration`,
      `${p}exercise_type`,
      `${p}calorie`,
      `${p}distance`,
      `${p}mean_heart_rate`,
      `${p}datauuid`,
      `${p}deviceuuid`,
      "",
    ].join(","),
    ...sessions.map((s) =>
      [
        utc(s.start),
        utc(new Date(s.start.getTime() + s.minutes * 60_000)),
        s.offset ?? "UTC+0000",
        s.minutes * 60_000,
        s.type,
        s.kcal ?? "",
        s.distance ?? "",
        "121.5",
        s.uuid,
        "watch",
        "",
      ].join(","),
    ),
  ].join("\n");
};

/** A "Download personal data" zip with the given CSV files under its usual folder. */
export const samsungZip = (files: Record<string, string>) =>
  makeZip(
    Object.entries(files).map(([name, data]) => ({
      name: `samsunghealth_export_${stamp}/${name}`,
      data,
    })),
  );
