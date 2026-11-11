// Reading product barcodes from the camera: the browser's BarcodeDetector where it exists
// (Android, macOS, iOS 17+ Safari), otherwise a WebAssembly build of ZXing served from Kal itself
// (/vendor/zxing_reader.wasm, copied from the zxing-wasm package by scripts/vendor-assets.mjs).
// Browser only.

export const PRODUCT_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;

type DetectedBarcode = { rawValue: string; format: string };
type Detector = { detect: (source: ImageBitmapSource) => Promise<DetectedBarcode[]> };
type DetectorConstructor = {
  new (options?: { formats?: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

export type BarcodeReader = {
  /** "native" (BarcodeDetector) or "wasm" (ZXing). */
  kind: "native" | "wasm";
  /** The digits of a product code in the frame, or null. */
  read: (video: HTMLVideoElement) => Promise<string | null>;
};

/** Accepts only plausible product codes (8, 12, 13 or 14 digits with a valid check digit). */
export const isProductCode = (value: string) => {
  if (!/^(\d{8}|\d{12,14})$/.test(value)) return false;
  const digits = value.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits
    .reverse()
    .reduce((total, digit, i) => total + digit * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
};

const nativeReader = async (): Promise<BarcodeReader | null> => {
  const Ctor = (globalThis as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const supported = (await Ctor.getSupportedFormats?.()) ?? [...PRODUCT_FORMATS];
    const formats = PRODUCT_FORMATS.filter((f) => supported.includes(f));
    if (!formats.length) return null;
    const detector = new Ctor({ formats });
    return {
      kind: "native",
      read: async (video) => {
        const found = await detector.detect(video);
        return found.map((b) => b.rawValue).find(isProductCode) ?? null;
      },
    };
  } catch {
    return null;
  }
};

const wasmReader = async (): Promise<BarcodeReader | null> => {
  try {
    const zxing = await import("zxing-wasm/reader");
    zxing.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith(".wasm") ? "/vendor/zxing_reader.wasm" : prefix + path,
      },
    });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    return {
      kind: "wasm",
      read: async (video) => {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (!width || !height) return null;
        // A smaller frame is enough for a barcode and much faster to scan.
        const scale = Math.min(1, 1280 / Math.max(width, height));
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const results = await zxing.readBarcodes(
          context.getImageData(0, 0, canvas.width, canvas.height),
          {
            formats: ["EAN-13", "EAN-8", "UPC-A", "UPC-E"],
            tryHarder: true,
            maxNumberOfSymbols: 1,
          },
        );
        return results.map((r) => r.text).find(isProductCode) ?? null;
      },
    };
  } catch {
    return null;
  }
};

/** The best barcode reader this browser has, or null when none works. */
export const createBarcodeReader = async () => (await nativeReader()) ?? (await wasmReader());
