import { expect, test, type Page } from "@playwright/test";
import type { KitchenTicket } from "../src/types";

// Deliberately different from Lima: the cutoff must not follow this browser's day.
test.use({ timezoneId: "Pacific/Honolulu" });

type Attention = {
  id: string; business_id: number; branch_id: number; order_id: number | null;
  kind: string; summary: string; sender: string; details: Record<string, unknown>;
  status: "pending" | "resolved"; version: number; created_at: string;
  resolved_at: string | null; resolved_by: string | null; resolution_note: string | null;
};

function ticket(id: number, firedAt: string, name = `Cliente ${id}`): KitchenTicket {
  return {
    id, order_id: id + 1000, order_number: `SYNTHETIC-${id}`, order_folio: id,
    sequence: 1, channel: "takeaway", customer_name: name, created_by_name: "Caja de prueba",
    source: "whatsapp_agent", station: "kitchen", status: "queued", version: 1,
    created_at: firedAt, fired_at: firedAt, print_count: 0,
    items: [{ item_id: id * 10, name: "Pizza hawaiana", variant_name: "Mediana", quantity: 1, modifiers: [], combo_components: [] }],
  };
}

function attention(id: string, kind: string, date: string): Attention {
  return {
    id, business_id: 1, branch_id: 1, order_id: null, kind,
    summary: `Detalle sintético ${id}`, sender: "51999000001", details: {}, status: "pending",
    version: 1, created_at: date, resolved_at: null, resolved_by: null, resolution_note: null,
  };
}

async function prepare(page: Page, initial: { tickets?: KitchenTicket[]; notices?: Attention[] } = {}) {
  const tickets = initial.tickets || [];
  const notices = initial.notices || [];
  const reads: { branch: string | null; view: string; page: number; pageSize: number; localDate: string | null }[] = [];
  const actions: { path: string; key: string | undefined; body: unknown }[] = [];
  const resolutions: { path: string; key: string | undefined; body: unknown }[] = [];
  const forbidden: string[] = [];
  const state = { failActivePage: 0 };

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
      printers: { find: async () => [], details: async () => [] },
      configs: { create: () => ({}) },
      print: async () => {
        localStorage.setItem("pos-daily-test:physical-print", "forbidden");
        throw new Error("Physical printing is forbidden in this synthetic test");
      },
      security: { setCertificatePromise: () => {}, setSignaturePromise: () => {}, setSignatureAlgorithm: () => {} },
    } });
  });
  // All business data is synthetic. No real API, WhatsApp or QZ socket is reached.
  await page.routeWebSocket(/.*/, socket => socket.close());
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      if (!(url.hostname === "fonts.googleapis.com" && request.method() === "GET" && request.resourceType() === "stylesheet")) {
        forbidden.push(`${request.method()} ${url.origin}`);
      }
      return route.abort("blockedbyclient");
    }
    if (!url.pathname.startsWith("/api/v1/")) {
      if (url.port !== "5175") { forbidden.push(request.url()); return route.abort("blockedbyclient"); }
      return route.continue();
    }
    const path = url.pathname.slice("/api/v1".length);
    const reply = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (request.method() === "GET" && path === "/context") return reply({
      role: "owner", roles: ["owner"],
      business: { id: 1, slug: "synthetic-daily-cutoff", name: "Restaurante de prueba", status: "active", currency: "PEN", timezone: "America/Lima", modules: { pos: true, cash: true, inventory: true } },
      branches: [{ id: 1, business_id: 1, name: "Sucursal principal", active: true }],
    });
    if (request.method() === "GET" && path === "/agent-attention") return reply(notices.filter(item => item.status !== "resolved"));
    const resolve = path.match(/^\/agent-attention\/([^/]+)\/resolve$/);
    if (request.method() === "POST" && resolve) {
      const body = request.postDataJSON() as Record<string, unknown>;
      resolutions.push({ path, key: request.headers()["idempotency-key"], body });
      const target = notices.find(item => item.id === resolve[1]);
      if (!target) return reply({ detail: "Unknown synthetic notice" }, 404);
      target.status = "resolved"; target.version += 1;
      target.resolution_note = String(body.note); target.resolved_by = "dev-owner";
      target.resolved_at = "2026-11-07T05:01:00Z";
      return reply(target);
    }
    if (request.method() === "GET" && path === "/kitchen/commands") {
      const view = url.searchParams.get("view") || "active";
      const pageNumber = Number(url.searchParams.get("page") || 1);
      const pageSize = Number(url.searchParams.get("page_size") || 12);
      reads.push({ branch: url.searchParams.get("branch_id"), view, page: pageNumber, pageSize, localDate: url.searchParams.get("local_date") });
      if (view === "active" && pageNumber === state.failActivePage) return reply({ detail: "Synthetic second-page read failed" }, 503);
      const source = tickets.filter(item => view === "active" ? item.status === "queued" || item.status === "preparing" : item.status === "ready");
      return reply({ items: source.slice((pageNumber - 1) * pageSize, pageNumber * pageSize), total: source.length, active_count: tickets.filter(item => item.status === "queued" || item.status === "preparing").length, page: pageNumber, page_size: pageSize, view });
    }
    const action = path.match(/^\/kitchen\/commands\/(\d+)\/(complete|reopen)$/);
    if (request.method() === "POST" && action) {
      const body = request.postDataJSON() as Record<string, unknown>;
      actions.push({ path, key: request.headers()["idempotency-key"], body });
      const target = tickets.find(item => item.id === Number(action[1]));
      if (!target) return reply({ detail: "Unknown synthetic ticket" }, 404);
      if (body.expected_status !== target.status || body.expected_version !== target.version) return reply({ detail: "Synthetic conflict" }, 409);
      target.status = action[2] === "complete" ? "ready" : "queued";
      target.version = Number(target.version) + 1;
      target.ready_at = action[2] === "complete" ? "2026-11-06T15:01:00Z" : null;
      return reply(target);
    }
    if (request.method() === "GET" && path === "/orders/workspace") return reply({ branch_id: 1, period: "all", view: "orders", items: [], page: 1, page_size: 12, total: 0, review_count: 0 });
    if (request.method() === "GET" && path === "/catalog") return reply({ categories: [], products: [], modifier_groups: [], ingredients: [], promotions: [] });
    if (request.method() === "GET" && path === "/orders/printing/pending") return reply({ branch_id: 1, items: [], next_after_order_id: null });
    forbidden.push(`${request.method()} ${path}`);
    return reply({ detail: "No synthetic route exists for this request" }, 404);
  });
  return { tickets, notices, reads, actions, resolutions, forbidden, state };
}

async function board(page: Page) {
  await page.goto("/pedidos");
  await page.getByRole("tab", { name: "Comandas digitales", exact: true }).click();
  const result = page.locator(".digital-command-board");
  await expect(result).toBeVisible();
  return result;
}

async function invalidate(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("pos:queries-changed")));
}

async function assertNoPhysicalPrint(page: Page) {
  expect(await page.evaluate(() => localStorage.getItem("pos-daily-test:physical-print"))).toBeNull();
}

test("daily groups collect every server page, reuse the snapshot and preserve manual completion", async ({ page }, info) => {
  await page.clock.install({ time: new Date("2026-11-06T15:00:00Z") });
  const old = Array.from({ length: 101 }, (_, index) => ticket(index + 1, "2026-11-05T18:00:00Z", `Anterior ${index + 1}`));
  const today = Array.from({ length: 14 }, (_, index) => ticket(2001 + index, "2026-11-06T14:55:00Z", `Hoy ${index + 1}`));
  const addition = { ...ticket(3001, "2026-11-06T14:58:00Z", "Agregado de pedido anterior"), created_at: "2026-11-05T18:00:00Z", order_id: 1001, sequence: 2, kind: "addition" };
  const fixture = await prepare(page, { tickets: [...old, ...today, addition] });
  const view = await board(page);
  // Let React's lazy route finish before pausing its timers. Pausing during
  // bootstrap would also pause the Suspense retry that mounts the actual page.
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 100));
  await expect(view.locator(".command-board-summary")).toContainText("15 comandas por preparar");
  await expect(view.locator(".command-card")).toHaveCount(12);
  await expect(view).toContainText("Página 1 de 2");
  expect(fixture.reads.filter(item => item.view === "active")).toEqual([
    { branch: "1", view: "active", page: 1, pageSize: 100, localDate: null },
    { branch: "1", view: "active", page: 2, pageSize: 100, localDate: null },
  ]);
  const readsAfterSnapshot = fixture.reads.length;
  await view.getByRole("button", { name: "Página siguiente", exact: true }).click();
  await expect(view.locator(".command-card")).toHaveCount(3);
  await expect(view).toContainText("Agregado de pedido anterior");
  await view.getByRole("button", { name: "Pendientes anteriores", exact: true }).click();
  await expect(view.locator(".command-board-summary")).toContainText("101 comandas por preparar");
  await expect(view).toContainText("Página 1 de 9");
  await expect(view.locator(".command-card")).toHaveCount(12);
  await view.getByRole("button", { name: "Página siguiente", exact: true }).click();
  await expect(view).toContainText("Página 2 de 9");
  await view.getByRole("button", { name: "Hoy", exact: true }).click();
  await expect(view).toContainText("Página 1 de 2");
  expect(fixture.reads).toHaveLength(readsAfterSnapshot);
  expect(fixture.actions).toEqual([]);
  expect(fixture.resolutions).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `e2e/test-output/pos-daily-r02/${info.project.name}-commands.png`, fullPage: true });

  await view.locator(".command-card").filter({ hasText: "Hoy 1" }).first().getByRole("button", { name: "Completar comanda" }).click();
  await expect(view.locator(".command-board-summary")).toContainText("14 comandas por preparar");
  expect(fixture.actions).toEqual([{ path: "/kitchen/commands/2001/complete", key: expect.any(String), body: { expected_status: "queued", expected_version: 1 } }]);
  await view.getByRole("button", { name: "Ver historial", exact: true }).click();
  await expect(view.locator(".command-card")).toHaveCount(1);
  await expect(view).toContainText("Hoy 1");
  expect(fixture.reads.at(-1)).toEqual({ branch: "1", view: "history", page: 1, pageSize: 12, localDate: "2026-11-06" });
  await view.getByRole("button", { name: "Regresar a comandas digitales" }).click();
  await expect(view.locator(".command-board-summary")).toContainText("14 comandas por preparar");

  // A successful first page followed by a failed page must never replace the complete snapshot.
  fixture.state.failActivePage = 2;
  fixture.tickets.push(ticket(4001, "2026-11-06T14:59:00Z", "No presentar colección parcial"));
  await invalidate(page);
  await expect(view.getByRole("note", { name: "Estado de actualización" })).toContainText("última consulta");
  await expect(view.locator(".command-board-summary")).toContainText("14 comandas por preparar");
  await expect(view.locator(".command-card")).toHaveCount(12);
  expect(fixture.actions).toHaveLength(1);
  expect(fixture.resolutions).toEqual([]);
  expect(fixture.forbidden).toEqual([]);
  await assertNoPhysicalPrint(page);
});

test("Lima midnight and returning after suspension reset the view without commercial operations", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-07T04:58:00Z") });
  const fixture = await prepare(page, { tickets: [
    ticket(10, "2026-11-05T18:00:00Z", "Pendiente de ayer"),
    ticket(11, "2026-11-07T04:59:00Z", "Comanda de las 23:59"),
  ] });
  const view = await board(page);
  await page.clock.pauseAt(new Date("2026-11-07T04:59:59Z"));
  await expect(view.locator(".command-board-summary")).toContainText("1 comanda por preparar");
  await expect(view).toContainText("Comanda de las 23:59");
  await view.getByRole("button", { name: "Pendientes anteriores", exact: true }).click();
  await expect(view).toContainText("Pendiente de ayer");
  await page.clock.runFor(4000);
  await expect(view.getByRole("button", { name: "Hoy", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(view.locator(".command-card")).toHaveCount(0);
  await expect(view).toContainText("Página 1 de 1");
  await view.getByRole("button", { name: "Pendientes anteriores", exact: true }).click();
  await expect(view.locator(".command-board-summary")).toContainText("2 comandas por preparar");
  await expect(view).toContainText("Comanda de las 23:59");
  expect(fixture.tickets.every(item => item.status === "queued")).toBe(true);

  fixture.tickets.push({ ...ticket(12, "2026-11-07T05:00:01Z", "Agregado del nuevo día"), order_id: 1010, created_at: "2026-11-05T18:00:00Z", sequence: 2, kind: "addition" });
  await invalidate(page);
  await view.getByRole("button", { name: "Hoy", exact: true }).click();
  await expect(view.locator(".command-card")).toHaveCount(1);
  await expect(view).toContainText("Agregado del nuevo día");
  await view.getByRole("button", { name: "Pendientes anteriores", exact: true }).click();
  // Simulate a suspended browser: advance its wall clock without delivering timer callbacks.
  await page.clock.setSystemTime(new Date("2026-11-08T05:00:03Z"));
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
  });
  await expect(view.getByRole("button", { name: "Hoy", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(view.locator(".command-card")).toHaveCount(0);
  await expect(view).toContainText("Página 1 de 1");
  expect(fixture.actions).toEqual([]);
  expect(fixture.resolutions).toEqual([]);
  expect(fixture.forbidden).toEqual([]);
  await assertNoPhysicalPrint(page);
});

test("daily notices hide only dated technical notices and keep important or unknown reviews", async ({ page }, info) => {
  await page.clock.install({ time: new Date("2026-11-07T04:58:00Z") });
  const fixture = await prepare(page, { notices: [
    attention("technical-old", "notification_review", "2026-11-05T18:00:00Z"),
    attention("technical-today", "notification_review", "2026-11-07T04:59:00Z"),
    attention("payment-old", "financial_review", "2026-11-05T18:00:00Z"),
    attention("quote-old", "delivery_quote", "2026-11-05T18:00:00Z"),
    attention("human-old", "human_requested", "2026-11-05T18:00:00Z"),
    attention("unknown-old", "future_unknown_kind", "2026-11-05T18:00:00Z"),
    attention("technical-invalid", "notification_review", "invalid-date"),
  ] });
  await page.goto("/pedidos");
  const panel = page.locator(".agent-attention-overview");
  await expect(panel.locator(".agent-attention-entry")).toHaveCount(6);
  await page.clock.pauseAt(new Date("2026-11-07T04:59:59Z"));
  await expect(panel.locator(".attention-financial_review")).toBeVisible();
  await expect(panel.locator(".attention-delivery_quote")).toBeVisible();
  await expect(panel.locator(".attention-human_requested")).toBeVisible();
  await expect(panel.locator(".attention-future_unknown_kind")).toBeVisible();
  await expect(panel.locator(".attention-notification_review")).toHaveCount(2);
  await panel.getByRole("button", { name: "Ver anteriores (1)", exact: true }).click();
  await expect(panel.locator(".agent-attention-entry")).toHaveCount(7);
  await expect(panel.getByRole("button", { name: "Ocultar anteriores", exact: true })).toBeVisible();
  await page.clock.runFor(4000);
  await expect(panel.locator(".agent-attention-entry")).toHaveCount(5);
  await expect(panel.getByRole("button", { name: "Ver anteriores (2)", exact: true })).toBeVisible();
  await expect(panel.locator(".attention-notification_review")).toHaveCount(1);
  await expect(panel.locator(".attention-financial_review")).toBeVisible();
  await expect(panel.locator(".attention-delivery_quote")).toBeVisible();
  await expect(panel.locator(".attention-human_requested")).toBeVisible();
  await expect(panel.locator(".attention-future_unknown_kind")).toBeVisible();
  expect(fixture.notices.every(item => item.status === "pending")).toBe(true);
  expect(fixture.actions).toEqual([]);
  expect(fixture.resolutions).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `e2e/test-output/pos-daily-r02/${info.project.name}-notices.png`, fullPage: true });
  await panel.getByRole("button", { name: "Ver anteriores (2)", exact: true }).click();
  const finance = panel.locator(".attention-financial_review");
  await finance.getByRole("button", { name: "Cerrar aviso", exact: true }).click();
  await expect(finance).toHaveCount(0);
  expect(fixture.resolutions).toEqual([{ path: "/agent-attention/payment-old/resolve", key: expect.any(String), body: { expected_version: 1, status: "resolved", note: "Aviso cerrado desde el POS." } }]);
  expect(fixture.actions).toEqual([]);
  expect(fixture.forbidden).toEqual([]);
  await assertNoPhysicalPrint(page);
});
