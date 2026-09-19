import { resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./helpers/parity-workspace";
import { mockCompletedManualPrint } from "./helpers/manual-print";

test.use({
  storageState: { cookies: [], origins: [] }, serviceWorkers: "block",
  locale: "es-PE", timezoneId: "America/Lima", colorScheme: "light",
  contextOptions: { reducedMotion: "reduce" },
});

test.beforeEach(async ({ page, parityMock }) => {
  parityMock.tableHistory = true;
  await page.addInitScript(() => {
    window.print = () => sessionStorage.setItem("history-print", document.querySelector(".order-print-document")?.textContent || "");
  });
});

async function tab(page: Page, name: string) {
  const trigger = page.getByRole("tab", { name, exact: true });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-selected", "true");
}

async function openHistory(page: Page) {
  await page.goto("/pedidos");
  await expect(page.getByRole("region", { name: "Lista de pedidos" })).toBeVisible();
  await tab(page, "Panel de mesas");
  await page.getByRole("button", { name: "Ver historial", exact: true }).click();
  const history = page.getByRole("region", { name: "Historial de mesas", exact: true });
  await expect(history.getByText("Todo el historial", { exact: true })).toBeVisible();
  return history;
}

function orderButton(page: Page, folio: number) {
  return page.getByRole("button", { name: new RegExp(`^Abrir pedido ${folio} de `) });
}

async function expectBounded(page: Page, surface: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(await surface.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
}

async function expectPrefixClear(input: Locator, prefixSelector: string) {
  await expect(input).toBeVisible();
  const geometry = await input.evaluate((element, selector) => {
    const inputBox = element.getBoundingClientRect();
    const prefix = element.parentElement!.querySelector(selector)!;
    const prefixBox = prefix.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      textStart: inputBox.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
      prefixRight: prefixBox.right, inputLeft: inputBox.left, prefixLeft: prefixBox.left,
      centerDifference: Math.abs((prefixBox.top + prefixBox.bottom - inputBox.top - inputBox.bottom) / 2),
      pointerEvents: getComputedStyle(prefix).pointerEvents,
    };
  }, prefixSelector);
  expect(geometry.textStart - geometry.prefixRight).toBeGreaterThanOrEqual(4);
  expect(geometry.prefixLeft).toBeGreaterThan(geometry.inputLeft);
  expect(geometry.centerDifference).toBeLessThanOrEqual(2);
  expect(geometry.pointerEvents).toBe("none");
}

test("all orders include old dates newest first, search the entire branch and paginate by twelve", async ({ page, parityMock }) => {
  await page.goto("/pedidos");
  const list = page.getByRole("region", { name: "Lista de pedidos", exact: true });
  const buttons = list.getByRole("button", { name: /^Abrir pedido / });
  await expect(buttons).toHaveCount(12);
  await expect(list.getByText("1 - 12 de 18 pedidos", { exact: true })).toBeVisible();
  expect(await buttons.evaluateAll((elements) => elements.map((element) => Number(element.getAttribute("aria-label")!.split(" ")[2])))).toEqual([301, 302, 300, 201, 202, 203, 204, 205, 206, 207, 208, 209]);
  await expect(page.getByText("Todo el historial", { exact: true })).toBeVisible();
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await expect(list.getByRole("button", { name: "Página anterior" })).toBeDisabled();
  await list.getByRole("button", { name: "Página siguiente" }).click();
  await expect(list.getByText("13 - 18 de 18 pedidos", { exact: true })).toBeVisible();
  await expect(buttons).toHaveCount(6);
  await expect(list.getByRole("button", { name: "Página siguiente" })).toBeDisabled();
  await expect(list.getByText("Archivo de 2023", { exact: true }).filter({ visible: true })).toBeVisible();
  const search = page.getByRole("textbox", { name: "Buscar pedidos" });
  for (const value of ["Archivo de 2023", "215", "+51999000215"]) {
    await search.fill(value);
    await expect(orderButton(page, 215)).toBeVisible();
    await expect(buttons).toHaveCount(1);
    await expect(list.getByText("1 - 1 de 1 pedido", { exact: true })).toBeVisible();
    await expect(list.getByRole("button", { name: "Página anterior" })).toBeDisabled();
  }
  await search.fill("Otra sucursal excluida");
  await expect(list.getByText("No hay pedidos", { exact: true })).toBeVisible();
  await search.fill("");
  await expect(buttons).toHaveCount(12);
  const queries = parityMock.reads.filter((read) => read.path === "/orders/workspace").map((read) => new URLSearchParams(read.query));
  expect(queries.some((query) => query.get("page") === "2")).toBe(true);
  expect(queries.every((query) => query.get("period") === "all" && query.get("view") === "orders" && query.get("branch_id") === "1" && query.get("page_size") === "12" && !query.has("day"))).toBe(true);
  expect(parityMock.reads.some((read) => read.path === "/orders")).toBe(false);
  await expectBounded(page, list);
});

test("tables preserve the selected zone through commands and branch-wide paginated history", async ({ page, parityMock }) => {
  await page.goto("/pedidos");
  await tab(page, "Panel de mesas");
  await tab(page, "Terraza");
  await expect(page.locator(".tables-workspace button:visible").filter({ hasText: "Mesa 2" })).toHaveCount(1);
  await expect(page.locator(".tables-legend, .table-legend")).toHaveCount(0);
  await tab(page, "Comandas digitales");
  await expect(page.getByRole("tabpanel", { name: "Comandas digitales" })).toBeVisible();
  await tab(page, "Panel de mesas");
  await expect(page.getByRole("tab", { name: "Terraza", exact: true })).toHaveAttribute("aria-selected", "true");
  const historyTrigger = page.getByRole("button", { name: "Ver historial", exact: true });
  await historyTrigger.click();
  const history = page.getByRole("region", { name: "Historial de mesas", exact: true });
  await expect(history.getByText("Cuentas finalizadas y canceladas", { exact: true })).toBeVisible();
  await expect(history.getByRole("button", { name: "Nuevo pedido" })).toHaveCount(0);
  await expect(history.getByText("1 - 12 de 15 pedidos", { exact: true })).toBeVisible();
  await expect(orderButton(page, 201)).toBeVisible();
  await expect(orderButton(page, 202)).toBeVisible();
  await expect(orderButton(page, 300)).toHaveCount(0);
  await expect(orderButton(page, 301)).toHaveCount(0);
  await expect(orderButton(page, 900)).toHaveCount(0);
  await history.getByRole("button", { name: "Página siguiente" }).click();
  await expect(history.getByText("13 - 15 de 15 pedidos", { exact: true })).toBeVisible();
  await history.getByRole("textbox", { name: "Buscar pedidos" }).fill("Cuenta pagada de sala");
  await expect(history.getByText("1 - 1 de 1 pedido", { exact: true })).toBeVisible();
  await expect(orderButton(page, 201)).toBeVisible();
  const queries = parityMock.reads.filter((read) => read.path === "/orders/workspace").map((read) => new URLSearchParams(read.query)).filter((query) => query.get("view") === "table_history");
  expect(queries.length).toBeGreaterThan(0);
  expect(queries.every((query) => query.get("period") === "all" && query.get("branch_id") === "1" && query.get("page_size") === "12" && !query.has("day") && !query.has("table_id") && !query.has("area_id"))).toBe(true);
  await expectBounded(page, history);
  await history.getByRole("button", { name: "Regresar a panel" }).click();
  await expect(historyTrigger).toBeFocused();
  await expect(page.getByRole("tab", { name: "Terraza", exact: true })).toHaveAttribute("aria-selected", "true");
});

for (const sample of [
  { id: 201, source: "Punto de venta", table: "Mesa 1 historica", paid: true, reason: null },
  { id: 202, source: "Men\u00fa digital", table: "Mesa 2 historica", paid: false, reason: "Cliente retiro su solicitud antes de preparar" },
  { id: 203, source: "WhatsApp", table: "Mesa 1 historica", paid: true, reason: "Cancelado despues del cobro por solicitud del cliente" },
]) {
  test(`historical detail ${sample.id} is read-only with source, table, payment and cancellation metadata`, async ({ page, parityMock }) => {
    const printRequests = await mockCompletedManualPrint(page);
    await openHistory(page);
    const trigger = orderButton(page, sample.id);
    await trigger.focus();
    await page.keyboard.press("Enter");
    const detail = page.getByRole("dialog", { name: `Pedido #${sample.id} \u00b7 #HISTORY-${sample.id}`, exact: true });
    await expect(detail).toBeVisible();
    await expect(detail.getByText(sample.table, { exact: true })).toBeVisible();
    await expect(detail.getByText(sample.source, { exact: true })).toBeVisible();
    await expect(detail.getByRole("button", { name: /Acciones del pedido|Agregar productos|Cobrar|Reabrir|Cerrar mesa|Enviar a cocina/ })).toHaveCount(0);
    const payments = detail.getByRole("region", { name: "Pagos de la cuenta" });
    await expect(payments.getByText(sample.paid ? "Pagado" : "Anulado", { exact: true })).toBeVisible();
    if (sample.paid) {
      await expect(payments.getByText("Efectivo", { exact: true })).toBeVisible();
      await expect(payments.getByText("Caja terraza historica", { exact: true })).toBeVisible();
      await expect(detail.getByText("Monto cobrado", { exact: true }).locator("..")).toContainText("32 S/");
    } else {
      await expect(payments.getByText("Efectivo", { exact: true })).toHaveCount(0);
      await expect(detail.getByText("Monto cobrado", { exact: true }).locator("..")).toContainText("0 S/");
    }
    if (sample.reason) {
      await expect(detail.getByRole("note")).toContainText("Este pedido fue cancelado");
      await expect(detail.getByRole("note")).toContainText(sample.reason);
      await expect(detail.getByRole("button", { name: "Imprimir cuenta" })).toBeDisabled();
      await expect(detail.getByText("Monto restante", { exact: true })).toHaveCount(0);
      if (sample.paid) await expect(payments.getByText(/La cancelaci\u00f3n no anula los cobros confirmados/)).toBeVisible();
    } else {
      await expect(detail.getByRole("note")).toHaveCount(0);
      await detail.getByRole("button", { name: "Imprimir cuenta" }).click();
      await expect.poll(() => printRequests.length).toBe(1);
      expect(printRequests[0]).toMatchObject({ orderId: sample.id, body: { job_type: "customer_receipt", expected_order_version: expect.any(Number) } });
    }
    const commands = detail.getByRole("region", { name: "Comandas del pedido" });
    for (const sequence of [1, 2]) {
      const expand = commands.getByRole("button", { name: new RegExp(`Comanda #${sequence}`) });
      await expand.focus();
      await page.keyboard.press("Space");
      await expect(expand).toHaveAttribute("aria-expanded", "true");
      const menu = commands.getByRole("button", { name: `Acciones de la comanda ${sequence}` });
      await menu.click();
      await expect(page.getByRole("menuitem")).toHaveText(["Imprimir comanda"]);
      await expect(page.getByRole("menuitem", { name: "Imprimir comanda" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
      await expect(detail).toBeVisible();
    }
    await expect(commands.getByText("1 \u00d7 Pizza clasica", { exact: true })).toBeVisible();
    await expect(commands.getByText("1 \u00d7 Limonada", { exact: true })).toBeVisible();
    await expectBounded(page, detail);
    await page.keyboard.press("Escape");
    await expect(detail).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(parityMock.reads.some((read) => read.path === `/orders/${sample.id}/detail`)).toBe(true);
    expect(parityMock.violations).toEqual([]);
  });
}

for (const contract of ["missing_echo", "unsupported"] as const) {
  test(`refuses ${contract} instead of presenting a partial all-date fallback`, async ({ page, parityMock }) => {
    parityMock.workspaceContract = contract;
    await page.goto("/pedidos");
    await expect(page.getByRole("tabpanel", { name: "Panel de pedidos" }).getByText(/historial completo/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Abrir pedido / })).toHaveCount(0);
    await tab(page, "Panel de mesas");
    await page.getByRole("button", { name: "Ver historial", exact: true }).click();
    const history = page.getByRole("region", { name: "Historial de mesas" });
    await expect(history.getByRole("alert")).toContainText(/historial completo/);
    await expect(history.getByRole("button", { name: /^Abrir pedido / })).toHaveCount(0);
    expect(parityMock.reads.some((read) => read.path === "/orders")).toBe(false);
    parityMock.workspaceContract = "complete";
    await history.getByRole("button", { name: "Reintentar" }).click();
    await expect(orderButton(page, 201)).toBeVisible();
    await expect(history.getByRole("alert")).toHaveCount(0);
  });
}

test("settings address and fixed-price prefixes leave clear editable text space", async ({ page }) => {
  await page.goto("/configuracion/sucursal");
  const settings = page.getByRole("dialog", { name: "Configuraci\u00f3n", exact: true });
  const address = settings.getByRole("combobox", { name: /Direcci\u00f3n completa/ });
  await expect(address).toHaveValue("Av. de prueba 123, Lima");
  await expectPrefixClear(address, "svg");
  await expectBounded(page, settings);
  await page.goto("/configuracion/delivery");
  const price = settings.getByRole("spinbutton", { name: /Precio fijo/ });
  await expect(price).toHaveValue("8");
  await expectPrefixClear(price, "span");
  await expectBounded(page, settings);
});

// Keep the visual-review group last; these are artifacts, not image-baseline detectors.
test.describe("grouped screenshots for final visual review", () => {
  test("captures main orders, table history, both details and shared-prefix settings", async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    async function capture(name: string) {
      if (["cancel-only", "none"].includes(process.env.E2E_CAPTURE_MODE || "")) return;
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const path = resolve(testInfo.config.rootDir, "test-output", "table-history-visuals", testInfo.project.name, `${name}.png`);
      await page.screenshot({ path, fullPage: true, animations: "disabled" });
      await testInfo.attach(name, { path, contentType: "image/png" });
    }
    await page.goto("/pedidos");
    await expect(page.getByText("1 - 12 de 18 pedidos", { exact: true })).toBeVisible();
    await capture("01-main-orders-all-history");
    await tab(page, "Panel de mesas");
    await tab(page, "Terraza");
    await capture("02-tables-selected-zone");
    await page.getByRole("button", { name: "Ver historial", exact: true }).click();
    await expect(page.getByText("1 - 12 de 15 pedidos", { exact: true })).toBeVisible();
    await capture("03-table-history-branch-wide");
    for (const id of [201, 202]) {
      await orderButton(page, id).click();
      const detail = page.getByRole("dialog", { name: `Pedido #${id} \u00b7 #HISTORY-${id}`, exact: true });
      await expect(detail).toBeVisible();
      await detail.getByRole("button", { name: /Comanda #1/ }).click();
      await detail.getByRole("button", { name: "Acciones de la comanda 1" }).click();
      await expect(page.getByRole("menuitem")).toHaveText(["Imprimir comanda"]);
      await capture(id === 201 ? "04-paid-readonly-detail" : "05-cancelled-readonly-detail");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(detail).toBeHidden();
    }
    await page.goto("/configuracion/sucursal");
    await expect(page.getByRole("combobox", { name: /Direcci\u00f3n completa/ })).toHaveValue("Av. de prueba 123, Lima");
    await capture("06-settings-address-prefix");
    await page.goto("/configuracion/delivery");
    await expect(page.getByRole("spinbutton", { name: /Precio fijo/ })).toHaveValue("8");
    await capture("07-settings-fixed-price-prefix");
  });
});
