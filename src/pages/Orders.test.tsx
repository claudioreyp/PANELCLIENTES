import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";
import type { OrderDetail, RestaurantTable } from "../types";
import { OrdersPage } from "./Orders";

const tenant = vi.hoisted(() => ({ branch: { id: 1 }, context: { role: "owner", business: { timezone: "America/Lima" } } }));
vi.mock("../lib/tenant", () => ({ useTenant: () => tenant }));
vi.mock("../lib/api", async (original) => ({ ...await original<typeof import("../lib/api")>(), api: vi.fn() }));
vi.mock("../lib/hooks", async (original) => ({ ...await original<typeof import("../lib/hooks")>(), useBranchRealtime: vi.fn() }));

const table = (branchId: number): RestaurantTable => ({ id: branchId * 100, branch_id: branchId, area_id: branchId * 10, code: `M${branchId}`, name: `Mesa ${branchId}`, capacity: 4, position_x: 28, position_y: 28, width: 92, height: 76, shape: "square", status: "occupied", active_order_id: branchId * 700, version: 1 });
const order = (branchId: number): OrderDetail => ({ id: branchId * 700, business_id: 1, branch_id: branchId, table_id: branchId * 100, number: `TEST-${branchId}`, folio: branchId, version: 1, channel: "dine_in", source: "pos", status: "preparing", payment_status: "pending", subtotal: 24, discount: 0, delivery_fee: 0, total: 24, paid_amount: 0, remaining_amount: 24, created_at: "2026-09-12T12:00:00Z", checkout_started_at: null, payments: [], kitchen_tickets: [], items: [{ id: branchId, product_id: 20, name: "Pizza", quantity: 1, unit_price: 24, line_total: 24, modifiers: [], status: "pending" }] });

function mockReads({ available = false, detail = (id: number) => order(id / 700) }: { available?: boolean; detail?: (id: number) => OrderDetail | Promise<OrderDetail> } = {}) {
  return async (path: string) => {
    const url = new URL(path, "http://test.invalid");
    const branchId = Number(url.searchParams.get("branch_id") || tenant.branch.id);
    if (url.pathname === "/orders/workspace") return { period: url.searchParams.get("period"), view: url.searchParams.get("view"), items: [], total: 0, review_count: 0, page: 1, page_size: 12 };
    if (url.pathname === "/catalog") return { branch: { id: branchId }, categories: [], products: [], modifier_groups: [], ingredients: [], promotions: [] };
    if (url.pathname === "/areas") return [{ id: branchId * 10, branch_id: branchId, name: `Sala ${branchId}`, sort_order: 0 }];
    if (url.pathname === "/tables") return [{ ...table(branchId), ...(available ? { status: "available", active_order_id: null } : {}) }];
    const match = url.pathname.match(/^\/orders\/(\d+)\/detail$/);
    if (match) return detail(Number(match[1]));
    throw new Error(`Unexpected read ${path}`);
  };
}

const app = () => <StrictMode><MemoryRouter><OrdersPage /></MemoryRouter></StrictMode>;
async function requestCancellation() {
  fireEvent.click(screen.getByRole("button", { name: "Acciones de la mesa" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Cancelar pedido" }));
  return screen.findByRole("dialog", { name: "Cancelar pedido" });
}
async function openAccount(branchId = 1, available = false) {
  fireEvent.click(screen.getByRole("tab", { name: "Panel de mesas" }));
  fireEvent.click(await screen.findByRole("button", { name: `Mesa ${branchId}, ${available ? "Libre" : "Ocupada"}, capacidad 4` }));
  if (available) fireEvent.click(screen.getByRole("button", { name: "Abrir mesa" }));
  else {
    await screen.findByRole("button", { name: "Acciones de la mesa" });
    return screen.getByRole("dialog", { name: `Cuenta de Mesa ${branchId}` });
  }
}
async function reopenAccount() {
  fireEvent.click(screen.getByRole("button", { name: "Acciones de la mesa" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Reabrir mesa" }));
}
beforeEach(() => { tenant.branch = { id: 1 }; });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("order detail actions and dismissal", () => {
  const detailOrder = (overrides: Partial<OrderDetail> = {}): OrderDetail => ({
    ...order(1), table_id: null, channel: "counter", status: "ready", ...overrides,
  });
  const paidOrder = (overrides: Partial<OrderDetail> = {}) => detailOrder({
    payment_status: "paid", paid_amount: 24, remaining_amount: 0, ...overrides,
  });
  const writes = () => vi.mocked(api).mock.calls.filter(([, options]) => !["GET", "HEAD"].includes(options?.method ?? "GET"));

  async function openDetail(saved: OrderDetail) {
    const reads = mockReads({ detail: () => saved });
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (options?.method && options.method !== "GET") throw new Error(`Unexpected write ${path}`);
      if (path.startsWith("/orders/workspace?")) return {
        ...await reads(path), items: [{ ...saved, item_count: 1, requires_review: false }], total: 1,
      };
      return reads(path);
    });
    render(app());
    const trigger = (await screen.findAllByRole("button", { name: "Abrir pedido 1 de cliente sin nombre" }))[0];
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Pedido #1 · #TEST-1" });
    await within(dialog).findByText("Monto cobrado");
    return { dialog, trigger };
  }

  it.each(["2026-09-13T03:18:00", "2026-09-13T03:18:00Z", "2026-09-12T22:18:00-05:00"])("shows the real Lima day and time in order detail for %s", async (created_at) => {
    const { dialog } = await openDetail(paidOrder({ created_at }));
    expect(within(dialog).getByText(/12 set\., 10:18 p\. m\./)).toBeVisible();
    expect(within(dialog).queryByText(/13 set\./)).toBeNull();
    expect(writes()).toEqual([]);
  });

  it.each([
    { status: "ready", channel: "counter" },
    { status: "ready", channel: "takeaway" },
    { status: "delivered", channel: "delivery" },
  ])("omits the close-operation button and empty footer for paid $status/$channel orders", async (state) => {
    const { dialog } = await openDetail(paidOrder(state));
    expect(within(dialog).getByText("Pagado")).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: "Cerrar operación" })).toBeNull();
    expect(dialog.querySelector(".order-detail-tools")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /^Cobrar/ })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Imprimir pedido" })).toBeEnabled();
    expect(writes()).toEqual([]);
  });

  it.each(["outside", "Escape", "X"])("dismisses paid detail via %s, restores focus and never writes to the API", async (dismiss) => {
    const { dialog, trigger } = await openDetail(paidOrder());
    const close = within(dialog).getByRole("button", { name: "Cerrar" });
    await waitFor(() => expect(close).toHaveFocus());
    fireEvent.mouseDown(within(dialog).getByText("Monto cobrado"));
    expect(dialog).toBeVisible();
    if (dismiss === "outside") fireEvent.mouseDown(dialog.parentElement!);
    else if (dismiss === "Escape") fireEvent.keyDown(document, { key: "Escape" });
    else fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    const reopened = await screen.findByRole("dialog", { name: "Pedido #1 · #TEST-1" });
    expect(await within(reopened).findByText("Pagado")).toBeVisible();
    expect(within(reopened).getByText("Listo")).toBeVisible();
    expect(writes()).toEqual([]);
  });

  it("keeps cancellation and other menu actions available for a paid ready order", async () => {
    const { dialog } = await openDetail(paidOrder());
    fireEvent.click(within(dialog).getByRole("button", { name: "Acciones del pedido" }));
    expect(screen.getByRole("menuitem", { name: "Copiar pedido" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Revisar impresión automática" })).toBeEnabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Cancelar pedido" }));
    const cancellation = await screen.findByRole("dialog", { name: "Cancelar pedido" });
    expect(within(cancellation).getByRole("button", { name: "Confirmar cancelación" })).toBeDisabled();
    expect(writes()).toEqual([]);
  });

  it("keeps payment, product additions and cancellation for an unpaid ready order", async () => {
    const { dialog } = await openDetail(detailOrder());
    expect(within(dialog).getByRole("button", { name: "Cobrar 24 S/" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Agregar productos" })).toBeEnabled();
    expect(dialog.querySelector(".order-detail-tools")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Acciones del pedido" }));
    expect(screen.getByRole("menuitem", { name: "Cancelar pedido" })).toBeEnabled();
    expect(screen.getByRole("menuitem", { name: "Editar pedido" })).toBeEnabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cobrar 24 S/" }));
    expect(await screen.findByRole("dialog", { name: "Cobrar al cliente" })).toBeVisible();
    expect(writes()).toEqual([]);
  });

  it.each([
    { status: "confirmed", channel: "counter", payment_status: "pending", label: "Enviar a cocina" },
    { status: "ready", channel: "delivery", payment_status: "pending", label: "Despachar delivery" },
    { status: "dispatched", channel: "delivery", payment_status: "pending", label: "Marcar entregado" },
    { status: "ready", channel: "delivery", payment_status: "paid", label: "Despachar delivery" },
    { status: "dispatched", channel: "delivery", payment_status: "paid", label: "Marcar entregado" },
  ])("preserves $label for $payment_status orders", async ({ label, ...state }) => {
    const saved = state.payment_status === "paid" ? paidOrder(state) : detailOrder(state);
    const { dialog } = await openDetail(saved);
    expect(within(dialog).getByRole("button", { name: label })).toBeEnabled();
    expect(dialog.querySelector(".order-detail-tools")).not.toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Cerrar operación" })).toBeNull();
    expect(writes()).toEqual([]);
  });
});

describe("order deep links", () => {
  it("opens the exact order even when it is not on the current page and preserves its complete code", async () => {
    vi.mocked(api).mockImplementation(mockReads());
    render(<MemoryRouter initialEntries={[{ pathname: "/pedidos", search: "?order_id=700", state: { auditReturnTo: "/configuracion/seguridad?page=2" } }]}><OrdersPage /></MemoryRouter>);
    const dialog = await screen.findByRole("dialog", { name: "Pedido #1 · #TEST-1" });
    expect(within(dialog).getByText("#TEST-1")).toBeVisible();
    expect(within(dialog).getByRole("link", { name: "Regresar al historial de seguridad" })).toHaveAttribute("href", "/configuracion/seguridad?page=2");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("rejects another branch without showing that order or switching branch", async () => {
    vi.mocked(api).mockImplementation(mockReads({ detail: () => order(2) }));
    render(<MemoryRouter initialEntries={["/pedidos?order_id=1400"]}><OrdersPage /></MemoryRouter>);
    expect(await screen.findByText("El pedido no pertenece a la sucursal seleccionada.")).toBeVisible();
    expect(screen.queryByText("#TEST-2")).toBeNull();
    expect(tenant.branch.id).toBe(1);
  });
});

describe("table account timestamps", () => {
  it.each(["2026-09-13T03:18:00", "2026-09-13T03:18:00Z", "2026-09-12T22:18:00-05:00"])("shows the same Lima time for a table opened at %s", async (created_at) => {
    vi.mocked(api).mockImplementation(mockReads({ detail: () => ({ ...order(1), created_at }) }));
    render(app());
    const dialog = await openAccount();
    expect(within(dialog!).getByText(/12[- ]set\., 10:18 p\. m\./)).toBeVisible();
    expect(within(dialog!).queryByText(/13 set\./)).toBeNull();
    expect(vi.mocked(api).mock.calls.filter(([, options]) => options?.method && options.method !== "GET")).toEqual([]);
  });
});

describe("table cancellation reason", () => {
  it("preserves the reason on failure and applies a confirmed cancellation despite a failed list refresh", async () => {
    let writes = 0;
    let cancelled = false;
    const reads = mockReads();
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (options?.method === "POST") {
        writes += 1;
        if (writes === 1) throw new Error("No se pudo guardar");
        cancelled = true;
        return { ...order(1), status: "cancelled", version: 2 };
      }
      if (cancelled && path.startsWith("/orders/workspace")) throw new Error("Consulta temporalmente fuera de línea");
      return reads(path);
    });
    render(app());
    await openAccount();
    const form = await requestCancellation();
    expect(form).toHaveClass("order-cancel-modal");
    expect(within(form).getByRole("button", { name: "Confirmar cancelación" })).toBeDisabled();
    fireEvent.change(within(form).getByLabelText("Motivo de cancelación"), { target: { value: "  El cliente se retiró  " } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar cancelación" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(within(form).getByLabelText("Motivo de cancelación")).toHaveValue("  El cliente se retiró  ");
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar cancelación" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Cancelar pedido" })).toBeNull());
    expect(screen.queryByRole("dialog", { name: "Cuenta de Mesa 1" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Pedido cancelado");
    expect(writes).toBe(2);
    const payloads = vi.mocked(api).mock.calls.filter(([, options]) => options?.method === "POST").map(([, options]) => JSON.parse(String(options?.body)));
    expect(payloads).toEqual([{ status: "cancelled", expected_version: 1, reason: "El cliente se retiró" }, { status: "cancelled", expected_version: 1, reason: "El cliente se retiró" }]);
  });

  it("discards a cancellation response when the user changes branch", async () => {
    let resolve!: (value: unknown) => void;
    const reads = mockReads();
    vi.mocked(api).mockImplementation(async (path, options) => options?.method === "POST" ? new Promise((done) => { resolve = done; }) : reads(path));
    const view = render(app());
    await openAccount();
    const form = await requestCancellation();
    fireEvent.change(within(form).getByLabelText("Motivo de cancelación"), { target: { value: "Prueba aislada" } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar cancelación" }));
    tenant.branch = { id: 2 };
    view.rerender(app());
    await openAccount(2);
    await act(async () => resolve({ ...order(1), status: "cancelled", version: 2 }));
    expect(screen.getByRole("dialog", { name: "Cuenta de Mesa 2" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Cancelar pedido" })).toBeNull();
    expect(screen.queryByText("Pedido cancelado y stock revertido.")).toBeNull();
  });
});

describe("confirmed table checkout", () => {
  it.each(["wrapped", "flat"].flatMap((format) => ["failed", "stale"].map((reload) => ({ format, reload }))))("applies $format start/reopen responses before a $reload detail reload", async ({ format, reload }) => {
    let saved = order(1);
    const reads = mockReads({ detail: async () => { if (saved.version > 1 && reload === "failed") throw new Error("Read offline"); return order(1); } });
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (!options?.method) return reads(path);
      const expected = JSON.parse(String(options.body)).expected_version;
      if (expected !== saved.version) throw new ApiError("Version anterior", 409);
      saved = { ...saved, version: saved.version + 1, checkout_started_at: path.endsWith("/start") ? "2026-09-12T13:00:00Z" : null };
      const partial = { id: saved.id, version: saved.version, checkout_started_at: saved.checkout_started_at };
      return format === "wrapped" ? { order: partial } : partial;
    });
    render(app());
    await openAccount();
    fireEvent.click(await screen.findByRole("button", { name: "Cerrar mesa" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cobrar mesa" })).toBeEnabled());
    await reopenAccount();
    await waitFor(() => expect(screen.getByRole("button", { name: "Cerrar mesa" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Cerrar mesa" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cobrar mesa" })).toBeEnabled());
    const writes = vi.mocked(api).mock.calls.filter(([, options]) => options?.method === "POST");
    expect(writes.map(([, options]) => JSON.parse(String(options?.body)).expected_version)).toEqual([1, 2, 3]);
    expect(new Set(writes.map(([, options]) => options?.idempotencyKey)).size).toBe(3);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["start", "reopen"].flatMap((action) => ["success", "error"].map((outcome) => ({ action, outcome }))))("discards a late $action $outcome after changing branch", async ({ action, outcome }) => {
    let complete!: (value: unknown) => void;
    let fail!: (reason: Error) => void;
    let completeCurrent!: (value: unknown) => void;
    const reads = mockReads({ detail: (id) => ({ ...order(id / 700), checkout_started_at: action === "reopen" && id === 700 ? "2026-09-12T13:00:00Z" : null }) });
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (!options?.method) return reads(path);
      if (path.startsWith("/orders/1400/")) return new Promise((resolve) => { completeCurrent = resolve; });
      return new Promise((resolve, reject) => { complete = resolve; fail = reject; });
    });
    const view = render(app());
    await openAccount();
    if (action === "start") fireEvent.click(await screen.findByRole("button", { name: "Cerrar mesa" }));
    else { await screen.findByRole("button", { name: "Cobrar mesa" }); await reopenAccount(); }
    tenant.branch = { id: 2 };
    view.rerender(app());
    expect(screen.queryByRole("dialog", { name: "Cuenta de Mesa 1" })).toBeNull();
    await openAccount(2);
    fireEvent.click(await screen.findByRole("button", { name: "Cerrar mesa" }));
    await act(async () => {
      if (outcome === "error") fail(new Error("Checkout anterior fallido"));
      else complete({ order: { ...order(1), version: 2, checkout_started_at: action === "start" ? "2026-09-12T13:00:00Z" : null } });
    });
    expect(screen.getByRole("dialog", { name: "Cuenta de Mesa 2" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cerrar mesa" })).toBeDisabled();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => completeCurrent({ order: { ...order(2), version: 2, checkout_started_at: "2026-09-12T14:00:00Z" } }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Cobrar mesa" })).toBeEnabled());
  });
});

describe("branch-scoped table callbacks", () => {
  it("does not resurrect a pending opening when returning to the original branch", async () => {
    let complete!: (value: unknown) => void;
    const reads = mockReads({ available: true });
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (!options?.method) return reads(path);
      return new Promise((resolve) => { complete = resolve; });
    });
    const view = render(app());
    await openAccount(1, true);
    tenant.branch = { id: 2 };
    view.rerender(app());
    tenant.branch = { id: 1 };
    view.rerender(app());
    await screen.findByRole("button", { name: "Mesa 1, Libre, capacidad 4" });
    await act(async () => complete({ id: 700 }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each(["success", "error"])("ignores late opening %s without replacing the new branch account", async (outcome) => {
    let complete!: (value: unknown) => void;
    let fail!: (reason: Error) => void;
    const reads = mockReads({ available: true });
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (!options?.method) return reads(path);
      const payload = JSON.parse(String(options.body));
      if (payload.branch_id === 1) return new Promise((resolve, reject) => { complete = resolve; fail = reject; });
      return { id: 1400 };
    });
    const view = render(app());
    await openAccount(1, true);
    tenant.branch = { id: 2 };
    view.rerender(app());
    await openAccount(2, true);
    await screen.findByRole("dialog", { name: "Cuenta de Mesa 2" });
    await act(async () => { if (outcome === "success") complete({ id: 700 }); else fail(new Error("Apertura anterior fallida")); });
    expect(screen.getByRole("dialog", { name: "Cuenta de Mesa 2" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Cuenta de Mesa 1" })).toBeNull();
    expect(screen.queryByText("Apertura anterior fallida")).toBeNull();
    expect(vi.mocked(api).mock.calls.filter(([path]) => path === "/orders/700/detail")).toHaveLength(0);
  });

  it("ignores a transfer list resolved in the previous branch", async () => {
    let complete!: (value: unknown) => void;
    let transferring = false;
    const reads = mockReads();
    vi.mocked(api).mockImplementation(async (path) => {
      if (transferring && path === "/tables?branch_id=1") return new Promise((resolve) => { complete = resolve; });
      return reads(path);
    });
    const view = render(app());
    const account = await openAccount();
    await within(account!).findByRole("button", { name: "Acciones de la mesa" });
    transferring = true;
    fireEvent.click(screen.getByRole("button", { name: "Acciones de la mesa" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Transferir pedido" }));
    tenant.branch = { id: 2 };
    view.rerender(app());
    await openAccount(2);
    await act(async () => complete([{ ...table(1), id: 101, name: "Mesa anterior", status: "available", active_order_id: null }]));
    expect(screen.queryByRole("dialog", { name: "Transferir pedido" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Cuenta de Mesa 2" })).toBeVisible();
    expect(screen.queryByText("Mesa anterior")).toBeNull();
  });

  it.each(["success", "error"])("discards a transfer %s after switching branches", async (outcome) => {
    let complete!: (value: unknown) => void;
    let fail!: (reason: Error) => void;
    const reads = mockReads();
    const destination = { ...table(1), id: 101, name: "Mesa destino", status: "available", active_order_id: null };
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (options?.method === "PATCH") return new Promise((resolve, reject) => { complete = resolve; fail = reject; });
      if (path === "/tables?branch_id=1") return [table(1), destination];
      return reads(path);
    });
    const view = render(app());
    await openAccount();
    fireEvent.click(screen.getByRole("button", { name: "Acciones de la mesa" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Transferir pedido" }));
    fireEvent.click(await screen.findByRole("button", { name: /Mesa destino.*Capacidad/ }));
    tenant.branch = { id: 2 };
    view.rerender(app());
    await openAccount(2);
    await act(async () => { if (outcome === "success") complete({ ...order(1), table_id: 101, version: 2 }); else fail(new Error("Transferencia anterior fallida")); });
    expect(screen.getByRole("dialog", { name: "Cuenta de Mesa 2" })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "Transferir pedido" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
