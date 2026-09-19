import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Page, Route, TestInfo } from "@playwright/test";
import { expect, test } from "./helpers/parity-workspace";

const json = (route: Route, data: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });

async function deliveryApi(page: Page, mode: "quote" | "fixed", failFirstQuote = false) {
  const quotes: Record<string, unknown>[] = [];
  const keys: string[] = [];
  const orders: Record<string, unknown>[] = [];
  const confirmations: Record<string, unknown>[] = [];
  let saved: Record<string, unknown> | null = null;
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace("/api/v1", "");
    if (endpoint === "/settings/branches/1/delivery" && request.method() === "GET") return json(route, {
      version: 4, delivery_mode: mode, fixed_delivery_fee: 15, minimum_enabled: false, free_over_enabled: false,
      minimum_amount: 0, free_over_amount: 0, radii: [], pos_quotes_supported: true,
      delivery_policy_supported: true, delivery_policy: { neighborhoods: [], origin: null, outside_band_mode: "quote" },
    });
    if (endpoint === "/settings/branches/1/delivery/quotes" && request.method() === "POST") {
      const body = request.postDataJSON(); quotes.push(body); keys.push(request.headers()["idempotency-key"] || "");
      if (failFirstQuote && quotes.length === 1) return route.abort("failed");
      const fee = mode === "fixed" ? 15 : body.confirmed_fee ?? null;
      return json(route, { id: `quote-${quotes.length}`, fee, requires_quote: fee === null, fee_status: fee === null ? "pending_quote" : "final", configuration_version: 4, expires_at: "2026-09-09T20:15:00Z" }, 201);
    }
    if (endpoint === "/cash/sessions") return json(route, [{ id: 33, register_id: 7, status: "open" }]);
    if (endpoint === "/orders" && request.method() === "POST") {
      const body = request.postDataJSON(); orders.push(body);
      saved = { ...body, id: 12, folio: 8, number: "DELIVERY-TEST", business_id: 1, version: 1, source: "pos", subtotal: 8, discount: 0, total: 8 + body.delivery_fee, payment_status: "pending", status: "draft", created_at: "2026-09-09T20:00:00Z", items: [{ id: 101, product_id: 21, name: "Limonada", quantity: 1, unit_price: 8, line_total: 8, modifiers: [], status: "pending" }] };
      return json(route, saved, 201);
    }
    if (endpoint === "/orders/12/confirm-and-send" && request.method() === "POST") {
      confirmations.push(request.postDataJSON());
      saved = { ...saved, version: 2, status: "sent_to_kitchen" };
      return json(route, { order: saved, tickets: [] });
    }
    if (endpoint === "/orders/12/detail" && saved) return json(route, { order: saved, payments: [], payment_evidence: [], tickets: [], payment_summary: { paid: 0, remaining: saved.total } });
    if (endpoint === "/orders/12/printing" && request.method() === "GET") return json(route, { order_id: 12, items: [], recoverable_error: false });
    return route.fallback();
  });
  return { quotes, keys, orders, confirmations };
}

async function openDelivery(page: Page) {
  await page.goto("/pedidos");
  await page.getByRole("button", { name: "Nuevo pedido" }).click();
  const drawer = page.getByRole("dialog", { name: "Agrega un pedido" });
  await drawer.getByLabel("Tipo de pedido").selectOption("delivery");
  await drawer.getByRole("button", { name: "Agregar productos", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Agregar productos" });
  await picker.getByRole("button", { name: /Limonada/ }).click();
  await picker.getByRole("button", { name: "Guardar selección" }).click();
  await drawer.getByLabel("Nombre del cliente").fill("Cliente aislado");
  await drawer.getByLabel("Número de teléfono").fill("900000001");
  await drawer.getByLabel("Colonia", { exact: false }).fill("Centro");
  await drawer.getByLabel("Calle", { exact: true }).fill("Calle de prueba");
  await drawer.getByLabel(/^Número casa/).fill("123");
  await drawer.getByLabel(/Entre calles/).fill("Primera y Segunda");
  await drawer.getByLabel("Referencias", { exact: true }).fill("Puerta de prueba");
  return drawer;
}

async function evidence(page: Page, info: TestInfo, name: string) {
  const dir = path.resolve(info.config.rootDir, "test-output", "settings-delivery", info.project.name);
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
}

test("quote shows an empty editable fee and requires confirmation before kitchen", async ({ page }, info) => {
  const state = await deliveryApi(page, "quote");
  const drawer = await openDelivery(page);
  const cost = drawer.getByLabel("Costo de envío", { exact: true });
  await expect(cost).toBeEditable(); await expect(cost).toHaveValue("");
  expect(await cost.evaluate((input) => Number.parseFloat(getComputedStyle(input).paddingLeft))).toBeGreaterThanOrEqual(40);
  await cost.scrollIntoViewIfNeeded();
  await evidence(page, info, "quote-empty");
  await drawer.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(drawer.getByRole("alert")).toContainText("por cotizar");
  expect(state.orders).toHaveLength(0); expect(state.confirmations).toHaveLength(0);
  await cost.fill("12.50");
  const confirm = drawer.getByRole("button", { name: "Confirmar importe de envío" });
  await confirm.focus(); await page.keyboard.press("Enter");
  await drawer.getByRole("button", { name: "Continuar", exact: true }).click();
  const checkout = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await expect(checkout).toBeVisible();
  await checkout.getByRole("checkbox", { name: /Cobrar después/ }).check();
  await checkout.getByRole("button", { name: "Enviar a cocina", exact: true }).click();
  await expect(page.getByText("Comanda enviada a cocina. Pago pendiente.")).toBeVisible();
  expect(state.orders).toHaveLength(1); expect(state.confirmations).toHaveLength(1);
  expect(state.orders[0]).toMatchObject({ delivery_fee: 12.5, delivery_quote_id: expect.any(String), delivery_address: { address: "Calle de prueba 123, Centro, Entre Primera y Segunda", street: "Calle de prueba", number: "123", cross_streets: "Primera y Segunda", neighborhood: "Centro", reference: "Puerta de prueba" } });
  expect(state.quotes.at(-1)).toMatchObject({ subtotal: 8, confirmed_fee: 12.5, expected_configuration_version: 4 });
  expect(state.keys.every(Boolean)).toBe(true);
});

test("fixed fee is readonly and a failed quote retries without changing destination", async ({ page }, info) => {
  const state = await deliveryApi(page, "fixed", true);
  const drawer = await openDelivery(page);
  const cost = drawer.getByLabel("Costo de envío", { exact: true });
  await expect(cost).toHaveAttribute("readonly", ""); await expect(cost).toHaveValue("S/ 15.00");
  await cost.scrollIntoViewIfNeeded(); await evidence(page, info, "fixed-readonly");
  await drawer.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(drawer.getByRole("alert")).toBeVisible();
  expect(state.orders).toHaveLength(0);
  await drawer.getByRole("button", { name: "Continuar", exact: true }).click();
  const checkout = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await expect(checkout).toBeVisible();
  expect(state.quotes).toHaveLength(2); expect(state.keys[0]).toBe(state.keys[1]);
  await page.keyboard.press("Escape");
  await expect(drawer.getByRole("button", { name: "Continuar", exact: true })).toBeFocused();
  await expect(drawer.getByLabel("Calle", { exact: true })).toHaveValue("Calle de prueba");
  await drawer.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(checkout).toBeVisible(); expect(state.quotes).toHaveLength(2);
  await page.keyboard.press("Escape");
  await drawer.getByLabel("Calle", { exact: true }).fill("Calle nueva");
  await drawer.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(checkout).toBeVisible(); expect(state.quotes).toHaveLength(3);
  expect(state.quotes[2]).toMatchObject({ destination: { street: "Calle nueva" } });
});
