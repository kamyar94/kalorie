// Bundles the plain Node entry points next to the Next.js build, for the container image:
//   dist/start.mjs   migrations, then the web server     (scripts/start.mjs)
//   dist/cal.mjs     the server tool                     (scripts/cal.mjs)
//   dist/worker.mjs  the background job worker           (worker/index.ts)
//   dist/fdc-import.mjs, dist/seed-dishes.mjs   food data commands that dist/cal.mjs loads
// sharp stays external (native module, copied with node_modules).
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await build({
  absWorkingDir: root,
  entryPoints: {
    start: "scripts/start.mjs",
    cal: "scripts/cal.mjs",
    worker: "worker/index.ts",
    "fdc-import": "scripts/fdc-import.mjs",
    "seed-dishes": "scripts/seed-dishes.mjs",
  },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  sourcemap: true,
  external: ["sharp", "pg-native"],
  // "server-only" guards web code against client bundles; in Node it is a no-op.
  alias: { "server-only": path.join(root, "scripts", "empty.mjs") },
  banner: {
    js: "import { createRequire as __calRequire } from 'node:module'; const require = __calRequire(import.meta.url);",
  },
  logLevel: "warning",
});
console.log(
  "Bundled dist/start.mjs, dist/cal.mjs, dist/worker.mjs, dist/fdc-import.mjs and dist/seed-dishes.mjs.",
);
