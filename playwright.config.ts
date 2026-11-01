import { existsSync } from "node:fs";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against a production build, a worker process and a throwaway database
// (tests/e2e/serve.mjs). Microsoft Edge (channel "msedge") is used so no browser download is
// needed; Chromium's fake camera stands in for a real one. Phone and desktop sizes both run.
//
// Per-checkout settings in .env.test.local (git-ignored): CAL_TEST_PG_CONTAINER, CAL_TEST_PG_PORT,
// CAL_E2E_PORT. CAL_E2E_SKIP_BUILD=1 reuses the last build.
const root = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
if (existsSync(path.join(root, ".env.test.local")))
  process.loadEnvFile(path.join(root, ".env.test.local"));

const port = Number(process.env.CAL_E2E_PORT || 3100);
const pgPort = Number(process.env.CAL_TEST_PG_PORT || 55432);
process.env.E2E_DATABASE_URL ??=
  process.env.CAL_TEST_DATABASE_URL?.replace(/\/[^/]*$/, "/cal_e2e") ??
  `postgres://postgres:cal-test-only@127.0.0.1:${pgPort}/cal_e2e`;
const baseURL = `http://127.0.0.1:${port}`;

const camera = {
  channel: "msedge",
  permissions: ["camera"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
};

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "off",
    video: "off",
  },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"], ...camera } },
    {
      name: "desktop",
      use: { ...devices["Desktop Edge"], viewport: { width: 1280, height: 800 }, ...camera },
    },
    // The dark theme gets the same accessibility checks.
    { name: "phone-dark", use: { ...devices["Pixel 7"], ...camera, colorScheme: "dark" } },
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
