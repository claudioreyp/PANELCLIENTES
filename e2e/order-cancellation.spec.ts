import { expect, test } from "@playwright/test";

test("records a chosen cash refund atomically and preserves the original card payment", async ({ page }, testInfo) => {
  const branch = { id: 1, business_id: 1, slug: "matriz", name: "Sucursal principal", active: true, opening_hours: {}, accepted_payment_methods: ["cash", "card", "yape", "plin", "transfer", "online"], delivery_enabled: true, takeaway_enabled: true, delivery_fee: 0 };
  const initial = { id: 70, folio: 9, business_id: 1, branch_id: 1, number: "VISUAL-70", customer_name: "Cliente de prueba", channel: "takeaway", source: "pos", status: "ready", payment_status: "paid", subtotal: 234, discount: 0, delivery_fee: 0, total: 234, version: 4, created_at: "2026-10-04T20:00:00", items: [{ id: 91, product_id: 20, name: "Pizza Hawaiana", variant_name: "Familiar", quantity: 6, unit_price: 39, line_total: 234, modifiers: [], status: "ready" }] };
  let saved = initial;
  let financial = { collected: 234, refunded: 0, net_collected: 234, refundable: 234, status: "paid" };
  let refunds: Record<string, unknown>[] = [];
  let reason: string | null = null;
  const writes: { path: string; body: Record<string, unknown>; key: string | undefined }[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, "");
    let body: unknown;
    if (path === "/context") body = { role: "owner", business: { id: 1, slug: "visual-cash", name: "Restaurante de prueba", status: "active", plan: "pro", currency: "PEN", timezone: "America/Lima", modules: { pos: true, cash: true, inventory: true } }, branches: [branch] };
    else if (path === "/catalog") body = { branch, categories: [], products: [], ingredients: [], modifier_groups: [], promotions: [] };
    else if (path === "/orders/workspace") body = { period: "all", view: "orders", branch_id: 1, items: [{ ...saved, item_count: 6, requires_review: false, financial_summary: financial }], total: 1, page: 1, page_size: 12, review_count: 0 };
    else if (path === "/orders/70/detail") body = { order: saved, payments: [{ id: 1, order_id: 70, method: "card", amount: 234, status: "confirmed", created_at: "2026-10-04T20:00:00", cash_register_name: "Principal" }], tickets: [], payment_evidence: [], payment_summary: { paid: 234, remaining: 0 }, financial_summary: financial, refunds, cancellation_reason: reason };
    else if (path === "/orders/70/cancellation-preview") body = { order_id: 70, branch_id: 1, order_version: 4, can_cancel: true, can_refund: true, reason: null, refundable_amount: 234, financial_summary: financial, refund_methods: ["cash", "card", "yape", "plin", "transfer", "online"], registers: [{ id: 3, name: "Principal", version: 1, session_id: 8, session_version: 6 }] };
    else if (path === "/orders/70/cancel" && request.method() === "POST") {
      const payload = request.postDataJSON();
      writes.push({ path, body: payload, key: request.headers()["idempotency-key"] });
      reason = payload.reason;
      saved = { ...initial, status: "cancelled", version: 5 };
      financial = { collected: 234, refunded: 234, net_collected: 0, refundable: 0, status: "refunded" };
      refunds = [{ id: 1, order_id: 70, method: "cash", amount: 234, signed_amount: -234, register_id: 3, register_name: "Principal", session_id: 8, created_at: "2026-10-04T20:02:00", note: reason }];
      body = { order: saved, financial_summary: financial, refunds, cash_period: { register_id: 3, session_id: 8, version: 7 } };
    } else {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "No fixture for this optional read" }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("impulsa.authMode", "dev"); localStorage.setItem("impulsa.businessId", "1"); localStorage.setItem("impulsa.branchId", "1");
  });
  await page.goto("/pedidos");
  await page.getByRole("button", { name: "Abrir pedido 9 de Cliente de prueba" }).first().click();
  const detail = page.getByRole("dialog", { name: "Pedido #9 · #VISUAL-70" });
  await detail.getByRole("button", { name: "Acciones del pedido" }).click();
  await page.getByRole("menuitem", { name: "Cancelar pedido" }).click();
  const cancel = page.getByRole("dialog", { name: "Cancelar pedido" });
  await expect(cancel.getByText(/Reembolso pendiente/)).toContainText("234.00");
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/order-cancel-${testInfo.project.name}.png`, fullPage: true });
  await cancel.getByLabel("Motivo de cancelación").fill("El cliente canceló y recibió la devolución");
  await cancel.getByRole("radio", { name: "Efectivo", exact: true }).check();
  await cancel.getByRole("checkbox", { name: /Confirmo que realicé/ }).check();
  await cancel.getByRole("button", { name: "Confirmar cancelación" }).scrollIntoViewIfNeeded();
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/order-cancel-confirm-${testInfo.project.name}.png`, fullPage: true });
  await cancel.getByRole("button", { name: "Confirmar cancelación" }).click();
  await expect(cancel).toBeHidden();
  await expect(detail.getByText("Reembolsado", { exact: true })).toBeVisible();
  await expect(detail.getByText("Monto cobrado").locator("..")).toContainText("234 S/");
  await expect(detail.getByText(/Pago de 234 S\/ en/)).toContainText("Tarjeta");
  await expect(detail.getByText(/Reembolso de 234 S\/ en/)).toContainText("Efectivo");
  await expect(detail.getByRole("button", { name: /^Cobrar/ })).toHaveCount(0);
  await expect(detail.getByText("Monto restante")).toHaveCount(0);
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/order-refunded-${testInfo.project.name}.png`, fullPage: true });
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ path: "/orders/70/cancel", body: { reason: "El cliente canceló y recibió la devolución", expected_version: 4, refunds: [{ method: "cash", amount: 234 }], refund_confirmed: true, register_id: 3, expected_session_id: 8, expected_cash_version: 6 } });
  expect(writes[0].key).toBeTruthy();
});
