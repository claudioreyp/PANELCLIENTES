import { expect, test, type Page, type Route } from "@playwright/test";
import { resolve } from "node:path";
import type { KitchenCommandItem } from "../src/types";
import type { PosPrintJob } from "../src/lib/order-printing";

type TablePrintSubmission = { data: { type: string; format: string; data: string; options?: { pageWidth: number; pageHeight: number } }[] };

async function tablePrintSubmissions(page: Page): Promise<TablePrintSubmission[]> {
  return page.evaluate(() => (window as unknown as { tablePrints: TablePrintSubmission[] }).tablePrints);
}

const allChannels = [
  "pos_tables",
  "pos_counter",
  "pos_takeaway",
  "pos_delivery",
  "digital_tables",
  "digital_takeaway",
  "digital_delivery",
];

type Area = {
  id: number;
  branch_id: number;
  name: string;
  sort_order: number;
  columns: number;
  rows: number;
  version: number;
};

type RestaurantTable = {
  id: number;
  branch_id: number;
  area_id: number;
  code: string;
  name: string;
  capacity: number;
  position_x: number;
  position_y: number;
  row: number;
  column: number;
  width: number;
  height: number;
  shape: string;
  status: string;
  version: number;
  active_order_id?: number | null;
};

type KitchenTicket = {
  id: number;
  order_id: number;
  order_number?: string;
  order_folio?: number;
  version?: number;
  channel?: string;
  customer_name?: string | null;
  table_id?: number | null;
  table_name?: string | null;
  source?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  sequence: number;
  station: string;
  kind?: string;
  context?: Record<string, unknown>;
  status: "queued" | "preparing" | "ready" | "served" | "cancelled";
  items: KitchenCommandItem[];
  print_count: number;
  created_at: string;
  fired_at?: string;
  started_at: string | null;
  ready_at: string | null;
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function normalizedPath(url: string) {
  const pathname = new URL(url).pathname.replace(/^.*\/api\/v1/, "");
  return pathname.replace(/\/+$/, "") || "/";
}

function numericValue(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function activateOrdersTab(page: Page, name: string) {
  const tab = page.getByRole("tab", { name, exact: true });
  await expect(tab).toBeVisible();
  await tab.scrollIntoViewIfNeeded();
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

async function mockTablesAndCommandasApi(page: Page, options: { seedArea?: boolean; seedTable?: boolean; seedTransferTable?: boolean; failFirstOrderResponse?: boolean; ticketAgeMinutes?: number; repeatedModifiers?: boolean; automaticPrinting?: boolean } = {}) {
  await page.addInitScript(() => {
    let active = false;
    const sent: TablePrintSubmission[] = [];
    Object.assign(window, { tablePrints: sent, qz: {
      websocket: { isActive: () => active, connect: async () => { active = true; }, disconnect: async () => { active = false; } },
      printers: { find: async () => ["Mesa POS de prueba"], details: async () => [{ name: "Mesa POS de prueba", driver: "Generic / Text Only" }] },
      security: { setCertificatePromise: () => {}, setSignaturePromise: () => {}, setSignatureAlgorithm: () => {} },
      configs: { create: (printer: string, options: unknown) => ({ printer, options }) },
      print: async (_config: unknown, data: TablePrintSubmission["data"]) => { sent.push({ data }); },
    } });
  });
  const printJobs: PosPrintJob[] = [];
  const areas: Area[] = options.seedArea || options.seedTable ? [
    {
      id: 51,
      branch_id: 1,
      name: "Sala principal",
      sort_order: 0,
      columns: 7,
      rows: 5,
      version: 1,
    },
    {
      id: 52,
      branch_id: 1,
      name: "Pabellón",
      sort_order: 1,
      columns: 7,
      rows: 5,
      version: 1,
    },
  ] : [];
  const tables: RestaurantTable[] = options.seedTable ? [{
    id: 101,
    branch_id: 1,
    area_id: 51,
    code: "MESA-1",
    name: "Mesa 1",
    capacity: 4,
    position_x: 24,
    position_y: 24,
    row: 0,
    column: 0,
    width: 92,
    height: 76,
    shape: "square",
    status: "available",
    version: 1,
  }, ...(options.seedTransferTable ? [{
    id: 102,
    branch_id: 1,
    area_id: 51,
    code: "MESA-2",
    name: "Mesa 2",
    capacity: 6,
    position_x: 148,
    position_y: 24,
    row: 0,
    column: 1,
    width: 92,
    height: 76,
    shape: "square",
    status: "available",
    version: 1,
  }] : [])] : [];
  const transitionStatuses: string[] = [];
  const transitionExpectedStatuses: string[] = [];
  const orderIdempotencyKeys: string[] = [];
  const itemBatchPayloads: Record<string, unknown>[] = [];
  const revisionPayloads: Record<string, unknown>[] = [];
  const commandActions: string[] = [];
  const extraCommands: KitchenTicket[] = [];
  let failCommandReads = false;
  const printedTicketIds: number[] = [];
  const checkoutActions: string[] = [];
  const tablePaymentPayloads: Record<string, unknown>[] = [];
  const orderTransitions: string[] = [];
  const orderTransitionPayloads: Record<string, unknown>[] = [];
  const orderTransferPayloads: Record<string, unknown>[] = [];
  const tableCreatePayloads: Record<string, unknown>[] = [];
  let createdOrderPayload: Record<string, unknown> | null = null;
  let confirmSendCount = 0;
  let tableOrderVersion = 1;
  let tableOrderStatus = "draft";
  let tableOrderItems: Record<string, unknown>[] = [];
  let tableOrderTickets: KitchenTicket[] = [];
  let tableCheckoutStartedAt: string | null = null;
  let tableReleasedAt: string | null = null;
  let tablePaymentStatus = "pending";
  let tableOrderTableId = 101;
  const tableOrderCreatedAt = new Date().toISOString();
  const ticketCreatedAt = new Date(Date.now() - (options.ticketAgeMinutes ?? 5) * 60_000).toISOString();
  const ticket: KitchenTicket = {
    id: 501,
    order_id: 27,
    order_folio: 6,
    order_number: "0027",
    channel: "delivery",
    customer_name: "Claudio Rey",
    source: "digital_menu",
    created_by: "menú digital",
    sequence: 1,
    station: "kitchen",
    kind: "standard",
    context: {},
    status: "queued",
    items: [{ item_id: 901, name: "Pizza clásica", quantity: 2, notes: "Sin cebolla" }],
    print_count: 0,
    created_at: ticketCreatedAt,
    fired_at: ticketCreatedAt,
    started_at: null,
    ready_at: null,
  };

  const branch = {
    id: 1,
    business_id: 1,
    slug: "matriz",
    name: "Sucursal principal",
    opening_hours: {},
    accepted_payment_methods: ["cash", "yape"],
    delivery_enabled: true,
    takeaway_enabled: true,
    delivery_fee: 5,
    active: true,
  };

  const catalog = {
    branch,
    categories: [{ id: 10, name: "Pizzas", color: "#2aa775", sort_order: 0, active: true }],
    products: [{
      id: 20,
      category_id: 10,
      sku: "PIZZA-CLASICA",
      name: "Pizza clásica",
      description: "Masa artesanal y mozzarella",
      price: 24,
      image_url: null,
      service_channels: allChannels,
      product_type: "standard",
      available: true,
      track_stock: false,
      preparation_station: "kitchen",
      sort_order: 0,
      variants: [],
      modifier_groups: options.repeatedModifiers ? [{
        id: 40,
        branch_id: 1,
        name: "Salsas",
        minimum: 0,
        maximum: 4,
        required: false,
        allow_repeats: true,
        max_per_option: 3,
        sort_order: 0,
        modifiers: [
          { id: 41, name: "BBQ", price_delta: 2, active: true, sort_order: 0 },
          { id: 42, name: "Ajo", price_delta: 0, active: true, sort_order: 1 },
        ],
      }] : [],
      recipe: [],
      combo_components: [],
    }],
    modifier_groups: [],
    ingredients: [],
    promotions: [],
  };

  function createTable(payload: Record<string, unknown>) {
    const area = areas.find((item) => item.id === Number(payload.area_id)) || areas[0];
    const name = String(payload.name || `Mesa ${tables.length + 1}`);
    const table: RestaurantTable = {
      id: 101 + tables.length,
      branch_id: numericValue(payload.branch_id, 1),
      area_id: numericValue(payload.area_id, area?.id || 51),
      code: String(payload.code || name.toUpperCase().replace(/\s+/g, "-")),
      name,
      capacity: numericValue(payload.capacity, 4),
      position_x: numericValue(payload.position_x, 0),
      position_y: numericValue(payload.position_y, 0),
      row: numericValue(payload.row, 1),
      column: numericValue(payload.column, 1),
      width: numericValue(payload.width, 112),
      height: numericValue(payload.height, 88),
      shape: String(payload.shape || "square"),
      status: String(payload.status || "available"),
      version: 1,
    };
    tables.push(table);
    return table;
  }


  function currentTableOrder() {
    const subtotal = tableOrderItems.filter((item) => !["cancelled", "superseded"].includes(String(item.status))).reduce((sum, item) => sum + Number(item.line_total || 0), 0);
    return {
      id: 700, business_id: 1, branch_id: 1, folio: 7, number: "260910-TEST700",
      channel: "dine_in", source: "pos", status: tableOrderStatus, payment_status: tablePaymentStatus,
      table_id: tableOrderTableId, customer_name: null, customer_phone: null, delivery_address: null,
      table_context: { table_id: tableOrderTableId, table_name: tables.find((table) => table.id === tableOrderTableId)?.name, area_name: "Sala principal" },
      subtotal, discount: 0, delivery_fee: 0, total: subtotal, notes: null, version: tableOrderVersion,
      checkout_started_at: tableCheckoutStartedAt, table_released_at: tableReleasedAt,
      created_at: tableOrderCreatedAt, items: tableOrderItems,
    };
  }

  function snapshot(item: Record<string, unknown>): KitchenCommandItem {
    return { item_id: Number(item.id), name: String(item.name), quantity: Number(item.quantity), variant_name: item.variant_name as string | null, notes: item.notes as string | null, modifiers: item.modifiers as KitchenCommandItem["modifiers"], line_total: Number(item.line_total), status: String(item.status) };
  }

  function enqueuePrint(command?: KitchenTicket, manual = false) {
    const job = {
      id: `table-print-${printJobs.length + 1}`, order_id: 700, branch_id: 1,
      job_type: command ? "kitchen_ticket" : "customer_receipt", status: "pending", retryable: false,
      payload: structuredClone({ snapshot_version: 1, printer_name: "Mesa POS de prueba", print_language: "escpos", paper_width_mm: 80, copies: 1,
        business: { name: "Restaurante de prueba" }, branch: { name: "Sucursal de prueba" }, order: currentTableOrder(),
        ticket: command ? { ...command, context: { ...command.context, table_name: command.table_name, area_name: "Sala principal", actor_name: "Personal de prueba" } } : null,
        template: { font_size: "normal" }, test_document: true,
      }),
    } as unknown as PosPrintJob;
    if (manual && command) printedTicketIds.push(command.id);
    printJobs.push(job);
    return job;
  }

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const requestUrl = new URL(request.url());
    const path = normalizedPath(request.url());

    if (path === "/orders/700/printing/qz") return json(route, { mode: "manual-approval", certificate: null });
    if (path === "/orders/700/printing") {
      if (method === "POST") {
        const body = request.postDataJSON();
        return json(route, enqueuePrint(body.job_type === "kitchen_ticket" ? tableOrderTickets.find((command) => command.id === body.kitchen_ticket_id) : undefined, true), 201);
      }
      return json(route, { order_id: 700, items: printJobs, recoverable_error: false });
    }
    const printAction = path.match(/^\/orders\/700\/printing\/([^/]+)\/(claim|complete)$/);
    if (method === "POST" && printAction) {
      const job = printJobs.find((item) => item.id === printAction[1]);
      if (!job) return json(route, { detail: "Trabajo no encontrado" }, 404);
      if (printAction[2] === "claim") {
        const allowed = job.status === "pending";
        if (allowed) job.status = "claimed";
        return json(route, { job, dispatch_allowed: allowed });
      }
      job.status = request.postDataJSON().outcome === "printed" ? "printed" : "failed";
      return json(route, job);
    }

    if (method === "GET" && path === "/context") {
      return json(route, {
        business: {
          id: 1,
          slug: "pizza-house",
          name: "Pizza House",
          status: "active",
          plan: "pro",
          currency: "PEN",
          timezone: "America/Lima",
          modules: { pos: true, tables: true, kds: true },
        },
        branches: [branch],
        role: "owner",
      });
    }

    if (method === "GET" && path === "/catalog") return json(route, catalog);

    if (method === "GET" && path === "/orders/workspace") {
      return json(route, {
        period: requestUrl.searchParams.get("period") || "day",
        view: requestUrl.searchParams.get("view") || "orders",
        items: [{
          id: 27,
          folio: 6,
          number: "0027",
          customer_name: "Mesa 1",
          customer_phone: null,
          channel: "dine_in",
          source: "pos",
          created_at: ticket.created_at,
          status: "confirmed",
          payment_status: "pending",
          total: 48,
          delivery_fee: 0,
          requires_review: false,
          item_count: 2,
          version: 1,
        }],
        page: 1,
        page_size: 12,
        total: 1,
        review_count: 0,
      });
    }

    if (method === "GET" && path === "/orders") return json(route, []);

    if (method === "POST" && path === "/orders") {
      createdOrderPayload = request.postDataJSON() as Record<string, unknown>;
      tableOrderTableId = Number(createdOrderPayload.table_id || 101);
      orderIdempotencyKeys.push(request.headers()["idempotency-key"] || "");
      const table = tables.find((item) => item.id === Number(createdOrderPayload.table_id));
      if (table) Object.assign(table, { status: "occupied", active_order_id: 700, version: table.version + 1 });
      if (options.failFirstOrderResponse && orderIdempotencyKeys.length === 1) return route.abort("failed");
      return json(route, { id: 700 }, 201);
    }

    if (method === "GET" && path === "/orders/700/detail") {
      const subtotal = currentTableOrder().total;
      return json(route, {
        order: currentTableOrder(),
        payments: tablePaymentStatus === "paid" ? [{ id: 801, order_id: 700, method: "yape", amount: subtotal, status: "confirmed", created_at: new Date().toISOString() }] : [],
        payment_evidence: [],
        tickets: tableOrderTickets,
        payment_summary: { paid: tablePaymentStatus === "paid" ? subtotal : 0, remaining: tablePaymentStatus === "paid" ? 0 : subtotal },
      });
    }

    if (method === "PATCH" && path === "/orders/700") {
      const payload = request.postDataJSON() as Record<string, unknown>;
      orderTransferPayloads.push(payload);
      const source = tables.find((item) => item.id === tableOrderTableId);
      const target = tables.find((item) => item.id === Number(payload.table_id));
      if (!target) return json(route, { detail: "Mesa no encontrada" }, 404);
      if (source) Object.assign(source, { status: "available", active_order_id: null, version: source.version + 1 });
      Object.assign(target, { status: "occupied", active_order_id: 700, version: target.version + 1 });
      tableOrderTableId = target.id;
      tableOrderVersion += 1;
      return json(route, { id: 700, table_id: tableOrderTableId, version: tableOrderVersion });
    }

    if (method === "POST" && path === "/orders/700/item-batches") {
      const payload = request.postDataJSON() as { items?: Record<string, unknown>[] };
      itemBatchPayloads.push(payload as Record<string, unknown>);
      const appendedItems = (payload.items || []).map((item, index) => {
        const modifiers = Array.isArray(item.modifiers) ? item.modifiers as { price_delta?: number }[] : [];
        const quantity = Number(item.quantity || 1);
        const unitPrice = 24 + modifiers.reduce((sum, modifier) => sum + Number(modifier.price_delta || 0), 0);
        return {
          id: 701 + tableOrderItems.length + index,
          product_id: Number(item.product_id),
          name: "Pizza clásica",
          variant_name: null,
          quantity,
          unit_price: unitPrice,
          modifiers,
          notes: item.notes || null,
          status: "pending",
          line_total: unitPrice * quantity,
        };
      });
      tableOrderItems = [...tableOrderItems, ...appendedItems];
      tableOrderVersion += 1;
      if (!["draft", "pending_confirmation"].includes(tableOrderStatus)) {
        tableOrderTickets.push({
          id: 702 + tableOrderTickets.length,
          order_id: 700,
          order_number: "260910-TEST700", order_folio: 7, version: 1,
          channel: "dine_in",
          customer_name: null,
          table_id: 101,
          table_name: "Mesa 1",
          source: "pos",
          created_by: "punto de venta",
          sequence: tableOrderTickets.length + 1,
          station: "kitchen",
          kind: "addition",
          context: {},
          status: "queued",
          items: appendedItems.map(snapshot),
          print_count: 0,
          created_at: new Date().toISOString(),
          fired_at: new Date().toISOString(),
          started_at: null,
          ready_at: null,
        });
        if (options.automaticPrinting) enqueuePrint(tableOrderTickets.at(-1));
      }
      return json(route, { order: currentTableOrder(), tickets: tableOrderTickets.slice(-1), appended_item_ids: appendedItems.map((item) => item.id) });
    }

    if (method === "POST" && path === "/orders/700/confirm-and-send") {
      confirmSendCount += 1;
      tableOrderStatus = "sent_to_kitchen";
      tableOrderVersion += 1;
      tableOrderTickets = [{
        id: 702,
        order_id: 700,
        order_number: "260910-TEST700", order_folio: 7, version: 1,
        channel: "dine_in",
        customer_name: null,
        table_id: 101,
        table_name: "Mesa 1",
        source: "pos",
        created_by: "punto de venta",
        sequence: 1,
        station: "kitchen",
        kind: "standard",
        context: {},
        status: "queued",
        items: tableOrderItems.map(snapshot),
        print_count: 0,
        created_at: new Date().toISOString(),
        fired_at: new Date().toISOString(),
        started_at: null,
        ready_at: null,
      }];
      if (options.automaticPrinting) enqueuePrint(tableOrderTickets[0]);
      return json(route, { order: currentTableOrder(), tickets: tableOrderTickets });
    }

    if (method === "POST" && path === "/orders/700/item-revisions") {
      const payload = request.postDataJSON() as { operations: Record<string, unknown>[]; expected_version: number };
      revisionPayloads.push(payload as unknown as Record<string, unknown>);
      if (payload.expected_version !== tableOrderVersion) return json(route, { detail: "Pedido desactualizado" }, 409);
      const cancelled = new Set(payload.operations.filter((operation) => operation.type === "cancel").map((operation) => Number(operation.item_id)));
      if (!tableOrderItems.some((item) => !["cancelled", "superseded"].includes(String(item.status)) && !cancelled.has(Number(item.id)))) return json(route, { detail: "Para cancelar todos los productos, usa Cancelar pedido", code: "ORDER_REQUIRES_CANCELLATION" }, 409);
      const affected = new Map<number, KitchenTicket>();
      const created: number[] = [];
      for (const operation of payload.operations) {
        const itemId = Number(operation.item_id);
        const original = tableOrderItems.find((item) => Number(item.id) === itemId)!;
        const owner = [...tableOrderTickets].reverse().find((command) => command.items.some((item) => item.item_id === itemId))!;
        let after: KitchenCommandItem;
        if (operation.type === "cancel") {
          original.status = "cancelled";
          original.cancellation_reason = operation.reason;
          after = { ...snapshot(original), action: "cancelled", cancellation_reason: String(operation.reason) };
        } else {
          const replacement = operation.replacement as Record<string, unknown>;
          original.status = "superseded";
          const modifiers = (replacement.modifiers || []) as NonNullable<KitchenCommandItem["modifiers"]>;
          const quantity = Number(replacement.quantity);
          const nextItem = { ...original, ...replacement, id: 701 + tableOrderItems.length, quantity, modifiers, status: "pending", replaces_item_id: itemId, line_total: (24 + modifiers.reduce((sum, modifier) => sum + Number(modifier.price_delta || 0), 0)) * quantity };
          tableOrderItems.push(nextItem);
          const remaining = [...modifiers];
          const removed = (original.modifiers as typeof modifiers).filter((modifier) => {
            const index = remaining.findIndex((option) => option.modifier_id === modifier.modifier_id);
            if (index < 0) return true;
            remaining.splice(index, 1); return false;
          });
          const history = ["queued", "preparing"].includes(owner.status) ? owner.items.find((item) => item.item_id === itemId)?.removed_modifiers || [] : [];
          after = { ...snapshot(nextItem), action: "modified", previous_item_id: itemId, previous_name: String(original.name), previous_quantity: Number(original.quantity), removed_modifiers: [...history, ...removed.map((option) => ({ ...option, removed_quantity: Number(original.quantity) }))] };
        }
        if (["queued", "preparing"].includes(owner.status)) {
          owner.items = owner.items.map((item) => item.item_id === itemId ? after : item);
          owner.context = { ...owner.context, modified_at: new Date().toISOString() };
          owner.version = (owner.version || 1) + 1;
          affected.set(owner.id, owner);
        } else {
          const correction: KitchenTicket = { ...owner, id: 702 + tableOrderTickets.length, sequence: tableOrderTickets.length + 1, version: 1, status: "queued", kind: "revision", items: [after], context: { modified_at: new Date().toISOString(), source_ticket_ids: [owner.id] }, created_at: new Date().toISOString(), ready_at: null };
          tableOrderTickets.push(correction); affected.set(correction.id, correction); created.push(correction.id);
        }
      }
      tableOrderVersion += 1;
      return json(route, { order: currentTableOrder(), tickets: [...affected.values()], created_ticket_ids: created, updated_ticket_ids: [...affected.keys()].filter((id) => !created.includes(id)) }, 201);
    }

    if (method === "POST" && path === "/orders/700/table-checkout/start") {
      checkoutActions.push("start");
      if (!tableCheckoutStartedAt) {
        tableCheckoutStartedAt = new Date().toISOString();
        tableOrderVersion += 1;
        if (options.automaticPrinting) enqueuePrint();
      }
      return json(route, { order: currentTableOrder() });
    }

    if (method === "POST" && path === "/orders/700/table-checkout/reopen") {
      checkoutActions.push("reopen");
      tableCheckoutStartedAt = null;
      tableOrderVersion += 1;
      return json(route, { order: { id: 700, version: tableOrderVersion, checkout_started_at: null } });
    }

    if (method === "POST" && path === "/orders/700/table-checkout/pay") {
      checkoutActions.push("pay");
      const payload = request.postDataJSON() as Record<string, unknown>;
      tablePaymentPayloads.push(payload);
      tablePaymentStatus = "paid";
      tableReleasedAt = new Date().toISOString();
      tableOrderStatus = "closed";
      tableOrderVersion += 1;
      const table = tables.find((item) => item.id === 101);
      if (table) Object.assign(table, { status: "available", active_order_id: null, version: table.version + 1 });
      return json(route, {
        order: { id: 700, version: tableOrderVersion, status: tableOrderStatus, payment_status: "paid", table_released_at: tableReleasedAt },
        payments: [{ id: 801, method: "yape", amount: 24, status: "confirmed" }],
        table,
      });
    }

    if (method === "POST" && path === "/orders/700/transition") {
      const payload = request.postDataJSON() as { status?: string; reason?: string; expected_version?: number };
      orderTransitionPayloads.push(payload);
      orderTransitions.push(payload.status || "");
      tableOrderStatus = payload.status || tableOrderStatus;
      tableOrderVersion += 1;
      if (tableOrderStatus === "cancelled") {
        tableOrderTickets.forEach((command) => { if (["queued", "preparing"].includes(command.status)) command.status = "cancelled"; });
        const table = tables.find((item) => item.id === tableOrderTableId);
        if (table) Object.assign(table, { status: "available", active_order_id: null, version: table.version + 1 });
      }
      return json(route, { id: 700, status: tableOrderStatus, version: tableOrderVersion });
    }

    if (method === "GET" && path === "/areas") return json(route, areas);

    if (method === "POST" && path === "/areas") {
      const payload = request.postDataJSON() as Record<string, unknown>;
      const area: Area = {
        id: 51 + areas.length,
        branch_id: numericValue(payload.branch_id, 1),
        name: String(payload.name || "Sala principal"),
        sort_order: numericValue(payload.sort_order, areas.length),
        columns: numericValue(payload.columns, 7),
        rows: numericValue(payload.rows, 5),
        version: 1,
      };
      areas.push(area);
      return json(route, area, 201);
    }

    const areaMatch = path.match(/^\/areas\/(\d+)$/);
    if (method === "PATCH" && areaMatch) {
      const area = areas.find((item) => item.id === Number(areaMatch[1]));
      if (!area) return json(route, { detail: "Zona no encontrada" }, 404);
      Object.assign(area, request.postDataJSON(), { version: area.version + 1 });
      return json(route, area);
    }

    if (method === "GET" && path === "/tables") return json(route, tables);

    if (method === "POST" && path === "/tables") {
      const payload = request.postDataJSON() as Record<string, unknown>;
      tableCreatePayloads.push(payload);
      return json(route, createTable(payload), 201);
    }

    if (method === "POST" && path === "/tables/bulk") {
      const payload = request.postDataJSON() as Record<string, unknown> | Record<string, unknown>[];
      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray(payload.tables)
          ? payload.tables as Record<string, unknown>[]
          : [];
      tableCreatePayloads.push(...rows);
      return json(route, rows.map(createTable), 201);
    }

    const tableMatch = path.match(/^\/tables\/(\d+)$/);
    if (method === "PATCH" && tableMatch) {
      const table = tables.find((item) => item.id === Number(tableMatch[1]));
      if (!table) return json(route, { detail: "Mesa no encontrada" }, 404);
      Object.assign(table, request.postDataJSON(), { version: table.version + 1 });
      return json(route, table);
    }

    if (method === "GET" && path === "/kitchen/commands") {
      if (failCommandReads) return route.abort("failed");
      const view = requestUrl.searchParams.get("view") || "active";
      const commands = [ticket, ...extraCommands, ...tableOrderTickets];
      const items = commands.filter((command) => view === "history"
        ? ["ready", "served"].includes(command.status)
        : ["queued", "preparing"].includes(command.status));
      return json(route, {
        items,
        total: items.length,
        page: 1,
        page_size: 12,
        active_count: commands.filter((command) => ["queued", "preparing"].includes(command.status)).length,
        view,
      });
    }

    const commandActionMatch = path.match(/^\/kitchen\/commands\/(\d+)\/(complete|reopen)$/);
    if (method === "POST" && commandActionMatch) {
      const command = [ticket, ...extraCommands, ...tableOrderTickets].find((candidate) => candidate.id === Number(commandActionMatch[1]));
      if (!command) return json(route, { detail: "Comanda no encontrada" }, 404);
      const action = commandActionMatch[2];
      const payload = request.postDataJSON() as { expected_status?: KitchenTicket["status"]; expected_version: number };
      if (payload.expected_version !== (command.version || 1)) return json(route, { detail: "La comanda cambió", code: "KITCHEN_TICKET_STALE" }, 409);
      command.version = (command.version || 1) + 1;
      commandActions.push(action);
      transitionExpectedStatuses.push(payload.expected_status || "");
      command.status = action === "complete" ? "ready" : "preparing";
      if (action === "complete") command.ready_at = new Date().toISOString();
      if (action === "reopen") command.ready_at = null;
      return json(route, { command, order: { id: command.order_id } });
    }

    if (method === "GET" && path === "/kitchen/tickets") return json(route, [ticket, ...tableOrderTickets]);

    const transitionMatch = path.match(/^\/kitchen\/tickets\/(\d+)(?:\/transition)?$/);
    if ((method === "POST" || method === "PATCH") && transitionMatch) {
      const payload = request.postDataJSON() as { status?: KitchenTicket["status"]; expected_status?: KitchenTicket["status"] };
      const nextStatus = payload.status || "preparing";
      transitionStatuses.push(nextStatus);
      transitionExpectedStatuses.push(payload.expected_status || "");
      ticket.status = nextStatus;
      if (nextStatus === "preparing") ticket.started_at = new Date().toISOString();
      if (nextStatus === "ready") ticket.ready_at = new Date().toISOString();
      return json(route, ticket);
    }

    const printMatch = path.match(/^\/kitchen\/tickets\/(\d+)\/print$/);
    if (method === "POST" && printMatch) {
      const printedTicket = [ticket, ...tableOrderTickets].find((candidate) => candidate.id === Number(printMatch[1]));
      if (!printedTicket) return json(route, { detail: "Comanda no encontrada" }, 404);
      printedTicket.print_count += 1;
      printedTicketIds.push(printedTicket.id);
      return json(route, printedTicket);
    }

    return json(route, { detail: `Ruta no simulada: ${method} ${path}` }, 404);
  });

  return {
    printJobs,
    ticket,
    extraCommands,
    setFailCommandReads: (fail: boolean) => { failCommandReads = fail; },
    areas,
    tables,
    tableCreatePayloads,
    transitionStatuses,
    transitionExpectedStatuses,
    commandActions,
    printedTicketIds,
    checkoutActions,
    orderIdempotencyKeys,
    itemBatchPayloads,
    revisionPayloads,
    tablePaymentPayloads,
    orderTransitions,
    orderTransitionPayloads,
    orderTransferPayloads,
    getConfirmSendCount: () => confirmSendCount,
    getTableOrderVersion: () => tableOrderVersion,
    getCreatedOrderPayload: () => createdOrderPayload,
  };
}

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket("**", (socket) => socket.close());
  await page.addInitScript(() => {
    localStorage.setItem("impulsa.authMode", "dev");
    localStorage.setItem("impulsa.businessId", "1");
    localStorage.setItem("impulsa.branchId", "1");
  });
});

test("performance: revisiting tables with a slow API", async ({ page }, testInfo) => {
  await mockTablesAndCommandasApi(page, { seedTable: true });
  let reads = 0;
  await page.route("**/api/v1/{areas,tables}?*", async (route) => {
    reads += 1;
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fallback();
  });
  const started = Date.now();
  await page.goto("/pedidos");
  await activateOrdersTab(page, "Panel de mesas");
  const table = page.locator(".tables-workspace button:visible").filter({ hasText: "Mesa 1" }).first();
  await expect(table).toBeVisible();
  const initialMs = Date.now() - started;
  await activateOrdersTab(page, "Panel de pedidos");
  const revisit = Date.now();
  await activateOrdersTab(page, "Panel de mesas");
  const phase = process.env.POS_PERF_PHASE || "after";
  if (phase !== "before") await expect(table).toBeVisible({ timeout: 300 });
  await expect(table).toBeVisible();
  const metrics = { phase, initialMs, revisitMs: Date.now() - revisit, reads };
  console.log("NAVIGATION_METRICS", JSON.stringify(metrics));
  await testInfo.attach(`navigation-${phase}`, { body: JSON.stringify(metrics), contentType: "application/json" });
  await page.screenshot({ path: `e2e/test-output/navigation-${phase}-${testInfo.project.name}.png`, fullPage: true });
});

test("query cache never shows a late response from the previous branch", async ({ page }) => {
  await mockTablesAndCommandasApi(page, { seedTable: true });
  const branches = [1, 2].map((id) => ({ id, business_id: 1, name: `Sucursal ${id}`, slug: `branch-${id}`, active: true, opening_hours: {}, accepted_payment_methods: ["cash"], delivery_fee: 0 }));
  const held: (() => void)[] = [];
  let holdFirst = false;
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = normalizedPath(url.href);
    if (path === "/context") return json(route, { role: "owner", business: { id: 1, name: "Test", slug: "test", status: "active", plan: "pos", modules: { pos: true, tables: true, kds: true } }, branches });
    const branchId = Number(url.searchParams.get("branch_id") || route.request().headers()["x-branch-id"]);
    if (path === "/catalog") return json(route, { branch: branches[branchId - 1], categories: [], products: [], modifier_groups: [], ingredients: [], promotions: [] });
    if (!["/areas", "/tables"].includes(path)) return route.fallback();
    expect(route.request().headers()["x-branch-id"]).toBe(String(branchId));
    if (holdFirst && branchId === 1) await new Promise<void>((resolve) => held.push(resolve));
    if (path === "/areas") return json(route, [{ id: branchId * 10, branch_id: branchId, name: `Sala ${branchId}`, columns: 7, rows: 5, sort_order: 0, version: 1 }]);
    return json(route, [{ id: branchId * 100, branch_id: branchId, area_id: branchId * 10, name: `Mesa sucursal ${branchId}`, code: `M${branchId}`, capacity: 4, status: "available", position_x: 0, position_y: 0, row: 0, column: 0, width: 90, height: 74, shape: "square", version: 1 }]);
  });
  await page.goto("/pedidos");
  await activateOrdersTab(page, "Panel de mesas");
  const first = page.locator(".tables-workspace button:visible").filter({ hasText: "Mesa sucursal 1" });
  await expect(first).toBeVisible();
  holdFirst = true;
  await page.evaluate(() => window.dispatchEvent(new Event("pos:queries-changed")));
  await expect.poll(() => held.length).toBe(2);
  const selector = page.getByRole("combobox", { name: "Sucursal", exact: true });
  const openMenu = page.getByRole("button", { name: "Abrir menú" });
  const usesMobileMenu = await openMenu.isVisible();
  if (usesMobileMenu) await openMenu.click();
  await selector.selectOption("2");
  if (usesMobileMenu) await expect(openMenu).toHaveAttribute("aria-expanded", "false");
  await activateOrdersTab(page, "Panel de mesas");
  await expect(page.locator(".tables-workspace button:visible").filter({ hasText: "Mesa sucursal 2" })).toBeVisible();
  const lateResponses = Promise.all(["/areas", "/tables"].map(async (path) => {
    const response = await page.waitForResponse((result) => normalizedPath(result.url()) === path && result.request().headers()["x-branch-id"] === "1");
    await response.finished();
  }));
  held.forEach((release) => release());
  await lateResponses;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(first).toHaveCount(0);
  await expect(page.locator(".tables-workspace button:visible").filter({ hasText: "Mesa sucursal 2" })).toBeVisible();
});

test("regression: saves a drag after the displayed position has rendered", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Mobile uses the table list instead of the draggable floor.");
  const mock = await mockTablesAndCommandasApi(page, { seedTable: true });
  const patches: Record<string, unknown>[] = [];
  await page.route("**/api/v1/tables/101", async (route) => {
    if (route.request().method() === "PATCH") patches.push(route.request().postDataJSON());
    await route.fallback();
  });
  await page.goto("/pedidos");
  await activateOrdersTab(page, "Panel de mesas");
  if (testInfo.project.name === "tablet") {
    await expect(page.locator(".tables-operational-floor")).toBeHidden();
    await expect(page.locator(".tables-mobile-list")).toBeVisible();
    await page.setViewportSize({ width: 1180, height: 820 });
  }
  await expect(page.locator(".tables-operational-floor")).toBeVisible();
  await page.getByRole("button", { name: "Mover mesas", exact: true }).click();
  const tableButton = page.getByRole("button", { name: "Mesa 1, Libre, capacidad 4", exact: true });
  await tableButton.scrollIntoViewIfNeeded();
  const bounds = (await tableButton.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 48, bounds.y + bounds.height / 2, { steps: 4 });
  await expect(tableButton).toHaveCSS("transform", "matrix(1, 0, 0, 1, 72, 24)");
  await page.mouse.up();
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toEqual({ position_x: 72, position_y: 24, expected_version: 1 });
  await expect.poll(() => mock.tables[0].version).toBe(2);
  await page.reload();
  await activateOrdersTab(page, "Panel de mesas");
  await expect(page.getByRole("button", { name: "Mesa 1, Libre, capacidad 4", exact: true })).toHaveCSS("transform", "matrix(1, 0, 0, 1, 72, 24)");
});

test("regression: disables editor controls until its pending save completes", async ({ page }) => {
  const mock = await mockTablesAndCommandasApi(page, { seedArea: true });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/v1/tables", async (route) => {
    if (route.request().method() === "POST") await pending;
    await route.fallback();
  });
  await page.goto("/pedidos");
  await activateOrdersTab(page, "Panel de mesas");
  await page.getByRole("button", { name: "Agregar mesas", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Sala principal", exact: true });
  await editor.getByRole("button", { name: "Agregar mesa en fila 1, columna 1", exact: true }).click();
  await editor.getByLabel("Identificador de mesa", { exact: true }).fill("Ventana");
  await editor.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(editor.getByText("Espera a que termine el guardado para seguir editando.")).toBeVisible();
  for (const control of await editor.locator("input, select, button").all()) await expect(control).toBeDisabled();
  release();
  await expect(editor).toBeHidden();
  expect(mock.tableCreatePayloads).toHaveLength(1);
  expect(mock.tableCreatePayloads[0].name).toBe("Mesa Ventana");
});

test("regression: chains confirmed checkout versions when detail reads fail", async ({ page }) => {
  const mock = await mockTablesAndCommandasApi(page, { seedTable: true });
  await page.goto("/pedidos");
  await activateOrdersTab(page, "Panel de mesas");
  await page.locator(".tables-workspace button:visible").filter({ hasText: "Mesa 1" }).first().click();
  await page.getByRole("button", { name: "Abrir mesa", exact: true }).click();
  const account = page.getByRole("dialog", { name: "Cuenta de Mesa 1", exact: true });
  await account.getByRole("button", { name: "Agregar productos", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Agregar productos a Mesa 1", exact: true });
  await picker.getByRole("button", { name: /Pizza clásica/ }).click();
  await picker.getByRole("button", { name: "Guardar selección", exact: true }).click();
  await expect(account.getByText("Comanda #1", { exact: true })).toBeVisible();
  let version = mock.getTableOrderVersion();
  const initialVersion = version;
  const writes: number[] = [];
  await page.route("**/api/v1/orders/700/detail", (route) => json(route, { detail: "Read offline" }, 503));
  await page.route("**/api/v1/orders/700/table-checkout/*", async (route) => {
    const payload = route.request().postDataJSON() as { expected_version: number };
    writes.push(payload.expected_version);
    if (payload.expected_version !== version) return json(route, { detail: "Version anterior" }, 409);
    version++;
    return json(route, { order: { id: 700, version, checkout_started_at: route.request().url().endsWith("/start") ? new Date().toISOString() : null } });
  });
  await account.getByRole("button", { name: "Cerrar mesa", exact: true }).click();
  await expect(account.getByRole("button", { name: "Cobrar mesa", exact: true })).toBeEnabled();
  await account.getByRole("button", { name: "Acciones de la mesa", exact: true }).click();
  await account.getByRole("menuitem", { name: "Reabrir mesa", exact: true }).click();
  await account.getByRole("button", { name: "Cerrar mesa", exact: true }).click();
  await expect(account.getByRole("button", { name: "Cobrar mesa", exact: true })).toBeEnabled();
  expect(writes).toEqual([initialVersion, initialVersion + 1, initialVersion + 2]);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("configures the first table inline from the responsive tables workspace", async ({ page }, testInfo) => {
  const mock = await mockTablesAndCommandasApi(page, { seedArea: true });
  const pavilionArea = mock.areas.find((area) => area.name === "Pabellón")!;
  expect(pavilionArea).toBeDefined();
  await page.goto("/pedidos");

  for (const name of ["Panel de pedidos", "Panel de mesas", "Comandas digitales"]) {
    await expect(page.getByRole("tab", { name, exact: true })).toBeVisible();
  }

  await activateOrdersTab(page, "Panel de mesas");
  await expect(page.getByRole("tab", { name: /Sala principal/ })).toBeVisible();
  const addTables = page.getByRole("button", { name: "Agregar mesas", exact: true });
  await expect(addTables).toBeVisible();
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/tables-panel-${testInfo.project.name}.png`, fullPage: true });
  }
  await addTables.click();

  const editor = page.getByRole("dialog", { name: "Sala principal", exact: true });
  await expect(editor).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);

  const sidebar = editor.locator("aside");
  await expect(sidebar.getByRole("heading", { name: "Zona Sala principal", exact: true })).toBeVisible();
  await expect(sidebar.getByLabel("Nombre de zona", { exact: true })).toHaveValue("Sala principal");
  await expect(sidebar.getByLabel("Columnas", { exact: true })).toBeVisible();
  await expect(sidebar.getByLabel("Filas", { exact: true })).toBeVisible();
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/tables-editor-setup-${testInfo.project.name}.png` });
  }

  const firstCell = editor.getByRole("button", { name: "Agregar mesa en fila 1, columna 1" });
  await firstCell.scrollIntoViewIfNeeded();
  await firstCell.click();

  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "Agregar mesa", exact: true })).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(sidebar.getByRole("heading", { name: "Zona Sala principal", exact: true })).toBeHidden();
  await expect(sidebar.getByLabel("Nombre de zona", { exact: true })).toBeHidden();
  await expect(sidebar.getByRole("heading", { name: "Mesa 1", exact: true })).toBeVisible();

  const identifier = sidebar.getByLabel("Identificador de mesa", { exact: true });
  const shape = sidebar.getByRole("combobox", { name: "Forma", exact: true });
  const capacity = sidebar.getByRole("spinbutton", { name: "Capacidad", exact: true });
  const width = sidebar.getByRole("group", { name: "Ancho", exact: true });
  await expect(identifier).toHaveValue("1");
  await expect(shape).toBeVisible();
  await expect(capacity).toBeVisible();
  await expect(width).toBeVisible();
  await expect(sidebar.getByRole("group", { name: "Altura", exact: true })).toBeVisible();

  await identifier.fill("Ventana");
  await shape.selectOption("rectangle");
  await width.getByRole("button", { name: "Expandir ancho", exact: true }).click();
  await expect(width.getByLabel("Ancho actual", { exact: true })).toHaveText("2");
  const changedWidth = 220;
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/tables-editor-${testInfo.project.name}.png` });
  }

  await editor.locator(".zone-editor-header").getByRole("button", { name: "Guardar", exact: true }).click();

  await expect(page.getByRole("dialog", { name: /seleccion.*zona/i })).toHaveCount(0);

  await expect.poll(() => mock.tableCreatePayloads.length).toBe(1);
  await expect.poll(() => mock.tables.length).toBe(1);
  await expect(editor).toBeHidden();
  await page.getByRole("tab", { name: "Sala principal", exact: true }).click();
  await expect(page.locator("strong:visible").filter({ hasText: /^Mesa Ventana$/ })).toBeVisible();
  expect(mock.tableCreatePayloads[0]).toMatchObject({
    area_id: mock.areas.find((area) => area.name === "Sala principal")!.id,
    name: "Mesa Ventana",
    capacity: 4,
    shape: "rectangle",
    width: changedWidth,
  });
  expect(mock.tables[0]).toMatchObject({
    area_id: mock.areas.find((area) => area.name === "Sala principal")!.id,
    name: "Mesa Ventana",
    capacity: 4,
    shape: "rectangle",
    width: changedWidth,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("completes commandas from the flat board and reopens them from history", async ({ page }, testInfo) => {
  const mock = await mockTablesAndCommandasApi(page);
  await page.goto("/pedidos");

  await activateOrdersTab(page, "Comandas digitales");
  await expect(page.getByText("1 comanda por preparar", { exact: true })).toBeVisible();
  await expect(page.getByText("2 × Pizza clásica", { exact: true })).toBeVisible();
  const timer = page.getByRole("timer").first();
  await expect(timer).toHaveAttribute("data-urgency", "normal");
  await expect(timer).toHaveText(/^5:\d{2}$/);
  if (testInfo.project.name === "desktop") {
    await page.getByRole("button", { name: "Ver en pantalla completa", exact: true }).click();
    await expect(page.locator(".digital-command-board")).toHaveClass(/is-fullscreen/);
    await page.getByRole("button", { name: "Salir de pantalla completa", exact: true }).click();
    await expect(page.locator(".digital-command-board")).not.toHaveClass(/is-fullscreen/);
  }
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/command-board-${testInfo.project.name}.png`, fullPage: true });
  }

  await page.getByRole("button", { name: "Completar comanda", exact: true }).click();
  await expect.poll(() => mock.commandActions).toEqual(["complete"]);
  expect(mock.transitionExpectedStatuses).toEqual(["queued"]);
  await expect(page.getByText("No hay comandas por preparar", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Ver historial", exact: true }).click();
  await expect(page.getByRole("button", { name: "Devolver a preparación", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Devolver a preparación", exact: true }).click();
  await expect.poll(() => mock.commandActions).toEqual(["complete", "reopen"]);
  await page.getByRole("button", { name: "Regresar a comandas digitales", exact: true }).click();
  await expect(page.getByRole("button", { name: "Completar comanda", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("marks command timers red after twenty minutes", async ({ page }) => {
  await mockTablesAndCommandasApi(page, { ticketAgeMinutes: 21 });
  await page.goto("/pedidos");
  await activateOrdersTab(page, "Comandas digitales");
  await expect(page.getByRole("timer")).toHaveAttribute("data-urgency", "critical");
  await expect(page.getByRole("timer")).toHaveText(/^21:\d{2}$/);
});

test("reference command cards retain variants, grouped units and independent corrections", async ({ page }, testInfo) => {
  const mock = await mockTablesAndCommandasApi(page, { ticketAgeMinutes: 125 });
  Object.assign(mock.ticket, { order_number: "2026-0027", customer_name: "Pepe", channel: "takeaway", created_by: "e213d9ac-1840-4185-941b-79948d150d09", created_by_name: "Ana Pérez", created_at: mock.ticket.created_at.replace("Z", ""), items: [{
    item_id: 901, name: "Alitas", variant_name: "Mediano", quantity: 1, notes: "Salsas aparte", modifiers: [
      { modifier_id: 1, group_name: "Elige las salsas", name: "BBQ" },
      { modifier_id: 2, group_name: "Extras", name: "Zanahoria" },
      { modifier_id: 3, group_name: "Extras", name: "Pepino" },
      { modifier_id: 3, group_name: "Extras", name: "Pepino" },
    ],
  }] });
  mock.extraCommands.push({ ...mock.ticket, id: 502, sequence: 2, kind: "revision", created_at: new Date(Date.now() - 2 * 60000).toISOString(), context: { modified_at: new Date(Date.now() - 2 * 60000).toISOString() }, items: [{
    item_id: 902, name: "Alitas", variant_name: "Grande", quantity: 1, action: "modified", previous_name: "Alitas - Mediano", previous_quantity: 1, notes: "Sin sal", modifiers: [{ name: "BBQ" }], combo_components: [{ product_id: 5, name: "Papas", quantity: 1 }],
  }, { item_id: 903, name: "Refresco", quantity: 1, action: "cancelled", cancellation_reason: "Ya no lo desea" }] });
  await page.goto("/pedidos");
  await activateOrdersTab(page, "Comandas digitales");
  await expect(page.getByText("2 comandas por preparar", { exact: true })).toBeVisible();
  const cards = page.locator(".command-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("1 × Alitas - Mediano");
  await expect(cards.first()).toContainText("2 × Pepino");
  await expect(cards.first()).toContainText("Tomado por Ana Pérez");
  await expect(cards.first().getByRole("timer")).toHaveText("+99 mins");
  await expect(cards.first().getByRole("timer")).toHaveAccessibleName(/125 minutos y \d+ segundos/);
  await expect(cards.last()).toContainText("Modificado hace 2 min");
  await expect(cards.last()).toContainText("Antes: 1 × Alitas - Mediano");
  await expect(cards.last()).toContainText("Personalizaciones");
  await expect(cards.last()).toContainText("1 × Papas");
  await expect(cards.last()).toContainText("Cancelado");
  await expect(page.getByText(mock.ticket.created_by!, { exact: false })).toHaveCount(0);
  await expect(cards.filter({ hasText: "S/" })).toHaveCount(0);
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/reference-commands-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Ver en pantalla completa", exact: true }).click();
  await expect(page.locator(".digital-command-board")).toHaveClass(/is-fullscreen/);
  await page.getByRole("button", { name: "Salir de pantalla completa", exact: true }).click();
  await expect(page.locator(".digital-command-board")).not.toHaveClass(/is-fullscreen/);
  await page.getByRole("button", { name: "Ver historial", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("No hay comandas en el historial de hoy")).toBeVisible();
  await page.getByRole("button", { name: "Regresar a comandas digitales" }).click();
  await expect(cards).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("confirmed command completion survives a failed background read", async ({ page }) => {
  const mock = await mockTablesAndCommandasApi(page);
  await page.goto("/pedidos");
  await activateOrdersTab(page, "Comandas digitales");
  const complete = page.getByRole("button", { name: "Completar comanda", exact: true });
  await expect(complete).toBeVisible();
  mock.setFailCommandReads(true);
  await complete.click();
  await expect(page.getByText("No hay comandas por preparar")).toBeVisible();
  await expect(page.getByText("Comanda completada y guardada en el historial.")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(mock.commandActions).toEqual(["complete"]);
  mock.setFailCommandReads(false);
  await page.getByRole("button", { name: "Ver historial" }).click();
  await page.getByRole("button", { name: "Devolver a preparación" }).click();
  await page.getByRole("button", { name: "Regresar a comandas digitales" }).click();
  await expect(complete).toBeVisible();
  expect(mock.commandActions).toEqual(["complete", "reopen"]);
});

test("opens an occupied table directly and reflects a completed command as prepared", async ({ page }, testInfo) => {
  const mock = await mockTablesAndCommandasApi(page, { seedTable: true });
  await page.goto("/pedidos");
  await activateOrdersTab(page, "Panel de mesas");

  await page.locator(".tables-workspace button:visible").filter({ hasText: "Mesa 1" }).first().click();
  await page.getByRole("dialog", { name: "Mesa 1 disponible" }).getByRole("button", { name: "Abrir mesa", exact: true }).click();

  const account = page.getByRole("dialog", { name: "Cuenta de Mesa 1" });
  await account.getByRole("button", { name: "Agregar productos" }).click();
  const picker = page.getByRole("dialog", { name: "Agregar productos a Mesa 1" });
  await picker.getByRole("button", { name: /Pizza clásica/ }).click();
  await picker.getByRole("button", { name: "Guardar selección" }).click();
  await expect(account.getByText("Comanda #1", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(account).toBeHidden();

  await activateOrdersTab(page, "Comandas digitales");
  await page.locator(".command-card").filter({ has: page.getByText("#7", { exact: true }) }).getByRole("button", { name: "Completar comanda", exact: true }).click();
  await expect.poll(() => mock.commandActions).toEqual(["complete"]);

  await activateOrdersTab(page, "Panel de mesas");
  await page.locator(".tables-workspace button:visible").filter({ hasText: "Mesa 1" }).first().click();

  const refreshedAccount = page.getByRole("dialog", { name: "Cuenta de Mesa 1" });
  await expect(refreshedAccount).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Mesa 1", exact: true })).toHaveCount(0);
  await refreshedAccount.getByRole("button", { name: /Comanda #1/ }).click();
  await expect(refreshedAccount.getByText("Preparado", { exact: true })).toBeVisible();

  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/table-command-prepared-${testInfo.project.name}.png`, fullPage: true });
  }
});

test("prints each new table command and the complete account only at each real close", async ({ page }) => {
  const mock = await mockTablesAndCommandasApi(page, { seedTable: true, automaticPrinting: true });
  await page.goto("/pedidos");
  await activateOrdersTab(page, "Panel de mesas");
  await page.locator(".tables-workspace button:visible").filter({ hasText: "Mesa 1" }).first().click();
  await page.getByRole("dialog", { name: "Mesa 1 disponible" }).getByRole("button", { name: "Abrir mesa", exact: true }).click();
  const account = page.getByRole("dialog", { name: "Cuenta de Mesa 1" });
  await expect(account.getByText("No se han agregado productos")).toBeVisible();
  expect(await tablePrintSubmissions(page)).toHaveLength(0);
  expect(mock.printJobs).toHaveLength(0);

  for (const quantity of [1, 2]) {
    await account.getByRole("button", { name: "Agregar productos" }).click();
    const picker = page.getByRole("dialog", { name: "Agregar productos a Mesa 1" });
    await picker.getByRole("button", { name: /Pizza clásica/ }).click();
    for (let index = 1; index < quantity; index++) await picker.getByRole("button", { name: "Agregar una unidad de Pizza clásica", exact: true }).click();
    await picker.getByRole("button", { name: "Guardar selección" }).click();
    await expect.poll(async () => (await tablePrintSubmissions(page)).length).toBe(quantity);
    await expect.poll(() => mock.printJobs.every((job) => job.status === "printed")).toBe(true);
  }
  expect(mock.printJobs.map((job) => job.job_type)).toEqual(["kitchen_ticket", "kitchen_ticket"]);
  expect(mock.printJobs[0].payload.ticket?.items).toMatchObject([{ quantity: 1 }]);
  expect(mock.printJobs[1].payload.ticket?.items).toHaveLength(1);
  expect(mock.printJobs[1].payload.ticket?.items).toMatchObject([{ quantity: 2 }]);
  expect(mock.printJobs[1].payload.ticket?.sequence).toBe(2);
  const automatic = await tablePrintSubmissions(page);
  expect(automatic[1].data[1].data).toContain("En Sala principal");
  expect(automatic[1].data[1].data).toContain("Mesa 1");
  expect(automatic[1].data[1].data).not.toContain("Monto a pagar");

  await account.getByRole("button", { name: "Acciones de la comanda 2", exact: true }).click();
  await account.getByRole("menuitem", { name: "Imprimir comanda", exact: true }).click();
  await expect.poll(async () => (await tablePrintSubmissions(page)).length).toBe(3);
  expect(mock.printedTicketIds).toEqual([703]);

  await account.getByRole("button", { name: "Cerrar mesa", exact: true }).click();
  await expect.poll(async () => (await tablePrintSubmissions(page)).length).toBe(4);
  expect(mock.printJobs[3].job_type).toBe("customer_receipt");
  expect(mock.printJobs[3].payload.order.items).toHaveLength(2);
  expect(mock.printJobs[3].payload.order.total).toBe(72);
  expect((await tablePrintSubmissions(page))[3].data[1].data).toContain("Monto a pagar");

  await account.getByRole("button", { name: "Acciones de la mesa", exact: true }).click();
  await account.getByRole("menuitem", { name: "Reabrir mesa", exact: true }).click();
  await account.getByRole("button", { name: "Cerrar mesa", exact: true }).click();
  await expect.poll(async () => (await tablePrintSubmissions(page)).length).toBe(5);
  await account.getByRole("button", { name: "Imprimir cuenta", exact: true }).click();
  await expect.poll(async () => (await tablePrintSubmissions(page)).length).toBe(6);
  await expect.poll(() => mock.printJobs.every((job) => job.status === "printed")).toBe(true);

  await account.getByRole("button", { name: "Cobrar mesa", exact: true }).click();
  const payment = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await payment.getByRole("radio", { name: /Yape/ }).check();
  await payment.getByRole("button", { name: /^Cobrar/ }).click();
  await expect(account).toBeHidden();
  expect(mock.checkoutActions).toEqual(["start", "reopen", "start", "pay"]);
  expect(mock.tablePaymentPayloads[0]).toMatchObject({ payments: [{ method: "yape", amount: 72 }] });
  const submissions = await tablePrintSubmissions(page);
  expect(submissions).toHaveLength(6);
  for (const submission of submissions) {
    expect(submission.data[0]).toMatchObject({ type: "raw", format: "command", data: "1B40" });
    expect(submission.data[1]).toMatchObject({ type: "raw", format: "html", options: { pageWidth: 576, pageHeight: expect.any(Number) } });
    expect(submission.data[1].options!.pageHeight).toBeGreaterThan(0);
    expect(submission.data[2]).toMatchObject({ type: "raw", format: "command", data: "0A1D564100" });
  }
});

test("opens, reopens and pays a table while its command remains in kitchen", async ({ page }, testInfo) => {
  const mock = await mockTablesAndCommandasApi(page, { seedTable: true });
  await page.goto("/pedidos");
  await activateOrdersTab(page, "Panel de mesas");

  await page.locator(".tables-workspace button:visible").filter({ hasText: "Mesa 1" }).first().click();
  const tableDialog = page.getByRole("dialog", { name: "Mesa 1 disponible" });
  await expect(tableDialog.getByText("Abre la mesa para empezar a agregar productos.")).toBeVisible();
  await tableDialog.getByRole("button", { name: "Abrir mesa", exact: true }).click();

  const account = page.getByRole("dialog", { name: "Cuenta de Mesa 1" });
  await expect(account.getByText("No se han agregado productos")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(account.getByRole("button", { name: "Cerrar detalle de mesa", exact: true })).toHaveCount(0);
  const orderActions = account.getByRole("button", { name: "Acciones de la mesa", exact: true });
  await expect(orderActions).toHaveAttribute("aria-expanded", "false");
  await orderActions.click();
  await expect(orderActions).toHaveAttribute("aria-expanded", "true");
  const orderMenu = account.getByRole("menu", { name: "Acciones del pedido", exact: true });
  await expect(orderMenu.getByRole("menuitem", { name: "Reabrir mesa", exact: true })).toBeDisabled();
  await expect(orderMenu.getByRole("menuitem", { name: "Transferir pedido", exact: true })).toBeFocused();
  await expect(orderMenu.getByRole("menuitem", { name: "Cancelar pedido", exact: true })).toBeVisible();
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/table-order-actions-${testInfo.project.name}.png`, fullPage: true });
  }
  await page.keyboard.press("Escape");
  await expect(orderMenu).toBeHidden();
  await expect(account).toBeVisible();
  await expect(orderActions).toBeFocused();
  await expect(orderActions).toHaveAttribute("aria-expanded", "false");
  await orderActions.click();
  await account.locator(".table-order-empty").click();
  await expect(orderMenu).toBeHidden();
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/table-account-empty-${testInfo.project.name}.png`, fullPage: true });
  }
  await account.getByRole("button", { name: "Agregar productos" }).click();

  const picker = page.getByRole("dialog", { name: "Agregar productos a Mesa 1" });
  await picker.getByRole("button", { name: /Pizza clásica/ }).click();
  await picker.getByRole("button", { name: "Guardar selección" }).click();

  await expect(page.getByText("Productos agregados y comanda enviada a cocina.")).toBeVisible();
  await expect(account.getByText("Comanda #1", { exact: true })).toBeVisible();
  await account.getByRole("button", { name: /Comanda #1/ }).click();
  await expect(account.getByText("1 × Pizza clásica", { exact: true })).toBeVisible();
  await account.getByRole("button", { name: "Acciones de la comanda 1", exact: true }).click();
  const commandMenu = account.getByRole("menu", { name: "Acciones de la comanda 1", exact: true });
  await expect(commandMenu.getByText("Acciones", { exact: true })).toBeVisible();
  await expect(commandMenu.getByRole("menuitem", { name: "Editar productos", exact: true })).toBeVisible();
  await expect(commandMenu.getByRole("menuitem", { name: "Imprimir comanda", exact: true })).toBeVisible();
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/table-command-actions-${testInfo.project.name}.png`, fullPage: true });
  }
  await commandMenu.getByRole("menuitem", { name: "Imprimir comanda", exact: true }).click();
  await expect.poll(() => mock.printedTicketIds).toEqual([702]);
  await expect(account).toHaveAttribute("aria-busy", "false");
  await account.getByRole("button", { name: "Acciones de la comanda 1", exact: true }).click();
  await orderActions.click();
  await expect(commandMenu).toBeHidden();
  await expect(account.getByRole("menu", { name: "Acciones del pedido", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await account.getByRole("button", { name: "Cerrar mesa", exact: true }).click();
  await expect(account.getByRole("button", { name: "Imprimir cuenta", exact: true })).toBeVisible();
  await expect.poll(() => mock.checkoutActions).toEqual(["start"]);
  await account.getByRole("button", { name: "Acciones de la mesa", exact: true }).click();
  await account.getByRole("menuitem", { name: "Reabrir mesa", exact: true }).click();
  await expect(account.getByRole("button", { name: "Cerrar mesa", exact: true })).toBeVisible();
  await expect.poll(() => mock.checkoutActions).toEqual(["start", "reopen"]);
  await account.getByRole("button", { name: "Cerrar mesa", exact: true }).click();
  await expect.poll(() => mock.checkoutActions).toEqual(["start", "reopen", "start"]);
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/table-account-checkout-${testInfo.project.name}.png`, fullPage: true });
  }
  await account.getByRole("button", { name: "Cobrar mesa", exact: true }).click();
  const payment = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await expect(payment).toBeVisible();
  await payment.getByRole("radio", { name: /Yape/ }).check();
  await payment.getByRole("button", { name: /^Cobrar/ }).click();
  await expect.poll(() => mock.checkoutActions).toEqual(["start", "reopen", "start", "pay"]);
  await expect(account).toBeHidden();
  expect(mock.tables[0]).toMatchObject({ status: "available", active_order_id: null });
  expect(mock.tablePaymentPayloads).toHaveLength(1);
  expect(mock.tablePaymentPayloads[0]).toMatchObject({ payments: [{ method: "yape", amount: 24 }] });

  expect(mock.getCreatedOrderPayload()).toMatchObject({
    branch_id: 1,
    channel: "dine_in",
    table_id: 101,
    delivery_address: null,
    delivery_fee: 0,
    items: [],
  });
  expect(mock.itemBatchPayloads).toHaveLength(1);
  expect(mock.itemBatchPayloads[0]).toMatchObject({ items: [{ product_id: 20, quantity: 1 }] });
  expect(mock.getConfirmSendCount()).toBe(1);
});

test("transfers and cancels a table order from the general actions menu", async ({ page }, testInfo) => {
  const mock = await mockTablesAndCommandasApi(page, { seedTable: true, seedTransferTable: true });
  await page.goto("/pedidos");
  await activateOrdersTab(page, "Panel de mesas");

  await page.locator(".tables-workspace button:visible").filter({ hasText: "Mesa 1" }).first().click();
  await page.getByRole("dialog", { name: "Mesa 1 disponible" }).getByRole("button", { name: "Abrir mesa", exact: true }).click();

  const account = page.getByRole("dialog", { name: "Cuenta de Mesa 1" });
  await account.getByRole("button", { name: "Acciones de la mesa", exact: true }).click();
  await account.getByRole("menuitem", { name: "Transferir pedido", exact: true }).click();
  const transfer = page.getByRole("dialog", { name: "Transferir pedido", exact: true });
  await expect(transfer.getByRole("button", { name: /Mesa 2/ })).toBeVisible();
  await transfer.getByRole("button", { name: /Mesa 2/ }).click();

  await expect.poll(() => mock.orderTransferPayloads).toEqual([{ table_id: 102, expected_version: 1 }]);
  const transferredAccount = page.getByRole("dialog", { name: "Cuenta de Mesa 2" });
  await expect(transferredAccount).toBeVisible();
  expect(mock.tables[0]).toMatchObject({ status: "available", active_order_id: null });
  expect(mock.tables[1]).toMatchObject({ status: "occupied", active_order_id: 700 });

  await transferredAccount.getByRole("button", { name: "Acciones de la mesa", exact: true }).click();
  await transferredAccount.getByRole("menuitem", { name: "Cancelar pedido", exact: true }).click();
  const cancellation = page.getByRole("dialog", { name: "Cancelar pedido", exact: true });
  await expect(cancellation.getByRole("button", { name: "Confirmar cancelación" })).toBeDisabled();
  expect(mock.orderTransitions).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(cancellation).toBeHidden();
  await expect(transferredAccount).toBeVisible();
  await transferredAccount.getByRole("button", { name: "Acciones de la mesa", exact: true }).click();
  await transferredAccount.getByRole("menuitem", { name: "Cancelar pedido", exact: true }).click();
  await cancellation.getByLabel("Motivo de cancelación").fill("Cliente no ocupará la mesa transferida");
  if (process.env.E2E_CAPTURE_MODE === "cancel-only") {
    await cancellation.getByRole("button", { name: "Confirmar cancelación" }).click({ trial: true });
    const path = resolve(testInfo.config.rootDir, "test-output", "cancel-table-confirmation", `${testInfo.project.name}.png`);
    await page.screenshot({ path, animations: "disabled" });
    await testInfo.attach("table-cancellation-confirmation", { path, contentType: "image/png" });
  }
  await cancellation.getByRole("button", { name: "Confirmar cancelación" }).click();
  await expect.poll(() => mock.orderTransitions).toEqual(["cancelled"]);
  expect(mock.orderTransitionPayloads).toEqual([{ status: "cancelled", expected_version: 2, reason: "Cliente no ocupará la mesa transferida" }]);
  await expect(transferredAccount).toBeHidden();
  expect(mock.tables[1]).toMatchObject({ status: "available", active_order_id: null });
});

test("edits a sent product and updates the original command", async ({ page }, testInfo) => {
  const mock = await mockTablesAndCommandasApi(page, { seedTable: true, repeatedModifiers: true });
  await page.goto("/pedidos");
  await activateOrdersTab(page, "Panel de mesas");
  await page.locator(".tables-workspace button:visible").filter({ hasText: "Mesa 1" }).first().click();
  await page.getByRole("dialog", { name: "Mesa 1 disponible" }).getByRole("button", { name: "Abrir mesa", exact: true }).click();

  const account = page.getByRole("dialog", { name: "Cuenta de Mesa 1" });
  await account.getByRole("button", { name: "Agregar productos" }).click();
  const picker = page.getByRole("dialog", { name: "Agregar productos a Mesa 1" });
  await picker.getByRole("button", { name: /Pizza clásica/ }).click();
  const configuration = page.getByRole("dialog", { name: "Pizza clásica" });
  await configuration.getByRole("button", { name: "Agregar una unidad de BBQ" }).click();
  await configuration.getByRole("button", { name: "Agregar una unidad de BBQ" }).click();
  await configuration.getByRole("button", { name: "Agregar a la selección" }).click();
  await expect(picker.getByText("BBQ ×2", { exact: true })).toBeVisible();
  await picker.getByRole("button", { name: "Guardar selección" }).click();
  await expect(account.getByText("Comanda #1", { exact: true })).toBeVisible();

  await account.getByRole("button", { name: "Acciones de la comanda 1", exact: true }).click();
  await account.getByRole("menuitem", { name: "Editar productos", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Editar productos de la comanda 1" });
  await editor.locator(".command-editor-product-select").click();
  await expect(editor.getByLabel("Cantidad de BBQ")).toHaveText("2");
  await editor.getByRole("button", { name: "Agregar una unidad de BBQ" }).click();
  await expect(editor.getByLabel("Cantidad de BBQ")).toHaveText("3");
  await expect(editor.getByRole("button", { name: "Agregar una unidad de BBQ" })).toBeDisabled();
  await editor.getByRole("spinbutton", { name: "Cantidad de Pizza clásica", exact: true }).fill("2");
  await editor.getByLabel("Nota adicional", { exact: true }).fill("Agregar queso");
  await editor.getByRole("button", { name: "Editar producto", exact: true }).click();
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/table-command-editor-${testInfo.project.name}.png`, fullPage: true });
  }
  await editor.getByRole("button", { name: "Guardar", exact: true }).click();

  await expect.poll(() => mock.revisionPayloads.length).toBe(1);
  expect(mock.revisionPayloads[0]).toMatchObject({
    operations: [{
      type: "edit",
      item_id: 701,
      replacement: {
        product_id: 20,
        quantity: 2,
        notes: "Agregar queso",
        modifiers: [
          { modifier_id: 41, name: "BBQ", price_delta: 2 },
          { modifier_id: 41, name: "BBQ", price_delta: 2 },
          { modifier_id: 41, name: "BBQ", price_delta: 2 },
        ],
      },
    }],
  });
  await expect(editor).toBeHidden();
  await expect(account.getByText("Comanda #1", { exact: true })).toBeVisible();
  await expect(account.getByText("Comanda #2", { exact: true })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(account).toBeHidden();
  await activateOrdersTab(page, "Comandas digitales");
  await expect(page.getByText("Modificado justo ahora", { exact: true })).toBeVisible();
  await expect(page.getByText("Agregar queso", { exact: true })).toBeVisible();
});

test("cancels a sent product with an audit reason and updates the original command", async ({ page }) => {
  const mock = await mockTablesAndCommandasApi(page, { seedTable: true });
  await page.goto("/pedidos");
  await activateOrdersTab(page, "Panel de mesas");
  await page.locator(".tables-workspace button:visible").filter({ hasText: "Mesa 1" }).first().click();
  await page.getByRole("dialog", { name: "Mesa 1 disponible" }).getByRole("button", { name: "Abrir mesa", exact: true }).click();

  const account = page.getByRole("dialog", { name: "Cuenta de Mesa 1" });
  await account.getByRole("button", { name: "Agregar productos" }).click();
  const picker = page.getByRole("dialog", { name: "Agregar productos a Mesa 1" });
  await picker.getByRole("button", { name: /Pizza clásica/ }).click();
  await picker.getByRole("button", { name: "Guardar selección" }).click();
  await expect(account.getByText("Comanda #1", { exact: true })).toBeVisible();

  await account.getByRole("button", { name: "Agregar productos" }).click();
  await picker.getByRole("button", { name: /Pizza clásica/ }).click();
  await picker.getByRole("button", { name: "Guardar selección" }).click();
  await expect(account.getByText("Comanda #2", { exact: true })).toBeVisible();

  await account.getByRole("button", { name: "Acciones de la comanda 1", exact: true }).click();
  await account.getByRole("menuitem", { name: "Editar productos", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Editar productos de la comanda 1" });
  await editor.getByRole("button", { name: "Acciones de Pizza clásica", exact: true }).click();
  await editor.getByRole("menuitem", { name: "Cancelar producto", exact: true }).click();
  const cancellation = page.getByRole("alertdialog", { name: "Cancelar producto" });
  await cancellation.getByLabel("Motivo", { exact: true }).fill("Producto solicitado por error");
  await cancellation.getByRole("button", { name: "Cancelar producto", exact: true }).click();
  await expect(editor.getByText("Cancelación preparada", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Guardar", exact: true }).click();

  await expect.poll(() => mock.revisionPayloads.length).toBe(1);
  expect(mock.revisionPayloads[0]).toMatchObject({
    operations: [{ type: "cancel", item_id: 701, reason: "Producto solicitado por error" }],
  });
  await expect(editor).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(account).toBeHidden();
  await activateOrdersTab(page, "Comandas digitales");
  await expect(page.getByText("Cancelado", { exact: true })).toBeVisible();
  await expect(page.getByText("Motivo: Producto solicitado por error", { exact: true })).toBeVisible();
});

test("retired extras stay on the original command until completion and later edits create a correction", async ({ page }, testInfo) => {
  await mockTablesAndCommandasApi(page, { seedTable: true, repeatedModifiers: true });
  await page.goto("/pedidos");
  await activateOrdersTab(page, "Panel de mesas");
  await page.locator(".tables-workspace button:visible").filter({ hasText: "Mesa 1" }).first().click();
  await page.getByRole("dialog", { name: "Mesa 1 disponible" }).getByRole("button", { name: "Abrir mesa", exact: true }).click();
  const account = page.getByRole("dialog", { name: "Cuenta de Mesa 1" });
  await account.getByRole("button", { name: "Agregar productos" }).click();
  const picker = page.getByRole("dialog", { name: "Agregar productos a Mesa 1" });
  await picker.getByRole("button", { name: /Pizza clásica/ }).click();
  const configuration = page.getByRole("dialog", { name: "Pizza clásica" });
  await configuration.getByRole("button", { name: "Agregar una unidad de BBQ" }).click();
  await configuration.getByRole("button", { name: "Agregar una unidad de BBQ" }).click();
  await configuration.getByRole("button", { name: "Agregar a la selección" }).click();
  await picker.getByRole("button", { name: "Guardar selección" }).click();

  for (const note of ["Salsa aparte", "Poca sal"]) {
    await account.getByRole("button", { name: "Acciones de la comanda 1", exact: true }).click();
    await account.getByRole("menuitem", { name: "Editar productos", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Editar productos de la comanda 1" });
    await editor.locator(".command-editor-product-select").click();
    if (note === "Salsa aparte") await editor.getByRole("button", { name: "Quitar una unidad de BBQ" }).click();
    await editor.getByLabel("Nota adicional", { exact: true }).fill(note);
    await editor.getByRole("button", { name: "Editar producto", exact: true }).click();
    await editor.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect(editor).toBeHidden();
  }
  await account.getByRole("button", { name: /Comanda #1/ }).click();
  await expect(account.locator(".order-removed-options del").first()).toHaveText("1 × BBQ");
  await expect(account.getByText("1 × Pizza clásica")).toBeVisible();
  await expect(account.getByText("Comanda #2", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await activateOrdersTab(page, "Comandas digitales");
  const command = page.locator(".command-card").filter({ has: page.getByText("#7", { exact: true }) });
  await expect(command).toHaveCount(1);
  await expect(command.locator(".order-removed-options del")).toHaveText("1 × BBQ");
  await expect(command).toContainText("Poca sal");
  await expect(command).not.toContainText("S/");
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/retired-extra-${testInfo.project.name}.png`, fullPage: true });
  await command.getByRole("button", { name: "Completar comanda" }).click();
  await expect(command).toHaveCount(0);

  await activateOrdersTab(page, "Panel de mesas");
  await page.locator(".tables-workspace button:visible").filter({ hasText: "Mesa 1" }).first().click();
  await account.getByRole("button", { name: "Acciones de la comanda 1", exact: true }).click();
  await account.getByRole("menuitem", { name: "Editar productos", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Editar productos de la comanda 1" });
  await editor.locator(".command-editor-product-select").click();
  await editor.getByLabel("Nota adicional", { exact: true }).fill("Cambio posterior a cocina");
  await editor.getByRole("button", { name: "Editar producto", exact: true }).click();
  await editor.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(account.getByText("Comanda #1", { exact: true })).toBeVisible();
  await expect(account.getByText("Comanda #2", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await activateOrdersTab(page, "Comandas digitales");
  await expect(command).toHaveCount(1);
  await expect(command).toContainText("Comanda #2");
  await expect(command).toContainText("Cambio posterior a cocina");
  await expect(command.locator(".order-removed-options")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("warns and cancels an empty table instead of closing a zero-value sale", async ({ page }, testInfo) => {
  const mock = await mockTablesAndCommandasApi(page, { seedTable: true });
  await page.goto("/pedidos");
  await activateOrdersTab(page, "Panel de mesas");
  await page.locator(".tables-workspace button:visible").filter({ hasText: "Mesa 1" }).first().click();
  await page.getByRole("dialog", { name: "Mesa 1 disponible" }).getByRole("button", { name: "Abrir mesa", exact: true }).click();

  const account = page.getByRole("dialog", { name: "Cuenta de Mesa 1" });
  await account.getByRole("button", { name: "Cerrar mesa", exact: true }).click();
  const warning = page.getByRole("alertdialog", { name: "Esta mesa no tiene productos" });
  await expect(warning.getByText("Cancela el pedido para liberarla.", { exact: false })).toBeVisible();
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.screenshot({ path: `.impeccable/review/table-empty-warning-${testInfo.project.name}.png`, fullPage: true });
  }
  await warning.getByRole("button", { name: "Cancelar pedido", exact: true }).click();
  await expect(warning).toBeHidden();
  const cancellation = page.getByRole("dialog", { name: "Cancelar pedido", exact: true });
  await expect(cancellation.getByLabel("Motivo de cancelación")).toHaveAttribute("required", "");
  await expect(cancellation.getByRole("button", { name: "Confirmar cancelación" })).toBeDisabled();
  expect(mock.orderTransitions).toEqual([]);
  expect(mock.checkoutActions).toEqual([]);
  await cancellation.getByLabel("Motivo de cancelación").fill("Mesa abierta por error, sin consumo");
  await cancellation.getByRole("button", { name: "Confirmar cancelación" }).click();
  await expect.poll(() => mock.orderTransitions).toEqual(["cancelled"]);
  expect(mock.orderTransitionPayloads).toEqual([{ status: "cancelled", expected_version: 1, reason: "Mesa abierta por error, sin consumo" }]);
  expect(mock.tablePaymentPayloads).toEqual([]);
  expect(mock.printedTicketIds).toEqual([]);
  await expect(account).toBeHidden();
});

test("reuses the same idempotency key when opening a table response is lost", async ({ page }) => {
  const mock = await mockTablesAndCommandasApi(page, { seedTable: true, failFirstOrderResponse: true });
  await page.goto("/pedidos");
  await activateOrdersTab(page, "Panel de mesas");
  await page.locator(".tables-workspace button:visible").filter({ hasText: "Mesa 1" }).first().click();
  const openButton = page.getByRole("dialog", { name: "Mesa 1 disponible" }).getByRole("button", { name: "Abrir mesa", exact: true });
  await openButton.click();
  await expect.poll(() => mock.orderIdempotencyKeys.length).toBe(1);
  await openButton.click();
  await expect.poll(() => mock.orderIdempotencyKeys.length).toBe(2);
  expect(mock.orderIdempotencyKeys[0]).toBeTruthy();
  expect(mock.orderIdempotencyKeys[1]).toBe(mock.orderIdempotencyKeys[0]);
  await expect(page.getByRole("dialog", { name: "Cuenta de Mesa 1" })).toBeVisible();
});
