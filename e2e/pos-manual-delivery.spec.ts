import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const captures = "C:/codex/apps/Impulsa/APP POS/entregas/pos-domicilio-manual-20261107/screenshots-final";
const branch = { id: 1, business_id: 1, name: "Sucursal principal", slug: "matriz", active: true, opening_hours: {}, accepted_payment_methods: ["cash", "yape"], delivery_enabled: true, takeaway_enabled: true, delivery_fee: 99 };
function order() {
  return { id: 12, business_id: 1, branch_id: 1, number: "SYNTHETIC-12", folio: 12, version: 2, source: "pos", channel: "delivery", status: "sent_to_kitchen", payment_status: "pending", payment_method: null, customer_name: "Ana Manual", customer_phone: "944197385", delivery_address: { delivery_service: "own" }, delivery_fee: 0, delivery_fee_status: "pending_quote", subtotal: 10, discount: 0, total: 10, paid_amount: 0, remaining_amount: 10, created_at: "2026-11-07T12:00:00Z", items: [{ id: 1, product_id: 20, name: "Pan con lechón", quantity: 1, unit_price: 10, line_total: 10, modifiers: [], status: "preparing" }], payments: [] as Record<string, unknown>[], kitchen_tickets: [] as unknown[], payment_requests: [], edit_policy: { can_edit: true, fulfillment_locked: false, reason: null } };
}
async function prepare(page: Page, seeded = false) {
  const current = order();
  const writes: { path: string; method: string; body: Record<string, unknown>; key?: string }[] = [];
  const forbidden: string[] = [];
  let exists = seeded;
  await page.addInitScript(() => {
    localStorage.setItem("impulsa.authMode", "dev"); localStorage.setItem("impulsa.businessId", "1"); localStorage.setItem("impulsa.branchId", "1");
    Object.assign(window, { qz: { api: { setSha256Type: () => {} }, websocket: { isActive: () => false, connect: async () => {}, disconnect: async () => {} }, printers: { find: async () => [], details: async () => [] }, configs: { create: () => ({}) }, print: async () => { throw new Error("Physical printing forbidden"); }, security: { setCertificatePromise: () => {}, setSignaturePromise: () => {}, setSignatureAlgorithm: () => {} } } });
  });
  await page.routeWebSocket("**", socket => socket.close());
  await page.route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) return route.abort("blockedbyclient");
    if (!url.pathname.startsWith("/api/v1/")) { if (url.port === "5175") return route.continue(); forbidden.push(request.url()); return route.abort(); }
    const path = url.pathname.slice("/api/v1".length); const reply = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    const method = request.method();
    if (method !== "GET") writes.push({ path, method, body: request.postDataJSON() || {}, key: request.headers()["idempotency-key"] });
    if (method === "GET" && path === "/context") return reply({ role: "owner", roles: ["owner"], business: { id: 1, slug: "manual-delivery-test", name: "Restaurante de ensayo", status: "active", currency: "PEN", timezone: "America/Lima", modules: { pos: true, cash: true, inventory: true } }, branches: [branch] });
    if (method === "GET" && path === "/catalog") return reply({ branch, categories: [{ id: 10, name: "Platos", active: true, sort_order: 0 }], products: [{ id: 20, category_id: 10, name: "Pan con lechón", sku: "PAN-TEST", description: "Producto sintético", price: 10, active: true, available: true, track_stock: false, product_type: "standard", preparation_station: "kitchen", sort_order: 0, service_channels: ["pos_delivery", "pos_counter", "pos_takeaway"], variants: [], modifier_groups: [], recipe: [], combo_components: [] }], modifier_groups: [], ingredients: [], promotions: [] });
    if (method === "GET" && path === "/agent-attention") return reply([]);
    if (method === "GET" && path === "/orders/workspace") return reply({ branch_id: 1, period: "all", view: "orders", items: exists ? [current] : [], page: 1, page_size: 12, total: exists ? 1 : 0, review_count: 0 });
    if (method === "GET" && path === "/orders/12/printing") return reply({ order_id: 12, items: [], recoverable_error: false });
    if (method === "GET" && path === "/orders/printing/pending") return reply({ branch_id: 1, items: [], next_after_order_id: null });
    if (method === "GET" && ["/orders/12/detail", "/orders/12"].includes(path)) return reply(current);
    if (method === "GET" && path === "/cash/registers") return reply([{ id: 91, name: "Caja principal", active: true }]);
    if (method === "GET" && path === "/cash/sessions") return reply([{ id: 301, register_id: 91, status: "open" }]);
    if (method === "POST" && path === "/orders") {
      const payload = request.postDataJSON(); exists = true;
      Object.assign(current, { ...payload, id: 12, version: 1, source: "pos", status: "draft", delivery_fee_status: payload.allow_pending_delivery_quote ? "pending_quote" : "final", subtotal: 10, total: 10 + payload.delivery_fee, remaining_amount: 10 + payload.delivery_fee, items: order().items });
      return reply(current, 201);
    }
    if (method === "POST" && path === "/orders/12/confirm-and-send") { current.version++; current.status = "sent_to_kitchen"; return reply({ order: current, tickets: [] }); }
    if (method === "PATCH" && path === "/orders/12") {
      const payload = request.postDataJSON(); expect(payload.expected_version).toBe(current.version); expect(payload.expected_total).toBe(10 + payload.delivery_fee);
      Object.assign(current, { delivery_fee: payload.delivery_fee, delivery_fee_status: "final", total: payload.expected_total, remaining_amount: payload.expected_total, version: current.version + 1 }); return reply(current);
    }
    if (method === "POST" && path === "/orders/12/payments") { const payload = request.postDataJSON(); current.payments.push({ ...payload, id: 1, status: "confirmed", created_at: current.created_at }); current.paid_amount += payload.amount; current.remaining_amount -= payload.amount; current.payment_status = current.remaining_amount ? "partial" : "paid"; current.version++; return reply({ order: current, payment: current.payments[0] }, 201); }
    forbidden.push(`${method} ${path}`); return reply({ detail: `Unexpected synthetic route ${path}` }, 404);
  });
  return { current, writes, forbidden };
}
async function capture(page: Page, info: TestInfo, name: string) { await mkdir(captures, { recursive: true }); await page.screenshot({ path: `${captures}/${name}-${info.project.name}.png`, fullPage: false }); }
async function newDelivery(page: Page) {
  await page.goto("/pedidos"); await page.getByRole("button", { name: "Nuevo pedido" }).click();
  const drawer = page.getByRole("dialog", { name: "Agrega un pedido" });
  await drawer.getByLabel("Tipo de pedido").selectOption("delivery");
  await drawer.getByRole("button", { name: "Agregar productos" }).click();
  const picker = page.getByRole("dialog", { name: "Agregar productos" });
  await picker.getByRole("button", { name: /Pan con lechón/ }).click(); await picker.getByRole("button", { name: "Guardar selección" }).click();
  await drawer.getByLabel("Nombre del cliente").fill("Ana Manual"); await drawer.getByLabel("Número de teléfono").fill("944197385");
  return drawer;
}

test("manual delivery needs only name and phone and saves unknown shipping without payment", async ({ page }, info) => {
  const fixture = await prepare(page); const drawer = await newDelivery(page);
  await expect(drawer.getByLabel(/^Calle/)).toHaveValue(""); await expect(drawer.getByLabel(/^Referencias/)).toHaveValue("");
  await drawer.getByRole("button", { name: "Continuar" }).click();
  const checkout = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await expect(checkout.getByText("Agrega un costo de envío para poder cobrar al momento.")).toBeVisible();
  await expect(checkout.getByRole("checkbox", { name: /Cobrar después/ })).toBeChecked();
  await expect(checkout.getByRole("checkbox", { name: /Cobrar después/ })).toBeDisabled();
  await capture(page, info, "pending-checkout");
  await checkout.getByRole("button", { name: "Guardar sin cobrar" }).click();
  await expect(page.getByRole("button", { name: "Agregar costo de envío" })).toBeVisible();
  expect(fixture.writes.map(write => write.path)).toEqual(["/orders", "/orders/12/confirm-and-send"]);
  expect(fixture.writes[0].body).toMatchObject({ customer_name: "Ana Manual", customer_phone: "944197385", delivery_fee: 0, allow_pending_delivery_quote: true });
  expect(fixture.writes[0].body).not.toHaveProperty("delivery_quote_id"); expect(fixture.current.paid_amount).toBe(0); expect(fixture.forbidden).toEqual([]);
});

test("manual inline quotation updates total and restores the regular top collection", async ({ page }, info) => {
  const fixture = await prepare(page, true); await page.goto("/pedidos"); await page.getByRole("button", { name: /Abrir pedido 12 de Ana Manual/ }).click();
  const collect = page.getByRole("button", { name: "Cobrar 10 S/", exact: true }); await expect(collect).toBeDisabled();
  await page.getByRole("button", { name: "Agregar costo de envío" }).click();
  const form = page.getByRole("form", { name: "Costo de envío" }); await form.getByLabel("Costo de envío").fill("5"); await capture(page, info, "inline-quotation");
  await form.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cobrar 15 S/", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Agregar costo de envío" })).toHaveCount(0);
  await capture(page, info, "quoted-total");
  expect(fixture.writes).toHaveLength(1); expect(fixture.writes[0]).toMatchObject({ path: "/orders/12", method: "PATCH", body: { delivery_fee: 5, expected_version: 2, expected_total: 15 }, key: expect.any(String) });
  expect(fixture.current.payment_requests).toEqual([]); expect(fixture.forbidden).toEqual([]);
});

test("explicit zero means free shipping and preserves normal immediate cash checkout", async ({ page }, info) => {
  const fixture = await prepare(page); const drawer = await newDelivery(page);
  await drawer.getByLabel(/^Costo de envío/).fill("0"); await drawer.getByRole("button", { name: "Continuar" }).click();
  const checkout = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await expect(checkout.getByRole("checkbox", { name: /Cobrar después/ })).toBeEnabled(); await expect(checkout.getByRole("checkbox", { name: /Cobrar después/ })).not.toBeChecked();
  await checkout.getByRole("radio", { name: /Efectivo/ }).check(); await checkout.getByLabel("Cantidad recibida").fill("10"); await capture(page, info, "free-shipping-cash");
  await checkout.getByRole("button", { name: /Cobrar/, exact: false }).click();
  await expect(page.getByText("Pedido pagado y enviado a cocina.")).toBeVisible();
  expect(fixture.writes.map(write => write.path)).toEqual(["/orders", "/orders/12/payments", "/orders/12/confirm-and-send"]);
  expect(fixture.writes[0].body).toMatchObject({ delivery_fee: 0 }); expect(fixture.writes[0].body).not.toHaveProperty("allow_pending_delivery_quote"); expect(fixture.current.payment_status).toBe("paid"); expect(fixture.forbidden).toEqual([]);
});
