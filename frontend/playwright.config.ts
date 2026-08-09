import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  expect: {
    timeout: 5000
  },
  fullyParallel: false,
  outputDir: join(tmpdir(), "zhilu-playwright-results"),
  projects: [
    {
      name: "desktop-chromium",
      use: {
        browserName: "chromium",
        channel: process.env.CI ? undefined : "chrome",
        viewport: { height: 900, width: 1440 }
      }
    }
  ],
  reporter: "line",
  retries: process.env.CI ? 1 : 0,
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off"
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:3000"
  },
  workers: process.env.CI ? 1 : undefined
});
