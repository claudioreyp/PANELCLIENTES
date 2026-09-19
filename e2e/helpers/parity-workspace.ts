import { expect, test as base, type Route } from "@playwright/test";
import { historyAreas, historyDetail, historyTables, historyWorkspace } from "./table-history-data";

export const PARITY_DAY = "2026-09-09";
export const PARITY_ORDER = "Abrir pedido 7 de Cliente de prueba";

const branch = {
  id: 1, business_id: 1, slug: "matriz", name: "Matriz", active: true,
  opening_hours: {}, accepted_payment_methods: ["cash", "card", "yape"],
  delivery_enabled: true, takeaway_enabled: true, dine_in_enabled: true, delivery_fee: 0,
};
const business = {
  id: 1, slug: "restaurante-parity", name: "Restaurante de prueba", status: "active", plan: "pro",
  currency: "PEN", country_code: "PE", timezone: "America/Lima", version: 1,
  modules: { pos: true, cash: true, inventory: true },
};
const channels = ["pos_tables", "pos_counter", "pos_takeaway", "pos_delivery", "digital_tables", "digital_takeaway", "digital_delivery"];
const extras = {
  id: 40, branch_id: 1, name: "Extras", internal_label: "Opcionales", minimum: 0, maximum: 1,
  required: false, allow_repeats: false, max_per_option: 1, sort_order: 0,
  modifiers: [{ id: 41, name: "Extra queso", price_delta: 2, available: true, active: true, sort_order: 0 }],
};
const catalog = {
  branch,
  categories: [{ id: 10, name: "Carta", color: "#718078", active: true, sort_order: 0 }],
  products: [
    { id: 20, name: "Pizza cl\u00e1sica", price: 24, preparation_station: "kitchen", modifier_groups: [extras] },
    { id: 21, name: "Limonada", price: 8, preparation_station: "bar", modifier_groups: [] },
  ].map((product, index) => ({
    ...product, category_id: 10, sku: `PARITY-${product.id}`, description: "Producto de prueba",
    image_url: null, available: true, track_stock: false, product_type: "standard",
    service_channels: channels, sort_order: index, variants: [], recipe: [], combo_components: [],
  })),
  modifier_groups: [extras], ingredients: [], promotions: [],
};

const items = catalog.products.map((product, index) => ({
  id: 91 + index, product_id: product.id, name: product.name, quantity: 1,
  unit_price: product.price, line_total: product.price, status: "preparing", modifiers: [],
  notes: index === 0 ? "Sin cebolla" : null,
}));
const order = {
  id: 8, folio: 7, number: "0008", business_id: 1, branch_id: 1, channel: "takeaway", source: "pos",
  customer_name: "Cliente de prueba", customer_phone: null, status: "preparing",
  payment_status: "pending", payment_method: "cash", subtotal: 32, discount: 0,
  delivery_fee: 0, total: 32, version: 2, created_at: `${PARITY_DAY}T14:55:00-05:00`, items,
};
const tickets = items.map((item, index) => ({
  id: 81 + index, business_id: 1, branch_id: 1, order_id: 8, order_folio: order.folio, order_number: order.number,
  sequence: index + 1, station: index === 0 ? "kitchen" : "bar", status: "preparing",
  channel: order.channel, source: order.source, customer_name: order.customer_name,
  created_by: "Equipo de prueba", kind: "original", print_count: 0,
  created_at: `${PARITY_DAY}T14:${55 + index}:00-05:00`,
  items: [{ ...item, item_id: item.id }],
}));
const register = { id: 7, name: "Caja Principal", active: true, is_default: true };
const cut = {
  id: 3741, number: 3741, register, closed_at: "2026-09-08T23:00:00-05:00",
  created_by: "Equipo de prueba", retained_fund_amount: 20, cash_withdrawn_amount: 0,
  total_expected_amount: 20, total_difference: 0, result: "balanced", notes: null,
  methods: [{ key: "cash", label: "Efectivo", counted: 20, expected: 20, difference: 0, transactions: [] }],
};

function dashboard(url: URL, empty: boolean) {
  const hourly = url.searchParams.get("date_from") === url.searchParams.get("date_to");
  return {
    branch_id: 1, date_from: url.searchParams.get("date_from"), date_to: url.searchParams.get("date_to"),
    sales: empty ? 0 : 32, orders: empty ? 0 : 1, shipping: 0, average_ticket: empty ? 0 : 32,
    granularity: hourly ? "hour" : "day",
    // Nonempty zero buckets reproduce the API contract, not an artificially empty series.
    series: Array.from({ length: hourly ? 16 : 7 }, (_, index) => ({
      key: hourly ? `${String(index).padStart(2, "0")}:00` : `2026-09-${String(index + 3).padStart(2, "0")}`,
      sales: !empty && index === 6 ? 32 : 0, orders: !empty && index === 6 ? 1 : 0, shipping: 0,
    })),
    weekdays: hourly ? [] : ["Lunes", "Martes", "Mi\u00e9rcoles", "Jueves", "Viernes", "S\u00e1bado", "Domingo"].map((name, index) => ({ name, sales: !empty && index === 2 ? 32 : 0 })),
    channels: ["Punto de venta", "Men\u00fa digital", "WhatsApp"].map((name, index) => ({ name, sales: !empty && index === 0 ? 32 : 0, orders: !empty && index === 0 ? 1 : 0 })),
    services: [{ name: "Para llevar / Para recoger", sales: empty ? 0 : 32 }],
    payment_methods: [],
    top_products: empty ? [] : [{ name: "Pizza cl\u00e1sica", quantity: 1, sales: 24 }],
    bottom_products: empty ? [] : [{ name: "Limonada", quantity: 1, sales: 8 }],
  };
}

type RequestRecord = { method: string; path: string; query: string };
type ParityMock = {
  emptyDay: boolean;
  tableHistory: boolean;
  workspaceContract: "complete" | "missing_echo" | "unsupported";
  reads: RequestRecord[];
  violations: string[];
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

export const test = base.extend<{ parityMock: ParityMock }>({
  parityMock: [async ({ context, page, baseURL }, use) => {
    if (baseURL !== "http://127.0.0.1:5175") throw new Error("Parity only runs against the isolated local Playwright server on port 5175.");
    const origin = new URL(baseURL).origin;
    const state: ParityMock = { emptyDay: false, tableHistory: false, workspaceContract: "complete", reads: [], violations: [] };
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.setFixedTime(new Date(`${PARITY_DAY}T20:00:00Z`));
    await context.addInitScript(() => {
      localStorage.setItem("impulsa.authMode", "dev");
      localStorage.setItem("impulsa.businessId", "1");
      localStorage.setItem("impulsa.branchId", "1");
    });
    // Neither API realtime nor Vite HMR connects to a server in this isolated context.
    await context.routeWebSocket(/.*/, (socket) => {
      const url = new URL(socket.url());
      if (url.pathname === "/api/v1/ws/branches/1") socket.send(JSON.stringify({ event: "connected" }));
      else if (url.host !== new URL(origin).host) state.violations.push(`Unexpected WebSocket: ${url.origin}${url.pathname}`);
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      const apiPath = path.startsWith("/api/v1/") ? path.slice("/api/v1".length) : null;

      if (method === "OPTIONS" && apiPath) return route.fulfill({ status: 204 });
      if (!["GET", "HEAD"].includes(method)) {
        state.violations.push(`Blocked write: ${method} ${path}`);
        return json(route, { detail: "Parity is read-only; no mutation was sent." }, 405);
      }
      if (apiPath) {
        state.reads.push({ method, path: apiPath, query: url.search });
        if (apiPath === "/context") return json(route, { role: "owner", roles: ["owner", "manager"], business, branches: [branch] });
        if (apiPath === "/catalog") return json(route, catalog);
        if (apiPath === "/catalog/promotions") return json(route, []);
        if (apiPath === "/reports/dashboard") return json(route, dashboard(url, state.emptyDay));
        if (apiPath === "/orders/workspace") {
          if (state.workspaceContract === "unsupported") return json(route, { detail: "Unsupported workspace contract", code: "API_CONTRACT_UNSUPPORTED" }, 404);
          if (state.tableHistory) {
            const response = historyWorkspace(url);
            return json(route, state.workspaceContract === "missing_echo" ? { ...response, period: undefined, view: undefined } : response);
          }
          const search = (url.searchParams.get("search") || "").toLocaleLowerCase("es-PE");
          const day = url.searchParams.get("day");
          const matches = !state.emptyDay && (!day || day === PARITY_DAY) && `${order.folio} ${order.number} ${order.customer_name}`.toLocaleLowerCase("es-PE").includes(search);
          const rows = matches ? [{ ...order, item_count: items.length, requires_review: false }] : [];
          return json(route, { items: rows, total: rows.length, review_count: 0, page: 1, page_size: 12, period: url.searchParams.get("period") || "day", view: url.searchParams.get("view") || "orders" });
        }
        const historicalDetail = apiPath.match(/^\/orders\/(\d+)\/detail$/);
        if (state.tableHistory && historicalDetail) {
          const detail = historyDetail(Number(historicalDetail[1]));
          return json(route, detail || { detail: "Order not found in this branch" }, detail ? 200 : 404);
        }
        if (apiPath === "/orders/8/detail") return json(route, { order, payments: [], payment_evidence: [], tickets, payment_summary: { paid: 0, remaining: 32 } });
        if (apiPath === "/kitchen/commands") {
          const view = url.searchParams.get("view") || "active";
          const visible = state.emptyDay || view === "history" ? [] : tickets;
          return json(route, { items: visible, total: visible.length, active_count: state.emptyDay ? 0 : tickets.length, page: 1, page_size: 12, view });
        }
        if (apiPath === "/areas") return json(route, state.tableHistory ? historyAreas : []);
        if (apiPath === "/tables") return json(route, state.tableHistory ? historyTables : []);
        if (apiPath === "/cash/registers") return json(route, [register]);
        if (apiPath === "/cash/registers/7/cut-preview") return json(route, {
          register, session_id: 33, version: 1, period_started_at: cut.closed_at, opening_fund: 20,
          has_card_activity: false, transfer_expected_amount: 0, pending_orders: [], pending_order_count: 0,
        });
        if (apiPath === "/cash/cuts") return json(route, { items: [cut], total: 1, page: 1, page_size: 10 });
        if (apiPath === "/cash/cuts/3741") return json(route, cut);
        if (apiPath === "/cash/registers/7/movements") return json(route, { items: [], total: 0, page: 1, page_size: 10 });
        if (apiPath === "/settings/business") return json(route, business);
        if (apiPath === "/settings/branches/1/profile") return json(route, {
          id: 1, alias: branch.name, address: "Av. de prueba 123, Lima", maps_url: "", google_place_id: "",
          latitude: null, longitude: null, logo_url: null, cover_url: null, active: true, version: 1,
        });
        if (apiPath === "/settings/branches/1/delivery") return json(route, {
          version: 1, mode: "fixed", fixed_fee: 8, base_fee: 0, per_km_fee: 0, max_distance_km: 10,
          free_over_enabled: false, free_over_amount: 0, minimum_enabled: false, minimum_amount: 0, radii: [], google_routes_configured: false,
        });
        if (apiPath === "/settings/branches/1/services") return json(route, {
          branch_id: 1, ...Object.fromEntries(channels.map((channel) => [channel, true])), version: 1,
        });
        state.violations.push(`Unmocked API read: ${method} ${apiPath}`);
        return json(route, { detail: "Missing parity fixture" }, 404);
      }

      // Only static app assets/documents and public font assets may leave the route handler.
      const staticType = ["document", "script", "stylesheet", "image", "font", "other"].includes(request.resourceType());
      const appAsset = url.origin === origin && staticType;
      const fontAsset = url.protocol === "https:" && (
        (url.hostname === "fonts.googleapis.com" && /^\/css2?$/.test(path) && request.resourceType() === "stylesheet")
        || (url.hostname === "fonts.gstatic.com" && path.startsWith("/s/") && request.resourceType() === "font")
      );
      if (appAsset || fontAsset) return route.continue();
      state.violations.push(`Blocked nonfixture request: ${method} ${url.origin}${path}`);
      return route.abort("blockedbyclient");
    });

    await use(state);
    expect(state.violations, "Every API read must be mocked and all writes must remain blocked").toEqual([]);
    expect(errors, "No unhandled browser errors").toEqual([]);
  }, { auto: true }],
});

export { expect };
