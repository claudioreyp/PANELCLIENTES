import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CASH_DENOMINATIONS, CashWorkspace as Workspace, calculateDenominationTotal } from "./CashWorkspace";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "../lib/api";

const CashWorkspace = () => <MemoryRouter><Workspace /></MemoryRouter>;

const apiMock = vi.hoisted(() => vi.fn());
const tenantMock = vi.hoisted(() => ({
  branch: { id: 1, name: "Sucursal principal" },
  context: { business: { timezone: "America/Lima" } },
}));

vi.mock("../lib/api", () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    details: unknown;

    constructor(message: string, status: number, details?: unknown, code?: string) {
      super(message);
      this.status = status;
      this.details = details;
      this.code = code;
    }
  }
  return { api: apiMock, ApiError };
});

vi.mock("../lib/tenant", () => ({
  useTenant: () => tenantMock,
}));

const secondaryRegister = { id: 6, name: "Caja secundaria", active: true, is_default: false };
const register = { id: 7, name: "Caja Principal", active: true, is_default: true };
const preview = {
  register,
  session_id: 18,
  version: 3,
  period_started_at: "2026-08-31T11:07:00-05:00",
  opening_fund: 5,
  has_cash_activity: true,
  has_card_activity: false,
  transfer_expected_amount: 12,
  pending_orders: [{ id: 3, number: "0003", remaining_amount: 30 }],
  pending_order_count: 1,
};

const cut = {
  id: 3741,
  number: 3741,
  register,
  closed_at: "2026-08-31T11:07:00-05:00",
  created_by: "Claudio Rey",
  retained_fund_amount: 5,
  cash_withdrawn_amount: 25,
  total_expected_amount: 60,
  total_difference: 10,
  result: "surplus",
  methods: [],
  notes: null,
};

function installApiMock(overrides: { firstCut?: boolean; registers?: typeof register[]; detail?: unknown } = {}) {
  apiMock.mockImplementation((path: string, options?: RequestInit & { idempotencyKey?: string }) => {
    if (path.startsWith("/cash/registers?")) return Promise.resolve(overrides.registers || [secondaryRegister, register]);
    if (path === "/cash/registers/7/cut-preview") {
      return Promise.resolve(overrides.firstCut ? {
        ...preview,
        session_id: null,
        version: 0,
        period_started_at: null,
        opening_fund: 0,
        pending_orders: [],
        pending_order_count: 0,
      } : preview);
    }
    if (path.startsWith("/cash/cuts?")) {
      return Promise.resolve(overrides.firstCut
        ? { items: [], total: 0, page: 1, page_size: 10 }
        : { items: [cut], total: 1, page: 1, page_size: 10 });
    }
    if (path === "/cash/registers/7/cuts" && options?.method === "POST") return Promise.resolve(cut);
    if (path === "/cash/registers/7/movements" && options?.method === "POST") {
      return Promise.resolve({ id: 90, movement_type: "withdrawal", amount: 10, note: "Compra urgente" });
    }
    if (path.startsWith("/cash/registers/7/movements?")) {
      return Promise.resolve({ items: [], total: 0, page: 1, page_size: 10 });
    }
    if (path === "/cash/cuts/3741") return Promise.resolve(overrides.detail || cut);
    return Promise.reject(new Error(`Ruta no simulada: ${path}`));
  });
}

describe("CashWorkspace", () => {
  beforeEach(() => {
    apiMock.mockReset();
    tenantMock.branch = { id: 1, name: "Sucursal principal" };
    tenantMock.context = { business: { timezone: "America/Lima" } };
    installApiMock();
  });

  afterEach(() => cleanup());

  it("shows the exact blind first-cut state and both operational tabs", async () => {
    installApiMock({ firstCut: true });
    render(<CashWorkspace />);

    expect(await screen.findByRole("heading", { name: "Realiza tu primer corte de caja a ciegas" })).toBeVisible();
    const cutsTab = screen.getByRole("tab", { name: "Cortes de caja" });
    const movementsTab = screen.getByRole("tab", { name: "Entradas y retiros de efectivo" });
    const cutsPanel = screen.getByRole("tabpanel");
    expect(cutsTab).toHaveAttribute("aria-selected", "true");
    expect(cutsTab).toHaveAttribute("tabindex", "0");
    expect(movementsTab).toHaveAttribute("tabindex", "-1");
    expect(cutsTab).toHaveAttribute("aria-controls", cutsPanel.id);
    expect(cutsPanel).toHaveAttribute("aria-labelledby", cutsTab.id);
    expect(screen.getByRole("button", { name: /Nuevo corte de caja/ })).toBeEnabled();

    fireEvent.keyDown(cutsTab, { key: "ArrowRight" });
    await waitFor(() => expect(movementsTab).toHaveFocus());
    expect(movementsTab).toHaveAttribute("aria-selected", "true");
  });

  it("never enables cash actions with an inactive register", async () => {
    installApiMock({ registers: [{ ...register, active: false }] });
    render(<CashWorkspace />);

    expect(await screen.findByRole("alert")).toHaveTextContent("No hay una caja activa configurada");
    expect(screen.getByRole("button", { name: /Nuevo corte de caja/ })).toBeDisabled();
    expect(apiMock).not.toHaveBeenCalledWith("/cash/registers/7/cut-preview");
  });

  it("counts denominations, blocks pending orders, and sends an idempotent cut", async () => {
    render(<CashWorkspace />);
    const newCut = await screen.findByRole("button", { name: /Nuevo corte de caja/ });
    fireEvent.click(newCut);

    const drawer = await screen.findByRole("dialog", { name: "Agregar un corte de caja" });
    expect(within(drawer).getByText("Hay 1 pedido sin cobrar.")).toBeVisible();
    expect(within(drawer).getByLabelText("Monto de pagos en tarjeta")).toBeDisabled();
    expect(within(drawer).queryByText(/Monto esperado/)).not.toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole("button", { name: "Contar efectivo" }));
    const calculator = await screen.findByRole("dialog", { name: "Calculadora de efectivo" });
    fireEvent.change(within(calculator).getByRole("spinbutton", { name: "Cantidad de S/ 10.00" }), { target: { value: "2" } });
    expect(within(calculator).getByText(/Total/)).toHaveTextContent(/20[.,]00/);
    fireEvent.click(within(calculator).getByRole("button", { name: "Guardar" }));

    expect(within(drawer).getByLabelText("Monto en efectivo")).toHaveValue(20);
    fireEvent.click(within(drawer).getByRole("button", { name: "Guardar" }));
    expect(await within(drawer).findByText(/Cobra los pedidos pendientes/)).toBeVisible();

    fireEvent.click(within(drawer).getByRole("checkbox", { name: "Omitir pagos pendientes" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/cash/registers/7/cuts",
      expect.objectContaining({ method: "POST", idempotencyKey: expect.any(String) }),
    ));
    const call = apiMock.mock.calls.find(([path, options]) => path === "/cash/registers/7/cuts" && options?.method === "POST");
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toMatchObject({
      expected_session_id: 18,
      expected_version: 3,
      cash_counted: 20,
      card_counted: 0,
      retained_fund: 5,
      ignore_pending_orders: true,
    });
    expect(body.denominations["10.00"]).toBe(2);
  });

  it("registers only an income or withdrawal from the movements tab", async () => {
    render(<CashWorkspace />);
    const movementsTab = await screen.findByRole("tab", { name: "Entradas y retiros de efectivo" });
    fireEvent.click(movementsTab);

    fireEvent.click(await screen.findByRole("button", { name: "Agregar movimiento" }));
    const dialog = await screen.findByRole("dialog", { name: "Agrega un movimiento" });
    const type = within(dialog).getByLabelText("Tipo de movimiento");
    expect(within(type).getAllByRole("option").map((option) => option.textContent)).toEqual(["Entrada de efectivo", "Retiro de efectivo"]);
    fireEvent.change(type, { target: { value: "withdrawal" } });
    fireEvent.change(within(dialog).getByLabelText("Cantidad"), { target: { value: "10" } });
    fireEvent.change(within(dialog).getByLabelText("Motivo"), { target: { value: "Compra urgente" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/cash/registers/7/movements",
      expect.objectContaining({ method: "POST", idempotencyKey: expect.any(String) }),
    ));
    const call = apiMock.mock.calls.find(([path, options]) => path === "/cash/registers/7/movements" && options?.method === "POST");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      movement_type: "withdrawal",
      amount: 10,
      note: "Compra urgente",
      expected_version: 3,
      expected_session_id: 18,
    });
  });

  it("keeps collapsed transactions mounted for printing and labels the scroll region", async () => {
    const detail = {
      ...cut,
      methods: [{
        key: "cash",
        label: "Efectivo",
        counted: 50,
        expected: 40,
        difference: 10,
        transactions: [{ id: 21, order_folio: 3, order_number: "0003", amount: 40, created_at: "2026-08-31T10:30:00-05:00" }],
      }],
    };
    installApiMock({ detail });
    render(<CashWorkspace />);

    const scrollRegion = await screen.findByRole("region", { name: "Historial de cortes desplazable" });
    expect(scrollRegion).toHaveAttribute("tabindex", "0");
    expect(scrollRegion).toHaveAccessibleDescription("En pantallas pequeñas, cada fila muestra todos sus datos.");

    fireEvent.click(screen.getByRole("button", { name: "Abrir corte #3741" }));
    const dialog = await screen.findByRole("dialog", { name: "#3741 en Caja Principal" });
    const transaction = within(dialog).getByText(/Pedido #3/);
    expect(transaction.closest(".cash-method-transactions")).not.toHaveClass("is-open");

    fireEvent.click(within(dialog).getByRole("button", { name: /Efectivo/ }));
    expect(transaction.closest(".cash-method-transactions")).toHaveClass("is-open");
  });

  it("remounts all cash state when the selected branch changes", async () => {
    const branchTwoRegister = { id: 8, name: "Caja Norte", active: true, is_default: true };
    apiMock.mockImplementation((path: string) => {
      if (path === "/cash/registers?branch_id=1") return Promise.resolve([register]);
      if (path === "/cash/registers?branch_id=2") return Promise.resolve([branchTwoRegister]);
      if (path === "/cash/registers/7/cut-preview") return Promise.resolve(preview);
      if (path === "/cash/registers/8/cut-preview") return Promise.resolve({ ...preview, register: branchTwoRegister, session_id: null, version: 0, opening_fund: 0, pending_orders: [], pending_order_count: 0 });
      if (path.startsWith("/cash/cuts?") && path.includes("branch_id=1")) return Promise.resolve({ items: [cut], total: 1, page: 1, page_size: 10 });
      if (path.startsWith("/cash/cuts?") && path.includes("branch_id=2")) return Promise.resolve({ items: [], total: 0, page: 1, page_size: 10 });
      return Promise.reject(new Error(`Ruta no simulada: ${path}`));
    });
    const view = render(<CashWorkspace />);
    expect(await screen.findByRole("button", { name: "Abrir corte #3741" })).toBeVisible();

    tenantMock.branch = { id: 2, name: "Sucursal norte" };
    view.rerender(<CashWorkspace />);

    expect(screen.queryByRole("button", { name: "Abrir corte #3741" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Realiza tu primer corte de caja a ciegas" })).toBeVisible();
    expect(apiMock).toHaveBeenCalledWith("/cash/registers?branch_id=2");
  });

  it("sums every supported denomination in cents without floating point drift", () => {
    const counts = Object.fromEntries(CASH_DENOMINATIONS.map((value) => [value.toFixed(2), 1]));
    expect(calculateDenominationTotal(counts)).toBe(388.85);
  });

  it("requires an explicit active count and accepts a manually entered zero", async () => {
    const reads = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path, options) => path.endsWith("/cut-preview") ? Promise.resolve({ ...preview, opening_fund: 0, pending_order_count: 0, pending_orders: [] }) : reads(path, options));
    render(<CashWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /Nuevo corte/ }));
    const drawer = await screen.findByRole("dialog", { name: "Agregar un corte de caja" });
    expect(within(drawer).getByLabelText("Monto en efectivo")).toHaveValue(null);
    expect(within(drawer).getByLabelText("Monto en efectivo")).toBeRequired();
    expect(within(drawer).getByLabelText("Resumen del conteo")).toHaveTextContent("Pendiente");
    fireEvent.submit(drawer.querySelector("form")!);
    expect(await within(drawer).findByRole("alert")).toHaveTextContent("Ingresa el efectivo contado");
    expect(apiMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
    fireEvent.change(within(drawer).getByLabelText("Monto en efectivo"), { target: { value: "0" } });
    fireEvent.submit(drawer.querySelector("form")!);
    await waitFor(() => expect(apiMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
  });

  it("disables inactive cash and its calculator while net-zero card activity still requires count", async () => {
    const reads = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path, options) => path.endsWith("/cut-preview") ? Promise.resolve({ ...preview, has_cash_activity: false, has_card_activity: true, opening_fund: 0, pending_orders: [], pending_order_count: 0 }) : reads(path, options));
    render(<CashWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /Nuevo corte/ }));
    const drawer = await screen.findByRole("dialog", { name: "Agregar un corte de caja" });
    expect(within(drawer).getByLabelText("Monto en efectivo")).toBeDisabled();
    expect(within(drawer).getByLabelText("Monto en efectivo")).toHaveValue(0);
    expect(within(drawer).getByRole("button", { name: "Contar efectivo" })).toBeDisabled();
    expect(within(drawer).getByLabelText("Monto de pagos en tarjeta")).toHaveValue(null);
    fireEvent.submit(drawer.querySelector("form")!);
    expect(await within(drawer).findByRole("alert")).toHaveTextContent("Ingresa el monto contado en tarjeta");
  });

  it("shows signed categories, real folios and previous fund without hiding mixed discrepancies", async () => {
    installApiMock({ detail: { ...cut, result: "balanced", reconciliation_status: "mixed", has_discrepancy: true, opening_amount: 10, previous_session_id: 3740, methods: [{ key: "cash", label: "Efectivo", counted: 234, expected: 473, difference: -239, transactions: [
      { id: 1, kind: "payment", order_id: 99, order_folio: 7, order_number: "FULL-CODE", amount: 468, signed_amount: 468, created_at: "2026-10-04T20:57:00" },
      { id: 1, kind: "movement", movement_type: "income", note: "Se encontró", amount: 10 },
      { id: 2, kind: "movement", movement_type: "withdrawal", note: "Insumos", amount: 15 },
      { id: 3, kind: "refund", method: "cash", order_id: 100, order_folio: 8, amount: 234 },
    ] }] } });
    render(<CashWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir corte #3741" }));
    const dialog = await screen.findByRole("dialog", { name: "#3741 en Caja Principal" });
    expect(within(dialog).getByText("Con diferencias por método")).toBeInTheDocument();
    expect(within(dialog).getByText("Fondo de caja anterior (corte #3740)")).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: /Retiros de efectivo \(1\)/ })).toHaveTextContent(/-.*15\.00/);
    expect(within(dialog).getByText("Insumos").parentElement).toHaveTextContent(/-S\/\s*15\.00/);
    expect(within(dialog).getByText(/Pedido #8/).parentElement).toHaveTextContent(/-S\/\s*234\.00/);
    expect(within(dialog).getByText(/Pedido #7/)).toHaveTextContent(/3:57/);
    expect(within(dialog).queryByText(/FULL-CODE/)).toBeNull();
  });

  it("freezes a pending movement, blocks dismissal and retries the same immutable intent", async () => {
    const reads = apiMock.getMockImplementation()!;
    let reject!: (reason: unknown) => void;
    let writes = 0;
    apiMock.mockImplementation((path, options) => {
      if (options?.method === "POST") { writes++; return writes === 1 ? new Promise((_, fail) => { reject = fail; }) : Promise.resolve({ id: 91 }); }
      return reads(path, options);
    });
    render(<CashWorkspace />);
    fireEvent.click(await screen.findByRole("tab", { name: "Entradas y retiros de efectivo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Agregar movimiento" }));
    const dialog = await screen.findByRole("dialog", { name: "Agrega un movimiento" });
    fireEvent.change(within(dialog).getByLabelText("Cantidad"), { target: { value: "15" } });
    fireEvent.change(within(dialog).getByLabelText("Motivo"), { target: { value: "Insumos" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }));
    expect(within(dialog).getByLabelText("Cantidad")).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog).toBeInTheDocument();
    reject(new ApiError("Respuesta perdida", 0));
    await within(dialog).findByRole("button", { name: "Reintentar mismo movimiento" });
    expect(within(dialog).getByLabelText("Cantidad")).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    expect(dialog).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reintentar mismo movimiento" }));
    await waitFor(() => expect(writes).toBe(2));
    const calls = apiMock.mock.calls.filter(([, options]) => options?.method === "POST");
    expect(calls[1][1].body).toBe(calls[0][1].body);
    expect(calls[1][1].idempotencyKey).toBe(calls[0][1].idempotencyKey);
  });

  it("opens a movement with a fresh period identity and full API totals beyond the page", async () => {
    const reads = apiMock.getMockImplementation()!;
    let previewReads = 0;
    apiMock.mockImplementation((path, options) => {
      if (path.endsWith("/cut-preview")) { previewReads++; return Promise.resolve({ ...preview, session_id: previewReads > 1 ? 19 : 18, version: previewReads > 1 ? 1 : 3 }); }
      if (path.includes("/movements?")) return Promise.resolve({ items: [{ id: 1, movement_type: "income", amount: 1, created_at: "2026-10-04T20:00:00Z" }], total: 101, page: 1, page_size: 10, session_id: 19, summary: { income_amount: 100, withdrawal_amount: 25, expense_amount: 5, refund_amount: 0, signed_amount: 70 } });
      return reads(path, options);
    });
    render(<CashWorkspace />);
    await screen.findByRole("button", { name: /Nuevo corte/ });
    fireEvent.click(screen.getByRole("tab", { name: "Entradas y retiros de efectivo" }));
    await waitFor(() => expect(screen.getByText("Total de entradas").parentElement).toHaveTextContent(/100\.00/));
    expect(screen.getByText("Total de retiros").parentElement).toHaveTextContent(/30\.00/);
    expect(apiMock.mock.calls.find(([path]) => path.includes("/movements?"))?.[0]).toContain("current_period=true");
    fireEvent.click(screen.getByRole("button", { name: "Agregar movimiento" }));
    const dialog = await screen.findByRole("dialog", { name: "Agrega un movimiento" });
    fireEvent.change(within(dialog).getByLabelText("Cantidad"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Motivo"), { target: { value: "Cambio" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(apiMock.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
    const write = apiMock.mock.calls.find(([, options]) => options?.method === "POST");
    expect(write).toBeDefined();
    expect(JSON.parse(write![1].body)).toMatchObject({ expected_session_id: 19, expected_version: 1 });
  });

  it.each([0, 408, 503])("pins null identity and retains an uncertain cut after status %s for an exact retry", async (status) => {
    installApiMock({ firstCut: true });
    const reads = apiMock.getMockImplementation()!;
    let writes = 0;
    apiMock.mockImplementation((path, options) => {
      if (options?.method === "POST") {
        writes++;
        return writes === 1 ? Promise.reject(new ApiError("Respuesta perdida", status)) : Promise.resolve(cut);
      }
      return reads(path, options);
    });
    render(<CashWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: /Nuevo corte/ }));
    const drawer = await screen.findByRole("dialog", { name: "Agregar un corte de caja" });
    fireEvent.change(within(drawer).getByLabelText("Monto en efectivo"), { target: { value: "0" } });
    fireEvent.submit(drawer.querySelector("form")!);
    await within(drawer).findByRole("button", { name: "Reintentar mismo corte" });
    expect(within(drawer).getByLabelText("Monto en efectivo")).toBeDisabled();
    expect(within(drawer).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(drawer).toBeVisible();
    fireEvent.click(within(drawer).getByRole("button", { name: "Reintentar mismo corte" }));
    await waitFor(() => expect(writes).toBe(2));
    const calls = apiMock.mock.calls.filter(([, options]) => options?.method === "POST");
    expect(JSON.parse(calls[0][1].body)).toMatchObject({ expected_session_id: null, expected_version: 0, cash_counted: 0 });
    expect(calls[1][1].body).toBe(calls[0][1].body);
    expect(calls[1][1].idempotencyKey).toBe(calls[0][1].idempotencyKey);
  });

  it("uses effective reconciliation filters, including all discrepancies", async () => {
    render(<CashWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Filtros" }));
    fireEvent.change(screen.getByLabelText("Resultado"), { target: { value: "mixed" } });
    await waitFor(() => expect(apiMock.mock.calls.some(([path]) => path.includes("reconciliation_status=mixed"))).toBe(true));
    fireEvent.change(screen.getByLabelText("Resultado"), { target: { value: "discrepancy" } });
    await waitFor(() => expect(apiMock.mock.calls.some(([path]) => path.includes("has_discrepancy=true") && !path.includes("reconciliation_status"))).toBe(true));
  });

  it("keeps the last fund and all actions scoped to the selected register", async () => {
    const reads = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path, options) => {
      if (path === "/cash/registers/6/cut-preview") return Promise.resolve({ ...preview, register: secondaryRegister, session_id: 44, version: 2 });
      if (path.startsWith("/cash/cuts?") && path.includes("register_id=6")) return Promise.resolve({ items: [{ ...cut, register: secondaryRegister, retained_fund_amount: 99 }], total: 1, page: 1, page_size: 10 });
      return reads(path, options);
    });
    render(<CashWorkspace />);
    await screen.findByRole("button", { name: /Nuevo corte/ });
    fireEvent.change(screen.getByLabelText("Caja", { selector: "select" }), { target: { value: "6" } });
    await waitFor(() => expect(screen.getByText("Fondo de caja registrado por", { exact: false }).parentElement).toHaveTextContent(/99\.00/));
    fireEvent.click(screen.getByRole("button", { name: /Nuevo corte/ }));
    const drawer = await screen.findByRole("dialog", { name: "Agregar un corte de caja" });
    expect(within(drawer).getByText("Caja secundaria")).toBeVisible();
    expect(apiMock.mock.calls.filter(([path]) => path === "/cash/registers/6/cut-preview")).toHaveLength(2);
  });

  it("labels a card refund by its actual method and shows per-method zero as Sin diferencia", async () => {
    installApiMock({ detail: { ...cut, methods: [{ key: "card", label: "Tarjeta", counted: 0, expected: 0, difference: 0, transactions: [] }] } });
    const reads = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path, options) => path.includes("/movements?") ? Promise.resolve({ items: [{ id: 2, movement_type: "refund", method: "card", amount: 234, signed_amount: -234, created_at: "2026-10-04T20:00:00" }], total: 1, page: 1, page_size: 10 }) : reads(path, options));
    render(<CashWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir corte #3741" }));
    const detail = await screen.findByRole("dialog", { name: "#3741 en Caja Principal" });
    expect(within(detail).getByRole("button", { name: /Tarjeta/ })).toHaveTextContent("Sin diferencia");
    fireEvent.click(within(detail).getByRole("button", { name: "Cerrar" }));
    fireEvent.click(screen.getByRole("tab", { name: "Entradas y retiros de efectivo" }));
    const refund = await screen.findByText("Reembolso", { exact: true });
    expect(refund.parentElement).toHaveTextContent("Tarjeta");
    expect(refund.closest("tr")).toHaveTextContent(/-.*234\.00/);
  });
});

describe("cash movement deep links", () => {
  const movement = { id: 9424, register_id: 9, movement_type: "withdrawal", amount: 100, note: "Insumos del turno anterior", created_at: "2026-09-08T20:45:00Z", created_by: "Equipo" };
  const result = { branch_id: 1, register: { id: 9, name: "Caja archivada", active: false }, items: [movement], total: 1, page: 1, page_size: 10 };
  function reads(payload: unknown = result) {
    apiMock.mockImplementation(async (path: string) => {
      if (path.startsWith("/cash/registers?")) return [register];
      if (path.endsWith("/cut-preview")) return preview;
      if (path.startsWith("/cash/cuts?")) return { items: [], total: 0, page: 1, page_size: 10 };
      if (path.startsWith("/cash/registers/9/movements?")) return payload;
      throw new Error(`Unexpected ${path}`);
    });
  }
  const linkedApp = (path = "/caja?tab=movements&register_id=9&movement_id=9424") => <MemoryRouter initialEntries={[{ pathname: path.split("?")[0], search: `?${path.split("?")[1]}`, state: { auditReturnTo: "/configuracion/seguridad?page=2" } }]}><Workspace /></MemoryRouter>;
  beforeEach(() => { apiMock.mockReset(); tenantMock.branch = { id: 1, name: "Sucursal principal" }; });
  afterEach(cleanup);

  it("shows the exact movement from an archived non-primary register", async () => {
    reads();
    render(linkedApp());
    expect(await screen.findByText("Insumos del turno anterior")).toBeVisible();
    expect(screen.getByText("Caja archivada")).toBeVisible();
    expect(screen.getByRole("link", { name: "Regresar al historial de seguridad" })).toBeVisible();
    const path = apiMock.mock.calls.find(([value]) => value.includes("/9/movements?"))?.[0];
    expect(path).toContain("branch_id=1");
    expect(path).toContain("movement_id=9424");
    expect(apiMock.mock.calls.some(([value]) => value.includes("/7/movements"))).toBe(false);
    expect(screen.queryByRole("button", { name: "Agregar movimiento" })).not.toBeInTheDocument();
  });

  it.each([
    { ...result, branch_id: 2 },
    { ...result, items: [{ ...movement, id: 8 }] },
    [movement],
  ])("rejects incompatible or incorrectly scoped responses", async (payload) => {
    reads(payload);
    render(linkedApp());
    expect(await screen.findByText(/No se pudo verificar el movimiento/)).toBeVisible();
    expect(screen.queryByText("Insumos del turno anterior")).not.toBeInTheDocument();
    expect(apiMock.mock.calls.some(([value]) => value.includes("/7/movements"))).toBe(false);
  });

  it("does not resolve a malformed link using the default register", async () => {
    reads();
    render(linkedApp("/caja?tab=movements&register_id=9&movement_id=-1"));
    expect(await screen.findByText("El enlace del movimiento no es válido.")).toBeVisible();
    expect(apiMock.mock.calls.some(([value]) => value.includes("/movements"))).toBe(false);
  });

  it("keeps confirmed movement data after a failed refresh", async () => {
    reads();
    render(linkedApp());
    await screen.findByText("Insumos del turno anterior");
    fireEvent.click(screen.getByRole("tab", { name: "Cortes de caja" }));
    apiMock.mockRejectedValue(new Error("Consulta temporalmente no disponible"));
    fireEvent.click(screen.getByRole("tab", { name: "Entradas y retiros de efectivo" }));
    expect(await screen.findByText("Consulta temporalmente no disponible")).toBeVisible();
    expect(screen.getByText("Insumos del turno anterior")).toBeVisible();
    expect(screen.getByText("#9424")).toBeVisible();
  });
});
