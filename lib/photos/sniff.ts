// Image type from the first bytes of a file, never from its name or the browser's claim.

export type SniffedImage = "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/avif";

/** The image type of the bytes, or null when they are not an image Cal knows. */
export const sniffImageType = (bytes: Uint8Array): SniffedImage | null => {
  const at = (i: number) => bytes[i] ?? -1;
  const ascii = (start: number, text: string) =>
    [...text].every((char, i) => at(start + i) === char.charCodeAt(0));
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (ascii(0, "\x89PNG\r\n\x1a\n")) return "image/png";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(4, "ftyp")) {
    const brand = String.fromCharCode(at(8), at(9), at(10), at(11));
    if (["avif", "avis"].includes(brand)) return "image/avif";
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"].includes(brand))
      return "image/heic";
  }
  return null;
};

/** Types the server decodes. HEIC is converted to JPEG on the device before upload. */
export const ACCEPTED_UPLOAD_TYPES: readonly SniffedImage[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];
