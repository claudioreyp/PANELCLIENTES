import { expect, test, type Page } from "@playwright/test";
import type { OrderDetail, PaymentEvidence } from "../src/types";

const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWQAAAABJRU5ErkJggg==";
const created = "2026-11-06T20:00:00Z";

function receipt(id: number, request: string | null, status = "under_review"): PaymentEvidence {
  return { id, order_id: id === 50 ? 5 : 6, payment_request_id: request,
    provider: "yape", status, expected_amount: request ? 6 : 15,
    amount_detected: 17.5, operation_number: `SYNTHETIC-${id}`, recipient: "Destinatario de prueba",
    warnings: ["Importe y destinatario sujetos a revisión humana"],
    image_url: `/api/v1/payment-evidence/${id}/image`, created_at: created };
}

function makeOrder(id: number, base: number, status: string): OrderDetail {
  const paid = id === 5 ? base : 0;
  return { id, business_id: 1, branch_id: 1, folio: id, number: `SYNTHETIC-${id}`,
    customer_name: "Cliente de prueba", customer_phone: null, channel: "delivery", source: "whatsapp_agent",
    status, version: 2, payment_method: "yape", payment_status: paid ? "partial" : "pending",
    created_at: created, submitted_at: created, subtotal: base, discount: 0, delivery_fee: 6,
    delivery_fee_status: "final", total: base + 6, paid_amount: paid, remaining_amount: base + 6 - paid,
    items: [{ id: id * 10, product_id: 1, name: "Producto de prueba", quantity: 1,
      unit_price: base, line_total: base, modifiers: [], status: "ready" }],
    payments: paid ? [{ id: 1, order_id: id, method: "yape", amount: paid, status: "confirmed", created_at: created }] : [],
    payment_evidences: id === 5 ? [receipt(50, null, "paid")] : [receipt(60, "shipping-6")],
    payment_requests: [{ id: `shipping-${id}`, order_id: id, purpose: "delivery", method: "yape",
      amount: 6, status: id === 5 ? "pending" : "under_review", version: 1, items: [] }],
    kitchen_tickets: [],
  } as unknown as OrderDetail;
}

async function prepare(page: Page, order: OrderDetail, lostReview = false, lostPayment = false) {
  const branch = { id: 1, business_id: 1, name: "Sucursal principal", active: true,
    accepted_payment_methods: ["cash", "yape"], delivery_enabled: true, takeaway_enabled: true, opening_hours: {} };
  const writes: { path: string; body: Record<string, unknown>; key?: string }[] = [];
  const forbidden: string[] = [];
  const replays = new Map<string, unknown>();
  let dropped = false;
  function detail() {
    return { order, payments: order.payments, tickets: order.kitchen_tickets,
      payment_evidence: order.payment_evidences, payment_requests: order.payment_requests,
      payment_summary: { paid: order.paid_amount, remaining: order.remaining_amount } };
  }
  await page.addInitScript(() => {
    localStorage.setItem("impulsa.authMode", "dev");
    localStorage.setItem("impulsa.businessId", "1"); localStorage.setItem("impulsa.branchId", "1");
    Object.assign(window, { qz: { api: { setSha256Type: () => {} },
      websocket: { isActive: () => false, connect: async () => {}, disconnect: async () => {} },
      printers: { find: async () => [], details: async () => [] }, configs: { create: () => ({}) },
      print: async () => { localStorage.setItem("delivery-yape:physical-print", "forbidden"); throw new Error("Forbidden physical printing"); },
      security: { setCertificatePromise: () => {}, setSignaturePromise: () => {}, setSignatureAlgorithm: () => {} } } });
  });
  await page.routeWebSocket(/.*/, socket => socket.close());
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      if (url.hostname !== "fonts.googleapis.com" && url.hostname !== "fonts.gstatic.com") forbidden.push(`${request.method()} ${url.origin}`);
      return route.abort("blockedbyclient");
    }
    if (!url.pathname.startsWith("/api/v1/")) return route.continue();
    const path = url.pathname.slice("/api/v1".length);
    const reply = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (request.method() === "GET") {
      if (path === "/context") return reply({ role: "owner", roles: ["owner"], business: { id: 1,
        slug: "synthetic-delivery", name: "Restaurante de prueba", status: "active", currency: "PEN",
        timezone: "America/Lima", modules: { pos: true, cash: true } }, branches: [branch] });
      if (path === "/catalog") return reply({ branch, categories: [], products: [], modifier_groups: [], ingredients: [], promotions: [] });
      if (path === "/agent-attention") return reply([]);
      if (path === "/orders/workspace") return reply({ branch_id: 1, period: "all", view: "orders", items: [{ ...order, item_count: 1 }], total: 1, page: 1, page_size: 12, review_count: 0 });
      if (path === `/orders/${order.id}/detail`) return reply(detail());
      if (path === `/orders/${order.id}`) return reply(order);
      if (path === "/orders/printing/pending") return reply({ branch_id: 1, items: [], next_after_order_id: null });
      if (path === "/cash/registers") return reply([{ id: 1, name: "Caja de prueba", active: true }]);
      if (path === "/cash/sessions") return reply([{ id: 1, register_id: 1, status: "open" }]);
      if (/^\/payment-evidence\/\d+\/image$/.test(path)) return route.fulfill({ contentType: "image/png", body: Buffer.from(image, "base64") });
      return reply({ detail: "No optional synthetic read" }, 404);
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    const key = request.headers()["idempotency-key"];
    writes.push({ path, body, key });
    if (key && replays.has(key)) return reply(replays.get(key));
    if (path === `/orders/${order.id}/transition`) {
      order.status = String(body.status); order.version += 1;
      if (body.delivery_collection === "courier_pending") Object.assign(order.payment_requests![0], { collection_pending_with_courier: true });
      return reply(order);
    }
    if (path === `/orders/${order.id}/payments`) {
      order.paid_amount += Number(body.amount); order.remaining_amount = Math.max(0, order.total - order.paid_amount);
      order.payment_status = order.remaining_amount ? "partial" : "paid"; order.version += 1;
      order.payments.push({ id: 2, order_id: order.id, method: String(body.method), amount: Number(body.amount), status: "confirmed", created_at: created });
      if (body.payment_request_id) Object.assign(order.payment_requests![0], { status: "paid", collection_pending_with_courier: false });
      const response = { order, payment: order.payments.at(-1) };
      if (key) replays.set(key, structuredClone(response));
      if (lostPayment && !dropped) { dropped = true; return reply({ detail: "Synthetic lost payment response after commit" }, 503); }
      return reply(response);
    }
    if (path === "/payment-evidence/60/review") {
      const amount = Number(body.confirmed_amount);
      order.status = "sent_to_kitchen"; order.version += 1;
      order.paid_amount = amount; order.remaining_amount = Math.max(0, order.total - amount);
      order.payment_status = order.remaining_amount ? "partial" : "paid";
      order.payments = [{ id: 2, order_id: order.id, method: "yape", amount, status: "confirmed", created_at: created }];
      Object.assign(order.payment_evidences![0], { status: "paid", payment_request_id: null });
      order.payment_requests![0].status = body.allocation === "original_and_delivery" ? "paid" : "pending";
      const response = { order, evidence: order.payment_evidences![0], notification: { queued: false } };
      if (key) replays.set(key, structuredClone(response));
      if (lostReview && !dropped) { dropped = true; return reply({ detail: "Synthetic lost response after commit" }, 503); }
      return reply(response);
    }
    forbidden.push(`${request.method()} ${path}`);
    return reply({ detail: "Forbidden synthetic mutation" }, 405);
  });
  page.on("dialog", dialog => dialog.accept());
  await page.goto("/pedidos");
  await page.getByRole("button", { name: `Abrir pedido ${order.id} de Cliente de prueba`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Pedido #${order.id} · #${order.number}`, exact: true });
  await expect(dialog.getByText("Cobro del envío", { exact: true })).toBeVisible();
  return { order, writes, forbidden, dialog };
}

async function noExternalEffects(page: Page, forbidden: string[]) {
  expect(forbidden).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("delivery-yape:physical-print"))).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test("dispatch and courier collection preserve the balance until the staff records one payment", async ({ page }, info) => {
  const f = await prepare(page, makeOrder(5, 15, "ready"));
  await expect(f.dialog.getByText("Yape pendiente de recibir", { exact: false })).toBeVisible();
  await f.dialog.getByRole("button", { name: "Despachar delivery", exact: true }).click();
  await expect(f.dialog.getByRole("button", { name: "Marcar entregado", exact: true })).toBeEnabled();
  await f.dialog.getByRole("button", { name: "Marcar entregado", exact: true }).click();
  await expect(f.dialog.getByText("Cobro pendiente del repartidor", { exact: false })).toBeVisible();
  expect(f.order.paid_amount).toBe(15); expect(f.order.remaining_amount).toBe(6);
  expect(f.writes[1].body).toMatchObject({ status: "delivered", delivery_collection: "courier_pending" });
  await page.screenshot({ path: `e2e/test-output/delivery-yape/${info.project.name}-courier-pending.png`, fullPage: true });
  await expect(f.dialog.getByRole("button", { name: "Registrar cobro del envío", exact: true })).toHaveCount(0);
  await f.dialog.getByRole("button", { name: "Cobrar 6 S/", exact: true }).click();
  const payment = page.getByRole("dialog", { name: "Cobrar al cliente", exact: true });
  await expect(payment.getByRole("radio", { name: /Múltiples/ })).toHaveCount(0);
  await payment.getByRole("radio", { name: /^Efectivo/ }).check();
  await payment.getByLabel("Cantidad recibida", { exact: true }).fill("6");
  await expect(payment.getByText("Caja de prueba", { exact: true })).toBeVisible();
  await page.screenshot({ path: `e2e/test-output/delivery-yape/${info.project.name}-regular-cash-payment.png`, fullPage: true, animations: "disabled" });
  await payment.getByRole("button", { name: /^Cobrar / }).click();
  await expect(payment).toBeHidden();
  await expect(f.dialog.getByText("Yape pendiente de recibir", { exact: false })).toHaveCount(0);
  const payments = f.writes.filter(write => write.path.endsWith("/payments"));
  expect(payments).toHaveLength(1);
  expect(payments[0].body).toMatchObject({ payment_request_id: "shipping-5", method: "cash", amount: 6 });
  expect(payments[0].key).toBeTruthy(); expect(f.order.paid_amount).toBe(21);
  await noExternalEffects(page, f.forbidden);
});

test("a combined receipt can recover a lost approval without issuing a second payment", async ({ page }, info) => {
  const f = await prepare(page, makeOrder(6, 4.5, "draft"), true);
  await f.dialog.getByRole("combobox", { name: "Aplicar comprobante a", exact: true }).selectOption("original_and_delivery");
  await f.dialog.getByLabel("Importe realmente verificado", { exact: true }).fill("17.50");
  await f.dialog.getByLabel("Motivo de la corrección", { exact: true }).fill("Comprobante corresponde a productos y envío; exceso para revisión.");
  await page.screenshot({ path: `e2e/test-output/delivery-yape/${info.project.name}-combined-review.png`, fullPage: true });
  await f.dialog.getByRole("button", { name: "Aplicar y aprobar pago", exact: true }).click();
  await expect(page.getByText(/Synthetic lost response after commit/)).toBeVisible();
  await f.dialog.getByRole("button", { name: "Aplicar y aprobar pago", exact: true }).click();
  await expect(f.dialog.getByRole("button", { name: "Aplicar y aprobar pago", exact: true })).toHaveCount(0);
  const approvals = f.writes.filter(write => write.path.endsWith("/review"));
  expect(approvals).toHaveLength(2); expect(approvals[0].key).toBeTruthy();
  expect(approvals[1]).toEqual(approvals[0]);
  expect(approvals[0].body).toMatchObject({ approve: true, allocation: "original_and_delivery", confirmed_amount: 17.5, expected_version: 2 });
  expect(f.order.payments).toHaveLength(1); expect(f.order.paid_amount).toBe(17.5);
  expect(f.order.payment_requests![0].status).toBe("paid");
  await noExternalEffects(page, f.forbidden);
});

test("applying a receipt to products alone preserves the delivery debt", async ({ page }) => {
  const f = await prepare(page, makeOrder(6, 4.5, "draft"));
  await f.dialog.getByRole("combobox", { name: "Aplicar comprobante a", exact: true }).selectOption("original");
  await f.dialog.getByLabel("Importe realmente verificado", { exact: true }).fill("4.50");
  await f.dialog.getByLabel("Motivo de la corrección", { exact: true }).fill("El comprobante corresponde solo a los productos.");
  await f.dialog.getByRole("button", { name: "Aplicar y aprobar pago", exact: true }).click();
  await expect(f.dialog.getByRole("button", { name: "Aplicar y aprobar pago", exact: true })).toHaveCount(0);
  expect(f.order.paid_amount).toBe(4.5); expect(f.order.remaining_amount).toBe(6);
  expect(f.order.payment_requests![0].status).toBe("pending");
  expect(f.writes[0].body).toMatchObject({ allocation: "original", confirmed_amount: 4.5 });
  await noExternalEffects(page, f.forbidden);
});

test("an open delivery receipt can travel but must be reviewed before the order is delivered", async ({ page }, info) => {
  const order = makeOrder(5, 15, "ready");
  order.payment_evidences!.push({ ...receipt(51, "shipping-5"), order_id: 5 });
  order.payment_requests![0].status = "under_review";
  const f = await prepare(page, order);
  await f.dialog.getByRole("button", { name: "Despachar delivery", exact: true }).click();
  await expect(f.dialog.getByRole("button", { name: "Marcar entregado", exact: true })).toBeDisabled();
  await expect(f.dialog.getByText(/revisar|revisión/, { exact: false }).first()).toBeVisible();
  expect(f.writes).toHaveLength(1);
  await page.screenshot({ path: `e2e/test-output/delivery-yape/${info.project.name}-delivery-review-block.png`, fullPage: true });
  await noExternalEffects(page, f.forbidden);
});

test("an unresolved original receipt still blocks dispatch", async ({ page }) => {
  const order = makeOrder(5, 15, "ready");
  order.payment_evidences![0].status = "under_review";
  const f = await prepare(page, order);
  await expect(f.dialog.getByRole("button", { name: "Despachar delivery", exact: true })).toBeDisabled();
  expect(f.writes).toHaveLength(0);
  await noExternalEffects(page, f.forbidden);
});


test("the regular checkout recovers the same shipping payment after a lost response", async ({ page }) => {
  const order = makeOrder(5, 15, "delivered");
  order.payment_requests![0].collection_pending_with_courier = true;
  const f = await prepare(page, order, false, true);
  await f.dialog.getByRole("button", { name: "Cobrar 6 S/", exact: true }).click();
  const payment = page.getByRole("dialog", { name: "Cobrar al cliente", exact: true });
  await payment.getByRole("radio", { name: /^Efectivo/ }).check();
  await payment.getByLabel("Cantidad recibida", { exact: true }).fill("10");
  await expect(payment.getByText("Caja de prueba", { exact: true })).toBeVisible();
  await payment.getByRole("button", { name: /^Cobrar / }).click();
  await expect(payment.getByRole("button", { name: "Reintentar confirmación", exact: true })).toBeEnabled();
  await expect(payment.getByLabel("Cantidad recibida", { exact: true })).toBeDisabled();
  await expect(payment.getByRole("button", { name: "Cancelar", exact: true })).toBeDisabled();
  expect(f.order.payments).toHaveLength(2);
  await payment.getByRole("button", { name: "Reintentar confirmación", exact: true }).click();
  await expect(payment).toBeHidden();
  const payments = f.writes.filter(write => write.path.endsWith("/payments"));
  expect(payments).toHaveLength(2); expect(payments[1]).toEqual(payments[0]);
  expect(payments[0].body).toMatchObject({ payment_request_id: "shipping-5", amount: 6, method: "cash", expected_version: 2 });
  expect(f.order.payments).toHaveLength(2); expect(f.order.remaining_amount).toBe(0);
  await noExternalEffects(page, f.forbidden);
});
