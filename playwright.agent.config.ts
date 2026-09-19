import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testMatch: "agent-device-access.spec.ts",
  workers: 1,
  timeout: 45000,
  use: { ...base.use, baseURL: "http://127.0.0.1:5176", trace: "off" },
  webServer: [
    { command: "python ../Apis/scripts/agent_access_e2e_server.py", port: 8009, reuseExistingServer: process.env.AGENT_E2E_REUSE === "1" },
    { command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5176 --strictPort", port: 5176, reuseExistingServer: process.env.AGENT_E2E_REUSE === "1",
      env: { VITE_API_BASE_URL: "http://127.0.0.1:8009/api/v1", VITE_DEV_AUTH_TOKEN: "isolated-agent-e2e-only", VITE_DEV_BUSINESS_ID: "1", VITE_DEV_BRANCH_ID: "1", VITE_GOOGLE_MAPS_BROWSER_KEY: "", VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" } },
  ],
});
