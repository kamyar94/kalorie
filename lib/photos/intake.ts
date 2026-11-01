// Server-side photo intake with sharp (docs/DESIGN.md section 4, step 1): decode with a pixel
// limit against decompression bombs, apply the camera orientation, re-encode, and drop all
// metadata (sharp writes none unless asked). Three copies: the 2048 px original, a 1280 px copy
// for the vision call and a 400 px thumbnail.
import crypto from "node:crypto";

import sharp from "sharp";

export const PHOTO_SIZES = {
  original: { edge: 2048, quality: 85 },
  analysis: { edge: 1280, quality: 82 },
  thumb: { edge: 400, quality: 75 },
} as const;

export type PhotoVariant = keyof typeof PHOTO_SIZES;

export type ProcessedPhoto = {
  original: Buffer;
  analysis: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  /** SHA-256 of the stored original. */
  sha256: string;
};

export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoError";
  }
}

/** Largest decoded image accepted: PHOTO_MAX_PIXELS or 40 megapixels. */
export const maxInputPixels = () => {
  const value = Number(process.env.PHOTO_MAX_PIXELS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 40_000_000;
};

const encode = (input: Buffer, edge: number, quality: number) =>
  sharp(input, { limitInputPixels: maxInputPixels(), failOn: "error" })
    .rotate()
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:2:0" })
    .toBuffer({ resolveWithObject: true });

/** Decodes and re-encodes one upload. Throws PhotoError for anything that is not a usable image. */
export const processPhoto = async (input: Buffer): Promise<ProcessedPhoto> => {
  try {
    const meta = await sharp(input, { limitInputPixels: maxInputPixels() }).metadata();
    if (!meta.width || !meta.height) throw new PhotoError("The photo could not be read.");
    if ((meta.pages ?? 1) > 1) throw new PhotoError("Animated images are not accepted.");
    const original = await encode(input, PHOTO_SIZES.original.edge, PHOTO_SIZES.original.quality);
    const [analysis, thumb] = await Promise.all([
      encode(original.data, PHOTO_SIZES.analysis.edge, PHOTO_SIZES.analysis.quality),
      encode(original.data, PHOTO_SIZES.thumb.edge, PHOTO_SIZES.thumb.quality),
    ]);
    return {
      original: original.data,
      analysis: analysis.data,
      thumb: thumb.data,
      width: original.info.width,
      height: original.info.height,
      sha256: crypto.createHash("sha256").update(original.data).digest("hex"),
    };
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/pixel limit/i.test(message)) throw new PhotoError("The photo has too many pixels.");
    throw new PhotoError("The photo could not be read.");
  }
};
