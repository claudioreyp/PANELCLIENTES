import { defineConfig } from "@playwright/test";

// Opt-in renderer-only validation: npx playwright test --config scripts/thermal-height.playwright.config.ts
// QZ_INSTALL_DIR and QZ_HEIGHT_HEAP_MB optionally select the installed runtime and child-process heap.
// No dev server, printer, QZ settings or external user-data directories are used.
export default defineConfig({
  testDir: "../e2e",
  testMatch: "thermal-height.spec.ts",
  metadata: { qzHeightHarness: true },
  outputDir: "../node_modules/.cache/qz-height/playwright",
  reporter: "line",
  workers: 1,
  retries: 0,
  timeout: 180_000,
  use: { headless: true, trace: "off", screenshot: "off", video: "off" },
});
