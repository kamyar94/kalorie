// Makes the app icons in public/icons from public/icons/icon.svg with sharp:
//   pnpm icons
// The maskable icon has a full-bleed background and keeps the mark inside the 80 % safe zone.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const svg = await readFile(path.join(dir, "icon.svg"));

const plain = (size, file) =>
  sharp(svg, { density: Math.ceil((size / 64) * 72 * 2) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(dir, file));

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

await plain(32, "favicon-32.png");
await plain(192, "icon-192.png");
await plain(512, "icon-512.png");
await maskable(512, "maskable-512.png");
// iOS rounds the corners itself and shows transparency as black, so the touch icon is full bleed.
await maskable(180, "apple-touch-icon.png");
console.log(`Icons written to ${path.relative(process.cwd(), dir)}`);
