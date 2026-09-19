import { expect, test, type Page, type Route } from "@playwright/test";
import { mockCompletedManualPrint } from "./helpers/manual-print";

const allChannels = [
  "pos_tables",
  "pos_counter",
  "pos_takeaway",
  "pos_delivery",
  "digital_tables",
  "digital_takeaway",
  "digital_delivery",
];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function orderDetail(id: number, number: string, customerName: string, folio: number) {
  return {
    order: {
      id,
      folio,
      business_id: 1,
      branch_id: 1,
      number,
      channel: "delivery",
      source: "pos",
      status: "preparing",
      payment_status: "partial",
      payment_method: "yape",
      customer_name: customerName,
      customer_phone: "+51 944 197 385",
      delivery_address: {
        address: "Av. Arequipa 1234, Lince",
        reference: "Puerta verde",
        maps_url: "https://maps.google.com/?q=-12.08,-77.03",
      },
      subtotal: 30,
      discount: 0,
      delivery_fee: 5,
      total: 35,
      notes: "Tocar el timbre una vez",
      version: 3,
      created_at: "2026-08-27T14:57:00-05:00",
      items: [{
        id: 91,
        product_id: 20,
        name: "Pizza clásica",
        variant_name: "Familiar",
        quantity: 1,
        unit_price: 30,
        modifiers: [
          { modifier_id: 41, name: "Extra queso", price_delta: 2 },
          { modifier_id: 41, name: "Extra queso", price_delta: 2 },
        ],
        notes: "Sin cebolla",
        status: "preparing",
        line_total: 30,
      }],
    },
    payments: [{ id: 60, order_id: id, method: "yape", amount: 20, status: "confirmed", created_at: "2026-08-27T15:01:00-05:00" }],
    payment_evidence: [
      { id: 70, order_id: id, provider: "yape", amount_detected: 15, operation_number: "OP-ANTERIOR", security_code: "111", recipient: "Pizza House", status: "under_review", warnings: [], image_url: "", created_at: "2026-08-27T15:00:00-05:00" },
      { id: 71, order_id: id, provider: "yape", amount_detected: 20, operation_number: "OP-RECIENTE", security_code: "742", recipient: "Pizza House", status: "evidence_received", warnings: [], image_url: "", created_at: "2026-08-27T15:02:00-05:00" },
    ],
    tickets: [
      { id: 82, order_id: id, order_folio: folio, order_number: number, sequence: 2, station: "bar", status: "queued", items: [], print_count: 0, created_at: "2026-08-27T15:04:00-05:00" },
      { id: 81, order_id: id, order_folio: folio, order_number: number, sequence: 1, station: "kitchen", status: "preparing", items: [], print_count: 1, created_at: "2026-08-27T15:03:00-05:00" },
    ],
    payment_summary: { paid: 20, remaining: 15 },
  };
}

type MockOrdersApiOptions = {
  completedCommand?: boolean;
  failFirstRevision?: boolean;
  editable?: boolean;
  failFirstEdit?: boolean;
  authoritativeTotalDelta?: number;
  cashRegisters?: { id: number; name: string; active: boolean }[];
  cashSessions?: { id: number; register_id: number; status: string }[];
  failFirstPaymentResponse?: boolean;
  failFirstConfirmResponse?: boolean;
  rejectFirstConfirm?: boolean;
};

async function mockOrdersApi(page: Page, options: MockOrdersApiOptions = {}) {
  let createdPayload: Record<string, unknown> | null = null;
  let orderRequestCount = 0;
  const paymentPayloads: Record<string, unknown>[] = [];
  const paymentIdempotencyKeys: string[] = [];
  const confirmPayloads: Record<string, unknown>[] = [];
  const confirmIdempotencyKeys: string[] = [];
  const editPayloads: Record<string, unknown>[] = [];
  const revisionPayloads: Record<string, unknown>[] = [];
  const workspaceQueries: URLSearchParams[] = [];
  const transitionPayloads: Record<string, unknown>[] = [];
  let failReadsAfterEdit = false;
  const cashRegisters = options.cashRegisters ?? [{ id: 91, name: "Caja principal", active: true }];
  const cashSessions = options.cashSessions ?? [{ id: 301, register_id: 91, status: "open" }];
  const orders = [{
    id: 8,
    folio: 7,
    number: "0008",
    customer_name: "Claudio Rey",
    customer_phone: "+51 944 197 385",
    channel: "delivery",
    source: "pos",
    created_at: "2026-08-27T14:57:00-05:00",
    status: "preparing",
    payment_status: "partial",
    total: 35,
    delivery_fee: 5,
    requires_review: true,
    item_count: 1,
    version: 3,
  }];
  const details = new Map<number, ReturnType<typeof orderDetail>>([[8, orderDetail(8, "0008", "Claudio Rey", 7)]]);
  if (options.editable) {
    const detail = details.get(8)!;
    detail.order.channel = "takeaway";
    detail.order.payment_status = "pending";
    detail.order.delivery_fee = 0;
    detail.order.subtotal = 34;
    detail.order.discount = 4;
    detail.order.total = 30;
    Object.assign(detail.order.items[0], { line_total: 34, promotion_discount: 4 });
    detail.payments = []; detail.payment_evidence = [];
    detail.payment_summary = { paid: 0, remaining: 30 };
    detail.tickets = [{ ...detail.tickets[1], status: options.completedCommand ? "ready" : "preparing", items: detail.order.items.map((item) => ({ ...item, item_id: item.id })) }];
    Object.assign(orders[0], { channel: "takeaway", payment_status: "pending", delivery_fee: 0, total: 30, requires_review: false });
  }
  const catalog = {
    branch: {
      id: 1,
      business_id: 1,
      slug: "matriz",
      name: "Sucursal principal",
      opening_hours: {},
      accepted_payment_methods: ["cash", "card", "transfer"],
      delivery_enabled: true,
      takeaway_enabled: true,
      delivery_fee: 5,
      active: true,
    },
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
      variants: [
        { id: 30, name: "Personal", price_delta: 0, active: true },
        { id: 31, name: "Familiar", price_delta: 6, active: true },
      ],
      modifier_groups: [{
        id: 40,
        branch_id: 1,
        name: "Extras",
        minimum: 0,
        maximum: 4,
        required: false,
        allow_repeats: true,
        max_per_option: 3,
        sort_order: 0,
        modifiers: [{ id: 41, name: "Extra queso", price_delta: 2, active: true, sort_order: 0 }],
      }],
      recipe: [],
      combo_components: [],
    }],
    modifier_groups: [],
    ingredients: [],
    promotions: [],
  };

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/v1/, "");

    if (request.method() === "GET" && path === "/context") {
      return json(route, {
        role: "owner",
        business: {
          id: 1,
          slug: "pizza-house",
          name: "Pizza House",
          status: "active",
          plan: "pro",
          currency: "PEN",
          timezone: "America/Lima",
          modules: { pos: true, cash: true, inventory: true },
        },
        branches: [catalog.branch],
      });
    }
    if (request.method() === "GET" && path === "/catalog") return json(route, catalog);
    if (request.method() === "GET" && path === "/settings/branches/1/delivery") return json(route, {
      version: 1, delivery_mode: "fixed", fixed_delivery_fee: 5, pos_quotes_supported: true,
      delivery_policy: { neighborhoods: [], origin: null, outside_band_mode: "reject" },
    });
    if (request.method() === "POST" && path === "/settings/branches/1/delivery/quotes") {
      const payload = request.postDataJSON();
      expect(payload.expected_configuration_version).toBe(1);
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      return json(route, { id: "orders-delivery-quote", fee: 5, requires_quote: false, configuration_version: 1, expires_at: new Date(Date.now() + 600000).toISOString(), fee_status: "final" }, 201);
    }
    if (request.method() === "GET" && path === "/orders/workspace") {
      workspaceQueries.push(url.searchParams);
      const search = url.searchParams.get("search")?.toLocaleLowerCase("es-PE") || "";
      const items = orders.filter((order) => !search || `${order.folio} ${order.number} ${order.customer_name} ${order.customer_phone}`.toLocaleLowerCase("es-PE").includes(search));
      return json(route, { items, page: 1, page_size: 12, total: items.length, review_count: orders.filter((order) => order.requires_review).length, period: url.searchParams.get("period") || "day", view: url.searchParams.get("view") || "orders" });
    }
    const detailMatch = path.match(/^\/orders\/(\d+)\/detail$/);
    if (request.method() === "GET" && detailMatch) {
      if (failReadsAfterEdit) return route.abort("failed");
      const detail = details.get(Number(detailMatch[1]));
      return detail ? json(route, detail) : json(route, { detail: "Pedido no encontrado", code: "CATALOG_RESOURCE_NOT_FOUND" }, 404);
    }
    const orderMatch = path.match(/^\/orders\/(\d+)$/);
    if (request.method() === "PATCH" && orderMatch) {
      const detail = details.get(Number(orderMatch[1]))!;
      const payload = request.postDataJSON(); editPayloads.push(payload);
      if (options.failFirstEdit && editPayloads.length === 1) return json(route, { detail: "No se pudo guardar. Revisa los datos." }, 422);
      Object.assign(detail.order, payload, { version: detail.order.version + 1, total: payload.expected_total });
      detail.payment_summary.remaining = detail.order.total;
      Object.assign(orders.find((item) => item.id === detail.order.id)!, detail.order);
      return json(route, detail.order);
    }
    if (request.method() === "GET" && orderMatch) return json(route, details.get(Number(orderMatch[1]))!.order);
    const revisionMatch = path.match(/^\/orders\/(\d+)\/item-revisions$/);
    if (request.method() === "POST" && revisionMatch) {
      const payload = request.postDataJSON();
      revisionPayloads.push(payload);
      if (options.failFirstRevision && revisionPayloads.length === 1) return json(route, { detail: "No se pudo guardar la comanda. Inténtalo nuevamente." }, 422);
      const detail = details.get(Number(revisionMatch[1]))!;
      const revisedItems = [];
      for (const operation of payload.operations) {
        const original = detail.order.items.find((item) => item.id === operation.item_id)!;
        if (operation.type === "cancel") {
          original.status = "cancelled";
          Object.assign(original, { cancellation_reason: operation.reason });
          revisedItems.push({ ...original, item_id: original.id });
        } else {
          original.status = "superseded";
          const replacement = operation.replacement;
          const product = catalog.products.find((item) => item.id === replacement.product_id)!;
          const variant = product.variants.find((item) => item.name === replacement.variant_name);
          const unitPrice = product.price + (variant?.price_delta || 0) + replacement.modifiers.reduce((sum: number, modifier: { price_delta: number }) => sum + modifier.price_delta, 0);
          const fresh = { ...original, ...replacement, id: 100 + detail.order.items.length, status: "preparing", unit_price: unitPrice, line_total: unitPrice * replacement.quantity, promotion_discount: 0 };
          detail.order.items.push(fresh);
          revisedItems.push({ ...fresh, item_id: fresh.id });
        }
      }
      detail.order.subtotal = detail.order.items.filter((item) => !["superseded", "cancelled"].includes(item.status)).reduce((sum, item) => sum + item.line_total, 0);
      detail.order.discount = 0;
      detail.order.total = detail.order.subtotal + detail.order.delivery_fee;
      detail.order.version += 1;
      const ticket = { ...detail.tickets[0], id: 90 + detail.tickets.length, sequence: detail.tickets.length + 1, status: "queued", items: revisedItems };
      detail.tickets.push(ticket);
      detail.payment_summary.remaining = detail.order.total;
      return json(route, { order: detail.order, tickets: [ticket] });
    }
    if (request.method() === "POST" && /^\/kitchen\/tickets\/\d+\/print$/.test(path)) return json(route, { print_count: 1 });
    const transitionMatch = path.match(/^\/orders\/(\d+)\/transition$/);
    if (request.method() === "POST" && transitionMatch) {
      const detail = details.get(Number(transitionMatch[1]))!;
      const payload = request.postDataJSON();
      transitionPayloads.push(payload);
      detail.order.status = payload.status;
      Object.assign(detail, { cancellation_reason: payload.reason });
      detail.order.version += 1;
      if (payload.status === "cancelled") {
        detail.tickets.forEach((ticket) => { if (["queued", "preparing"].includes(ticket.status)) ticket.status = "cancelled"; });
      }
      const summary = orders.find((order) => order.id === detail.order.id);
      if (summary) Object.assign(summary, { status: detail.order.status, version: detail.order.version });
      return json(route, detail.order);
    }
    if (request.method() === "POST" && path === "/orders") {
      orderRequestCount += 1;
      createdPayload = request.postDataJSON();
      const createdItems = Array.isArray(createdPayload?.items) ? createdPayload.items as Record<string, unknown>[] : [];
      const subtotal = createdItems.reduce((sum, item) => {
        const variantDelta = item.variant_name === "Familiar" ? 6 : 0;
        const modifierDelta = Array.isArray(item.modifiers)
          ? (item.modifiers as { price_delta?: number }[]).reduce((modifierSum, modifier) => modifierSum + Number(modifier.price_delta || 0), 0)
          : 0;
        return sum + (24 + variantDelta + modifierDelta) * Number(item.quantity || 1);
      }, 0);
      const deliveryFee = Number(createdPayload.delivery_fee || 0);
      const total = subtotal + deliveryFee + Number(options.authoritativeTotalDelta || 0);
      const detail = orderDetail(12, "0012", String(createdPayload?.customer_name || "Cliente de mostrador"), 8);
      detail.order.channel = String(createdPayload.channel || "counter");
      detail.order.status = "draft";
      detail.order.payment_status = "pending";
      detail.order.subtotal = subtotal;
      detail.order.delivery_fee = deliveryFee;
      detail.order.total = total;
      detail.order.version = 1;
      detail.payments = [];
      detail.payment_evidence = [];
      detail.tickets = [];
      detail.payment_summary = { paid: 0, remaining: total };
      details.set(12, detail);
      orders.unshift({
        id: 12,
        folio: detail.order.folio,
        number: "0012",
        customer_name: detail.order.customer_name,
        customer_phone: detail.order.customer_phone,
        channel: detail.order.channel,
        source: "pos",
        created_at: detail.order.created_at,
        status: "draft",
        payment_status: "pending",
        total,
        delivery_fee: deliveryFee,
        requires_review: false,
        item_count: 1,
        version: 1,
      });
      return json(route, { id: 12, folio: detail.order.folio, number: detail.order.number, total, version: 1 }, 201);
    }
    if (request.method() === "GET" && path === "/cash/registers") return json(route, cashRegisters);
    if (request.method() === "GET" && path === "/cash/sessions") return json(route, cashSessions);
    const paymentMatch = path.match(/^\/orders\/(\d+)\/payments$/);
    if (request.method() === "POST" && paymentMatch) {
      const orderId = Number(paymentMatch[1]);
      const detail = details.get(orderId);
      if (!detail) return json(route, { detail: "Pedido no encontrado" }, 404);
      const payload = request.postDataJSON() as Record<string, unknown>;
      paymentPayloads.push(payload);
      paymentIdempotencyKeys.push(request.headers()["idempotency-key"] || "");
      const payment = {
        id: 80 + paymentPayloads.length,
        order_id: orderId,
        method: String(payload.method),
        amount: Number(payload.amount),
        status: "confirmed",
        created_at: new Date().toISOString(),
      };
      detail.payments.push(payment);
      const paid = detail.payments.reduce((sum, item) => sum + Number(item.amount), 0);
      detail.order.payment_status = paid >= detail.order.total ? "paid" : "partial";
      detail.order.version += 1;
      detail.payment_summary = { paid, remaining: Math.max(0, detail.order.total - paid) };
      const summary = orders.find((order) => order.id === orderId);
      if (summary) {
        summary.payment_status = detail.order.payment_status;
        summary.version = detail.order.version;
      }
      if (options.failFirstPaymentResponse && paymentPayloads.length === 1) return route.abort("failed");
      return json(route, { payment, order: detail.order }, 201);
    }
    const confirmMatch = path.match(/^\/orders\/(\d+)\/confirm-and-send$/);
    if (request.method() === "POST" && confirmMatch) {
      const orderId = Number(confirmMatch[1]);
      const detail = details.get(orderId);
      if (!detail) return json(route, { detail: "Pedido no encontrado" }, 404);
      const payload = request.postDataJSON() as Record<string, unknown>;
      confirmPayloads.push(payload);
      confirmIdempotencyKeys.push(request.headers()["idempotency-key"] || "");
      if (options.rejectFirstConfirm && confirmPayloads.length === 1) return json(route, { detail: "Cocina no disponible temporalmente" }, 503);
      detail.order.status = "sent_to_kitchen";
      detail.order.version += 1;
      const ticket = {
        id: 90 + confirmPayloads.length,
        order_id: orderId,
        sequence: detail.tickets.length + 1,
        order_folio: detail.order.folio,
        order_number: detail.order.number,
        station: "kitchen",
        status: "queued",
        items: detail.order.items.map((item) => ({ ...item, item_id: item.id })),
        print_count: 0,
        created_at: new Date().toISOString(),
      };
      detail.tickets.push(ticket);
      const summary = orders.find((order) => order.id === orderId);
      if (summary) {
        summary.status = detail.order.status;
        summary.version = detail.order.version;
      }
      if (options.failFirstConfirmResponse && confirmPayloads.length === 1) return route.abort("failed");
      return json(route, { order: detail.order, tickets: [ticket] });
    }
    return json(route, { detail: `Ruta no simulada: ${request.method()} ${path}` }, 404);
  });

  return {
    orders,
    details,
    workspaceQueries,
    transitionPayloads,
    revisionPayloads,
    editPayloads,
    setFailDetailReads: (value: boolean) => { failReadsAfterEdit = value; },
    paymentPayloads,
    paymentIdempotencyKeys,
    confirmPayloads,
    confirmIdempotencyKeys,
    getCreatedPayload: () => createdPayload,
    getOrderRequestCount: () => orderRequestCount,
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

async function addPersonalPizzaToNewOrder(page: Page) {
  await page.getByRole("button", { name: "Nuevo pedido" }).click();
  const drawer = page.getByRole("dialog", { name: "Agrega un pedido" });
  await drawer.getByRole("button", { name: "Agregar productos" }).click();
  const picker = page.getByRole("dialog", { name: "Agregar productos" });
  await picker.getByRole("button", { name: /Pizza clásica/ }).click();
  const configuration = page.getByRole("dialog", { name: "Pizza clásica" });
  await configuration.getByRole("radio", { name: /Personal/ }).check();
  await configuration.getByRole("button", { name: "Agregar a la selección" }).click();
  await picker.getByRole("button", { name: "Guardar selección" }).click();
  return drawer;
}

test("completed kitchen command shows prepared products in the order detail and reopening clears them", async ({ page }, testInfo) => {
  const mock = await mockOrdersApi(page);
  await page.route("**/api/v1/orders/12/printing", (route) => json(route, { order_id: 12, items: [], recoverable_error: false }));
  let version = 1;
  let failCompletion = true;
  const actions: string[] = [];
  await page.route("**/api/v1/kitchen/commands**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const detail = mock.details.get(12);
    const command = detail?.tickets[0];
    if (request.method() === "GET") {
      const history = url.searchParams.get("view") === "history";
      const active = command && ["queued", "preparing"].includes(command.status);
      const items = command && (history ? !active : active) ? [{ ...command, version }] : [];
      return json(route, { items, total: items.length, page: 1, page_size: 12, active_count: active ? 1 : 0 });
    }
    if (!detail || !command) return json(route, {}, 404);
    expect(request.postDataJSON()).toEqual({ expected_status: command.status, expected_version: version });
    expect(request.headers()["idempotency-key"]).toBeTruthy();
    if (failCompletion) {
      failCompletion = false;
      return json(route, { detail: "No se pudo completar la comanda de prueba." }, 503);
    }
    const action = url.pathname.endsWith("/complete") ? "complete" : "reopen";
    actions.push(action);
    command.status = action === "complete" ? "ready" : "preparing";
    version += 1;
    detail.order.version += 1;
    detail.order.status = command.status;
    return json(route, { command: { ...command, version }, order: detail.order });
  });

  await page.goto("/pedidos");
  const drawer = await addPersonalPizzaToNewOrder(page);
  await drawer.getByRole("button", { name: "Continuar" }).click();
  const checkout = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await checkout.getByRole("checkbox", { name: /Cobrar después/ }).check();
  await checkout.getByRole("button", { name: "Enviar a cocina" }).click();
  const detail = page.getByRole("dialog", { name: "Pedido #8 · #0012" });
  await expect(detail.getByRole("button", { name: /Comanda #1/ })).toBeVisible();
  await page.keyboard.press("Escape");

  async function openDetail() {
    await page.getByRole("tab", { name: "Panel de pedidos", exact: true }).click();
    await page.getByRole("button", { name: /Abrir pedido 8 de/ }).click();
    await detail.getByRole("button", { name: /Comanda #1/ }).click();
  }
  await page.getByRole("tab", { name: "Comandas digitales" }).click();
  await page.getByRole("button", { name: "Completar comanda", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No se pudo completar");
  await openDetail();
  await expect(detail.getByText("Preparado", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Comandas digitales" }).click();
  await page.getByRole("button", { name: "Completar comanda", exact: true }).click();
  await expect.poll(() => actions).toEqual(["complete"]);
  await openDetail();
  await expect(detail.getByText("Preparado", { exact: true })).toBeVisible();
  await expect(detail.getByText("Pago pendiente", { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Imprimir pedido" })).toBeEnabled();
  await expect(detail.getByRole("button", { name: /^Cobrar/ })).toBeEnabled();
  await expect(detail.getByText("Monto restante").locator("..")).toContainText("24 S/");
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await detail.locator(".modal-content").evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: `.impeccable/review/order-command-prepared-${testInfo.project.name}.png`, fullPage: true });
  }
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Comandas digitales" }).click();
  await page.getByRole("button", { name: "Ver historial" }).click();
  await page.getByRole("button", { name: "Devolver a preparación" }).click();
  await expect.poll(() => actions).toEqual(["complete", "reopen"]);
  await openDetail();
  await expect(detail.getByText("Preparado", { exact: true })).toHaveCount(0);
  expect(mock.getOrderRequestCount()).toBe(1);
  expect(mock.confirmPayloads).toHaveLength(1);
  expect(mock.paymentPayloads).toEqual([]);
  expect(mock.transitionPayloads).toEqual([]);
});

test("prepared and cancelled products retain separate badges beside a pending addition", async ({ page }, testInfo) => {
  const mock = await mockOrdersApi(page, { editable: true, completedCommand: true });
  const saved = mock.details.get(8)!;
  const cancelled = { ...saved.order.items[0], id: 92, name: "Pizza cancelada", status: "cancelled", notes: "", modifiers: [] };
  saved.order.items.push(cancelled);
  saved.tickets[0].items.push({ ...cancelled, item_id: cancelled.id });
  const addition = { ...saved.order.items[0], id: 93, name: "Nueva pizza" };
  saved.order.items.push(addition);
  saved.tickets.push({ ...saved.tickets[0], id: 82, sequence: 2, status: "queued", items: [{ ...addition, item_id: addition.id }] });
  saved.order.subtotal = 68;
  saved.order.discount = 8;
  saved.order.total = 60;
  saved.payment_summary.remaining = 60;
  await page.goto("/pedidos");
  await page.getByRole("button", { name: "Abrir pedido 7 de Claudio Rey" }).click();
  const detail = page.getByRole("dialog", { name: "Pedido #7 · #0008" });
  await detail.getByRole("button", { name: /Comanda #1/ }).click();
  await expect(detail.getByText("Preparado", { exact: true })).toHaveCount(2);
  const cancelledLine = detail.locator(".order-breakdown > article").filter({ hasText: "Pizza cancelada" });
  await expect(cancelledLine.getByText("Preparado", { exact: true })).toBeVisible();
  await expect(cancelledLine.getByText("Cancelado", { exact: true })).toBeVisible();
  await expect(cancelledLine.locator(".order-breakdown-heading > strong")).toHaveCSS("text-decoration-line", "line-through");
  await expect(cancelledLine.locator(".order-breakdown-price")).toHaveCSS("text-decoration-line", "line-through");
  await expect(detail.getByRole("button", { name: /Comanda #2/ })).toHaveAttribute("aria-expanded", "false");
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await detail.locator(".modal-content").evaluate((element) => { element.scrollTop = 0; });
    await page.screenshot({ path: `.impeccable/review/order-command-prepared-cancelled-${testInfo.project.name}.png`, fullPage: true });
  }
  await detail.getByRole("button", { name: /Comanda #2/ }).click();
  await expect(detail.getByText("Preparado", { exact: true })).toHaveCount(2);
  expect(mock.paymentPayloads).toEqual([]);
  expect(mock.revisionPayloads).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("shows a responsive order workspace and normalizes the new detail wrapper", async ({ page }) => {
  await mockOrdersApi(page);
  await page.goto("/pedidos");

  await expect(page.getByRole("heading", { name: "Pedidos" })).toBeVisible();
  await expect(page.getByText("1 pedido por revisar")).toBeVisible();
  const compactLayout = (page.viewportSize()?.width || 1280) <= 900;
  const orderTrigger = compactLayout
    ? page.locator(".orders-mobile-cards > button").first()
    : page.getByRole("button", { name: /Abrir pedido 7 de Claudio Rey/ });
  await expect(orderTrigger).toBeVisible();
  if (compactLayout) {
    await expect(page.locator(".orders-desktop-table")).toBeHidden();
  } else {
    await expect(page.getByRole("columnheader", { name: "Estado de pago" })).toBeVisible();
  }
  await orderTrigger.click();
  const detail = page.getByRole("dialog", { name: "Pedido #7 \u00b7 #0008" });
  await expect(detail).toBeVisible();
  await expect(detail.getByText("OP-RECIENTE")).toBeVisible();
  await expect(detail.getByText("OP-ANTERIOR")).toHaveCount(0);
  await expect(detail.getByRole("button", { name: /Cobrar/ })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Agregar productos" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Marcar listo" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: "Cancelar pedido" })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: /Confirmar y enviar/ })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: /Marcar preparando/ })).toHaveCount(0);
  await expect(detail.getByText(/Dividir/)).toHaveCount(0);
  await expect(detail.getByText("2 × Extra queso", { exact: true })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Aprobar pago y preparar" })).toBeVisible();
  await expect(detail.locator(".order-command-expand strong")).toHaveText(["Comanda #1", "Comanda #2"]);
  await expect(detail.getByText("Monto cobrado").locator("..")) .toContainText("20 S/");
  await detail.getByRole("button", { name: "Datos de envío" }).click();
  await expect(detail.getByText("Av. Arequipa 1234, Lince")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toBeHidden();
  await expect(orderTrigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("reference orders panel retains search, Lima dates, payment badges and keyboard detail", async ({ page }, testInfo) => {
  const mock = await mockOrdersApi(page, { editable: true });
  Object.assign(mock.orders[0], { customer_name: "Pepe", created_at: "2026-09-08T20:00:00", total: 66 });
  mock.orders.unshift({ ...mock.orders[0], id: 9, folio: 8, number: "0009", customer_name: "José", channel: "counter", payment_status: "paid", total: 69 });
  await page.goto("/pedidos");
  const list = page.getByRole("region", { name: "Lista de pedidos" });
  await expect(list.locator(".order-payment-badge:visible")).toHaveText(["Pagado", "Pago pendiente"]);
  await expect(list.getByText("69 S/").filter({ visible: true })).toBeVisible();
  await expect(list.getByText("66 S/").filter({ visible: true })).toBeVisible();
  await expect(list.locator("time:visible").first()).toContainText("3:00");
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/reference-orders-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("textbox", { name: "Buscar pedidos" }).fill("Pepe");
  await expect(list.getByText("José").filter({ visible: true })).toHaveCount(0);
  await expect(list.getByText("Pepe").filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Todo el historial", { exact: true })).toBeVisible();
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await expect.poll(() => mock.workspaceQueries.at(-1)?.get("search")).toBe("Pepe");
  expect(mock.workspaceQueries.every((query) => query.get("period") === "all" && query.get("view") === "orders" && !query.has("day"))).toBe(true);
  const row = list.getByRole("button", { name: "Abrir pedido 7 de Pepe" });
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Pedido #7 \u00b7 #0008" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

for (const timezoneId of ["America/Lima", "Asia/Tokyo"]) {
  test.describe(`order timestamp in browser ${timezoneId}`, () => {
    test.use({ timezoneId });
    test("shows September 12 at 22:18 consistently in list, detail and command", async ({ page }) => {
      const mock = await mockOrdersApi(page, { editable: true });
      const created_at = "2026-09-13T03:18:00";
      mock.orders[0].created_at = created_at;
      const saved = mock.details.get(8)!;
      saved.order.created_at = created_at;
      saved.tickets[0].created_at = created_at;
      await page.goto("/pedidos");
      const list = page.getByRole("region", { name: "Lista de pedidos" });
      await expect(list.locator("time:visible").first()).toHaveText(/12 set\., 10:18 p\. m\./);
      await list.getByRole("button", { name: "Abrir pedido 7 de Claudio Rey" }).click();
      const dialog = page.getByRole("dialog", { name: "Pedido #7 · #0008" });
      await expect(dialog.locator(".order-detail-summary")).toContainText(/12 set\., 10:18 p\. m\./);
      await expect(dialog.locator(".order-command-heading").filter({ hasText: "Comanda #1" })).toContainText(/10:18 p\. m\./);
      await expect(dialog).not.toContainText("13 set.");
    });
  });
}

test("creates a delivery command with deferred payment and protects unsaved changes", async ({ page }) => {
  const mock = await mockOrdersApi(page);
  await page.goto("/pedidos");
  await page.getByRole("button", { name: "Nuevo pedido" }).click();

  const drawer = page.getByRole("dialog", { name: "Agrega un pedido" });
  await drawer.getByLabel("Tipo de pedido").selectOption("delivery");
  await drawer.getByLabel("Nombre del cliente").fill("Ana Torres");
  await drawer.getByLabel("Número de teléfono").fill("999888777");
  await drawer.getByLabel("Calle", { exact: true }).fill("Jr. Las Flores");
  await drawer.getByLabel(/^Número casa/).fill("245");
  await drawer.getByLabel("Referencias", { exact: true }).fill("Frente al parque");

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.keyboard.press("Escape");
  await expect(drawer).toBeVisible();

  await drawer.getByRole("button", { name: "Agregar productos" }).click();
  const picker = page.getByRole("dialog", { name: "Agregar productos" });
  await picker.getByPlaceholder("Buscar por nombre o SKU").fill("Pizza clásica");
  await picker.getByRole("button", { name: /Pizza clásica/ }).click();

  const configuration = page.getByRole("dialog", { name: "Pizza clásica" });
  await configuration.getByRole("radio", { name: /Familiar/ }).check();
  await configuration.getByRole("button", { name: "Agregar una unidad de Extra queso" }).click();
  await configuration.getByRole("button", { name: "Agregar una unidad de Extra queso" }).click();
  await expect(configuration.getByLabel("Cantidad de Extra queso")).toHaveText("2");
  await configuration.getByLabel("Nota para cocina").fill("Sin cebolla");
  await configuration.getByRole("button", { name: "Agregar a la selección" }).click();
  await picker.getByRole("button", { name: "Guardar selección" }).click();
  await expect(drawer.getByText("Pizza clásica · Familiar", { exact: true })).toBeVisible();
  await expect(drawer.locator(".new-order-lines").getByText("Extra queso ×2", { exact: true })).toBeVisible();
  await drawer.getByRole("checkbox", { name: "Comentario adicional" }).check();
  await drawer.getByRole("textbox", { name: "Comentario adicional" }).fill("Llamar al llegar");
  await drawer.getByRole("button", { name: "Continuar" }).click();

  const checkout = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await expect(checkout).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.locator(".new-order-drawer")).toHaveAttribute("aria-hidden", "true");
  expect(await page.locator(".new-order-drawer").evaluate((element) => element.hasAttribute("inert"))).toBe(true);
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `.impeccable/review/new-order-payment-${test.info().project.name}.png` });
  }
  await checkout.getByRole("checkbox", { name: /Cobrar después/ }).check();
  await checkout.getByRole("button", { name: "Enviar a cocina" }).click();

  await expect(page.getByText("Comanda enviada a cocina. Pago pendiente.")).toBeVisible();
  const savedDetail = page.getByRole("dialog", { name: "Pedido #8 \u00b7 #0012" });
  await expect(savedDetail).toBeVisible();
  await expect(savedDetail.getByRole("button", { name: /Comanda #1/ })).toHaveAttribute("aria-expanded", "false");
  await expect(savedDetail.getByText("Borrador", { exact: true })).toHaveCount(0);
  await expect(savedDetail.locator(".order-unsent-warning")).toHaveCount(0);
  expect(mock.confirmPayloads).toEqual([{ expected_version: 1 }]);
  expect(mock.paymentPayloads).toHaveLength(0);
  await savedDetail.getByRole("button", { name: "Acciones de la comanda 1" }).click();
  await expect(page.getByRole("menuitem", { name: "Editar productos" })).toBeEnabled();
  await expect(page.getByRole("menuitem", { name: "Imprimir comanda" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(savedDetail.getByRole("button", { name: "Acciones de la comanda 1" })).toBeFocused();
  await expect(savedDetail.getByRole("button", { name: /Confirmar y enviar/ })).toHaveCount(0);
  await expect(savedDetail.getByRole("button", { name: /Marcar preparando/ })).toHaveCount(0);
  await expect(savedDetail.getByText(/Dividir/)).toHaveCount(0);
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.waitForTimeout(250);
    await page.screenshot({ path: `.impeccable/review/order-detail-pending-${test.info().project.name}.png` });
  }
  expect(mock.getCreatedPayload()).toMatchObject({
    branch_id: 1,
    channel: "delivery",
    customer_name: "Ana Torres",
    customer_phone: "999888777",
    delivery_address: { address: "Jr. Las Flores 245", street: "Jr. Las Flores", number: "245", reference: "Frente al parque" },
    delivery_quote_id: "orders-delivery-quote",
    notes: "Llamar al llegar",
    items: [{
      variant_name: "Familiar",
      notes: "Sin cebolla",
      modifiers: [
        { modifier_id: 41, name: "Extra queso", price_delta: 2 },
        { modifier_id: 41, name: "Extra queso", price_delta: 2 },
      ],
    }],
  });

  await savedDetail.getByRole("button", { name: /Cobrar/ }).click();
  const existingOrderCheckout = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await expect(existingOrderCheckout).toBeVisible();
  await expect(existingOrderCheckout.getByRole("checkbox", { name: /Cobrar después/ })).toHaveCount(0);
  await expect(existingOrderCheckout.getByRole("radio", { name: /Efectivo/ })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Pedido #8 \u00b7 #0012" })).toHaveCount(0);
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.waitForTimeout(250);
    await page.screenshot({ path: `.impeccable/review/order-detail-payment-${test.info().project.name}.png` });
  }
  await existingOrderCheckout.getByRole("radio", { name: /Tarjeta/ }).check();
  await existingOrderCheckout.getByRole("button", { name: /Cobrar/ }).click();

  await expect(page.getByText("Pago registrado correctamente.")).toBeVisible();
  const paidDetail = page.getByRole("dialog", { name: "Pedido #8 \u00b7 #0012" });
  await expect(paidDetail.getByText("Comanda #1")).toBeVisible();
  await expect(paidDetail.getByRole("button", { name: /Confirmar y enviar/ })).toHaveCount(0);
  await expect(paidDetail.getByRole("button", { name: /Marcar preparando/ })).toHaveCount(0);
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.waitForTimeout(250);
    await page.screenshot({ path: `.impeccable/review/order-detail-paid-sent-${test.info().project.name}.png` });
  }
  expect(mock.confirmPayloads).toEqual([{ expected_version: 1 }]);
  expect(mock.confirmIdempotencyKeys[0]).toBeTruthy();
});

test("manages order and command menus, delivery metadata, clipboard and print", async ({ page }) => {
  const mock = await mockOrdersApi(page, { editable: true, failFirstEdit: true });
  const printRequests = await mockCompletedManualPrint(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (value: string) => { sessionStorage.setItem("copied-order", value); } } });
    window.open = ((url: string) => { sessionStorage.setItem("contact-url", url); return null; }) as typeof window.open;
    window.print = () => { sessionStorage.setItem("printed-order", document.querySelector(".order-print-document")?.textContent || ""); };
  });
  await page.goto("/pedidos");
  const compact = (page.viewportSize()?.width || 1280) <= 900;
  await (compact ? page.locator(".orders-mobile-cards > button").first() : page.getByRole("button", { name: /Abrir pedido 7 de / })).click();
  const detail = page.getByRole("dialog", { name: "Pedido #7 \u00b7 #0008" });
  await detail.getByRole("button", { name: "Acciones del pedido" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Editar pedido", "Copiar pedido", "Revisar impresión automática", "Contactar cliente", "Cancelar pedido"]);
  await expect(page.getByRole("menuitem", { name: "Editar pedido" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Copiar pedido" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("copied-order"))).toContain("Nombre: Claudio Rey\n\nPara llevar");
  await detail.getByRole("button", { name: "Acciones del pedido" }).click();
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/managed-detail-${test.info().project.name}.png`, animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("button", { name: "Acciones del pedido" })).toBeFocused();
  await detail.getByRole("button", { name: "Acciones del pedido" }).click();
  await page.getByRole("menuitem", { name: "Contactar cliente" }).click();
  expect(await page.evaluate(() => sessionStorage.getItem("contact-url"))).toBe("https://wa.me/51944197385");
  await detail.getByRole("button", { name: /Comanda #1/ }).click();
  await expect(detail.getByText("2 × Extra queso")).toBeVisible();
  await detail.getByRole("button", { name: "Acciones de la comanda 1" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Editar productos", "Imprimir comanda"]);
  await page.getByRole("menuitem", { name: "Imprimir comanda" }).click();
  await expect.poll(() => printRequests.length).toBe(1);
  expect(printRequests[0]).toMatchObject({ orderId: 8, body: { job_type: "kitchen_ticket", kitchen_ticket_id: 81, expected_order_version: 3 } });
  await detail.getByRole("button", { name: "Acciones de la comanda 1" }).click();
  await page.getByRole("menuitem", { name: "Editar productos" }).click();
  await expect(page.getByRole("dialog", { name: /Editar productos/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await detail.getByRole("button", { name: "Acciones del pedido" }).click();
  await page.getByRole("menuitem", { name: "Editar pedido" }).click();
  const editor = page.getByRole("dialog", { name: /^Editar pedido #7\s*#0008$/ });
  await editor.getByLabel("Tipo de pedido").selectOption("delivery");
  await editor.getByLabel("Colonia", { exact: true }).fill("Miraflores");
  await editor.getByLabel("Calle", { exact: true }).fill("Av. Lima");
  await editor.getByLabel("Número (Casa, Depto, edificio)").fill("123");
  await editor.getByLabel("Referencias", { exact: true }).fill("Puerta azul");
  await editor.getByLabel("Costo de envío").fill("6");
  page.once("dialog", (dialog) => dialog.dismiss());
  await editor.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(editor.getByLabel("Calle", { exact: true })).toHaveValue("Av. Lima");
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/managed-editor-${test.info().project.name}.png`, animations: "disabled" });
  if ((page.viewportSize()?.width || 1280) <= 900) {
    await editor.getByRole("button", { name: "Vista previa" }).click();
    await expect(editor.getByLabel("Productos del pedido")).toBeVisible();
    await expect(editor.getByText("Sin cebolla")).toBeVisible();
    if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/managed-preview-${test.info().project.name}.png`, animations: "disabled" });
  }
  await editor.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(editor.getByRole("alert")).toContainText("No se pudo guardar");
  await expect(editor.getByLabel("Calle", { exact: true })).toHaveValue("Av. Lima");
  await editor.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(detail).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Cambios del pedido guardados." })).toBeVisible();
  expect(mock.editPayloads.at(-1)).toMatchObject({ channel: "delivery", delivery_fee: 6, expected_total: 36, delivery_address: { street: "Av. Lima", number: "123", delivery_service: "own" } });
  expect(mock.editPayloads.at(-1)).not.toHaveProperty("items");
  await detail.getByRole("button", { name: "Acciones del pedido" }).click();
  await page.getByRole("menuitem", { name: "Editar pedido" }).click();
  await expect(editor.getByLabel("Costo de envío")).toHaveValue("6");
  await editor.getByLabel("Servicio de entrega").selectOption("rappi");
  await editor.getByLabel("ID de pedido de Rappi").fill("R-42");
  await expect(editor.getByLabel("Calle", { exact: true })).toHaveCount(0);
  await editor.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(detail.getByText("Rappi · R-42")).toBeVisible();
  await detail.getByRole("button", { name: "Imprimir pedido" }).click();
  await expect.poll(() => printRequests.length).toBe(2);
  expect(printRequests[1]).toMatchObject({ orderId: 8, body: { job_type: "customer_receipt", expected_order_version: 5 } });
  await detail.getByRole("button", { name: "Acciones del pedido" }).click();
  await page.getByRole("menuitem", { name: "Cancelar pedido" }).click();
  const cancellation = page.getByRole("dialog", { name: "Cancelar pedido", exact: true });
  await expect(cancellation.getByLabel("Motivo de cancelación")).toHaveAttribute("required", "");
  await expect(cancellation.getByLabel("Motivo de cancelación")).toHaveAttribute("maxlength", "1000");
  await expect(cancellation.getByRole("button", { name: "Confirmar cancelación" })).toBeDisabled();
  await cancellation.getByLabel("Motivo de cancelación").fill("   ");
  await expect(cancellation.getByRole("button", { name: "Confirmar cancelación" })).toBeDisabled();
  expect(mock.transitionPayloads).toEqual([]);
  await cancellation.getByLabel("Motivo de cancelación").fill("  Cliente solicita cancelar el pedido  ");
  await cancellation.getByRole("button", { name: "Confirmar cancelación" }).click();
  await expect(cancellation).toBeHidden();
  await expect(detail.locator(".order-detail-tags").getByText("Cancelado", { exact: true })).toBeVisible();
  await expect(detail.getByRole("region", { name: "Comandas del pedido" }).getByText("Cancelado", { exact: true })).toBeVisible();
  expect(mock.transitionPayloads).toEqual([{ status: "cancelled", expected_version: 5, reason: "Cliente solicita cancelar el pedido" }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("edits command products from the dots menu and preserves staged changes on retry", async ({ page }) => {
  const mock = await mockOrdersApi(page, { editable: true, completedCommand: true, failFirstRevision: true });
  await page.goto("/pedidos");
  await ((page.viewportSize()?.width || 1280) <= 900 ? page.locator(".orders-mobile-cards > button").first() : page.getByRole("button", { name: /Abrir pedido 7 de / })).click();
  const detail = page.getByRole("dialog", { name: "Pedido #7 \u00b7 #0008" });
  await detail.getByRole("button", { name: "Acciones de la comanda 1" }).click();
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/command-actions-${test.info().project.name}.png`, animations: "disabled" });
  await detail.getByRole("menuitem", { name: "Editar productos" }).click();
  const editor = page.getByRole("dialog", { name: "Editar productos de la comanda 1" });
  const trigger = editor.getByRole("button", { name: "Acciones de Pizza clásica", exact: true });
  await trigger.click();
  await expect(editor.getByRole("menuitem")).toHaveText(["Editar", "Cancelar producto"]);
  await expect(editor.getByRole("menuitem", { name: "Editar", exact: true })).toBeFocused();
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/command-products-empty-${test.info().project.name}.png`, animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await editor.getByRole("menuitem", { name: "Editar", exact: true }).click();
  await expect(editor.getByRole("heading", { name: 'Editar "Pizza clásica"' })).toBeFocused();
  await expect(editor.getByLabel("Cantidad de Extra queso")).toHaveText("2");
  await editor.getByRole("radio", { name: /Personal/ }).check();
  await editor.getByLabel("Cantidad de Pizza clásica", { exact: true }).fill("2");
  await editor.getByLabel("Agregar una unidad de Extra queso").click();
  await editor.getByLabel("Nota adicional", { exact: true }).fill("Salsas aparte");
  await trigger.click();
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/command-products-form-${test.info().project.name}.png`, animations: "disabled" });
  await page.keyboard.press("Escape");
  page.once("dialog", (dialog) => dialog.dismiss());
  await editor.getByLabel("Cerrar editor", { exact: true }).click();
  await expect(editor.getByLabel("Nota adicional")).toHaveValue("Salsas aparte");
  await editor.getByRole("button", { name: "Editar producto", exact: true }).click();
  await expect(editor.getByText('"Salsas aparte"')).toBeVisible();
  await expect(editor.getByText("Extra queso ×3")).toBeVisible();
  await trigger.click();
  await editor.getByRole("menuitem", { name: "Editar", exact: true }).click();
  await expect(editor.getByLabel("Cantidad de Extra queso")).toHaveText("3");
  await editor.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("No se pudo guardar la comanda");
  await expect(editor.getByLabel("Nota adicional")).toHaveValue("Salsas aparte");
  await editor.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(mock.revisionPayloads).toHaveLength(2);
  expect(mock.revisionPayloads[1]).toMatchObject({ expected_version: 3, operations: [{ type: "edit", item_id: 91, replacement: { product_id: 20, quantity: 2, variant_name: "Personal", notes: "Salsas aparte", modifiers: [{ modifier_id: 41 }, { modifier_id: 41 }, { modifier_id: 41 }] } }] });
  await expect(detail.getByRole("button", { name: /Comanda #2/ })).toBeVisible();
  await detail.getByRole("button", { name: "Acciones de la comanda 2" }).click();
  await detail.getByRole("menuitem", { name: "Editar productos" }).click();
  const reopened = page.getByRole("dialog", { name: "Editar productos de la comanda 2" });
  await reopened.getByRole("button", { name: "Acciones de Pizza clásica", exact: true }).click();
  await reopened.getByRole("menuitem", { name: "Cancelar producto" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Cancelar producto" });
  await expect(confirmation.getByLabel("Motivo")).toBeFocused();
  await expect(confirmation.getByRole("button", { name: "Cancelar producto", exact: true })).toBeDisabled();
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/command-products-cancel-${test.info().project.name}.png`, animations: "disabled" });
  await confirmation.getByRole("button", { name: "Regresar" }).click();
  await reopened.getByRole("button", { name: "Acciones de Pizza clásica", exact: true }).click();
  await reopened.getByRole("menuitem", { name: "Cancelar producto" }).click();
  await confirmation.getByLabel("Motivo").fill("Producto solicitado por error");
  await confirmation.getByRole("button", { name: "Cancelar producto", exact: true }).click();
  await expect(reopened.getByRole("alert")).toContainText('Para cancelar todos los productos, usa “Cancelar pedido”');
  await expect(reopened.getByRole("button", { name: "Guardar", exact: true })).toBeDisabled();
  await expect(reopened).toBeVisible();
  expect(mock.revisionPayloads).toHaveLength(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("keeps a confirmed edit visible when a secondary detail read fails", async ({ page }) => {
  const mock = await mockOrdersApi(page, { editable: true });
  await page.goto("/pedidos");
  await ((page.viewportSize()?.width || 1280) <= 900 ? page.locator(".orders-mobile-cards > button").first() : page.getByRole("button", { name: /Abrir pedido 7 de / })).click();
  const detail = page.getByRole("dialog", { name: "Pedido #7 \u00b7 #0008" });
  await detail.getByRole("button", { name: "Acciones del pedido" }).click();
  await page.getByRole("menuitem", { name: "Editar pedido" }).click();
  const editor = page.getByRole("dialog", { name: /^Editar pedido #7\s*#0008$/ });
  await editor.getByLabel("Nombre de cliente").fill("Nombre guardado");
  mock.setFailDetailReads(true);
  await editor.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(detail.getByRole("heading", { name: "Nombre guardado" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Cambios del pedido guardados." })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(mock.editPayloads).toHaveLength(1);
});

test("previews configured products with notes and repeated options at every size", async ({ page }) => {
  await mockOrdersApi(page);
  await page.goto("/pedidos");
  const drawer = await addPersonalPizzaToNewOrder(page);
  await drawer.getByRole("button", { name: "Editar productos", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Agregar productos", exact: true });
  await picker.getByRole("button", { name: /Pizza clásica/ }).first().click();
  const configuration = page.getByRole("dialog", { name: "Pizza clásica", exact: true });
  await configuration.getByRole("radio", { name: /Familiar/ }).check();
  await configuration.getByRole("button", { name: "Agregar una unidad de Extra queso" }).click();
  await configuration.getByRole("button", { name: "Agregar una unidad de Extra queso" }).click();
  await configuration.getByLabel("Nota para cocina").fill("Las salsas van aparte");
  await configuration.getByRole("button", { name: "Agregar a la selección" }).click();
  await picker.getByRole("button", { name: "Guardar selección" }).click();
  if ((page.viewportSize()?.width || 1280) <= 900) await drawer.getByRole("button", { name: "Vista previa" }).click();
  const preview = drawer.getByLabel("Vista previa del pedido");
  await expect(preview.getByText("Las salsas van aparte")).toBeVisible();
  await expect(preview.getByText("2 × Extra queso")).toBeVisible();
  await expect(preview.getByRole("heading", { name: "Extras" })).toBeVisible();
  expect(await preview.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
  if (process.env.IMPECCABLE_REVIEW === "1") await page.screenshot({ path: `.impeccable/review/detailed-new-preview-${test.info().project.name}.png`, animations: "disabled" });
});

test("registers the order total as cash and shows the correct change", async ({ page }) => {
  const mock = await mockOrdersApi(page);
  await page.goto("/pedidos");
  const drawer = await addPersonalPizzaToNewOrder(page);
  await drawer.getByRole("button", { name: "Continuar" }).click();

  const checkout = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await checkout.getByRole("radio", { name: /Múltiples métodos/ }).check();
  await checkout.getByLabel("Cobrado con Tarjeta").fill("20");
  await checkout.getByLabel("Cobrado con Transferencia bancaria").fill("20");
  await expect(checkout.getByRole("alert")).toHaveText("Lo cobrado por medios distintos al efectivo no puede exceder el total.");
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `.impeccable/review/new-order-payment-multiple-error-${test.info().project.name}.png` });
  }
  await checkout.getByRole("radio", { name: /Efectivo/ }).check();
  await expect(checkout.getByText("Caja principal")).toBeVisible();
  await checkout.getByLabel("Cantidad recibida").fill("50");
  await expect(checkout.getByText("Cambio", { exact: true }).locator("..")).toContainText("S/ 26.00");
  if (process.env.IMPECCABLE_REVIEW === "1") {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `.impeccable/review/new-order-payment-cash-${test.info().project.name}.png` });
  }
  await checkout.getByRole("button", { name: /Cobrar/ }).click();

  await expect(page.getByText("Pedido pagado y enviado a cocina.")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Pedido #8 \u00b7 #0012" })).toBeVisible();
  expect(mock.paymentPayloads).toHaveLength(1);
  expect(mock.paymentPayloads[0]).toMatchObject({
    method: "cash",
    amount: 24,
    cash_session_id: 301,
    expected_version: 1,
  });
  expect(String(mock.paymentPayloads[0].note)).toContain("Efectivo recibido: 50.00 PEN");
  expect(String(mock.paymentPayloads[0].note)).toContain("Cambio: 26.00 PEN");
  expect(mock.paymentIdempotencyKeys[0]).toBeTruthy();
  expect(mock.confirmPayloads).toEqual([{ expected_version: 2 }]);
  expect(mock.confirmIdempotencyKeys[0]).toBeTruthy();
});

test("requires choosing a cash session when more than one is open", async ({ page }) => {
  const mock = await mockOrdersApi(page, {
    cashRegisters: [
      { id: 91, name: "Caja principal", active: true },
      { id: 92, name: "Caja terraza", active: true },
    ],
    cashSessions: [
      { id: 301, register_id: 91, status: "open" },
      { id: 302, register_id: 92, status: "open" },
    ],
  });
  await page.goto("/pedidos");
  const drawer = await addPersonalPizzaToNewOrder(page);
  await drawer.getByRole("button", { name: "Continuar" }).click();

  const checkout = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await checkout.getByRole("radio", { name: /Efectivo/ }).check();
  await checkout.getByLabel("Cantidad recibida").fill("24");
  const sessionSelect = checkout.getByLabel("Turno de caja");
  await expect(sessionSelect).toHaveValue("");
  await checkout.getByRole("button", { name: /Cobrar/ }).click();
  await expect(checkout.getByRole("alert")).toContainText("Selecciona la caja donde registrarás el cobro en efectivo");
  await expect(sessionSelect).toHaveAttribute("aria-invalid", "true");

  await sessionSelect.selectOption("302");
  await checkout.getByRole("button", { name: /Cobrar/ }).click();
  await expect(page.getByText("Pedido pagado y enviado a cocina.")).toBeVisible();
  expect(mock.paymentPayloads).toMatchObject([{ method: "cash", cash_session_id: 302 }]);
  expect(mock.confirmPayloads).toEqual([{ expected_version: 2 }]);
});

test("opens the saved order when a payment response is lost", async ({ page }) => {
  const mock = await mockOrdersApi(page, { failFirstPaymentResponse: true });
  await page.goto("/pedidos");
  const drawer = await addPersonalPizzaToNewOrder(page);
  await drawer.getByRole("button", { name: "Continuar" }).click();

  const checkout = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await checkout.getByRole("radio", { name: /Tarjeta/ }).check();
  await checkout.getByRole("button", { name: /Cobrar/ }).click();

  await expect(page.getByText(/El pedido se guardó, pero el cobro no terminó/)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Pedido #8 \u00b7 #0012" })).toBeVisible();
  expect(mock.getOrderRequestCount()).toBe(1);
  expect(mock.paymentPayloads).toHaveLength(1);
});

test("shows the authoritative kitchen state when confirmation response is lost", async ({ page }) => {
  const mock = await mockOrdersApi(page, { failFirstConfirmResponse: true });
  await page.goto("/pedidos");
  const drawer = await addPersonalPizzaToNewOrder(page);
  await drawer.getByRole("button", { name: "Continuar" }).click();

  const checkout = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await checkout.getByRole("radio", { name: /Tarjeta/ }).check();
  await checkout.getByRole("button", { name: /Cobrar/ }).click();

  await expect(page.getByText("Pedido pagado y enviado a cocina.")).toBeVisible();
  const detail = page.getByRole("dialog", { name: "Pedido #8 \u00b7 #0012" });
  await expect(detail.getByText("Comanda #1")).toBeVisible();
  await expect(detail.getByRole("button", { name: /Confirmar y enviar/ })).toHaveCount(0);
  await expect(detail.getByRole("button", { name: /Marcar preparando/ })).toHaveCount(0);
  expect(mock.confirmPayloads).toHaveLength(1);
  expect(mock.confirmIdempotencyKeys[0]).toBeTruthy();
});

test("recovers a failed deferred command on the same order without charging or duplicating", async ({ page }) => {
  const mock = await mockOrdersApi(page, { rejectFirstConfirm: true });
  await page.goto("/pedidos");
  const drawer = await addPersonalPizzaToNewOrder(page);
  await drawer.getByRole("button", { name: "Continuar" }).click();
  const checkout = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await checkout.getByRole("checkbox", { name: /Cobrar después/ }).check();
  await checkout.getByRole("button", { name: "Enviar a cocina" }).click();
  const detail = page.getByRole("dialog", { name: "Pedido #8 \u00b7 #0012" });
  await expect(page.getByText(/No pudimos confirmar el envío a cocina/)).toBeVisible();
  await expect(detail.getByRole("button", { name: "Acciones de la comanda 1" })).toHaveCount(0);
  await expect(detail.getByText(/Estos productos todavía no se enviaron/)).toBeVisible();
  await detail.getByRole("button", { name: "Enviar a cocina" }).click();
  await expect(detail.getByRole("button", { name: /Comanda #1/ })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Enviar a cocina" })).toHaveCount(0);
  await expect(detail.getByText("Pago pendiente", { exact: true })).toBeVisible();
  expect(mock.getOrderRequestCount()).toBe(1);
  expect(mock.paymentPayloads).toHaveLength(0);
  expect(mock.confirmPayloads).toEqual([{ expected_version: 1 }, { expected_version: 1 }]);
  await detail.getByRole("button", { name: "Acciones de la comanda 1" }).click();
  await page.getByRole("menuitem", { name: "Editar productos" }).click();
  await expect(page.getByRole("dialog", { name: /Editar productos de la comanda/ })).toBeVisible();
});

test("reconciles a lost deferred confirmation without leaving a stale error", async ({ page }) => {
  const mock = await mockOrdersApi(page, { failFirstConfirmResponse: true });
  await page.goto("/pedidos");
  const drawer = await addPersonalPizzaToNewOrder(page);
  await drawer.getByRole("button", { name: "Continuar" }).click();
  const checkout = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await checkout.getByRole("checkbox", { name: /Cobrar después/ }).check();
  await checkout.getByRole("button", { name: "Enviar a cocina" }).click();
  await expect(page.getByText("Comanda enviada a cocina. Pago pendiente.")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Pedido #8 \u00b7 #0012" }).getByText("Comanda #1")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(mock.getOrderRequestCount()).toBe(1);
  expect(mock.paymentPayloads).toHaveLength(0);
  expect(mock.confirmPayloads).toHaveLength(1);
});

test("ignores a second confirmation fired before the busy state renders", async ({ page }) => {
  const mock = await mockOrdersApi(page);
  await page.goto("/pedidos");
  const drawer = await addPersonalPizzaToNewOrder(page);
  await drawer.getByRole("button", { name: "Continuar" }).click();

  const checkout = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await checkout.getByRole("radio", { name: /Tarjeta/ }).check();
  const confirmButton = checkout.getByRole("button", { name: /Cobrar/ });
  await confirmButton.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });

  await expect(page.getByText("Pedido pagado y enviado a cocina.")).toBeVisible();
  expect(mock.getOrderRequestCount()).toBe(1);
  expect(mock.paymentPayloads).toHaveLength(1);
  expect(mock.confirmPayloads).toHaveLength(1);
});

test("chains versions when the customer pays with multiple methods", async ({ page }) => {
  const mock = await mockOrdersApi(page);
  await page.goto("/pedidos");
  const drawer = await addPersonalPizzaToNewOrder(page);
  await drawer.getByRole("button", { name: "Continuar" }).click();

  const checkout = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await checkout.getByRole("radio", { name: /Múltiples métodos/ }).check();
  await checkout.getByLabel("Cobrado con Tarjeta").fill("10");
  await checkout.getByLabel("Cobrado con Transferencia bancaria").fill("14");
  await checkout.getByRole("button", { name: /Cobrar/ }).click();

  await expect(page.getByText("Pedido pagado y enviado a cocina.")).toBeVisible();
  expect(mock.paymentPayloads).toMatchObject([
    { method: "card", amount: 10, expected_version: 1 },
    { method: "transfer", amount: 14, expected_version: 2 },
  ]);
  expect(new Set(mock.paymentIdempotencyKeys).size).toBe(2);
  expect(mock.confirmPayloads).toEqual([{ expected_version: 3 }]);
});

test("stops before charging when the API returns a different total", async ({ page }) => {
  const mock = await mockOrdersApi(page, { authoritativeTotalDelta: -4 });
  await page.goto("/pedidos");
  const drawer = await addPersonalPizzaToNewOrder(page);
  await drawer.getByRole("button", { name: "Continuar" }).click();

  const checkout = page.getByRole("dialog", { name: "Cobrar al cliente" });
  await checkout.getByRole("radio", { name: /Tarjeta/ }).check();
  await checkout.getByRole("button", { name: /Cobrar/ }).click();

  await expect(page.getByText("El total cambió al aplicar las reglas del pedido. Revísalo antes de cobrar.")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Pedido #8 \u00b7 #0012" })).toBeVisible();
  expect(mock.paymentPayloads).toHaveLength(0);
});
