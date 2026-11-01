import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

// Per-checkout test settings (container name and port of the test Postgres), git-ignored.
if (existsSync(path.join(root, ".env.test.local")))
  process.loadEnvFile(path.join(root, ".env.test.local"));

const shared = {
  resolve: { alias: { "@": root } },
};

// unit:         pure code, no database (tests next to the code, and tests/unit).
// integration:  against Postgres; each file gets its own database copied from a migrated
//               template (tests/helpers/global-setup.ts, tests/helpers/db-setup.ts).
// End-to-end tests run with Playwright (playwright.config.ts), not here.
export default defineConfig({
  ...shared,
  test: {
    restoreMocks: true,
    projects: [
      {
        ...shared,
        test: {
          name: "unit",
          environment: "node",
          include: [
            "lib/**/*.test.ts",
            "components/**/*.test.{ts,tsx}",
            "tests/unit/**/*.test.ts",
            "scripts/**/*.test.ts",
          ],
        },
      },
      {
        ...shared,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/helpers/global-setup.ts"],
          setupFiles: ["tests/helpers/db-setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
