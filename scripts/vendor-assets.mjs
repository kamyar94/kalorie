// Copies browser assets that come from packages into public/vendor/, so Cal serves them itself
// (the CSP allows no other origins): the ZXing WebAssembly barcode reader. Run by `pnpm build`,
// `pnpm dev` and the end-to-end server; public/vendor/ is not committed.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const assets = [
  {
    from: require.resolve("zxing-wasm/reader/zxing_reader.wasm"),
    to: path.join(root, "public", "vendor", "zxing_reader.wasm"),
  },
];

for (const asset of assets) {
  mkdirSync(path.dirname(asset.to), { recursive: true });
  copyFileSync(asset.from, asset.to);
}
