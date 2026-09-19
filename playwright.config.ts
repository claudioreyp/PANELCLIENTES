import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:5175", trace: "on-first-retry" },
  webServer: {
    command: "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5175 --strictPort",
    env: {
      VITE_API_BASE_URL: "http://127.0.0.1:8000/api/v1",
      VITE_DEV_AUTH_TOKEN: "playwright-local-token",
      VITE_DEV_BUSINESS_ID: "1",
      VITE_DEV_BRANCH_ID: "1",
    },
    port: 5175,
    reuseExistingServer: false,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
