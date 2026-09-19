import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CASH_DENOMINATIONS, CashWorkspace as Workspace, calculateDenominationTotal } from "./CashWorkspace";
import { MemoryRouter } from "react-router-dom";

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
        transactions: [{ id: 21, order_number: "0003", amount: 40, created_at: "2026-08-31T10:30:00-05:00" }],
      }],
    };
    installApiMock({ detail });
    render(<CashWorkspace />);

    const scrollRegion = await screen.findByRole("region", { name: "Historial de cortes desplazable" });
    expect(scrollRegion).toHaveAttribute("tabindex", "0");
    expect(scrollRegion).toHaveAccessibleDescription("En pantallas pequeñas, cada fila muestra todos sus datos.");

    fireEvent.click(screen.getByRole("button", { name: "Abrir corte #3741" }));
    const dialog = await screen.findByRole("dialog", { name: "#3741 en Caja Principal" });
    const transaction = within(dialog).getByText(/Pedido #0003/);
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
