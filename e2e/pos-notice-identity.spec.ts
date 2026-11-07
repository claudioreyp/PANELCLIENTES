import { expect, test, type Page } from "@playwright/test";
import type { AgentAttention } from "../src/types";

type Attention = AgentAttention & { contact_display_name?: string | null; contact_phone?: string | null };

function order(id: number, source: string) {
  return {
    id, business_id: 1, branch_id: 1, folio: id + 100, number: `SYNTHETIC-${id}`,
    source, channel: "takeaway", status: "sent_to_kitchen", payment_status: "pending",
    payment_method: "cash", version: 1, created_at: "2026-11-06T14:30:00Z",
    customer_name: null, customer_phone: null, table_id: null,
    subtotal: 30, total: 30, paid_amount: 0, remaining_amount: 30, delivery_fee: 0,
    discount: 0, notes: null, payments: [], kitchen_tickets: [], payment_requests: [],
    items: [{ id: id * 10, product_id: 1, name: "Pizza hawaiana", variant_name: "Mediana", quantity: 1, unit_price: 30, line_total: 30, modifiers: [], status: "pending" }],
  };
}

function attention(id: string, orderId: number | null, contact: Partial<Attention> = {}): Attention {
  return {
    id, business_id: 1, branch_id: 1, order_id: orderId,
    kind: orderId === null ? "human_requested" : "fulfillment_change",
    summary: `Detalle sintético ${id}`, sender: "7499818262692@lid", details: {},
    status: "pending", version: 1, created_at: "2026-11-06T14:32:00Z",
    resolved_at: null, resolved_by: null, resolution_note: null, ...contact,
  };
}

async function prepare(page: Page) {
  const sources = ["pos", "manual", "public_store", "integration", "whatsapp_agent", "agent", "n8n", "whatsapp"];
  const orders = new Map(sources.map((source, index) => [index + 1, {
    ...order(index + 1, source),
    ...(source === "pos" ? { recent_modification: { at: "2026-11-06T14:31:00Z", source: "agent", summary: "Cambio posterior del agente" } } : {}),
  }]));
  const records = [
    ...sources.map((source, index) => attention(`origen-${source}`, index + 1, {
      contact_display_name: `Cliente ${source}`, contact_phone: `5199900000${index + 1}`,
    })),
    attention("general-ambos", null, { contact_display_name: "María Fernández", contact_phone: "51988000001" }),
    attention("general-nombre", null, { contact_display_name: "Raúl de WhatsApp", contact_phone: null }),
    attention("general-telefono", null, { contact_display_name: null, contact_phone: "51988000003" }),
    attention("general-sin-datos", null, { contact_display_name: null, contact_phone: null }),
    // Compatibility with a response from the previous API version: a real PN
    // sender may be shown, while numeric LIDs must never be treated as phones.
    attention("general-pn-antiguo", null, { sender: "51988000005@c.us" }),
  ];
  const state = { failOrder: 0 };
  const reads: string[] = [];
  const forbidden: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("impulsa.authMode", "dev");
    localStorage.setItem("impulsa.businessId", "1");
    localStorage.setItem("impulsa.branchId", "1");
    Object.assign(window, { qz: {
      api: { setSha256Type: () => {} },
      websocket: { isActive: () => false, connect: async () => {}, disconnect: async () => {} },
      printers: { find: async () => [], details: async () => [] },
      configs: { create: () => ({}) },
      print: async () => {
        localStorage.setItem("pos-notice-identity:physical-print", "forbidden");
        throw new Error("Physical printing is forbidden in this synthetic test");
      },
      security: { setCertificatePromise: () => {}, setSignaturePromise: () => {}, setSignatureAlgorithm: () => {} },
    } });
  });
  await page.routeWebSocket(/.*/, socket => socket.close());
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      if (!(url.hostname === "fonts.googleapis.com" && request.method() === "GET" && request.resourceType() === "stylesheet")) forbidden.push(`${request.method()} ${url.origin}`);
      return route.abort("blockedbyclient");
    }
    if (!url.pathname.startsWith("/api/v1/")) {
      if (url.port !== "5175") { forbidden.push(request.url()); return route.abort("blockedbyclient"); }
      return route.continue();
    }
    const path = url.pathname.slice("/api/v1".length);
    const reply = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    reads.push(`${request.method()} ${path}`);
    if (request.method() !== "GET") {
      forbidden.push(`${request.method()} ${path}`);
      return reply({ detail: "This synthetic review is read-only" }, 405);
    }
    if (path === "/context") return reply({
      role: "owner", roles: ["owner"],
      business: { id: 1, slug: "synthetic-notice-identity", name: "Restaurante de prueba", status: "active", currency: "PEN", timezone: "America/Lima", modules: { pos: true, cash: true, inventory: true } },
      branches: [{ id: 1, business_id: 1, name: "Sucursal principal", active: true }],
    });
    if (path === "/agent-attention") {
      const selected = url.searchParams.get("order_id");
      return reply(records.filter(item => !selected || item.order_id === Number(selected)));
    }
    const singleOrder = path.match(/^\/orders\/(\d+)(?:\/detail)?$/);
    if (singleOrder) {
      const id = Number(singleOrder[1]);
      return state.failOrder === id ? reply({ detail: "No se pudo verificar el origen sintético" }, 503) : reply(orders.get(id));
    }
    if (path === "/orders/workspace") return reply({ branch_id: 1, period: "all", view: "orders", items: [], page: 1, page_size: 12, total: 0, review_count: 0 });
    if (path === "/catalog") return reply({ categories: [], products: [], modifier_groups: [], ingredients: [], promotions: [] });
    if (path === "/orders/printing/pending") return reply({ branch_id: 1, items: [], next_after_order_id: null });
    forbidden.push(`${request.method()} ${path}`);
    return reply({ detail: "No synthetic route exists for this request" }, 404);
  });
  return { orders, records, state, reads, forbidden };
}

function entry(page: Page, id: string) {
  return page.locator(".agent-attention-overview .agent-attention-entry").filter({ has: page.getByText(`Detalle sintético ${id}`, { exact: true }) });
}

async function assertReadOnly(page: Page, forbidden: string[]) {
  expect(forbidden).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem("pos-notice-identity:physical-print"))).toBeNull();
}

test("only agent-created orders appear and contact identity is readable without exposing LIDs", async ({ page }, info) => {
  await page.clock.install({ time: new Date("2026-11-06T15:00:00Z") });
  const fixture = await prepare(page);
  await page.goto("/pedidos");
  const panel = page.locator(".agent-attention-overview");
  await expect(panel.locator(".agent-attention-entry")).toHaveCount(9);
  for (const source of ["pos", "manual", "public_store", "integration"]) await expect(entry(page, `origen-${source}`)).toHaveCount(0);
  for (const [index, source] of ["whatsapp_agent", "agent", "n8n", "whatsapp"].entries()) {
    const summary = entry(page, `origen-${source}`).locator("summary");
    await expect(summary).toContainText(`Folio #${105 + index}`);
    await expect(summary).toContainText(`Cliente ${source}`);
    await expect(summary).toContainText(`5199900000${index + 5}`);
  }
  await expect(entry(page, "general-ambos").locator("summary")).toContainText("María Fernández");
  await expect(entry(page, "general-ambos").locator("summary")).toContainText("51988000001");
  await expect(entry(page, "general-nombre").locator("summary")).toContainText("Raúl de WhatsApp");
  await expect(entry(page, "general-nombre").locator("summary")).not.toContainText("51988000003");
  await expect(entry(page, "general-telefono").locator("summary")).toContainText("51988000003");
  await expect(entry(page, "general-sin-datos").locator("summary")).toContainText("Contacto no disponible");
  await expect(entry(page, "general-pn-antiguo").locator("summary")).toContainText("51988000005");
  await expect(panel).not.toContainText("@lid");
  await expect(panel).not.toContainText("7499818262692");
  await expect(panel).not.toContainText("@c.us");
  await expect(entry(page, "general-ambos").locator("summary")).toContainText("Sin pedido registrado");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `e2e/test-output/pos-notice-identity/${info.project.name}-overview.png`, fullPage: true });
  await assertReadOnly(page, fixture.forbidden);
});

test("the same agent notice shows folio and contact in the order while a manual order has no agent reviews", async ({ page }, info) => {
  await page.clock.install({ time: new Date("2026-11-06T15:00:00Z") });
  const fixture = await prepare(page);
  await page.goto("/pedidos");
  const linked = entry(page, "origen-whatsapp_agent");
  await linked.locator("summary").click();
  await linked.getByRole("button", { name: "Ver pedido", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const reviews = dialog.locator(".agent-attention-panel");
  await expect(reviews.getByRole("heading", { name: "Revisiones del pedido", exact: true })).toBeVisible();
  const summary = reviews.locator("summary");
  await expect(summary).toContainText("Folio #105");
  await expect(summary).toContainText("Cliente whatsapp_agent");
  await expect(summary).toContainText("51999000005");
  await expect(reviews).not.toContainText("@lid");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `e2e/test-output/pos-notice-identity/${info.project.name}-order.png`, fullPage: true });

  await page.goto("/pedidos?order_id=1");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Punto de venta");
  await expect(page.getByRole("dialog").locator(".agent-attention-panel")).toHaveCount(0);
  await expect(page.getByRole("dialog")).not.toContainText("Detalle sintético origen-pos");
  await assertReadOnly(page, fixture.forbidden);
});

test("an origin read failure preserves the complete confirmed notice list and exposes a retry", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-06T15:00:00Z") });
  const fixture = await prepare(page);
  await page.goto("/pedidos");
  const panel = page.locator(".agent-attention-overview");
  await expect(panel.locator(".agent-attention-entry")).toHaveCount(9);
  fixture.state.failOrder = 5;
  fixture.records.push(attention("general-sin-confirmar", null, { contact_display_name: "No mostrar colección parcial" }));
  await page.evaluate(() => window.dispatchEvent(new Event("pos:queries-changed")));
  await expect(panel.getByRole("alert")).toContainText("No se pudieron actualizar las incidencias");
  await expect(panel.getByRole("button", { name: "Reintentar incidencias", exact: true })).toBeVisible();
  await expect(panel.locator(".agent-attention-entry")).toHaveCount(9);
  await expect(panel).not.toContainText("No mostrar colección parcial");
  await expect(entry(page, "origen-whatsapp_agent").locator("summary")).toContainText("Folio #105");
  fixture.state.failOrder = 0;
  await panel.getByRole("button", { name: "Reintentar incidencias", exact: true }).click();
  await expect(panel.locator(".agent-attention-entry")).toHaveCount(10);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await assertReadOnly(page, fixture.forbidden);
});
