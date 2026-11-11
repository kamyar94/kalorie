// The browser's calls to Kal's JSON routes, typed with the contracts. Screens call these and never
// build requests themselves, so data access stays in one place. Browser only.
import type {
  ActivityDto,
  ImportedActivity,
  ImportResult,
  ManualActivityInput,
} from "@/lib/contracts/activities";
import type {
  HealthProfileDto,
  ImportedMeasurement,
  MeasurementDto,
  NewMeasurements,
} from "@/lib/contracts/body";
import type { BodyPhotoDto, BodyPose, BodySessionDto } from "@/lib/contracts/body-photos";
import type { LinkCodeDto } from "@/lib/contracts/devices";
import type { FoodResult } from "@/lib/contracts/food-search";
import type {
  MealieRecipeHit,
  PlanEntryDto,
  PlanRequestDto,
  PlanSuggestionDto,
  RecipeInfoDto,
  WeightPointDto,
} from "@/lib/contracts/integrations";
import type {
  FavoriteDto,
  ItemInput,
  ItemPatch,
  MealDto,
  MealItemDto,
  MealPatch,
  MealSlot,
  MealSummaryDto,
} from "@/lib/contracts/meals";
import type {
  LoggedMedicine,
  MedicineDayDto,
  MedicineDto,
  MedicineInput,
  MedicinePatch,
  MedicineScanDto,
  NewMedicineLog,
} from "@/lib/contracts/medicines";
import type { NutrientMap } from "@/lib/contracts/nutrients";

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const request = async <T>(
  url: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal; keepalive?: boolean } = {},
): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: init.signal,
      keepalive: init.keepalive,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new ApiError("No connection. Check your network and try again.", 0);
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok)
    throw new ApiError(body?.error ?? "Something went wrong. Try again.", response.status);
  return body as T;
};

/** The same for a multipart form (photos). */
const requestForm = async <T>(url: string, form: FormData): Promise<T> => {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      body: form,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError("No connection. Check your network and try again.", 0);
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok)
    throw new ApiError(body?.error ?? "Something went wrong. Try again.", response.status);
  return body as T;
};

/** What the meal photo routes answer: the meal, and whether it is being analysed again. */
export type MealPhotosChange = { meal: MealDto; reanalysed: boolean; notice: string | null };

export type UsedFood = {
  food: FoodResult;
  lastGrams: number;
  lastPortionText: string | null;
  uses: number;
};

export type NewFoodInput = {
  nameEn: string;
  nameFa?: string | null;
  brand?: string | null;
  barcode?: string | null;
  servingGrams?: number | null;
  per: "100g" | "serving";
  nutrients: NutrientMap;
};

export type NewManualMealInput = {
  eatenAt: string;
  tz: string;
  slot?: MealSlot;
  title?: string | null;
  items: ItemInput[];
};

const id = encodeURIComponent;

export const api = {
  listDay: (date: string) =>
    request<{ meals: MealSummaryDto[] }>(`/api/meals?date=${id(date)}`).then((r) => r.meals),
  getMeal: (mealId: string) => request<MealDto>(`/api/meals/${id(mealId)}`),
  patchMeal: (mealId: string, patch: MealPatch) =>
    request<MealDto>(`/api/meals/${id(mealId)}`, { method: "PATCH", body: patch }),
  deleteMeal: (mealId: string) =>
    request<{ ok: true }>(`/api/meals/${id(mealId)}`, { method: "DELETE" }),
  duplicateMeal: (mealId: string, when: { eatenAt: string; tz: string }) =>
    request<MealDto>(`/api/meals/${id(mealId)}/duplicate`, { method: "POST", body: when }),
  answer: (mealId: string, questionId: string, answer: string) =>
    request<MealDto>(`/api/meals/${id(mealId)}/answers`, {
      method: "POST",
      body: { questionId, answer },
    }),
  correct: (mealId: string, text: string, replaceEdits = false) =>
    request<MealDto>(`/api/meals/${id(mealId)}/corrections`, {
      method: "POST",
      body: { text, replaceEdits },
    }),
  retry: (mealId: string) => request<MealDto>(`/api/meals/${id(mealId)}/retry`, { method: "POST" }),
  /** Adds photos (JPEG blobs) to a meal; reanalyse analyses it again from its photos. */
  addMealPhotos: (mealId: string, photos: Blob[], reanalyse: boolean) => {
    const form = new FormData();
    photos.forEach((photo, i) => form.append("photos", photo, `photo-${i + 1}.jpg`));
    form.set("reanalyse", String(reanalyse));
    return requestForm<MealPhotosChange>(`/api/meals/${id(mealId)}/photos`, form);
  },
  removeMealPhoto: (mealId: string, photoId: string, reanalyse: boolean) =>
    request<MealPhotosChange>(
      `/api/meals/${id(mealId)}/photos/${id(photoId)}?reanalyse=${String(reanalyse)}`,
      { method: "DELETE" },
    ),
  /** Makes the photo the meal's cover (the first one). */
  setMealCover: (mealId: string, photoId: string, reanalyse: boolean) =>
    request<MealPhotosChange>(`/api/meals/${id(mealId)}/photos`, {
      method: "PATCH",
      body: { cover: photoId, reanalyse },
    }),
  addItem: (mealId: string, input: ItemInput) =>
    request<MealItemDto>(`/api/meals/${id(mealId)}/items`, { method: "POST", body: input }),
  patchItem: (itemId: string, patch: ItemPatch) =>
    request<MealItemDto>(`/api/items/${id(itemId)}`, { method: "PATCH", body: patch }),
  deleteItem: (itemId: string) =>
    request<{ ok: true }>(`/api/items/${id(itemId)}`, { method: "DELETE" }),
  rememberItem: (itemId: string) =>
    request<{ ok: true }>(`/api/items/${id(itemId)}/remember`, {
      method: "POST",
      keepalive: true,
    }),
  favorites: (limit = 50) =>
    request<{ favorites: FavoriteDto[] }>(`/api/favorites?limit=${limit}`).then((r) => r.favorites),
  /** Logs a favorite again (a copy of the meal as it is now) at that time. */
  logFavorite: (mealId: string, when: { eatenAt: string; tz: string }) =>
    request<MealDto>(`/api/favorites/${id(mealId)}/log`, { method: "POST", body: when }),
  medicines: () => request<{ medicines: MedicineDto[] }>("/api/medicines").then((r) => r.medicines),
  createMedicine: (input: MedicineInput) =>
    request<MedicineDto>("/api/medicines", { method: "POST", body: input }),
  updateMedicine: (medicineId: string, patch: MedicinePatch) =>
    request<MedicineDto>(`/api/medicines/${id(medicineId)}`, { method: "PATCH", body: patch }),
  medicineDay: (date: string) => request<MedicineDayDto>(`/api/medicine-logs?date=${id(date)}`),
  logMedicine: (input: NewMedicineLog) =>
    request<LoggedMedicine>("/api/medicine-logs", { method: "POST", body: input }),
  deleteMedicineLog: (logId: string) =>
    request<{ ok: true }>(`/api/medicine-logs/${id(logId)}`, { method: "DELETE" }),
  /** Sends a photo of a medicine's label; the reading follows (medicineScan). */
  scanMedicine: (photo: Blob) => {
    const form = new FormData();
    form.set("photo", photo, "label.jpg");
    return requestForm<MedicineScanDto>("/api/medicine-scans", form);
  },
  medicineScan: (scanId: string, signal?: AbortSignal) =>
    request<MedicineScanDto>(`/api/medicine-scans/${id(scanId)}`, { signal }),
  createManualMeal: (input: NewManualMealInput) =>
    request<MealDto>("/api/manual-meals", { method: "POST", body: input }),
  searchFoods: (query: string, signal?: AbortSignal) =>
    request<{ foods: FoodResult[] }>(`/api/foods?q=${id(query)}&limit=25`, { signal }).then(
      (r) => r.foods,
    ),
  /** Foods and, when Mealie is connected, Mealie recipes. */
  searchAll: (query: string, signal?: AbortSignal) =>
    request<{ foods: FoodResult[]; recipes?: MealieRecipeHit[] }>(
      `/api/foods?q=${id(query)}&limit=25`,
      { signal },
    ).then((r) => ({ foods: r.foods, recipes: r.recipes ?? [] })),
  getFood: (foodId: string) => request<FoodResult>(`/api/foods/${id(foodId)}`),
  usedFoods: () => request<{ recent: UsedFood[]; frequent: UsedFood[] }>("/api/foods/used"),
  /** The product, or null when Kal does not know the barcode. */
  barcode: async (code: string) => {
    try {
      return await request<FoodResult>(`/api/foods/barcode/${id(code)}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  createFood: (input: NewFoodInput) =>
    request<FoodResult>("/api/foods", { method: "POST", body: input }),
  logPlanned: (plannedId: string, body: { servings: number; eatenAt: string; tz: string }) =>
    request<{ mealId: string }>(`/api/planned/${id(plannedId)}/log`, { method: "POST", body }),
  mealieRecipe: (slug: string) => request<RecipeInfoDto>(`/api/mealie/recipes/${id(slug)}`),
  saveRecipeNutrition: (slug: string) =>
    request<RecipeInfoDto>(`/api/mealie/recipes/${id(slug)}/nutrition`, { method: "POST" }),
  suggestPlan: (body: PlanRequestDto) =>
    request<PlanSuggestionDto>("/api/mealie/plan/suggest", { method: "POST", body }),
  confirmPlan: (entries: Pick<PlanEntryDto, "date" | "slot" | "recipeId">[]) =>
    request<{ written: number; failed: number }>("/api/mealie/plan/confirm", {
      method: "POST",
      body: { entries },
    }),
  connectMealie: (token: string) =>
    request<{ ok: true }>("/api/integrations/mealie", { method: "POST", body: { token } }),
  testMealie: () => request<{ ok: true }>("/api/integrations/mealie/test", { method: "POST" }),
  disconnectMealie: () => request<{ ok: true }>("/api/integrations/mealie", { method: "DELETE" }),
  pairOpenGym: (code: string) =>
    request<{ ok: true }>("/api/integrations/opengym", { method: "POST", body: { code } }),
  syncOpenGym: () =>
    request<{ ok: true; weighIns: number; workouts: number; latestWeight: WeightPointDto | null }>(
      "/api/integrations/opengym/sync",
      { method: "POST" },
    ),
  disconnectOpenGym: () => request<{ ok: true }>("/api/integrations/opengym", { method: "DELETE" }),
  activities: (from: string, to: string) =>
    request<{ activities: ActivityDto[] }>(`/api/activities?from=${id(from)}&to=${id(to)}`).then(
      (r) => r.activities,
    ),
  createActivity: (input: ManualActivityInput) =>
    request<ActivityDto>("/api/activities", { method: "POST", body: input }),
  deleteActivity: (activityId: string) =>
    request<{ ok: true }>(`/api/activities/${id(activityId)}`, { method: "DELETE" }),
  importActivities: (records: ImportedActivity[]) =>
    request<ImportResult>("/api/imports/activities", { method: "POST", body: { records } }),
  importMeasurements: (records: ImportedMeasurement[]) =>
    request<ImportResult>("/api/imports/measurements", { method: "POST", body: { records } }),
  logMeasurements: (input: NewMeasurements) =>
    request<{ measurements: MeasurementDto[] }>("/api/body/measurements", {
      method: "POST",
      body: input,
    }).then((r) => r.measurements),
  deleteMeasurement: (measurementId: string) =>
    request<{ ok: true }>(`/api/body/measurements/${id(measurementId)}`, { method: "DELETE" }),
  saveHealthProfile: (input: Partial<HealthProfileDto>) =>
    request<HealthProfileDto>("/api/body/health", { method: "PUT", body: input }),
  /** One body photo at full size (JPEG, PNG or WebP as taken). */
  uploadBodyPhoto: (
    photo: Blob,
    meta: {
      pose: BodyPose;
      takenAt: string;
      tz: string;
      facing: "user" | "environment" | null;
      source: "camera" | "gallery";
    },
  ) => {
    const form = new FormData();
    form.set("photo", photo, `${meta.pose}.jpg`);
    form.set("pose", meta.pose);
    form.set("takenAt", meta.takenAt);
    form.set("tz", meta.tz);
    if (meta.facing) form.set("facing", meta.facing);
    form.set("source", meta.source);
    return requestForm<{ session: BodySessionDto; photo: BodyPhotoDto }>("/api/body-photos", form);
  },
  deleteBodyPhoto: (photoId: string) =>
    request<{ ok: true }>(`/api/body-photos/${id(photoId)}`, { method: "DELETE" }),
  /** A one-time code and the intent URL that opens the app's Health Connect screen with it. */
  createLinkCode: () => request<LinkCodeDto>("/api/devices/link-codes", { method: "POST" }),
  unlinkDevice: (deviceId: string) =>
    request<{ ok: true }>(`/api/devices/${id(deviceId)}`, { method: "DELETE" }),
};
