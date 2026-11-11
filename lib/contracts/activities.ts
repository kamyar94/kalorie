// CONTRACT: activities. Everything the person did to move: workouts from openGym, activities
// typed in Kal ("+ Activity"), and steps and exercise sessions imported from a Samsung Health
// export. One table holds them all (activities); a day's steps are an activity of type "steps"
// (category walking) without a duration. Plain data, safe for client components.
//
// Every record has a source and, for records that come from somewhere else, an external id:
// importing the same file twice, a new openGym sync, or (later) the Android helper reading Health
// Connect update the record they made before instead of adding a copy.
//
// Server functions (lib/activities/service.ts), each scoped by user id:
//   listActivities(userId, { from, to, limit })      -> ActivityDto[]   newest first
//   createActivity(userId, ManualActivityInput)       -> ActivityDto | null
//   deleteActivity(userId, id)                        -> "deleted" | "not-found" | "synced"
//   importActivities(userId, ImportedActivity[])      -> ImportResult
//   syncOpenGymActivities(userId, workouts, window)   (called by every openGym sync)
// HTTP: GET/POST /api/activities, DELETE /api/activities/:id, POST /api/imports/activities.

export const ACTIVITY_CATEGORIES = [
  "cardio",
  "strength",
  "walking",
  "mobility",
  "sports",
  "other",
] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  cardio: "Cardio",
  strength: "Strength",
  walking: "Walking",
  mobility: "Mobility",
  sports: "Sports",
  other: "Other",
};

/**
 * manual: typed in Kal; opengym: a workout read from openGym; import: from an export file
 * (source_app says which app); health_connect: reserved for the Android helper (Part 3).
 */
export const ACTIVITY_SOURCES = ["manual", "opengym", "import", "health_connect"] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

/** Apps an import or Health Connect record came from, as Kal names them. */
export const SOURCE_APP_LABELS: Record<string, string> = {
  "samsung-health": "Samsung Health",
  renpho: "Renpho",
  file: "a file",
};

export const INTENSITIES = ["light", "moderate", "vigorous"] as const;
export type Intensity = (typeof INTENSITIES)[number];

export const INTENSITY_LABELS: Record<Intensity, string> = {
  light: "Light",
  moderate: "Moderate",
  vigorous: "Vigorous",
};

export type ActivityType = {
  id: string;
  label: string;
  category: ActivityCategory;
  /** The usual effort, preselected in the sheet. */
  intensity: Intensity;
  /** Distance is worth asking for. */
  distance?: boolean;
  /** A day's step count instead of a timed session. */
  steps?: boolean;
};

/** What "+ Activity" offers, grouped by category in this order. */
export const ACTIVITY_TYPES: ActivityType[] = [
  { id: "run", label: "Running", category: "cardio", intensity: "vigorous", distance: true },
  { id: "cycle", label: "Cycling", category: "cardio", intensity: "moderate", distance: true },
  { id: "swim", label: "Swimming", category: "cardio", intensity: "moderate", distance: true },
  { id: "row", label: "Rowing", category: "cardio", intensity: "moderate", distance: true },
  { id: "elliptical", label: "Elliptical", category: "cardio", intensity: "moderate" },
  { id: "hiit", label: "HIIT", category: "cardio", intensity: "vigorous" },
  { id: "dance", label: "Dancing", category: "cardio", intensity: "moderate" },
  { id: "jump_rope", label: "Jump rope", category: "cardio", intensity: "vigorous" },
  { id: "stairs", label: "Stair climbing", category: "cardio", intensity: "vigorous" },
  { id: "cardio", label: "Other cardio", category: "cardio", intensity: "moderate" },
  { id: "weights", label: "Weight training", category: "strength", intensity: "moderate" },
  { id: "bodyweight", label: "Bodyweight exercises", category: "strength", intensity: "moderate" },
  { id: "circuit", label: "Circuit training", category: "strength", intensity: "vigorous" },
  { id: "walk", label: "Walking", category: "walking", intensity: "moderate", distance: true },
  { id: "hike", label: "Hiking", category: "walking", intensity: "moderate", distance: true },
  { id: "steps", label: "Steps (day total)", category: "walking", intensity: "light", steps: true },
  { id: "yoga", label: "Yoga", category: "mobility", intensity: "light" },
  { id: "stretching", label: "Stretching", category: "mobility", intensity: "light" },
  { id: "pilates", label: "Pilates", category: "mobility", intensity: "moderate" },
  { id: "mobility", label: "Mobility work", category: "mobility", intensity: "light" },
  { id: "football", label: "Football (soccer)", category: "sports", intensity: "vigorous" },
  { id: "basketball", label: "Basketball", category: "sports", intensity: "vigorous" },
  { id: "tennis", label: "Tennis", category: "sports", intensity: "vigorous" },
  { id: "badminton", label: "Badminton", category: "sports", intensity: "moderate" },
  { id: "volleyball", label: "Volleyball", category: "sports", intensity: "moderate" },
  { id: "martial_arts", label: "Martial arts", category: "sports", intensity: "vigorous" },
  { id: "climbing", label: "Climbing", category: "sports", intensity: "vigorous" },
  { id: "sport", label: "Other sport", category: "sports", intensity: "moderate" },
  { id: "other", label: "Other activity", category: "other", intensity: "moderate" },
];

export const activityType = (id: string | null | undefined) =>
  ACTIVITY_TYPES.find((t) => t.id === id) ?? null;

export const isActivityCategory = (value: unknown): value is ActivityCategory =>
  typeof value === "string" && (ACTIVITY_CATEGORIES as readonly string[]).includes(value);

export const isIntensity = (value: unknown): value is Intensity =>
  typeof value === "string" && (INTENSITIES as readonly string[]).includes(value);

/**
 * The category a workout's name points to ("Morning run" -> cardio); `fallback` when no word
 * does (openGym workouts are strength training unless they say otherwise).
 */
export const categoryFromWords = (
  words: string,
  fallback: ActivityCategory = "strength",
): ActivityCategory => {
  if (/\b(yoga|stretch|stretching|mobility|pilates)\b/i.test(words)) return "mobility";
  if (/\b(walk|walking|hike|hiking)\b/i.test(words)) return "walking";
  if (
    /\b(run|running|jog\w*|cycl\w*|bike|row|rowing|erg|elliptical|hiit|interval|tabata|cardio|swim\w*)\b/i.test(
      words,
    )
  )
    return "cardio";
  if (
    /\b(football|soccer|basketball|tennis|badminton|volleyball|squash|climb\w*|boxing)\b/i.test(
      words,
    )
  )
    return "sports";
  if (/\b(weights?|strength|gym|lift\w*|squat|bench|deadlift|press)\b/i.test(words))
    return "strength";
  return fallback;
};

/** A generic type id for each category (records whose own type Kal does not know). */
export const TYPE_OF_CATEGORY: Record<ActivityCategory, string> = {
  cardio: "cardio",
  strength: "weights",
  walking: "walk",
  mobility: "mobility",
  sports: "sport",
  other: "other",
};

/** The type id of a day's step count. */
export const STEPS_TYPE = "steps";

export const ACTIVITY_LIMITS = {
  titleChars: 80,
  notesChars: 500,
  /** One session, minutes (a whole day). */
  maxMinutes: 24 * 60,
  maxSteps: 200_000,
  /** Metres. */
  maxDistance: 1_000_000,
  maxKcal: 20_000,
  /** Records per import request (the browser sends a file in batches). */
  importBatch: 2000,
} as const;

export type ActivityDto = {
  id: string;
  category: ActivityCategory;
  /** An ACTIVITY_TYPES id, or the importer's own word for it. */
  type: string;
  title: string;
  startedAt: string;
  tz: string;
  localDate: string;
  localTime: string;
  /** Null for a day's steps. */
  durationMin: number | null;
  distanceM: number | null;
  steps: number | null;
  /** Labelled "estimate" wherever it is shown, unless the source measured it. */
  energyKcal: number | null;
  intensity: Intensity | null;
  source: ActivitySource;
  sourceApp: string | null;
  notes: string | null;
};

/** "+ Activity": what the person typed. */
export type ManualActivityInput = {
  type: string;
  title?: string | null;
  startedAt: string;
  tz: string;
  durationMin?: number | null;
  intensity?: Intensity | null;
  distanceKm?: number | null;
  steps?: number | null;
  notes?: string | null;
};

/** One record read from an export file on the device (lib/imports). */
export type ImportedActivity = {
  externalId: string;
  sourceApp: string;
  category: ActivityCategory;
  type: string;
  title: string;
  /** ISO time; for a day's steps, noon of that day in tz. */
  startedAt: string;
  tz: string;
  /** Set for a day's steps: the calendar day the count belongs to. */
  localDate?: string | null;
  durationMin?: number | null;
  distanceM?: number | null;
  steps?: number | null;
  energyKcal?: number | null;
  intensity?: Intensity | null;
};

export type ImportResult = { added: number; updated: number; skipped: number };

/** "Samsung Health", "openGym", "Kal" for where a record came from. */
export const sourceLabel = (source: ActivitySource, sourceApp: string | null) =>
  source === "opengym"
    ? "openGym"
    : source === "manual"
      ? "Kal"
      : source === "health_connect"
        ? "Health Connect"
        : (SOURCE_APP_LABELS[sourceApp ?? ""] ?? "a file");

/**
 * Energy estimate (kcal) = MET x body weight (kg) x hours. The MET is the middle of the WHO
 * intensity band (WHO 2020 guidelines on physical activity and sedentary behaviour: light below 3
 * METs, moderate 3 to under 6, vigorous 6 or more): 2.5, 4.5 and 8. openGym workouts keep their
 * own Compendium values (lib/integrations/opengym/parse.ts).
 */
export const INTENSITY_MET: Record<Intensity, number> = { light: 2.5, moderate: 4.5, vigorous: 8 };

/**
 * The MET of a typed activity: resistance training at light or moderate effort keeps the 2024
 * Compendium's 3.5 (code 02054, as for openGym workouts), everything else its intensity band.
 */
export const metOf = (category: ActivityCategory, intensity: Intensity | null) =>
  category === "strength" && intensity !== "vigorous"
    ? 3.5
    : INTENSITY_MET[intensity ?? "moderate"];

export const energyEstimate = (met: number, kg: number | null, minutes: number | null) =>
  kg && kg > 0 && minutes && minutes > 0 ? Math.round(met * kg * (minutes / 60)) : null;

/** "1 h 5 min", "45 min". */
export const formatMinutes = (minutes: number) => {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

/** "8,900". */
export const formatSteps = (steps: number) =>
  Math.round(steps).toLocaleString("en-US", { maximumFractionDigits: 0 });
