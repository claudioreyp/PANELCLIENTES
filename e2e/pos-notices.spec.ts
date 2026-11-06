import { expect, test, type Page } from "@playwright/test";

type Attention = {
  id: string; business_id: number; branch_id: number; order_id: number | null;
  kind: string; summary: string; sender: string; details: Record<string, unknown>;
  status: "pending" | "acknowledged" | "resolved"; version: number; created_at: string;
  resolved_at: string | null; resolved_by: string | null; resolution_note: string | null;
};

function order(id: number, source: "pos" | "whatsapp_agent" = "whatsapp_agent") {
  return {
    id, business_id: 1, branch_id: 1, folio: id + 100, number: `SYNTHETIC-${id}`,
    source, channel: "takeaway", status: "sent_to_kitchen", payment_status: "pending",
    payment_method: "cash", version: 1, created_at: "2026-11-06T14:30:00Z",
    customer_name: "Cliente de prueba", customer_phone: null, table_id: null,
    subtotal: 30, total: 30, paid_amount: 0, remaining_amount: 30, delivery_fee: 0,
    discount: 0, notes: null, payments: [], kitchen_tickets: [],
    items: [{ id: id * 10, product_id: 1, name: "Pizza hawaiana", variant_name: "Mediana", quantity: 1, unit_price: 30, line_total: 30, modifiers: [], status: "pending" }],
  };
}

function attention(id: string, kind: string, summary: string, orderId: number | null): Attention {
  return {
    id, business_id: 1, branch_id: 1, order_id: orderId, kind, summary,
    sender: "51999000001", details: {}, status: "pending", version: 1,
    created_at: "2026-11-06T14:32:00Z", resolved_at: null, resolved_by: null, resolution_note: null,
  };
}

function printJob(id: string, createdAt: string) {
  return {
    id, order_id: 12, branch_id: 1, job_type: "kitchen_ticket", status: "pending",
    retryable: false, attempts: 0, created_at: createdAt,
    payload: {
      snapshot_version: 1, printer_name: "Impresora de prueba desconectada", paper_width_mm: 80,
      copies: 1, print_language: "pixel", business: { name: "Restaurante de prueba" },
      branch: { name: "Sucursal principal", address: "Dirección sintética" }, order: order(12), ticket: null,
    },
  };
}

async function prepare(page: Page, options: { withLegacyPrint?: boolean; failFirstClose?: boolean } = {}) {
  const records = [
    attention("financial", "financial_review", "Revisar el comprobante y el importe del pedido antes de confirmar el pago. La revisión corresponde al encargado.", 12),
    attention("human", "human_requested", "El cliente solicita conversar con un encargado del restaurante.", null),
    attention("manual-history", "notification_review", "Aviso técnico de un pedido manual anterior sin relación actual con el agente.", 11),
    attention("agent-notification", "notification_review", "Revisar la entrega de la actualización del pedido recibido por WhatsApp.", 12),
  ];
  const orders = new Map([[11, order(11, "pos")], [12, order(12)]]);
  const jobs = options.withLegacyPrint ? [printJob("legacy-document", "2020-01-01T00:00:00Z")] : [];
  const resolutions: { id: string; key: string | undefined; body: Record<string, unknown> }[] = [];
  const otherWrites: string[] = [];
  const unexpected: string[] = [];

  await page.addInitScript(() => {
    localStorage.setItem("impulsa.authMode", "dev");
    localStorage.setItem("impulsa.businessId", "1");
    localStorage.setItem("impulsa.branchId", "1");
    let connected = false;
    Object.assign(window, { qz: {
      api: { setSha256Type: () => {} },
      websocket: {
        isActive: () => connected,
        connect: async () => { connected = true; },
        disconnect: async () => { connected = false; },
      },
      printers: {
        find: async () => [],
        details: async () => {
          const key = "pos-notices-test:printer-probes";
          localStorage.setItem(key, String(Number(localStorage.getItem(key) || 0) + 1));
          return [];
        },
      },
      configs: { create: () => ({}) },
      print: async () => { throw new Error("Physical printing is forbidden in this synthetic test"); },
      security: { setCertificatePromise: () => {}, setSignaturePromise: () => {}, setSignatureAlgorithm: () => {} },
    } });
  });
  // No real API, authentication provider, WhatsApp transport or local QZ socket is used.
  await page.routeWebSocket(/.*/, socket => socket.close());
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      // The incumbent stylesheet imports a Google font; block it as well, but
      // distinguish that known presentation request from an unexpected service call.
      if (!(url.hostname === "fonts.googleapis.com" && request.method() === "GET" && request.resourceType() === "stylesheet")) {
        unexpected.push(`${request.method()} ${url.origin}`);
      }
      return route.abort("blockedbyclient");
    }
    if (!url.pathname.startsWith("/api/v1/")) {
      if (url.port !== "5175") { unexpected.push(request.url()); return route.abort("blockedbyclient"); }
      return route.continue();
    }
    const path = url.pathname.slice("/api/v1".length);
    const reply = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (request.method() === "GET" && path === "/context") return reply({
      role: "owner", roles: ["owner"],
      business: { id: 1, slug: "synthetic-notices", name: "Restaurante de prueba", status: "active", currency: "PEN", timezone: "America/Lima", modules: { pos: true, cash: true, inventory: true } },
      branches: [{ id: 1, business_id: 1, name: "Sucursal principal", active: true }],
    });
    if (request.method() === "GET" && path === "/agent-attention") {
      const requestedOrder = url.searchParams.get("order_id");
      return reply(records.filter(item => (!requestedOrder || item.order_id === Number(requestedOrder)) && (url.searchParams.get("status") === "all" || item.status !== "resolved")));
    }
    const close = path.match(/^\/agent-attention\/([^/]+)\/resolve$/);
    if (request.method() === "POST" && close) {
      const body = request.postDataJSON() as Record<string, unknown>;
      const key = request.headers()["idempotency-key"];
      resolutions.push({ id: close[1], key, body });
      if (options.failFirstClose && resolutions.length === 1) return reply({ detail: "Synthetic temporary failure" }, 503);
      const target = records.find(item => item.id === close[1]);
      if (!target) return reply({ detail: "Attention request not found" }, 404);
      if (body.expected_version !== target.version) return reply({ detail: "Attention request changed; reload before resolving" }, 409);
      target.status = "resolved"; target.version += 1; target.resolution_note = String(body.note);
      target.resolved_by = "synthetic-owner"; target.resolved_at = "2026-11-06T14:40:00Z";
      return reply(target);
    }
    const singleOrder = path.match(/^\/orders\/(\d+)$/);
    if (request.method() === "GET" && singleOrder) return reply(orders.get(Number(singleOrder[1])));
    if (request.method() === "GET" && path === "/orders/workspace") return reply({ branch_id: 1, period: "all", view: "orders", items: [], page: 1, page_size: 12, total: 0, review_count: 0 });
    if (request.method() === "GET" && path === "/catalog") return reply({ categories: [], products: [], modifier_groups: [], ingredients: [], promotions: [] });
    if (request.method() === "GET" && path === "/orders/printing/pending") return reply({ branch_id: 1, items: jobs.length ? [{ order_id: 12, version: 1 }] : [], next_after_order_id: null });
    if (request.method() === "GET" && path === "/orders/12/printing") return reply({ order_id: 12, items: jobs, recoverable_error: false });
    if (request.method() === "GET" && /^\/(?:orders\/12\/printing\/qz|settings\/branches\/1\/printing\/qz)$/.test(path)) return reply({ mode: "manual-approval", certificate: null });
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) otherWrites.push(`${request.method()} ${path}`);
    unexpected.push(`${request.method()} ${path}`);
    return reply({ detail: "No synthetic route exists for this request" }, 404);
  });
  return { records, jobs, resolutions, otherWrites, unexpected };
}

async function printerProbes(page: Page) {
  return page.evaluate(() => Number(localStorage.getItem("pos-notices-test:printer-probes") || 0));
}

test("compact notices preserve details and close globally without touching an order or payment", async ({ page }, info) => {
  const fixture = await prepare(page, { withLegacyPrint: true });
  await page.goto("/pedidos");
  const panel = page.locator(".agent-attention-overview");
  const finance = panel.locator(".attention-financial_review");
  await expect(finance).toBeVisible();
  await expect(panel.locator(".agent-attention-entry")).toHaveCount(3);
  await expect(panel).not.toContainText("Aviso técnico de un pedido manual anterior");
  await expect(finance).toContainText("Revisión de pago");
  await expect(finance).toContainText("112");
  await expect.poll(() => printerProbes(page)).toBe(1);
  const printing = page.getByRole("complementary", { name: "Estado de impresión" });
  await expect(printing.locator(".print-notification")).toHaveCount(1);
  await expect(printing.getByRole("button", { name: "Cerrar aviso de impresión" })).toBeVisible();
  await expect(panel).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const close = finance.getByRole("button", { name: "Cerrar aviso", exact: true });
  const box = await close.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(info.project.name === "desktop" ? 36 : 44);
  await page.screenshot({ path: `.impeccable/review/pos-notices-${info.project.name}.png`, fullPage: true });
  await finance.locator("summary").click();
  await expect(finance.getByText(fixture.records[0].summary, { exact: true })).toBeVisible();
  await close.click();
  await expect(finance).toHaveCount(0);
  expect(fixture.resolutions).toHaveLength(1);
  expect(fixture.resolutions[0]).toEqual({ id: "financial", key: expect.any(String), body: { expected_version: 1, status: "resolved", note: "Aviso cerrado desde el POS." } });
  await page.reload();
  await expect(panel.locator(".agent-attention-entry")).toHaveCount(2);
  await expect(panel.locator(".attention-financial_review")).toHaveCount(0);
  await expect(printing.locator(".print-notification")).toHaveCount(0);
  expect(await printerProbes(page)).toBe(1);
  expect(fixture.otherWrites).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test("a failed global close recovers with the same operation after reloading", async ({ page }) => {
  const fixture = await prepare(page, { failFirstClose: true });
  await page.goto("/pedidos");
  const finance = page.locator(".agent-attention-overview .attention-financial_review");
  await finance.getByRole("button", { name: "Cerrar aviso", exact: true }).click();
  await expect(finance.getByRole("button", { name: "Reintentar cierre" })).toBeVisible();
  await page.reload();
  await finance.getByRole("button", { name: "Reintentar cierre" }).click();
  await expect(finance).toHaveCount(0);
  expect(fixture.resolutions).toHaveLength(2);
  expect(fixture.resolutions[1]).toEqual(fixture.resolutions[0]);
  expect(fixture.otherWrites).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});

test("legacy printing gets one last attempt and a fresh addition gets only one retry across reloads", async ({ page }) => {
  const fixture = await prepare(page, { withLegacyPrint: true });
  await page.goto("/pedidos");
  await expect.poll(() => printerProbes(page)).toBe(1);
  await expect(page.locator(".print-notification .icon-button")).toBeVisible();
  await page.locator(".print-notification .icon-button").click();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.reload();
  await expect(page.locator(".agent-attention-overview .attention-human_requested")).toBeVisible();
  expect(await printerProbes(page)).toBe(1);
  await expect(page.locator(".print-notification")).toHaveCount(0);
  // A new document, including an addition on the same order/version, has its own allowance.
  fixture.jobs.push(printJob("new-addition", "2099-01-01T00:00:00Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => printerProbes(page)).toBe(3);
  await expect(page.locator(".print-notification .icon-button")).toBeVisible();
  await page.locator(".print-notification .icon-button").click();
  await page.reload();
  await expect(page.locator(".agent-attention-overview .attention-human_requested")).toBeVisible();
  await expect(page.locator(".print-notification")).toHaveCount(0);
  expect(await printerProbes(page)).toBe(3);
  expect(fixture.otherWrites).toEqual([]);
  expect(fixture.unexpected).toEqual([]);
});
