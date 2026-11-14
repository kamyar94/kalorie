// Medicines against Postgres: the person's list and its routes, logging (from the list with the
// usual amount, typed or read from a label, kept in the list or not), Today's card, the history,
// changing a log's time and amount (to another day too), removing a log with its label photo, the label photo read by the provider mock (and without a
// key, not a medicine), the export, "Delete my data", and that it all stays with its owner.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { aiUsage, medicineLogs, medicines, medicineScans } from "@/db/schema";
import { deleteUserData, exportUserData } from "@/lib/account/data";
import { saveProviderKey } from "@/lib/ai/service";
import type { SessionUser } from "@/lib/auth/accounts";
import {
  READ_MEDICINE_LABEL_JOB,
  type LoggedMedicine,
  type MedicineDayDto,
  type MedicineDto,
  type MedicineLogDto,
  type MedicineScanDto,
} from "@/lib/contracts/medicines";
import { localParts, shiftLocalDate } from "@/lib/meals/time";
import { readMedicineLabelHandler } from "@/lib/medicines/label";
import { pruneUnusedScans, UNUSED_SCAN_MS } from "@/lib/medicines/scans";
import { medicineHistory } from "@/lib/medicines/service";
import { resolvePhotoPath } from "@/lib/photos/storage";
import { drainJobs } from "@/lib/queue/worker";
import { fromLocalInputValue } from "@/lib/ui/format";
import {
  aiReplies,
  startAiMock,
  TEST_API_KEY,
  useAiMock,
  type AiMock,
} from "@/tests/helpers/ai-mock";
import { createUser } from "@/tests/helpers/factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => session.user,
}));

const medicinesRoute = await import("@/app/api/medicines/route");
const medicineRoute = await import("@/app/api/medicines/[id]/route");
const logsRoute = await import("@/app/api/medicine-logs/route");
const logRoute = await import("@/app/api/medicine-logs/[id]/route");
const scansRoute = await import("@/app/api/medicine-scans/route");
const scanRoute = await import("@/app/api/medicine-scans/[id]/route");
const scanPhotoRoute = await import("@/app/api/medicine-scans/[id]/[size]/route");

const ORIGIN = "http://127.0.0.1:3201";
const HEADERS = { origin: ORIGIN, "x-forwarded-host": "127.0.0.1:3201" };
const TZ = "Europe/Berlin";
let ai: AiMock;
let restore: () => void;
let root: string;
let ann: SessionUser;
let ben: SessionUser;

const asUser = async () => {
  const row = await createUser();
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    timeZone: row.timeZone,
    units: row.units,
  };
};

const call = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`${ORIGIN}${url}`, {
    method,
    headers: { ...HEADERS, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

const addMedicine = async (body: Record<string, unknown>) =>
  (await (await medicinesRoute.POST(call("/api/medicines", "POST", body))).json()) as MedicineDto;

const log = (body: Record<string, unknown>) =>
  logsRoute.POST(
    call("/api/medicine-logs", "POST", { takenAt: new Date().toISOString(), tz: TZ, ...body }),
  );

const day = async (date: string) =>
  (await (await logsRoute.GET(call(`/api/medicine-logs?date=${date}`))).json()) as MedicineDayDto;

const today = () => localParts(new Date(), TZ).date;

const jpeg = () =>
  sharp({ create: { width: 900, height: 600, channels: 3, background: "#f1f2ee" } })
    .jpeg()
    .toBuffer();

const scan = async (photo?: Buffer | string) => {
  const body = new FormData();
  const bytes = photo ?? (await jpeg());
  body.set(
    "photo",
    new Blob([typeof bytes === "string" ? bytes : new Uint8Array(bytes)]),
    "label.jpg",
  );
  return scansRoute.POST(
    new NextRequest(`${ORIGIN}/api/medicine-scans`, { method: "POST", body, headers: HEADERS }),
  );
};

const readScans = () => drainJobs({ [READ_MEDICINE_LABEL_JOB]: readMedicineLabelHandler });

beforeAll(async () => {
  ai = await startAiMock();
  restore = useAiMock(ai);
  root = mkdtempSync(path.join(os.tmpdir(), "cal-medicines-"));
  process.env.PHOTO_ROOT = root;
  ann = await asUser();
  ben = await asUser();
});

afterAll(async () => {
  restore();
  await ai.close();
  rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  session.user = ann;
  ai.reset();
  await db.execute(sql`delete from rate_limits`);
});

describe("the list of medicines", () => {
  it("adds, changes, archives and lists the person's medicines only", async () => {
    const created = await medicinesRoute.POST(
      call("/api/medicines", "POST", { name: "Vitamin D", strength: "1000 IU", form: "tablet" }),
    );
    expect(created.status).toBe(201);
    const vitamin = (await created.json()) as MedicineDto;
    expect(vitamin).toMatchObject({
      name: "Vitamin D",
      strength: "1000 IU",
      form: "tablet",
      usualAmount: 1,
      unit: "tablet",
      archived: false,
      lastTakenAt: null,
    });
    expect(
      (await medicinesRoute.POST(call("/api/medicines", "POST", { strength: "5 mg" }))).status,
    ).toBe(400);

    const changed = await medicineRoute.PATCH(
      call(`/api/medicines/${vitamin.id}`, "PATCH", { usualAmount: 2, form: "capsule" }),
      ctx({ id: vitamin.id }),
    );
    expect((await changed.json()) as MedicineDto).toMatchObject({
      usualAmount: 2,
      form: "capsule",
      unit: "capsule",
    });

    session.user = ben;
    expect(
      (
        await medicineRoute.PATCH(
          call(`/api/medicines/${vitamin.id}`, "PATCH", { archived: true }),
          ctx({ id: vitamin.id }),
        )
      ).status,
    ).toBe(404);
    const theirs = (await (await medicinesRoute.GET(call("/api/medicines"))).json()) as {
      medicines: MedicineDto[];
    };
    expect(theirs.medicines).toEqual([]);
    session.user = null;
    expect((await medicinesRoute.GET(call("/api/medicines"))).status).toBe(401);
  });
});

describe("logging what was taken", () => {
  it("logs from the list with the usual amount; Today shows it taken and the rest due", async () => {
    const person = await asUser();
    session.user = person;
    const omega = await addMedicine({ name: "Omega-3", form: "capsule" });
    const zinc = await addMedicine({ name: "Zinc", strength: "15 mg", usualAmount: 2 });
    const old = await addMedicine({ name: "Old cough syrup", form: "liquid" });
    await medicineRoute.PATCH(
      call(`/api/medicines/${old.id}`, "PATCH", { archived: true }),
      ctx({ id: old.id }),
    );
    expect((await day(today())).due.map((m) => m.name)).toEqual(["Omega-3", "Zinc"]);

    const response = await log({ medicineId: zinc.id });
    expect(response.status).toBe(201);
    const { log: zincLog } = (await response.json()) as LoggedMedicine;
    expect(zincLog).toMatchObject({
      medicineId: zinc.id,
      name: "Zinc",
      strength: "15 mg",
      amount: 2,
      localDate: today(),
      photo: null,
    });
    const now = await day(today());
    expect(now.logs.map((l) => l.name)).toEqual(["Zinc"]);
    expect(now.due.map((m) => m.id)).toEqual([omega.id]);
    // Someone else's medicine cannot be logged; nor can a time next year.
    session.user = ben;
    expect((await log({ medicineId: omega.id })).status).toBe(404);
    expect((await day(today())).logs).toEqual([]);
    session.user = person;
    expect(
      (await log({ name: "X", takenAt: new Date(Date.now() + 86_400_000).toISOString() })).status,
    ).toBe(400);
  });

  it("keeps a typed medicine in the list, finds it again by name, and brings it back from the archive", async () => {
    const person = await asUser();
    session.user = person;
    const first = (await (
      await log({ name: "Ibuprofen", strength: "200 mg", form: "tablet", amount: 2, keep: true })
    ).json()) as LoggedMedicine;
    expect(first.medicine).toMatchObject({ name: "Ibuprofen", usualAmount: 2, unit: "tablet" });
    expect(first.log).toMatchObject({ amount: 2, unit: "tablet", medicineId: first.medicine!.id });

    await medicineRoute.PATCH(
      call(`/api/medicines/${first.medicine!.id}`, "PATCH", { archived: true }),
      ctx({ id: first.medicine!.id }),
    );
    const again = (await (
      await log({ name: "IBUPROFEN", strength: "200 MG", amount: 1, keep: true })
    ).json()) as LoggedMedicine;
    expect(again.medicine).toMatchObject({ id: first.medicine!.id, archived: false });

    // Not kept: a log without a medicine.
    const once = (await (
      await log({ name: "Antihistamine", keep: false })
    ).json()) as LoggedMedicine;
    expect(once).toMatchObject({ medicine: null, log: { medicineId: null, amount: 1 } });
    expect(await db.$count(medicines, eq(medicines.userId, person.id))).toBe(1);

    // The log keeps the name of the time it was taken.
    await medicineRoute.PATCH(
      call(`/api/medicines/${first.medicine!.id}`, "PATCH", { name: "Ibuprofen Forte" }),
      ctx({ id: first.medicine!.id }),
    );
    const history = await medicineHistory(person.id, today());
    expect(history[0]!.logs.map((l) => l.name)).toEqual([
      "Ibuprofen",
      "IBUPROFEN",
      "Antihistamine",
    ]);
  });

  it("puts the history by day, newest day first, and removes a log", async () => {
    const person = await asUser();
    session.user = person;
    const yesterday = new Date(Date.now() - 86_400_000);
    await log({ name: "Vitamin C", takenAt: yesterday.toISOString() });
    const { log: todayLog } = (await (await log({ name: "Vitamin C" })).json()) as LoggedMedicine;
    const history = await medicineHistory(person.id, today());
    expect(history.map((d) => d.localDate)).toEqual([today(), localParts(yesterday, TZ).date]);
    expect(await medicineHistory(person.id, shiftLocalDate(today(), -10), 5)).toEqual([]);

    session.user = ben;
    expect(
      (
        await logRoute.DELETE(
          call(`/api/medicine-logs/${todayLog.id}`, "DELETE"),
          ctx({ id: todayLog.id }),
        )
      ).status,
    ).toBe(404);
    session.user = person;
    expect(
      (
        await logRoute.DELETE(
          call(`/api/medicine-logs/${todayLog.id}`, "DELETE"),
          ctx({ id: todayLog.id }),
        )
      ).status,
    ).toBe(200);
    expect((await day(today())).logs).toEqual([]);
  });
});

describe("changing a log", () => {
  const patch = (logId: string, body: unknown, headers: Record<string, string> = HEADERS) =>
    logRoute.PATCH(
      new NextRequest(`${ORIGIN}/api/medicine-logs/${logId}`, {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      ctx({ id: logId }),
    );

  it("changes the amount in the log's unit, and only the owner can, from Kal's own pages", async () => {
    const person = await asUser();
    session.user = person;
    const zinc = await addMedicine({ name: "Zinc", strength: "15 mg", form: "tablet" });
    const { log: taken } = (await (await log({ medicineId: zinc.id })).json()) as LoggedMedicine;

    const changed = await patch(taken.id, { amount: 2 });
    expect(changed.status).toBe(200);
    expect((await changed.json()) as MedicineLogDto).toMatchObject({
      id: taken.id,
      amount: 2,
      unit: "tablet",
      takenAt: taken.takenAt,
      localDate: taken.localDate,
      localTime: taken.localTime,
    });
    // The usual amount of the medicine stays.
    expect((await day(today())).logs[0]!.amount).toBe(2);
    expect(
      (await db.select().from(medicines).where(eq(medicines.id, zinc.id)))[0]!.usualAmount,
    ).toBe(1);

    // Someone else: as if it did not exist; no session; another site; not an id.
    session.user = ben;
    expect((await patch(taken.id, { amount: 3 })).status).toBe(404);
    session.user = null;
    expect((await patch(taken.id, { amount: 3 })).status).toBe(401);
    session.user = person;
    expect(
      (
        await patch(
          taken.id,
          { amount: 3 },
          { origin: "https://elsewhere.example.org", "x-forwarded-host": "127.0.0.1:3201" },
        )
      ).status,
    ).toBe(403);
    expect((await patch("not-a-log", { amount: 3 })).status).toBe(404);
    expect(
      (await db.select().from(medicineLogs).where(eq(medicineLogs.id, taken.id)))[0]!.amount,
    ).toBe(2);
  });

  it("refuses a time in the future, an amount of 0 or too many, and a body that changes nothing", async () => {
    const person = await asUser();
    session.user = person;
    const { log: taken } = (await (await log({ name: "Vitamin C" })).json()) as LoggedMedicine;
    const refused = async (body: unknown) => {
      const response = await patch(taken.id, body);
      return {
        status: response.status,
        error: ((await response.json()) as { error: string }).error,
      };
    };
    expect(
      await refused({ takenAt: new Date(Date.now() + 3_600_000).toISOString(), tz: TZ }),
    ).toEqual({ status: 400, error: "Pick a time in the past year." });
    expect(
      await refused({ takenAt: new Date(Date.now() - 400 * 86_400_000).toISOString() }),
    ).toMatchObject({ status: 400 });
    expect(await refused({ amount: 0 })).toEqual({
      status: 400,
      error: "Give an amount from 0.01 to 100.",
    });
    expect(await refused({ amount: 101 })).toMatchObject({ status: 400 });
    expect(await refused({ tz: TZ })).toEqual({
      status: 400,
      error: "Send a new time or a new amount.",
    });
    expect(await refused("not json")).toMatchObject({ status: 400 });
    // A few minutes ahead of the server's clock is a phone's clock, not the future.
    const skew = await patch(taken.id, {
      takenAt: new Date(Date.now() + 2 * 60_000).toISOString(),
    });
    expect(skew.status).toBe(200);
    expect(
      (await db.select().from(medicineLogs).where(eq(medicineLogs.id, taken.id)))[0]!.amount,
    ).toBe(1);
  });

  it("moves a log to the day of its new time, in the time zone it is meant in", async () => {
    const person = await asUser();
    session.user = person;
    const omega = await addMedicine({ name: "Omega-3", form: "capsule" });
    const { log: taken } = (await (await log({ medicineId: omega.id })).json()) as LoggedMedicine;
    expect((await day(today())).due).toEqual([]);

    // Yesterday at 21:00 in Berlin.
    const yesterday = shiftLocalDate(today(), -1);
    const evening = fromLocalInputValue(`${yesterday}T21:00`, TZ)!;
    const moved = (await (
      await patch(taken.id, { takenAt: evening, tz: TZ, amount: 2 })
    ).json()) as MedicineLogDto;
    expect(moved).toMatchObject({
      takenAt: evening,
      tz: TZ,
      localDate: yesterday,
      localTime: "21:00",
      amount: 2,
    });
    // Today has it due again; yesterday has it taken.
    const now = await day(today());
    expect(now.logs).toEqual([]);
    expect(now.due.map((m) => m.id)).toEqual([omega.id]);
    expect((await day(yesterday)).logs.map((l) => l.id)).toEqual([taken.id]);
    expect((await medicineHistory(person.id, today())).map((d) => d.localDate)).toEqual([
      yesterday,
    ]);

    // The same moment read in Tokyo is another wall-clock time (and maybe another day).
    const tokyo = (await (
      await patch(taken.id, { takenAt: evening, tz: "Asia/Tokyo" })
    ).json()) as MedicineLogDto;
    expect(tokyo).toMatchObject({
      tz: "Asia/Tokyo",
      localDate: localParts(new Date(evening), "Asia/Tokyo").date,
      localTime: localParts(new Date(evening), "Asia/Tokyo").time,
    });
    // A zone the server does not know: the person's own (UTC here).
    const unknown = (await (
      await patch(taken.id, { takenAt: evening, tz: "Mars/Olympus" })
    ).json()) as MedicineLogDto;
    expect(unknown).toMatchObject({
      tz: "UTC",
      localTime: localParts(new Date(evening), "UTC").time,
    });
    // Without a zone the log keeps its own.
    const kept = (await (await patch(taken.id, { amount: 1 })).json()) as MedicineLogDto;
    expect(kept).toMatchObject({ tz: "UTC", takenAt: evening, amount: 1 });
  });
});

describe("label photos", () => {
  it("without an AI key: fails at once, with no job, and the sheet is typed", async () => {
    const person = await asUser();
    session.user = person;
    const response = await scan();
    expect(response.status).toBe(202);
    const result = (await response.json()) as MedicineScanDto;
    expect(result).toMatchObject({
      status: "failed",
      reading: null,
      error: { kind: "no-key", settingsLink: true },
    });
    expect(result.error!.message).toMatch(/Save an AI key/);
    expect(
      (await db.execute(sql`select 1 from jobs where payload->>'scanId' = ${result.id}`)).rows,
    ).toEqual([]);
  });

  it("is read by the person's provider; the log keeps the photo, only for its owner", async () => {
    const person = await asUser();
    await saveProviderKey(person.id, "google", TEST_API_KEY);
    session.user = person;
    ai.queue(
      "google",
      aiReplies.google.json({
        is_medicine: true,
        name: "Ibuprofen",
        strength: "200 mg",
        form: "tablet",
        active_ingredients: [{ name: "Ibuprofen", strength: "200 mg" }],
      }),
    );
    const queued = (await (await scan()).json()) as MedicineScanDto;
    expect(queued.status).toBe("queued");
    expect(await readScans()).toBe(1);
    const read = (await (
      await scanRoute.GET(call(`/api/medicine-scans/${queued.id}`), ctx({ id: queued.id }))
    ).json()) as MedicineScanDto;
    expect(read).toMatchObject({
      status: "done",
      error: null,
      reading: {
        name: "Ibuprofen",
        strength: "200 mg",
        form: "tablet",
        ingredients: [{ name: "Ibuprofen", strength: "200 mg" }],
      },
    });
    // The request: the photo, the strict schema, no advice asked for; usage recorded.
    const request = ai.requests.at(-1)!.body as {
      contents: { parts: { inlineData?: unknown }[] }[];
      generationConfig: { responseJsonSchema: { required: string[] } };
      systemInstruction?: { parts: { text: string }[] };
    };
    expect(request.contents.at(-1)!.parts.some((p) => p.inlineData)).toBe(true);
    expect(request.generationConfig.responseJsonSchema.required).toContain("active_ingredients");
    expect(JSON.stringify(request)).toMatch(/Do not give advice/);
    const usage = await db.select().from(aiUsage).where(eq(aiUsage.userId, person.id));
    expect(usage.map((u) => u.task)).toEqual(["medicine-label"]);

    const logged = (await (
      await log({ name: "Ibuprofen", strength: "200 mg", form: "tablet", scanId: queued.id })
    ).json()) as LoggedMedicine;
    expect(logged.log.photo).toEqual({
      thumb: `/api/medicine-scans/${queued.id}/thumb`,
      original: `/api/medicine-scans/${queued.id}/original`,
    });
    const photo = await scanPhotoRoute.GET(
      call(logged.log.photo!.thumb),
      ctx({ id: queued.id, size: "thumb" }),
    );
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/jpeg");

    session.user = ben;
    expect(
      (
        await scanPhotoRoute.GET(
          call(logged.log.photo!.thumb),
          ctx({ id: queued.id, size: "thumb" }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await scanRoute.GET(call(`/api/medicine-scans/${queued.id}`), ctx({ id: queued.id })))
        .status,
    ).toBe(404);
    // Someone else's scan cannot be attached to a log.
    expect((await log({ name: "Ibuprofen", scanId: queued.id })).status).toBe(404);

    // Removing the log removes its photo (row, then files).
    session.user = person;
    const row = (await db.select().from(medicineScans).where(eq(medicineScans.id, queued.id)))[0]!;
    const file = resolvePhotoPath(row.thumbPath)!;
    expect(existsSync(file)).toBe(true);
    await logRoute.DELETE(
      call(`/api/medicine-logs/${logged.log.id}`, "DELETE"),
      ctx({ id: logged.log.id }),
    );
    expect(await db.$count(medicineScans, eq(medicineScans.id, queued.id))).toBe(0);
    expect(existsSync(file)).toBe(false);
  });

  it("says when the photo shows no medicine, and when the provider refuses the key", async () => {
    const person = await asUser();
    await saveProviderKey(person.id, "google", TEST_API_KEY);
    session.user = person;
    ai.queue(
      "google",
      aiReplies.google.json({
        is_medicine: false,
        name: "",
        strength: "",
        form: "unknown",
        active_ingredients: [],
      }),
    );
    const notMedicine = (await (await scan()).json()) as MedicineScanDto;
    await readScans();
    expect(
      (await (
        await scanRoute.GET(
          call(`/api/medicine-scans/${notMedicine.id}`),
          ctx({ id: notMedicine.id }),
        )
      ).json()) as MedicineScanDto,
    ).toMatchObject({ status: "failed", error: { kind: "not-medicine", settingsLink: false } });

    ai.queue("google", aiReplies.google.badKey);
    const refused = (await (await scan()).json()) as MedicineScanDto;
    await readScans();
    expect(
      (await (
        await scanRoute.GET(call(`/api/medicine-scans/${refused.id}`), ctx({ id: refused.id }))
      ).json()) as MedicineScanDto,
    ).toMatchObject({ status: "failed", error: { kind: "auth", settingsLink: true } });
  });

  it("refuses what an upload refuses, and removes unused photos after a day", async () => {
    const person = await asUser();
    session.user = person;
    expect((await scan("<svg onload=alert(1)>")).status).toBe(415);
    const old = (await (await scan()).json()) as MedicineScanDto;
    const kept = (await (await scan()).json()) as MedicineScanDto;
    await log({ name: "Kept", scanId: kept.id });
    await db
      .update(medicineScans)
      .set({ createdAt: new Date(Date.now() - UNUSED_SCAN_MS - 60_000) })
      .where(eq(medicineScans.userId, person.id));
    const file = resolvePhotoPath(
      (await db.select().from(medicineScans).where(eq(medicineScans.id, old.id)))[0]!.originalPath,
    )!;
    expect(await pruneUnusedScans(person.id)).toBe(1);
    expect(existsSync(file)).toBe(false);
    expect(
      (
        await db
          .select({ id: medicineScans.id })
          .from(medicineScans)
          .where(eq(medicineScans.userId, person.id))
      ).map((r) => r.id),
    ).toEqual([kept.id]);
  });
});

describe("export and delete my data", () => {
  it("exports the medicines and logs, and deleting removes them with the label photos", async () => {
    const person = await asUser();
    session.user = person;
    const vitamin = await addMedicine({ name: "Vitamin D", strength: "1000 IU" });
    await log({ medicineId: vitamin.id });
    const photo = (await (await scan()).json()) as MedicineScanDto;
    await log({ name: "Ibuprofen", scanId: photo.id });
    const data = (await exportUserData(person.id))!;
    expect(data.medicines.map((m) => m.name)).toEqual(["Vitamin D"]);
    expect(data.medicineLogs.map((l) => l.name).sort()).toEqual(["Ibuprofen", "Vitamin D"]);

    const file = resolvePhotoPath(
      (await db.select().from(medicineScans).where(eq(medicineScans.id, photo.id)))[0]!
        .originalPath,
    )!;
    expect(existsSync(file)).toBe(true);
    // Someone else's medicines stay.
    session.user = ben;
    await addMedicine({ name: "Ben's vitamin" });
    await deleteUserData(person.id);
    expect(await db.$count(medicines, eq(medicines.userId, person.id))).toBe(0);
    expect(await db.$count(medicineLogs, eq(medicineLogs.userId, person.id))).toBe(0);
    expect(await db.$count(medicineScans, eq(medicineScans.userId, person.id))).toBe(0);
    expect(existsSync(file)).toBe(false);
    expect(await db.$count(medicines, eq(medicines.userId, ben.id))).toBe(1);
  });
});
