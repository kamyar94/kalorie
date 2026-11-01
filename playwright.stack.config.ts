import { defineConfig, devices } from "@playwright/test";

// Smoke test of the Docker stack (deploy/test/Test-Stack.ps1 starts the stack and runs this): the
// real image, worker, database and egress proxy behind 127.0.0.1:3206, with a stand-in for the AI
// provider. Microsoft Edge (channel "msedge") needs no browser download; Chromium's fake camera
// stands in for a real one. CAL_STACK_URL, CAL_STACK_INVITE_A and CAL_STACK_INVITE_B come from
// the script (two single-use invite codes made with Cal.ps1).
const baseURL = process.env.CAL_STACK_URL ?? "http://127.0.0.1:3206";

export default defineConfig({
  testDir: "tests/stack",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results/stack",
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL, trace: "off", screenshot: "off", video: "off" },
  projects: [
    {
      name: "phone",
      use: {
        ...devices["Pixel 7"],
        channel: "msedge",
        permissions: ["camera"],
        launchOptions: {
          args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
        },
      },
    },
  ],
});
