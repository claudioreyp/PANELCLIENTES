import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderThermalDocument, type ThermalPrintTemplate } from "../src/lib/thermal-print";
import { createThermalPrintSample } from "../src/lib/thermal-print-sample";
import type { ThermalMeasurement } from "../src/lib/thermal-measure";

const root = path.resolve(import.meta.dirname, "..");
const heapMb = Number(process.env.QZ_HEIGHT_HEAP_MB || "512");
// Keep evidence outside the general E2E suite's automatically emptied test-results directory.
const artifacts = path.join(root, "node_modules", ".cache", "qz-height", `artifacts-${heapMb}`);
// Fixed regression ceilings for these fixtures, independent of measured height or engine drift.
const maxBlankTailRows = { short: 40, long: 144 } as const;
type ProbeWindow = Window & { thermalProbe: { measureThermalDocument: (html: string, width: 58 | 80, signal: AbortSignal) => Promise<ThermalMeasurement> } };

test("exact thermal HTML height versus installed QZ JavaFX without any printer access", async ({ page }, testInfo) => {
  test.skip(testInfo.config.metadata.qzHeightHarness !== true, "Opt in with scripts/thermal-height.playwright.config.ts; requires the local QZ runtime.");
  const bundled = await build({
    stdin: { contents: 'export { measureThermalDocument } from "./src/lib/thermal-measure";', resolveDir: root },
    bundle: true, write: false, format: "iife", globalName: "thermalProbe", platform: "browser",
  });
  await page.route("**/*", (route) => route.abort());
  await page.setContent('<html><head><style>body {font:80px serif} div {min-height:99999px}</style></head><body>Unrelated POS styles</body></html>');
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  await mkdir(artifacts, { recursive: true });
  const fixtures = [];
  // Alternate heights and widths in one JavaFX instance to expose state leaking between documents.
  for (const font_size of ["small", "normal", "large"] as const) {
    for (const short of [false, true]) {
      for (const paperWidth of [58, 80] as const) {
        for (const kitchen of [false, true]) {
          const name = `${paperWidth}-${font_size}-${short ? "short" : "long"}-${kitchen ? "kitchen" : "receipt"}`;
          const template: ThermalPrintTemplate = { font_size, header_enabled: true, footer_enabled: true,
            header_text: "ENCABEZADO DE PRUEBA\nSegunda linea del encabezado.",
            footer_text: "PIE DE PRUEBA\nUltima linea completa: 0123456789." };
          const sample = createThermalPrintSample({ paperWidth, kitchen, short, template, businessName: "Restaurante sintetico", branchName: "Sucursal sintetica" });
          if (!short) {
            sample.order.items = Array.from({ length: 8 }, (_, index) => ({ ...sample.order.items[0], id: -index - 1 }));
            sample.order.channel = "dine_in";
            sample.order.table_context = { table_id: 0, table_name: "Mesa de prueba", area_name: "Terraza sintetica" } as typeof sample.order.table_context;
            if (sample.ticket) {
              sample.ticket.items = Array.from({ length: 8 }, (_, index) => ({ ...sample.ticket!.items[0], item_id: -index - 1 }));
              sample.ticket.context = { channel: "dine_in", table_name: "Mesa de prueba", area_name: "Terraza sintetica" };
            }
          }
          const html = renderThermalDocument(sample);
          const measured = await page.evaluate(async ({ html, paperWidth }) => {
            return (window as ProbeWindow).thermalProbe.measureThermalDocument(html, paperWidth, new AbortController().signal);
          }, { html, paperWidth });
          const repeated = await page.evaluate(async ({ html, paperWidth }) => {
            return (window as ProbeWindow).thermalProbe.measureThermalDocument(html, paperWidth, new AbortController().signal);
          }, { html, paperWidth });
          expect(repeated).toEqual(measured);
          expect(measured.widthCssPx).toBeCloseTo(paperWidth * 96 / 25.4, 6);
          expect(measured.pageHeightDots).toBe(Math.ceil(measured.heightCssPx * (paperWidth === 58 ? 384 : 576) / measured.widthCssPx) + 2);
          expect(await page.locator("iframe").count()).toBe(0);
          await writeFile(path.join(artifacts, `${name}.html`), html);
          fixtures.push({ name, paperWidth, maxBlankTailRows: maxBlankTailRows[short ? "short" : "long"], fontScale: { small: 0.85, normal: 1, large: 1.2 }[font_size], rasterWidth: paperWidth === 58 ? 384 : 576, ...measured });
        }
      }
    }
  }
  const manifest = path.join(artifacts, "fixtures.json");
  await writeFile(manifest, JSON.stringify(fixtures, null, 2));
  const javaHome = path.join(artifacts, "java-home"), temp = path.join(artifacts, "tmp");
  await mkdir(javaHome, { recursive: true }); await mkdir(temp, { recursive: true });
  const qz = process.env.QZ_INSTALL_DIR || "C:\\Program Files\\QZ Tray";
  const args = [`-Xmx${heapMb}m`, "--enable-native-access=ALL-UNNAMED", "-Djava.awt.headless=true", "-Dprism.order=sw",
    `-Duser.home=${javaHome}`, `-Djava.io.tmpdir=${temp}`, `-Djna.tmpdir=${temp}`,
    `-Djava.library.path=${path.join(qz, "libs")}`, `-Dlog4j.configurationFile=${path.join(root, "scripts", "qz-height-log4j2.xml")}`,
    "--class-path", path.join(qz, "qz-tray.jar"), path.join(root, "scripts", "ThermalHeightHarness.java"), manifest];
  const output = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(path.join(qz, "runtime", "bin", "java.exe"), args, {
      cwd: artifacts, windowsHide: true,
      env: { ...process.env, APPDATA: javaHome, LOCALAPPDATA: javaHome, USERPROFILE: javaHome, TEMP: temp, TMP: temp },
    });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Isolated JavaFX harness timed out")); }, 120_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  await writeFile(path.join(artifacts, "harness-stdout.log"), output.stdout);
  await writeFile(path.join(artifacts, "harness-stderr.log"), output.stderr);
  expect(output.code, output.stderr).toBe(0);
  const results = JSON.parse(await readFile(path.join(artifacts, "javafx-results.json"), "utf8"));
  expect(results).toHaveLength(fixtures.length);
  for (const result of results) {
    expect.soft(result.bottomClipped, `${result.name}: ${JSON.stringify(result)}`).toBe(false);
    expect.soft(result.stableLayout, `${result.name}: reference retains layout`).toBe(true);
    expect.soft(result.fixedInk.inkRows, result.name).toBeGreaterThan(0);
    expect.soft(result.referenceInk.inkRows, result.name).toBeGreaterThan(0);
    expect.soft(Math.abs(result.fixedInk.lastRow - result.referenceInk.lastRow), `${result.name}: expanded reference last ink row`).toBeLessThanOrEqual(2);
    expect.soft(Math.abs(result.fixedInk.lastRow - result.repeatedInk.lastRow), `${result.name}: repeated ink position`).toBeLessThanOrEqual(2);
    expect.soft(result.rasterWidth, result.name).toBe(result.paperWidth === 58 ? 384 : 576);
    const fixture = fixtures.find((fixture) => fixture.name === result.name)!;
    expect.soft(result.fixedInk.tailRows, `${result.name}: independent blank-tail ceiling`).toBeLessThanOrEqual(fixture.maxBlankTailRows);
    expect.soft(result.repeatedInk.tailRows, `${result.name}: repeated independent blank-tail ceiling`).toBeLessThanOrEqual(fixture.maxBlankTailRows);
    expect.soft(parseFloat(result.fixedDom.fontSize), `${result.name}: installed JavaFX font size`).toBeCloseTo((result.paperWidth === 58 ? 9 : 10) * fixture.fontScale * 96 / 72, 2);
    const dotsPerCssPx = result.rasterWidth / (result.paperWidth * 96 / 25.4);
    const measuredSlack = Math.max(0, -result.heightDeltaCssPx);
    // Account explicitly for measured cross-engine drift, the retained 3 mm padding and the last line box.
    const tailBudget = Math.ceil((measuredSlack + 3 * 96 / 25.4 + parseFloat(result.fixedDom.fontSize) * 1.5) * dotsPerCssPx) + 2;
    expect.soft(result.fixedInk.tailRows, `${result.name}: tail beyond measured content/margins`).toBeLessThanOrEqual(tailBudget);
  }
});
