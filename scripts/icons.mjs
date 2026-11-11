// Makes the app icons in public/icons from public/icons/icon.svg with sharp:
//   pnpm icons              all of them
//   pnpm icons --android    only the Android app's launcher icons
// The maskable icon has a full-bleed background and keeps the mark inside the 80 % safe zone.
// The Android app (android/) draws its adaptive icon from the same mark as vectors
// (res/drawable/ic_launcher_*.xml); the PNGs here are for Android 7 launchers.
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "public", "icons");
const svg = await readFile(path.join(dir, "icon.svg"));

const plain = (size, file) =>
  sharp(svg, { density: Math.ceil((size / 64) * 72 * 2) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path.resolve(dir, file));

// Square icon without the rounded corners (the platform applies its own mask), mark at 70 %.
const maskable = async (size, file, background = "#1d7349") => {
  const mark = await sharp(svg, { density: Math.ceil((size / 64) * 72 * 2) })
    .resize(Math.round(size * 0.86), Math.round(size * 0.86))
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(dir, file));
};

// The Android launcher icon for each screen density (the rounded icon as it is).
const androidRes = path.join(root, "android", "app", "src", "main", "res");
const ANDROID_SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(ANDROID_SIZES)) {
  await mkdir(path.join(androidRes, `mipmap-${density}`), { recursive: true });
  await plain(size, path.join(androidRes, `mipmap-${density}`, "ic_launcher.png"));
}

if (!process.argv.includes("--android")) {
  await plain(32, "favicon-32.png");
  await plain(192, "icon-192.png");
  await plain(512, "icon-512.png");
  await maskable(512, "maskable-512.png");
  // iOS rounds the corners itself and shows transparency as black, so the touch icon is full bleed.
  await maskable(180, "apple-touch-icon.png");
}
console.log("Icons written.");
