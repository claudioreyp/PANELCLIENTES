// Real local bridge/API/QZ check. Only --print-short sends one synthetic document; never creates orders.
import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const results = [];
const printShort = process.argv.includes("--print-short");
try {
  for (const role of ["owner", "cashier", "kitchen"]) {
    const context = await browser.newContext();
    await context.grantPermissions(["local-network-access"], { origin: "http://127.0.0.1:5173" });
    const page = await context.newPage();
    page.on("requestfailed", request => console.error(new URL(request.url()).pathname, request.failure()?.errorText));
    await page.route("http://127.0.0.1:5173/qz-verification", route => route.fulfill({
      contentType: "text/html", body: "<!doctype html><html><head><title>QZ verification</title></head><body>Read-only QZ check</body></html>",
    }));
    await page.goto("http://127.0.0.1:5173/qz-verification");
    const checks = await page.evaluate(async ({ role, branchId, businessId, printShort }) => {
      localStorage.setItem("impulsa.authMode", "dev");
      localStorage.setItem("impulsa.devRole", role);
      localStorage.setItem("impulsa.businessId", businessId);
      localStorage.setItem("impulsa.branchId", branchId);
      const { qzBridge } = await import("/src/lib/qz-tray.ts");
      const rounds = [];
      try {
        if (role === "owner") {
          const { apiBlob } = await import("/src/lib/api.ts");
          const bundle = await apiBlob(`/settings/branches/${branchId}/printing/qz/activation`);
          const bytes = new Uint8Array(await bundle.arrayBuffer());
          if (bundle.type !== "application/zip" || bytes[0] !== 80 || bytes[1] !== 75) throw new Error("Expected public ZIP activation package");
          rounds.push({ activationDownloadVerified: true, bytes: bytes.length });
        }
        for (let i = 0; i < 2; i++) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);
          const start = performance.now();
          try {
            const result = await qzBridge.printers(Number(branchId), controller.signal, () => {});
            if (result.mode !== "signed" || !result.printers.length) throw new Error("Expected signed printer discovery");
            rounds.push({ mode: result.mode, printers: result.printers.length, elapsedMs: Math.round(performance.now() - start) });
          } finally { clearTimeout(timeout); }
          await qzBridge.disconnect();
        }
        if (printShort && role === "cashier") {
          const { api } = await import("/src/lib/api.ts");
          const { loadSettings, printingTemplate } = await import("/src/lib/settings.ts");
          const { createThermalPrintSample } = await import("/src/lib/thermal-print-sample.ts");
          const { renderThermalDocument } = await import("/src/lib/thermal-print.ts");
          // Settings inspection requires owner; the actual QZ dispatch remains cashier-scoped.
          localStorage.setItem("impulsa.devRole", "owner");
          let context, saved;
          try {
            context = await api("/context");
            saved = await loadSettings(`/settings/branches/${branchId}/printing`, {});
          } finally { localStorage.setItem("impulsa.devRole", role); }
          const branch = context.branches.find(item => item.id === Number(branchId));
          const settings = saved.data;
          if (!saved.available || !branch || context.business.name !== "Pizza House"
              || settings.printer_name !== "Printer POS-80" || settings.print_language !== "escpos"
              || settings.paper_width_mm !== 80) throw new Error("Physical test target/configuration changed; no paper sent");
          const sample = createThermalPrintSample({ businessName: context.business.name, branchName: branch.name,
            paperWidth: settings.paper_width_mm, short: true, template: printingTemplate(settings, "customer") });
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 30000);
          try {
            await qzBridge.dispatch({ branchId: Number(branchId), printerName: settings.printer_name,
              paperWidth: settings.paper_width_mm, copies: 1, printLanguage: settings.print_language,
              html: renderThermalDocument(sample), jobName: "PRUEBA - Identidad Escalar AI POS",
              signal: controller.signal, beforeSend: async () => {}, onSending: () => {} });
            rounds.push({ shortPrintAccepted: true, printer: settings.printer_name });
          } finally { clearTimeout(timeout); }
        }
      } finally { await qzBridge.disconnect(); }
      return rounds;
    }, { role, branchId: process.env.POS_BRANCH_ID || "2", businessId: process.env.POS_BUSINESS_ID || "2", printShort });
    results.push({ role, checks });
    await context.close();
  }
  console.log(JSON.stringify({ success: true, shortPrintRequested: printShort, results }, null, 2));
} finally { await browser.close(); }
