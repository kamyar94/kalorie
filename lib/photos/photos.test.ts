import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fitWithin, parseExifDate } from "./client";
import { PhotoError, processPhoto } from "./intake";
import { sniffImageType } from "./sniff";
import { photoRelativePath, readPhotoFile, resolvePhotoPath, writePhotoFile } from "./storage";

const image = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } });

describe("image type from content", () => {
  it("recognises JPEG, PNG, WebP and HEIC by their first bytes", async () => {
    expect(sniffImageType(await image(8, 8).jpeg().toBuffer())).toBe("image/jpeg");
    expect(sniffImageType(await image(8, 8).png().toBuffer())).toBe("image/png");
    expect(sniffImageType(await image(8, 8).webp().toBuffer())).toBe("image/webp");
    const heic = Buffer.from("\0\0\0\x18ftypheic\0\0\0\0mif1heic", "latin1");
    expect(sniffImageType(heic)).toBe("image/heic");
    expect(sniffImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("photo intake", () => {
  it("stores three sizes without any metadata, upright", async () => {
    const withExif = await image(3000, 2000)
      .jpeg()
      .withExif({ IFD0: { Make: "TestCam", Copyright: "someone" } })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const out = await processPhoto(withExif);
    // Orientation 6 means the camera was rotated: the stored photo is portrait.
    expect([out.width, out.height]).toEqual([1365, 2048]);
    for (const [buffer, edge] of [
      [out.original, 2048],
      [out.analysis, 1280],
      [out.thumb, 400],
    ] as const) {
      const meta = await sharp(buffer).metadata();
      expect(meta.format).toBe("jpeg");
      expect(Math.max(meta.width!, meta.height!)).toBe(edge);
      expect(meta.exif).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(meta.orientation ?? 1).toBe(1);
    }
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never enlarges small photos", async () => {
    const out = await processPhoto(await image(300, 200).png().toBuffer());
    expect([out.width, out.height]).toEqual([300, 200]);
  });

  it("refuses files that are not images and images with too many pixels", async () => {
    await expect(processPhoto(Buffer.from("not an image"))).rejects.toThrow(PhotoError);
    const saved = process.env.PHOTO_MAX_PIXELS;
    process.env.PHOTO_MAX_PIXELS = "10000";
    try {
      await expect(processPhoto(await image(200, 200).jpeg().toBuffer())).rejects.toThrow(
        /too many pixels/,
      );
    } finally {
      if (saved === undefined) delete process.env.PHOTO_MAX_PIXELS;
      else process.env.PHOTO_MAX_PIXELS = saved;
    }
  });
});

describe("photo storage", () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "cal-photos-"));
    process.env.PHOTO_ROOT = root;
  });
  afterAll(() => {
    delete process.env.PHOTO_ROOT;
    rmSync(root, { recursive: true, force: true });
  });

  it("writes under the root and refuses paths that leave it", async () => {
    const userId = "11111111-1111-4111-8111-111111111111";
    const relative = photoRelativePath(
      userId,
      "22222222-2222-4222-8222-222222222222",
      "thumb",
      new Date("2026-10-31T00:00:00Z"),
    );
    expect(relative).toBe(`${userId}/2026/10/22222222-2222-4222-8222-222222222222-thumb.jpg`);
    await writePhotoFile(relative, Buffer.from("x"));
    expect((await readPhotoFile(relative))?.toString()).toBe("x");
    expect(resolvePhotoPath("../outside.jpg")).toBeNull();
    expect(resolvePhotoPath(path.join(root, "abs.jpg"))).toBeNull();
    expect(await readPhotoFile("../../etc/passwd")).toBeNull();
    expect(() => photoRelativePath("../x", "y", "thumb", new Date())).toThrow();
  });
});

describe("client helpers", () => {
  it("fits the long edge within the limit without enlarging", () => {
    expect(fitWithin(4032, 3024, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3024, 4032, 2048)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(800, 600, 2048)).toEqual({ width: 800, height: 600 });
  });

  it("reads EXIF capture times with and without an offset", () => {
    const now = new Date("2026-10-31T12:00:00Z");
    expect(parseExifDate("2026:10:31 08:15:00", "+03:30", now)?.toISOString()).toBe(
      "2026-10-31T04:45:00.000Z",
    );
    const local = parseExifDate("2026:10:30 19:05:09", undefined, now)!;
    expect([local.getFullYear(), local.getMonth(), local.getDate(), local.getHours()]).toEqual([
      2026, 9, 30, 19,
    ]);
    expect(parseExifDate("1999:01:01 00:00:00", undefined, now)).toBeNull();
    expect(parseExifDate("2027:01:01 00:00:00", undefined, now)).toBeNull();
    expect(parseExifDate("garbage", undefined, now)).toBeNull();
    expect(parseExifDate(42, undefined, now)).toBeNull();
  });
});
