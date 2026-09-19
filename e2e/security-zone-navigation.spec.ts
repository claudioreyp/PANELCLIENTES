import { resolve } from "node:path";
import type { Locator, Page, Route } from "@playwright/test";
import type { RestaurantTable } from "../src/types";
import type { SecurityAuditDetail, SecurityAuditEntry } from "../src/types/settings";
import { test as base, expect } from "./helpers/parity-workspace";
import { historyAreas, historyDetail } from "./helpers/table-history-data";

const ORDER_ID = 201;
const FOLIO = 7;
const ORDER_CODE = "POS-CODE-201-COMPLETE";
const ZONE_NAME = "Zona de prueba aislada";
const MOVEMENT_ID = 9424;
const REGISTER_ID = 9;
const register = { id: REGISTER_ID, name: "Caja terraza", branch_id: 1, active: true, is_default: false };
const occurredAt = "2026-09-08T20:58:00Z";
const orderTarget = { kind: "order", branch_id: 1, label: `Pedido #${ORDER_CODE} (#${FOLIO})`, order_id: ORDER_ID } as const;

// Stable contract fixtures for the new SecurityAuditSettings surface, not API calls.
const auditDetails: SecurityAuditDetail[] = [
  {
    id: 401, branch_id: 1, actor_name: "Equipo de prueba", occurred_at: occurredAt,
    summary: "cancel\u00f3 un producto de un pedido",
    fields: [
      { label: "ID de pedido", value: `#${ORDER_CODE}` },
      { label: "Folio de pedido", value: `#${FOLIO}` },
    ],
    sections: [{ title: "Pizza retirada", fields: [
      { label: "Producto", value: "Pizza retirada" },
      { label: "Motivo de cancelaci\u00f3n", value: "El cliente cambio su seleccion" },
      { label: "Cantidad cancelada", value: "1" },
    ] }],
    target: orderTarget,
  },
  {
    id: 402, branch_id: 1, actor_name: "Equipo de prueba", occurred_at: occurredAt,
    summary: "realiz\u00f3 un retiro de efectivo",
    fields: [
      { label: "ID de movimiento", value: `#${MOVEMENT_ID}` },
      { label: "ID de la caja", value: `#${REGISTER_ID}` },
      { label: "Caja", value: register.name },
      { label: "Monto", value: "100 S/" },
      { label: "Nota", value: "Insumos del turno anterior" },
    ],
    sections: [],
    target: { kind: "cash_movement", branch_id: 1, label: `Movimiento #${MOVEMENT_ID}`, register_id: REGISTER_ID, movement_id: MOVEMENT_ID },
  },
  {
    id: 403, branch_id: 1, actor_name: "Equipo de prueba", occurred_at: occurredAt,
    summary: "edit\u00f3 un producto reduciendo su importe",
    fields: [{ label: "Folio de pedido", value: `#${FOLIO}` }],
    sections: [{ title: "Pizza clasica", fields: [
      { label: "Importe anterior", value: "30 S/" },
      { label: "Importe posterior", value: "24 S/" },
    ] }],
    target: orderTarget,
  },
  {
    id: 404, branch_id: 1, actor_name: "Equipo de prueba", occurred_at: occurredAt,
    summary: "cancel\u00f3 un pedido no pagado",
    fields: [{ label: "Motivo de cancelaci\u00f3n", value: "Motivo no registrado" }],
    sections: [], target: null,
  },
];

const auditEntries: SecurityAuditEntry[] = auditDetails.map((detail, index) => ({
  id: detail.id, branch_id: detail.branch_id, actor_name: detail.actor_name,
  branch_name: "Matriz", occurred_at: detail.occurred_at, summary: detail.summary,
  action: ["order.items_revised", "cash.movement_created", "order.items_revised", "order.cancelled"][index],
  categories: [["item_cancellation"], ["cash_withdrawal"], ["amount_reduction"], ["order_cancellation"]][index],
}));

function orderDetail() {
  const saved = historyDetail(ORDER_ID)!;
  return {
    ...saved,
    order: { ...saved.order, folio: FOLIO, number: ORDER_CODE, channel: "counter", table_id: null, table_released_at: null, customer_name: "Cliente de auditoria", payment_status: "pending" },
    table_context: null, payments: [], payment_summary: { paid: 0, remaining: 32 },
    tickets: saved.tickets.map((ticket) => ({ ...ticket, order_folio: FOLIO, order_number: ORDER_CODE, channel: "counter", status: "preparing" })),
  };
}

type MockWrite = { path: string; method: string; body: Record<string, unknown> };
type FlowMock = {
  areas: typeof historyAreas;
  tables: RestaurantTable[];
  writes: MockWrite[];
  detailReads: number[];
  auditDetailReads: number[];
  movementQueries: URLSearchParams[];
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

const test = base.extend<{ flowMock: FlowMock }>({
  flowMock: [async ({ page, parityMock }, use) => {
    const state: FlowMock = { areas: structuredClone(historyAreas), tables: [], writes: [], detailReads: [], auditDetailReads: [], movementQueries: [] };
    const detail = orderDetail();
    // Only these explicit fixture mutations bypass the shared read-only network guard.
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.slice("/api/v1".length);
      const method = request.method();
      const areaMatch = path.match(/^\/areas\/(\d+)$/);
      const tableMatch = path.match(/^\/tables\/(\d+)$/);
      if (["POST", "PATCH"].includes(method) && (path === "/areas" || path === "/tables" || areaMatch || tableMatch)) {
        const body = request.postDataJSON() as Record<string, unknown>;
        state.writes.push({ path, method, body });
        if (method === "POST" && path === "/areas") {
          expect(body.branch_id).toBe(1);
          const area = { id: 53, branch_id: 1, name: String(body.name), sort_order: 2, columns: Number(body.columns), rows: Number(body.rows), version: 1 };
          state.areas.push(area);
          return json(route, area, 201);
        }
        if (method === "PATCH" && areaMatch) {
          const area = state.areas.find((candidate) => candidate.id === Number(areaMatch[1]));
          if (!area) return json(route, { detail: "Zona no encontrada" }, 404);
          expect(body.expected_version).toBe(area.version);
          Object.assign(area, body, { version: area.version + 1 });
          return json(route, area);
        }
        if (method === "POST" && path === "/tables") {
          expect(body.branch_id).toBe(1);
          expect(state.areas.some((area) => area.id === body.area_id)).toBe(true);
          expect(state.tables.some((table) => table.code === body.code)).toBe(false);
          const table = { ...body, id: 610 + state.tables.length, status: "available", version: 1 } as RestaurantTable;
          state.tables.push(table);
          return json(route, table, 201);
        }
        if (method === "PATCH" && tableMatch) {
          const table = state.tables.find((candidate) => candidate.id === Number(tableMatch[1]));
          if (!table) return json(route, { detail: "Mesa no encontrada" }, 404);
          expect(body.expected_version).toBe(table.version);
          Object.assign(table, body, { version: (table.version || 1) + 1 });
          return json(route, table);
        }
        parityMock.violations.push(`Unsupported fixture write: ${method} ${path}`);
        return json(route, { detail: "Escritura bloqueada" }, 405);
      }
      if (method !== "GET") return route.fallback();
      const handled = ["/areas", "/tables", "/orders/workspace", "/kitchen/commands", "/settings/audit", "/cash/registers", `/cash/registers/${REGISTER_ID}/movements`, `/cash/registers/${REGISTER_ID}/cut-preview`].includes(path)
        || /^\/settings\/audit\/\d+$/.test(path) || /^\/orders\/\d+\/detail$/.test(path);
      if (!handled) return route.fallback();
      parityMock.reads.push({ method, path, query: url.search });
      if (["/areas", "/tables", "/orders/workspace", "/kitchen/commands", "/settings/audit"].includes(path) || path.startsWith("/settings/audit/")) expect(url.searchParams.get("branch_id")).toBe("1");
      if (path === "/areas") return json(route, state.areas);
      if (path === "/tables") return json(route, state.tables);
      if (path === "/orders/workspace") {
        const search = (url.searchParams.get("search") || "").toLowerCase();
        const isHistory = url.searchParams.get("view") === "table_history";
        const order = isHistory ? { ...detail.order, channel: "dine_in", status: "closed", payment_status: "paid", table_id: 101 } : detail.order;
        const rows = `${order.folio} ${order.number} ${order.customer_name}`.toLowerCase().includes(search) ? [{ ...order, paid_amount: isHistory ? 32 : 0, requires_review: false, item_count: 2 }] : [];
        return json(route, { items: rows, total: rows.length, review_count: 0, branch_id: 1, page: 1, page_size: 12, period: "all", view: isHistory ? "table_history" : "orders" });
      }
      const orderMatch = path.match(/^\/orders\/(\d+)\/detail$/);
      if (orderMatch) {
        const id = Number(orderMatch[1]);
        state.detailReads.push(id);
        return json(route, id === ORDER_ID ? detail : { detail: "Pedido no encontrado en esta sucursal" }, id === ORDER_ID ? 200 : 404);
      }
      if (path === "/kitchen/commands") {
        const view = url.searchParams.get("view") || "active";
        return json(route, { items: view === "history" ? [] : detail.tickets, total: view === "history" ? 0 : detail.tickets.length, active_count: detail.tickets.length, page: 1, page_size: 12, view });
      }
      if (path === "/settings/audit") return json(route, { items: auditEntries, total: auditEntries.length, page: 1, page_size: 10 });
      const auditMatch = path.match(/^\/settings\/audit\/(\d+)$/);
      if (auditMatch) {
        const id = Number(auditMatch[1]);
        state.auditDetailReads.push(id);
        const audit = auditDetails.find((entry) => entry.id === id);
        return json(route, audit || { detail: "Accion no encontrada" }, audit ? 200 : 404);
      }
      if (path === "/cash/registers") return json(route, [{ id: 7, name: "Caja Principal", branch_id: 1, active: true, is_default: true }, register]);
      if (path.endsWith("/cut-preview")) return json(route, { register, session_id: 33, version: 1, period_started_at: "2026-09-09T13:00:00Z", opening_fund: 20, pending_orders: [], pending_order_count: 0, has_card_activity: false, transfer_expected_amount: 0 });
      if (path.endsWith("/movements")) {
        expect(url.searchParams.get("branch_id")).toBe("1");
        state.movementQueries.push(url.searchParams);
        const movements = [
          { id: MOVEMENT_ID, branch_id: 1, register_id: REGISTER_ID, movement_type: "withdrawal", amount: 100, note: "Insumos del turno anterior", created_at: occurredAt, created_by: "Equipo de prueba", cash_cut_id: 3741 },
          { id: 9425, branch_id: 1, register_id: REGISTER_ID, movement_type: "income", amount: 20, note: "Movimiento ajeno al enlace", created_at: occurredAt, created_by: "Equipo de prueba", cash_cut_id: 3741 },
        ];
        const id = url.searchParams.get("movement_id");
        const items = id ? movements.filter((movement) => movement.id === Number(id)) : movements;
        return json(route, { branch_id: 1, register, items, total: items.length, page: 1, page_size: 10 });
      }
      throw new Error(`Missing response for fixture ${path}`);
    });
    await page.addInitScript(() => {
      window.print = () => {
        sessionStorage.setItem("security-zone-print", document.querySelector(".order-print-document")?.textContent || "");
        window.dispatchEvent(new Event("afterprint"));
      };
    });
    await use(state);
  }, { auto: true }],
});

test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: "block", locale: "es-PE", timezoneId: "America/Lima", colorScheme: "light", contextOptions: { reducedMotion: "reduce" } });

type VisualSurface = "ordersfolio" | "kitchenfolio" | "zonename" | "zoneeditornew" | "emptyzone" | "securitylist" | "securitycancel-detail" | "securitywithdrawal-detail" | "cash-exacttarget";

async function captureSurface(page: Page, surface: VisualSurface) {
  if (process.env.POS_VISUAL !== "1") return;
  const path = resolve(test.info().config.rootDir, "test-output", "security-zones", `${test.info().project.name}-${surface}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
}

async function tab(page: Page, name: string) {
  const trigger = page.getByRole("tab", { name, exact: true });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-selected", "true");
}

async function expectSummaryIdentity(surface: Locator) {
  await expect(surface.getByText(`#${FOLIO}`, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  expect(await surface.innerHTML()).not.toContain(ORDER_CODE);
  await expect(surface.getByText(`#${ORDER_ID}`, { exact: true })).toHaveCount(0);
}

async function openAudit(page: Page, id: number) {
  await page.goto("/configuracion/seguridad");
  const entry = auditDetails.find((candidate) => candidate.id === id)!;
  const history = page.getByRole("region", { name: "Historial de seguridad", exact: true });
  await expect(history).toBeVisible();
  expect(await history.innerHTML()).not.toContain(ORDER_CODE);
  for (const detail of auditDetails) await expect(history).toContainText(detail.summary);
  if (id === 401) await captureSurface(page, "securitylist");
  const row = history.getByRole("row").filter({ hasText: entry.summary });
  if (page.viewportSize()!.width <= 600) {
    const cells = row.getByRole("cell");
    const actionBox = await cells.nth(0).boundingBox();
    const dateBox = await cells.nth(1).boundingBox();
    expect(dateBox!.width).toBeGreaterThanOrEqual(actionBox!.width - 1);
    expect(dateBox!.y).toBeGreaterThanOrEqual(actionBox!.y + actionBox!.height - 1);
  }
  const trigger = row.getByRole("button");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Detalle de la acci\u00f3n", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS("opacity", "1");
  await expect(dialog).toHaveCSS("background-color", "rgb(255, 255, 255)");
  for (const field of [...entry.fields, ...entry.sections.flatMap((section) => section.fields)]) {
    await expect(dialog).toContainText(field.label);
    if (field.value) await expect(dialog).toContainText(field.value);
  }
  return { dialog, trigger, entry };
}

async function expectBlueLink(link: Locator, href: string) {
  await expect(link).toHaveAttribute("href", href);
  const channels = await link.evaluate((element) => getComputedStyle(element).color.match(/\d+/g)?.map(Number) || []);
  expect(channels.length).toBeGreaterThanOrEqual(3);
  expect(channels[2]).toBeGreaterThan(channels[0]);
  expect(channels[2]).toBeGreaterThan(channels[1]);
}

test("folios hide codes in orders, table history and kitchen while details and printing retain them", async ({ page, flowMock }) => {
  await page.goto("/pedidos");
  const list = page.getByRole("region", { name: "Lista de pedidos", exact: true });
  await expectSummaryIdentity(list);
  await captureSurface(page, "ordersfolio");
  const search = page.getByRole("textbox", { name: "Buscar pedidos" });
  await search.fill(ORDER_CODE);
  const trigger = list.getByRole("button", { name: `Abrir pedido ${FOLIO} de Cliente de auditoria`, exact: true });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press("Enter");
  const detail = page.getByRole("dialog", { name: `Pedido #${FOLIO} \u00b7 #${ORDER_CODE}`, exact: true });
  await expect(detail).toBeVisible();
  await expect(detail.getByText(`#${ORDER_CODE}`, { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Imprimir pedido", exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("security-zone-print"))).toContain(`#${ORDER_CODE}`);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("security-zone-print"))).toContain(`#${FOLIO}`);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(search).toHaveValue(ORDER_CODE);
  await tab(page, "Comandas digitales");
  const kitchen = page.getByRole("region", { name: "Comandas digitales activas" });
  await expect(kitchen.locator(".command-card")).toHaveCount(2);
  await expectSummaryIdentity(kitchen);
  await captureSurface(page, "kitchenfolio");
  await tab(page, "Panel de mesas");
  await page.getByRole("button", { name: "Ver historial", exact: true }).click();
  await expectSummaryIdentity(page.getByRole("region", { name: "Historial de mesas", exact: true }));
  expect(flowMock.detailReads.length).toBeGreaterThan(0);
  expect(flowMock.detailReads.every((id) => id === ORDER_ID)).toBe(true);
  expect(flowMock.writes).toEqual([]);
});

test("settings creates a zone, discards unsaved tables, and reopens its empty layout from the table panel", async ({ page, flowMock }) => {
  await page.goto("/configuracion/zonas");
  await page.getByRole("button", { name: "Nueva zona", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Agrega una zona", exact: true });
  await create.getByRole("textbox", { name: /Nombre de (la )?zona/ }).fill(ZONE_NAME);
  await captureSurface(page, "zonename");
  await create.getByRole("button", { name: "Continuar", exact: true }).click();
  const editor = page.getByRole("dialog", { name: ZONE_NAME, exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("slider", { name: "Columnas" })).toHaveValue("7");
  await expect(editor.getByRole("slider", { name: "Filas" })).toHaveValue("5");
  await captureSurface(page, "zoneeditornew");
  expect(flowMock.areas.find((area) => area.name === ZONE_NAME)?.id).toBe(53);
  const firstSlot = editor.getByRole("button", { name: "Agregar mesa en fila 1, columna 1", exact: true });
  await firstSlot.focus();
  await page.keyboard.press("Enter");
  await expect(editor.getByRole("textbox", { name: "Identificador de mesa" })).toHaveValue("1");
  expect(flowMock.tables).toEqual([]);
  const confirmation = page.waitForEvent("dialog").then(async (guard) => {
    expect(guard.message()).toContain("Salir sin guardar");
    await guard.accept();
  });
  await editor.getByRole("button", { name: "Salir", exact: true }).click();
  await confirmation;
  await expect(editor).toBeHidden();
  expect(flowMock.tables).toEqual([]);
  expect(flowMock.writes.map((write) => write.path)).toEqual(["/areas"]);

  // The zone name itself must open the layout, without navigating through a menu.
  const settings = page.getByRole("dialog", { name: "Configuraci\u00f3n", exact: true });
  await settings.getByText(ZONE_NAME, { exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(firstSlot).toBeVisible();
  await editor.getByRole("button", { name: "Salir", exact: true }).click();
  await expect(editor).toBeHidden();

  await page.goto("/pedidos");
  await tab(page, "Panel de mesas");
  await tab(page, ZONE_NAME);
  await expect(page.getByText("No hay mesas en esta zona", { exact: true }).filter({ visible: true })).toBeVisible();
  const addTables = page.getByRole("button", { name: "Agregar mesas", exact: true });
  await expect(addTables).toBeVisible();
  await captureSurface(page, "emptyzone");
  await addTables.click();
  await expect(editor).toBeVisible();
  await firstSlot.click();
  await editor.getByRole("textbox", { name: "Identificador de mesa" }).fill("9");
  await editor.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(flowMock.tables).toHaveLength(1);
  expect(flowMock.tables[0]).toMatchObject({ branch_id: 1, area_id: 53, name: "Mesa 9", status: "available" });
  await expect(page.locator(".tables-workspace").getByRole("button").filter({ hasText: "Mesa 9", visible: true })).toBeVisible();
  expect(flowMock.writes.filter((write) => write.path === "/tables" && write.method === "POST")).toHaveLength(1);
});

test("security opens cancellation details and the exact order using its blue link", async ({ page, flowMock }) => {
  const { dialog, trigger, entry } = await openAudit(page, 401);
  const link = dialog.getByRole("link", { name: entry.target!.label, exact: true });
  await expectBlueLink(link, `/pedidos?order_id=${ORDER_ID}`);
  await captureSurface(page, "securitycancel-detail");
  expect([...new Set(flowMock.auditDetailReads)]).toEqual([401]);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(link).toBeVisible();
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/pedidos\\?order_id=${ORDER_ID}$`));
  const order = page.getByRole("dialog", { name: `Pedido #${FOLIO} \u00b7 #${ORDER_CODE}`, exact: true });
  await expect(order).toBeVisible();
  await expect(order.getByText(`#${ORDER_CODE}`, { exact: true })).toBeVisible();
  expect(flowMock.detailReads.length).toBeGreaterThan(0);
  expect(flowMock.detailReads.every((id) => id === ORDER_ID)).toBe(true);
  expect(flowMock.writes).toEqual([]);
  await page.goBack();
  await expect(page).toHaveURL(/\/configuracion\/seguridad/);
  await expect(page.getByRole("region", { name: "Historial de seguridad", exact: true })).toBeVisible();
});

test("security opens the exact historical cash withdrawal without using the default register or current cut", async ({ page, flowMock }) => {
  const { dialog, entry } = await openAudit(page, 402);
  const link = dialog.getByRole("link", { name: entry.target!.label, exact: true });
  await expectBlueLink(link, `/caja?tab=movements&register_id=${REGISTER_ID}&movement_id=${MOVEMENT_ID}`);
  await captureSurface(page, "securitywithdrawal-detail");
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/caja\\?tab=movements&register_id=${REGISTER_ID}&movement_id=${MOVEMENT_ID}$`));
  await expect(page.getByRole("tab", { name: "Entradas y retiros de efectivo", exact: true })).toHaveAttribute("aria-selected", "true");
  const movements = page.getByRole("region", { name: "Movimientos de efectivo desplazables", exact: true });
  await expect(movements.getByText("Insumos del turno anterior", { exact: true })).toBeVisible();
  await expect(movements.getByText("Movimiento ajeno al enlace", { exact: true })).toHaveCount(0);
  await expect(movements.getByText(register.name, { exact: true })).toBeVisible();
  expect(flowMock.movementQueries.length).toBeGreaterThan(0);
  for (const query of flowMock.movementQueries) {
    expect(query.get("movement_id")).toBe(String(MOVEMENT_ID));
    expect(query.has("session_id")).toBe(false);
    expect(query.has("cut_id")).toBe(false);
  }
  expect([...new Set(flowMock.auditDetailReads)]).toEqual([402]);
  expect(flowMock.writes).toEqual([]);
  await captureSurface(page, "cash-exacttarget");
});

test("security shows reductions and legacy cancellations without inventing a missing target", async ({ page, flowMock }) => {
  const reduction = await openAudit(page, 403);
  await expect(reduction.dialog).toContainText("30 S/");
  await expect(reduction.dialog).toContainText("24 S/");
  const legacy = await openAudit(page, 404);
  await expect(legacy.dialog).toContainText("Motivo no registrado");
  await expect(legacy.dialog.getByRole("link")).toHaveCount(0);
  expect(flowMock.writes).toEqual([]);
});
