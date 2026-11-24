// 24-11-2026 (opdracht 6): browser tests of the main flows. They run against the local studio (port 3200) with a fake
// session and fake data: every request to the database and the worker is answered by e2e/mock.ts, so the tests never
// use Milan's account and never change anything real. Run: npx playwright test (uses the Edge that comes with Windows;
// the Playwright Chromium download was blocked on this pc, 24-11-2026)
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:3200", trace: "retain-on-failure", channel: "msedge" },
  webServer: { command: "npm run dev", url: "http://localhost:3200", reuseExistingServer: true, timeout: 120_000 },
});
