import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { renderThermalDocument } from "../src/lib/thermal-print";
import { createThermalPrintSample } from "../src/lib/thermal-print-sample";

for (const paperWidth of [58, 80] as const) {
  for (const kitchen of [false, true]) {
    for (const font_size of ["small", "normal", "large"] as const) {
    test(`${paperWidth} mm ${kitchen ? "kitchen" : "receipt"} ${font_size} fits the thermal roll`, async ({ page }, info) => {
      const sample = createThermalPrintSample({ businessName: "Restaurante de prueba", branchName: "Sucursal de prueba", paperWidth, kitchen });
      const html = renderThermalDocument({ ...sample, template: { ...sample.template, font_size,
        header_enabled: true, header_text: "Carta preparada al momento",
        footer_enabled: true, footer_text: "Gracias por tu visita.\nTe esperamos pronto.",
      } });
      await page.setContent(html);
      await expect(page.getByText("PRUEBA DE IMPRESION - SIN VALOR COMERCIAL", { exact: true })).toBeVisible();
      await expect(page.getByText("4 x Porción de queso", { exact: true })).toBeVisible();
      await expect(page.getByText("Sin ají; servir la salsa aparte.", { exact: false })).toBeVisible();
      await expect(page.getByText("Monto a pagar", { exact: true })).toHaveCount(kitchen ? 0 : 1);
      await expect(page.getByText("Carta preparada al momento", { exact: true })).toHaveCount(kitchen ? 0 : 1);
      await expect(page.locator(".thermal-custom-footer")).toHaveCount(kitchen ? 0 : 1);
      const overflow = await page.locator(".thermal-document").evaluate((element) => element.scrollWidth > element.clientWidth + 1);
      expect(overflow).toBe(false);
      if (process.env.IMPECCABLE_REVIEW === "1" && info.project.name === "desktop") {
        await mkdir(".impeccable/review", { recursive: true });
        await page.locator(".thermal-document").screenshot({ path: `.impeccable/review/thermal-${paperWidth}-${kitchen ? "kitchen" : "receipt"}-${font_size}.png` });
      }
    });
    }
  }
}
