import { defineConfig, devices } from "@playwright/test";

// Weimar Crisis Playwright config.
// Runs against a local static HTTP server (needed because supabase-js CORS
// blocks file:// origins).

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8765",
    viewport: { width: 420, height: 900 }, // phone-ish; SH is mobile-first
    deviceScaleFactor: 2,
    // Deterministic visuals
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "Europe/Berlin",
  },
  expect: {
    toHaveScreenshot: {
      // Small tolerance for font rendering jitter between machines
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 420, height: 900 } },
    },
  ],
  webServer: {
    command: "python3 -m http.server 8765 --bind 127.0.0.1",
    url: "http://127.0.0.1:8765",
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
