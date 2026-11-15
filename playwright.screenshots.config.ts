import { existsSync } from "node:fs";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

// The README's screenshots (`pnpm run screenshots`), kept out of the end-to-end run: the same
// throwaway stack as playwright.config.ts (tests/e2e/serve.mjs: test Postgres, a production build,
// the worker and the mock AI provider), a demo account filled with made-up data
// (tests/screenshots/demo-data.ts), and the images written to docs/screenshots/.
//
// Phones are 390 x 844 at device scale 2, in the light and the dark theme; one desktop image is
// 1280 wide. The clock zone is UTC so the made-up times read the same on every machine.
const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
if (existsSync(path.join(root, ".env.test.local")))
  process.loadEnvFile(path.join(root, ".env.test.local"));

const port = Number(process.env.CAL_E2E_PORT || 3100);
const pgPort = Number(process.env.CAL_TEST_PG_PORT || 55432);
// A database of its own, so the end-to-end database is never touched.
process.env.E2E_DATABASE_URL =
  process.env.CAL_TEST_DATABASE_URL?.replace(/\/[^/]*$/, "/cal_screenshots") ??
  `postgres://postgres:cal-test-only@127.0.0.1:${pgPort}/cal_screenshots`;
const baseURL = `http://127.0.0.1:${port}`;

const phone = {
  ...devices["Pixel 7"],
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  channel: "msedge",
  permissions: ["camera"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
};

export default defineConfig({
  testDir: "tests/screenshots",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results/screenshots",
  timeout: 300_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    timezoneId: "UTC",
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "off",
    video: "off",
  },
  projects: [
    { name: "phone-light", use: { ...phone, colorScheme: "light" } },
    { name: "phone-dark", use: { ...phone, colorScheme: "dark" } },
    {
      name: "desktop-light",
      use: {
        ...devices["Desktop Edge"],
        channel: "msedge",
        viewport: { width: 1280, height: 860 },
        deviceScaleFactor: 1,
        colorScheme: "light",
      },
    },
  ],
  webServer: {
    command: "node tests/e2e/serve.mjs",
    url: `${baseURL}/api/health`,
    timeout: 600_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      CAL_E2E_PORT: String(port),
      E2E_DATABASE_URL: process.env.E2E_DATABASE_URL,
    },
  },
});
