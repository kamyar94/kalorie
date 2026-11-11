// CONTRACT: medicines. The person's own list of medicines (one-tap logging), the log of what was
// taken and when, and a photo of a box or blister read by the person's own AI provider. Plain data
// (dates as ISO strings), safe to import from client components.
//
// Cal records what was taken. It never checks doses or interactions and never gives advice.
//
// Server functions (lib/medicines/service.ts, lib/medicines/scans.ts), each scoped by user id:
//   listMedicines(userId)                        -> MedicineDto[]       (archived ones too)
//   createMedicine(userId, MedicineInput)        -> MedicineDto
//   updateMedicine(userId, id, MedicinePatch)    -> MedicineDto | null
//   logMedicine(userId, NewMedicineLog)          -> { log, medicine } | null
//   deleteMedicineLog(userId, logId)             -> boolean
//   medicineDay(userId, localDate)               -> MedicineDayDto      (Today's card)
//   medicineHistory(userId, days)                -> MedicineHistoryDay[]
//   createMedicineScan(userId, photo)            -> MedicineScanDto     (queues the label reading)
//   getMedicineScan(userId, scanId)              -> MedicineScanDto | null
// HTTP: GET/POST /api/medicines, PATCH /api/medicines/:id, GET/POST /api/medicine-logs,
// DELETE /api/medicine-logs/:id, POST /api/medicine-scans, GET /api/medicine-scans/:id,
// GET /api/medicine-scans/:id/:size (thumb | original).

export const MEDICINE_FORMS = [
  "tablet",
  "capsule",
  "liquid",
  "drops",
  "spray",
  "inhaler",
  "injection",
  "cream",
  "patch",
  "powder",
  "other",
] as const;
export type MedicineForm = (typeof MEDICINE_FORMS)[number];

export const MEDICINE_FORM_LABELS: Record<MedicineForm, string> = {
  tablet: "Tablet",
  capsule: "Capsule",
  liquid: "Liquid",
  drops: "Drops",
  spray: "Spray",
  inhaler: "Inhaler",
  injection: "Injection",
  cream: "Cream or gel",
  patch: "Patch",
  powder: "Powder or sachet",
  other: "Other",
};

/** What one of each form is counted in: singular and plural. */
export const MEDICINE_UNITS: Record<MedicineForm, [string, string]> = {
  tablet: ["tablet", "tablets"],
  capsule: ["capsule", "capsules"],
  liquid: ["ml", "ml"],
  drops: ["drop", "drops"],
  spray: ["spray", "sprays"],
  inhaler: ["puff", "puffs"],
  injection: ["injection", "injections"],
  cream: ["application", "applications"],
  patch: ["patch", "patches"],
  powder: ["sachet", "sachets"],
  other: ["dose", "doses"],
};

export const isMedicineForm = (value: unknown): value is MedicineForm =>
  typeof value === "string" && (MEDICINE_FORMS as readonly string[]).includes(value);

export const MEDICINE_LIMITS = {
  nameChars: 80,
  strengthChars: 40,
  unitChars: 20,
  notesChars: 500,
  ingredients: 8,
  /** Most of one thing taken at once (20 tablets, 100 ml). */
  maxAmount: 100,
} as const;

/** The line under every way of logging a medicine. */
export const MEDICINE_DISCLAIMER =
  "Cal records what you took. It does not check doses or interactions; ask a pharmacist or doctor about those.";

/** The unit word for an amount of a form: "tablet", "tablets"; null without a form. */
export const unitFor = (form: MedicineForm | null, amount: number) =>
  form ? MEDICINE_UNITS[form][amount === 1 ? 0 : 1] : null;

/** "2 tablets", "1 capsule", "0.5 tablet", "5 ml"; just the number without a unit. */
export const formatDose = (amount: number, unit: string | null) => {
  const number = Number.isInteger(amount) ? String(amount) : String(Math.round(amount * 100) / 100);
  if (!unit) return number;
  // A unit stored for one ("tablet") reads in the plural for other amounts.
  const known = Object.values(MEDICINE_UNITS).find(([one, many]) => unit === one || unit === many);
  const word = known ? known[amount === 1 ? 0 : 1] : unit;
  return `${number} ${word}`;
};

/** "Ibuprofen 200 mg": the name and, when known, the strength. */
export const medicineTitle = (medicine: { name: string; strength: string | null }) =>
  medicine.strength ? `${medicine.name} ${medicine.strength}` : medicine.name;

/** One active ingredient as printed: "ibuprofen", "200 mg". */
export type MedicineIngredient = { name: string; strength: string };

export type MedicineDto = {
  id: string;
  name: string;
  strength: string | null;
  form: MedicineForm | null;
  /** What "Log now" logs: the usual amount in the unit. */
  usualAmount: number;
  unit: string | null;
  ingredients: MedicineIngredient[];
  notes: string | null;
  archived: boolean;
  /** The last time it was logged (ISO), null when never. */
  lastTakenAt: string | null;
};

export type MedicineLogDto = {
  id: string;
  /** The medicine of the person's list it was logged from, if any (it may be gone since). */
  medicineId: string | null;
  /** Name, strength and form as they were when it was taken. */
  name: string;
  strength: string | null;
  form: MedicineForm | null;
  amount: number;
  unit: string | null;
  takenAt: string;
  tz: string;
  localDate: string;
  /** HH:MM in its time zone. */
  localTime: string;
  /** The photo of the label it was logged from (owner-only URLs), if any. */
  photo: { thumb: string; original: string } | null;
};

/** Today's Medicines card: what was taken that day and the medicines not logged yet. */
export type MedicineDayDto = { logs: MedicineLogDto[]; due: MedicineDto[] };

export type MedicineHistoryDay = { localDate: string; logs: MedicineLogDto[] };

/** A medicine for the person's list (new, or the changes to one). */
export type MedicineInput = {
  name: string;
  strength?: string | null;
  form?: MedicineForm | null;
  usualAmount?: number;
  unit?: string | null;
  ingredients?: MedicineIngredient[];
  notes?: string | null;
};

export type MedicinePatch = Partial<MedicineInput> & { archived?: boolean };

/**
 * A medicine taken: from the list (medicineId: name, strength, form and the usual amount come from
 * it unless given), or typed or read from a label (name required). keep adds it to the person's
 * list (or finds it there) for one-tap logging next time.
 */
export type NewMedicineLog = {
  medicineId?: string;
  name?: string;
  strength?: string | null;
  form?: MedicineForm | null;
  amount?: number;
  unit?: string | null;
  ingredients?: MedicineIngredient[];
  takenAt: string;
  tz: string;
  /** The label photo it was read from. */
  scanId?: string;
  keep?: boolean;
};

export type LoggedMedicine = { log: MedicineLogDto; medicine: MedicineDto | null };

// ---- Reading a label (the "read-medicine-label" job) ----

export const READ_MEDICINE_LABEL_JOB = "read-medicine-label";

export type ReadMedicineLabelPayload = { scanId: string; userId: string };

export const isReadMedicineLabelPayload = (value: unknown): value is ReadMedicineLabelPayload =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).scanId === "string" &&
  typeof (value as Record<string, unknown>).userId === "string";

/** What the model read from the box or blister, cleaned. */
export type MedicineReading = {
  name: string;
  strength: string | null;
  form: MedicineForm | null;
  ingredients: MedicineIngredient[];
};

/** queued: waiting for the worker; reading: the worker is on it; done: reading set; failed: error. */
export type MedicineScanStatus = "queued" | "reading" | "done" | "failed";

export type MedicineScanDto = {
  id: string;
  status: MedicineScanStatus;
  reading: MedicineReading | null;
  /** Why there is no reading: a sentence for the person; settingsLink for a key problem. */
  error: { kind: string; message: string; settingsLink: boolean } | null;
  photo: { thumb: string; original: string };
};
