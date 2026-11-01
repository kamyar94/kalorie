// Browser side of the photo pipeline (docs/DESIGN.md section 3). Each photo is first checked for
// its EXIF capture time (gallery photos), then drawn into a canvas at most 2048 px on the long
// edge and saved as JPEG at quality 0.85. The canvas copy has no metadata at all, so no location
// or camera details leave the device, and iPhone HEIC photos become JPEG on the way.
//
// Browser only: import from client components.
import exifr from "exifr";

import { UPLOAD_LIMITS, type CreateMealResponse } from "@/lib/contracts/meals";

export type PreparedPhoto = {
  blob: Blob;
  width: number;
  height: number;
  /** The EXIF capture time of the original, when it had one. */
  capturedAt: Date | null;
};

const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const OFFSET = /^[+-]\d{2}:\d{2}$/;

/**
 * Turns EXIF date text ("2026:10:31 12:34:56") and an optional offset ("+03:30") into a Date.
 * Without an offset the time is read in the device's own time zone. Implausible dates give null.
 */
export const parseExifDate = (value: unknown, offset?: unknown, now = new Date()) => {
  if (typeof value !== "string") return null;
  const m = EXIF_DATE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const date =
    typeof offset === "string" && OFFSET.test(offset.trim())
      ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${offset.trim()}`)
      : new Date(y, mo - 1, d, h, mi, s);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() < 2000 || date.getTime() > now.getTime() + 86_400_000) return null;
  return date;
};

/** Reads the capture time from the original file's EXIF, before anything re-encodes it. */
export const readCaptureTime = async (file: Blob): Promise<Date | null> => {
  try {
    const tags = (await exifr.parse(file, {
      pick: ["DateTimeOriginal", "CreateDate", "OffsetTimeOriginal", "OffsetTime"],
      reviveValues: false,
    })) as Record<string, unknown> | undefined;
    if (!tags) return null;
    return (
      parseExifDate(tags.DateTimeOriginal, tags.OffsetTimeOriginal ?? tags.OffsetTime) ??
      parseExifDate(tags.CreateDate, tags.OffsetTime)
    );
  } catch {
    return null;
  }
};

/** Width and height that fit inside a square of longEdge, never larger than the source. */
export const fitWithin = (width: number, height: number, longEdge: number) => {
  const scale = Math.min(1, longEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

type Drawable = { source: CanvasImageSource; width: number; height: number; close: () => void };

const decode = async (file: Blob): Promise<Drawable> => {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Fall through to an <img>, which decodes more formats on some browsers (HEIC on Safari).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("This photo could not be opened. Try another one.");
  }
};

/** Resizes one photo to JPEG without metadata, keeping its EXIF capture time aside. */
export const preparePhoto = async (
  file: Blob,
  options: { longEdge?: number; quality?: number } = {},
): Promise<PreparedPhoto> => {
  const capturedAt = await readCaptureTime(file);
  const image = await decode(file);
  try {
    const size = fitWithin(
      image.width,
      image.height,
      options.longEdge ?? UPLOAD_LIMITS.clientLongEdge,
    );
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot resize photos.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(image.source, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", options.quality ?? UPLOAD_LIMITS.clientJpegQuality),
    );
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error("This photo could not be converted.");
    return { blob, width: size.width, height: size.height, capturedAt };
  } finally {
    image.close();
  }
};

/** The meal time: the first photo's capture time, or now for photos taken in the app. */
export const mealTimeFor = (photos: PreparedPhoto[], fallback = new Date()) =>
  photos.find((photo) => photo.capturedAt)?.capturedAt ?? fallback;

export const deviceTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export class UploadError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "UploadError";
    this.status = status;
  }
}

/**
 * Sends a meal to POST /api/meals. clientId is the meal's id in the device queue: sending the
 * same meal twice (a retry after a lost connection) returns the first copy.
 */
export const uploadMeal = async (input: {
  photos: Blob[];
  eatenAt: Date;
  tz?: string;
  note?: string;
  clientId: string;
  signal?: AbortSignal;
}): Promise<CreateMealResponse> => {
  if (!input.photos.length || input.photos.length > UPLOAD_LIMITS.maxPhotos)
    throw new UploadError(`Send one to ${UPLOAD_LIMITS.maxPhotos} photos.`, 400);
  const form = new FormData();
  input.photos.forEach((photo, i) => form.append("photos", photo, `photo-${i + 1}.jpg`));
  form.set("eatenAt", input.eatenAt.toISOString());
  form.set("tz", input.tz ?? deviceTimeZone());
  form.set("clientId", input.clientId);
  if (input.note?.trim()) form.set("note", input.note.trim().slice(0, UPLOAD_LIMITS.maxNoteChars));

  let response: Response;
  try {
    response = await fetch("/api/meals", {
      method: "POST",
      body: form,
      credentials: "same-origin",
      signal: input.signal,
    });
  } catch {
    throw new UploadError("No connection. The meal will be sent when you are online.", 0);
  }
  const body = (await response.json().catch(() => null)) as
    (CreateMealResponse & { error?: string }) | null;
  if (!response.ok || !body?.meal)
    throw new UploadError(body?.error ?? "The upload did not work. Try again.", response.status);
  return body;
};
