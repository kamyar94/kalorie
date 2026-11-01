// openGym's account state (GET /api/data -> {state, rev}) as weigh-ins and workouts, and the
// workout energy estimate. Pure code. Shapes from openGym's api/openapi.yaml (main branch,
// info.version 1.4.3, read 31 Oct 2026):
//   State.unit "kg" | "lb"; State.bodyweight[] {d: ISO date, w: weight in unit, t: ms};
//   State.workouts[] {id, d: ISO day, start: ms, end: ms, name, bw: body weight in unit,
//     entries[] {id: exercise id, sets[]}}; State.customEx[] (user exercises, {id, name});
//   State.deleted: removal stamps (weigh-ins by day). There is no duration field: a workout
//   lasts from start to end.
//
// Energy (labelled as an estimate everywhere it is shown): MET x body weight (kg) x hours. MET
// values from the 2024 Adult Compendium of Physical Activities, conditioning exercise
// (pacompendium.com/conditioning-exercise): resistance training, multiple exercises, 8-15
// repetitions 3.5 (code 02054, the default for gym workouts); circuit training 7.5 (02040);
// stationary rowing, moderate 5.0 (02071); elliptical, moderate 5.0 (02048); high intensity
// interval training, moderate 7.0 (02210); yoga, hatha 2.3 (02150); stretching, mild 2.3 (02101).
import type { WeightPointDto } from "@/lib/contracts/integrations";

export const LB_TO_KG = 0.45359237;

export type MetRule = { words: RegExp; met: number; code: string };

export const MET_RULES: MetRule[] = [
  { words: /\b(hiit|interval|tabata)\b/i, met: 7.0, code: "02210" },
  { words: /\b(circuit|kettlebell)/i, met: 7.5, code: "02040" },
  { words: /\b(row|rowing|erg)\b/i, met: 5.0, code: "02071" },
  { words: /\belliptical\b/i, met: 5.0, code: "02048" },
  { words: /\byoga\b/i, met: 2.3, code: "02150" },
  { words: /\b(stretch|stretching|mobility)\b/i, met: 2.3, code: "02101" },
];

/** Resistance (weight) training, multiple exercises, 8-15 repetitions. */
export const DEFAULT_MET = { met: 3.5, code: "02054" };

export const metFor = (name: string) => MET_RULES.find((r) => r.words.test(name)) ?? DEFAULT_MET;

/** kcal = MET x kg x hours, rounded; null without a weight or a duration. */
export const workoutKcal = (met: number, kg: number | null, minutes: number | null) =>
  kg && kg > 0 && minutes && minutes > 0 ? Math.round(met * kg * (minutes / 60)) : null;

export type CachedWorkout = {
  id: string;
  date: string;
  /** ms since epoch, null when unknown. */
  start: number | null;
  durationMin: number | null;
  name: string;
  exercises: string[];
  /** Body weight logged with the workout, kg. */
  bwKg: number | null;
};

export type OpenGymSnapshot = {
  unit: "kg" | "lb";
  weights: WeightPointDto[];
  workouts: CachedWorkout[];
  latestWeight: WeightPointDto | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const round1 = (value: number) => Math.round(value * 10) / 10;

/** "bench-press" or "bench_press" -> "Bench press". */
export const exerciseName = (id: string, custom: Map<string, string>) => {
  const known = custom.get(id);
  if (known) return known;
  const words = id.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Exercise";
};

/** Weigh-ins (one per day, the last), the latest one, and recent workouts from the state. */
export const parseState = (
  state: unknown,
  options: { weightDays?: number; workoutDays?: number; now?: Date } = {},
): OpenGymSnapshot => {
  const now = options.now ?? new Date();
  const record = (state && typeof state === "object" ? state : {}) as Record<string, unknown>;
  const unit = record.unit === "lb" ? "lb" : "kg";
  const toKg = (value: number) => (unit === "lb" ? value * LB_TO_KG : value);
  const since = (days: number) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const weightFrom = since(options.weightDays ?? 730);
  const workoutFrom = since(options.workoutDays ?? 120);

  // Weigh-ins removed in openGym are stamped under deleted (a negative stamp is an add-back).
  // Removal stamps per list and entry key (weigh-ins by day, workouts by id).
  const deleted = (record.deleted ?? {}) as Record<string, unknown>;
  const removed = (list: string) =>
    new Set(
      Object.entries((deleted[list] ?? {}) as Record<string, unknown>)
        .filter(([, stamp]) => typeof stamp === "number" && stamp > 0)
        .map(([key]) => key),
    );
  const removedDays = removed("bodyweight");
  const removedWorkouts = removed("workouts");

  const byDay = new Map<string, { t: number; kg: number }>();
  for (const raw of Array.isArray(record.bodyweight) ? record.bodyweight : []) {
    const entry = raw as Record<string, unknown>;
    const date = typeof entry.d === "string" ? entry.d.slice(0, 10) : "";
    const weight = num(entry.w);
    if (
      !DATE.test(date) ||
      weight === null ||
      weight <= 0 ||
      date < weightFrom ||
      removedDays.has(date)
    )
      continue;
    const kg = toKg(weight);
    if (kg < 20 || kg > 400) continue;
    const t = num(entry.t) ?? 0;
    const current = byDay.get(date);
    if (!current || t >= current.t) byDay.set(date, { t, kg });
  }
  const weights = [...byDay.entries()]
    .map(([date, v]) => ({ date, kg: round1(v.kg) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const custom = new Map<string, string>();
  for (const raw of Array.isArray(record.customEx) ? record.customEx : []) {
    const entry = raw as Record<string, unknown>;
    if (typeof entry.id === "string" && typeof entry.name === "string")
      custom.set(entry.id, entry.name.slice(0, 80));
  }

  const workouts: CachedWorkout[] = [];
  for (const raw of Array.isArray(record.workouts) ? record.workouts : []) {
    const entry = raw as Record<string, unknown>;
    const date = typeof entry.d === "string" ? entry.d.slice(0, 10) : "";
    if (!DATE.test(date) || date < workoutFrom) continue;
    if (typeof entry.id === "string" && removedWorkouts.has(entry.id)) continue;
    const start = num(entry.start);
    const end = num(entry.end);
    const minutes = start !== null && end !== null && end > start ? (end - start) / 60_000 : null;
    const exercises = (Array.isArray(entry.entries) ? entry.entries : [])
      .map((e) => (e as Record<string, unknown>)?.id)
      .filter((id): id is string => typeof id === "string")
      .map((id) => exerciseName(id, custom))
      .slice(0, 30);
    const bw = num(entry.bw);
    workouts.push({
      id:
        typeof entry.id === "string"
          ? entry.id.slice(0, 64)
          : `${date}-${start ?? workouts.length}`,
      date,
      start,
      // Longer than 5 hours is taken as a workout left running.
      durationMin: minutes !== null && minutes <= 300 ? Math.round(minutes) : null,
      name:
        typeof entry.name === "string" && entry.name.trim()
          ? entry.name.trim().slice(0, 80)
          : "Workout",
      exercises,
      bwKg: bw !== null && bw > 0 ? round1(toKg(bw)) : null,
    });
  }
  workouts.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? 0) - (b.start ?? 0));

  return { unit, weights, workouts: workouts.slice(-400), latestWeight: weights.at(-1) ?? null };
};

/** The body weight to use for a workout: its own, else the last weigh-in on or before its day. */
export const weightForDay = (date: string, weights: WeightPointDto[], fallback: number | null) => {
  let found: number | null = null;
  for (const w of weights) if (w.date <= date) found = w.kg;
  return found ?? weights[0]?.kg ?? fallback;
};
