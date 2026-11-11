// Body photos against Postgres and a temporary PHOTO_ROOT: the original kept at full size without
// metadata next to a view copy and a thumbnail, one session per day and one photo per pose (again
// replaces), the list, owner-only reads (an admin gets 404 too), removal with the files, refused
// uploads, nothing queued for an AI, the export, and "Delete my data".
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { bodyPhotos, bodyPhotoSessions, jobs } from "@/db/schema";
import { deleteUserData, exportUserData } from "@/lib/account/data";
import type { SessionUser } from "@/lib/auth/accounts";
import type { BodyPhotoDto, BodySessionDto } from "@/lib/contracts/body-photos";
import { localParts, shiftLocalDate } from "@/lib/meals/time";
import { resolvePhotoPath } from "@/lib/photos/storage";
import { createUser } from "@/tests/helpers/factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => session.user }));

const listRoute = await import("@/app/api/body-photos/route");
const itemRoute = await import("@/app/api/body-photos/[id]/route");
const fileRoute = await import("@/app/api/body-photos/[id]/[size]/route");

const ORIGIN = "http://127.0.0.1:3201";
const HEADERS = { origin: ORIGIN, "x-forwarded-host": "127.0.0.1:3201" };
const TZ = "Europe/Berlin";
let root: string;
let ann: SessionUser;
let ben: SessionUser;

const asUser = async (role: "member" | "admin" = "member") => {
  const row = await createUser({ timeZone: TZ, role });
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    timeZone: row.timeZone,
    units: row.units,
  };
};

/** A tall photo larger than meal photos are kept, with EXIF metadata in it. */
const photo = (width = 2400, height = 3200) =>
  sharp({ create: { width, height, channels: 3, background: "#b8a48c" } })
    .withExif({ IFD0: { Make: "Example camera", Artist: "Someone" } })
    .jpeg({ quality: 80 })
    .toBuffer();

const upload = async (fields: Record<string, string>, bytes?: Buffer | string) => {
  const form = new FormData();
  const data = bytes ?? (await photo());
  form.set(
    "photo",
    new Blob([typeof data === "string" ? data : new Uint8Array(data)]),
    "front.jpg",
  );
  for (const [key, value] of Object.entries({
    tz: TZ,
    takenAt: new Date().toISOString(),
    ...fields,
  }))
    form.set(key, value);
  const response = await listRoute.POST(
    new NextRequest(`${ORIGIN}/api/body-photos`, { method: "POST", body: form, headers: HEADERS }),
  );
  return {
    status: response.status,
    body: (await response.json()) as {
      session: BodySessionDto;
      photo: BodyPhotoDto;
      error?: string;
    },
  };
};

const read = (id: string, size: string) =>
  fileRoute.GET(new NextRequest(`${ORIGIN}/api/body-photos/${id}/${size}`), {
    params: Promise.resolve({ id, size }),
  });

const remove = (id: string) =>
  itemRoute.DELETE(
    new NextRequest(`${ORIGIN}/api/body-photos/${id}`, { method: "DELETE", headers: HEADERS }),
    { params: Promise.resolve({ id }) },
  );

const filesOf = async (id: string) =>
  (
    await db
      .select({ a: bodyPhotos.originalPath, b: bodyPhotos.viewPath, c: bodyPhotos.thumbPath })
      .from(bodyPhotos)
      .where(eq(bodyPhotos.id, id))
  ).flatMap((r) => [r.a, r.b, r.c]);

beforeAll(async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "cal-body-photos-"));
  process.env.PHOTO_ROOT = root;
  ann = await asUser();
  ben = await asUser("admin");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
  session.user = ann;
  await db.execute(sql`delete from rate_limits`);
});

describe("body photos", () => {
  it("keeps the original at full size without metadata, with a view copy and a thumbnail", async () => {
    const saved = await upload({ pose: "front", facing: "user" });
    expect(saved.status).toBe(201);
    expect(saved.body.photo).toMatchObject({
      pose: "front",
      width: 2400,
      height: 3200,
      facing: "user",
      source: "camera",
    });
    expect(saved.body.session.localDate).toBe(localParts(new Date(), TZ).date);
    const original = await read(saved.body.photo.id, "original");
    expect(original.status).toBe(200);
    expect(original.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    const meta = await sharp(Buffer.from(await original.arrayBuffer())).metadata();
    expect([meta.width, meta.height, meta.exif]).toEqual([2400, 3200, undefined]);
    const view = await sharp(
      Buffer.from(await (await read(saved.body.photo.id, "view")).arrayBuffer()),
    ).metadata();
    expect(Math.max(view.width!, view.height!)).toBe(1600);
    const thumb = await sharp(
      Buffer.from(await (await read(saved.body.photo.id, "thumb")).arrayBuffer()),
    ).metadata();
    expect(Math.max(thumb.width!, thumb.height!)).toBe(400);
    expect((await filesOf(saved.body.photo.id)).every((f) => f.startsWith(`${ann.id}/body/`))).toBe(
      true,
    );

    // Nothing was queued for an AI.
    expect(await db.select().from(jobs).where(eq(jobs.userId, ann.id))).toEqual([]);
  });

  it("groups a day's poses in one session and replaces a pose taken again", async () => {
    const person = await asUser();
    session.user = person;
    const first = await upload({ pose: "left" });
    const files = await filesOf(first.body.photo.id);
    const again = await upload({ pose: "left" });
    const back = await upload({ pose: "back", source: "gallery" });
    expect(again.body.session.id).toBe(first.body.session.id);
    expect(back.body.session.photos.map((p) => [p.pose, p.source])).toEqual([
      ["left", "camera"],
      ["back", "gallery"],
    ]);
    expect(files.every((f) => !existsSync(resolvePhotoPath(f)!))).toBe(true);

    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    await upload({ pose: "front", takenAt: yesterday });
    const list = (await (
      await listRoute.GET(new NextRequest(`${ORIGIN}/api/body-photos`))
    ).json()) as {
      sessions: BodySessionDto[];
    };
    expect(list.sessions.map((s) => [s.localDate, s.photos.length])).toEqual([
      [localParts(new Date(), TZ).date, 2],
      [shiftLocalDate(localParts(new Date(), TZ).date, -1), 1],
    ]);
  });

  it("is read only by the person who took it, not by an admin either", async () => {
    const saved = await upload({ pose: "right" });
    session.user = ben;
    for (const size of ["original", "view", "thumb"])
      expect((await read(saved.body.photo.id, size)).status).toBe(404);
    expect((await remove(saved.body.photo.id)).status).toBe(404);
    const list = (await (
      await listRoute.GET(new NextRequest(`${ORIGIN}/api/body-photos`))
    ).json()) as {
      sessions: BodySessionDto[];
    };
    expect(list.sessions).toEqual([]);
    session.user = ann;
    expect((await read(saved.body.photo.id, "large")).status).toBe(404);
  });

  it("removes a photo with its files, and the day's session with its last photo", async () => {
    const person = await asUser();
    session.user = person;
    const saved = await upload({ pose: "front" });
    const files = await filesOf(saved.body.photo.id);
    expect((await remove(saved.body.photo.id)).status).toBe(200);
    expect(files.every((f) => !existsSync(resolvePhotoPath(f)!))).toBe(true);
    expect(
      await db.select().from(bodyPhotoSessions).where(eq(bodyPhotoSessions.userId, person.id)),
    ).toEqual([]);
  });

  it("refuses a missing pose, a file that is not a photo, one too large, an odd time", async () => {
    expect((await upload({})).status).toBe(400);
    expect((await upload({ pose: "side" })).status).toBe(400);
    expect((await upload({ pose: "front" }, "not a photo")).status).toBe(415);
    expect((await upload({ pose: "front" }, Buffer.alloc(20 * 1024 * 1024 + 1))).status).toBe(413);
    expect(
      (await upload({ pose: "front", takenAt: new Date(Date.now() + 86_400_000).toISOString() }))
        .status,
    ).toBe(400);
  });

  it("is in the export (without the files) and goes with Delete my data", async () => {
    const person = await asUser();
    session.user = person;
    const saved = await upload({ pose: "front" });
    const files = await filesOf(saved.body.photo.id);
    const data = await exportUserData(person.id);
    expect(data!.bodyPhotos).toEqual([
      expect.objectContaining({
        localDate: saved.body.session.localDate,
        photos: [expect.objectContaining({ pose: "front", width: 2400 })],
      }),
    ]);
    await deleteUserData(person.id);
    expect(files.every((f) => !existsSync(resolvePhotoPath(f)!))).toBe(true);
    const left = await db.execute(sql`
      select (select count(*) from body_photos where user_id = ${person.id})::int as p,
             (select count(*) from body_photo_sessions where user_id = ${person.id})::int as s`);
    expect(left.rows[0]).toEqual({ p: 0, s: 0 });
  });
});
