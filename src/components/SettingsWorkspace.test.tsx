import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { SettingsWorkspace } from "./SettingsWorkspace";
import { Shell } from "./Shell";

const apiMock = vi.hoisted(() => vi.fn());
const tenantMock = vi.hoisted(() => ({
  branch: { id: 7, name: "Sucursal principal", address: "", maps_url: "", active: true, delivery_fee: 0, delivery_enabled: true, takeaway_enabled: true, accepted_payment_methods: ["cash"] },
  context: {
    role: "owner",
    business: { id: 3, name: "Pizza House", slug: "pizza-house", currency: "PEN", timezone: "America/Lima", modules: { pos: true, cash: true, inventory: true } },
    branches: [{ id: 7, name: "Sucursal principal" }],
  },
  selectBranch: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: apiMock };
});
vi.mock("../lib/tenant", () => ({ useTenant: () => tenantMock }));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ user: { email: "owner@example.com" }, signOut: vi.fn() }) }));

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="ruta actual">{location.pathname}</output>;
}

function renderWorkspace(initialEntry: string | { pathname: string; state?: unknown }) {
  const tree = () => <MemoryRouter initialEntries={[initialEntry]}><LocationProbe /><Routes><Route path="/pedidos" element={<div>Vista de pedidos</div>} /><Route path="/configuracion/:seccion?" element={<SettingsWorkspace />} /></Routes></MemoryRouter>;
  const view = render(tree());
  return { ...view, rerenderScope: () => view.rerender(tree()) };
}

describe("SettingsWorkspace", () => {
  beforeEach(() => {
    tenantMock.branch.id = 7;
    tenantMock.branch.name = "Sucursal principal";
    tenantMock.context.business.id = 3;
    tenantMock.context.branches = [{ id: 7, name: "Sucursal principal" }, { id: 8, name: "Sucursal norte" }];
    tenantMock.selectBranch.mockReset();
    tenantMock.selectBranch.mockImplementation((id: number) => { tenantMock.branch.id = id; });
    vi.stubGlobal("matchMedia", vi.fn((media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    apiMock.mockReset();
    apiMock.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/settings/business" && !options?.method) return Promise.resolve({ id: 3, name: "Pizza House", currency: "PEN", country_code: "PE", timezone: "America/Lima", version: 2 });
      if (path === "/settings/business" && options?.method === "PATCH") return Promise.resolve(JSON.parse(String(options.body)));
      return Promise.reject(new Error(`Ruta no simulada: ${path}`));
    });
  });

  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("hides Subscription and redirects legacy links to General", async () => {
    renderWorkspace("/configuracion/suscripcion");
    expect(screen.getByRole("dialog", { name: "Configuración" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Suscripción" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Suscripción" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("ruta actual")).toHaveTextContent("/configuracion/general"));
    expect(await screen.findByDisplayValue("Pizza House")).toBeVisible();
  });

  it("protects dirty changes before switching sections", async () => {
    renderWorkspace("/configuracion/general");
    const name = await screen.findByDisplayValue("Pizza House");
    fireEvent.change(name, { target: { value: "Pizza House Norte" } });
    fireEvent.click(screen.getByRole("button", { name: "Datos de sucursal" }));
    expect(screen.getByRole("alertdialog", { name: "Tienes cambios sin guardar" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" }));
    await waitFor(() => expect(screen.getByLabelText("ruta actual")).toHaveTextContent("/configuracion/sucursal"));
  });

  it("opens from the shell and returns to the originating route", async () => {
    render(<MemoryRouter initialEntries={["/pedidos"]}><LocationProbe /><Routes><Route path="/pedidos" element={<Shell><div>Vista de pedidos</div></Shell>} /><Route path="/configuracion/:seccion?" element={<SettingsWorkspace />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("link", { name: "Configuración" }));
    expect(await screen.findByRole("dialog", { name: "Configuración" })).toBeVisible();
    expect(screen.getByLabelText("ruta actual")).toHaveTextContent("/configuracion/general");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar configuración" }));
    await waitFor(() => expect(screen.getByText("Vista de pedidos")).toBeVisible());
    expect(screen.getByLabelText("ruta actual")).toHaveTextContent("/pedidos");
  });

  it("preserves a draft when save-and-close fails and closes only after confirmation", async () => {
    renderWorkspace({ pathname: "/configuracion/general", state: { settingsFrom: "/pedidos" } });
    fireEvent.change(await screen.findByDisplayValue("Pizza House"), { target: { value: "Nuevo nombre" } });
    apiMock.mockRejectedValueOnce(new Error("No se pudo guardar. Reintenta."));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar configuración" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar y continuar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Nuevo nombre")).toBeVisible();
    expect(screen.getByLabelText("ruta actual")).toHaveTextContent("/configuracion/general");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar configuración" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar y continuar" }));
    expect(await screen.findByText("Vista de pedidos")).toBeVisible();
  });

  it("requires confirmation when cancelling a section form", async () => {
    renderWorkspace("/configuracion/general");
    fireEvent.change(await screen.findByDisplayValue("Pizza House"), { target: { value: "Borrador" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Cancelar" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
    expect(screen.getByDisplayValue("Borrador")).toBeVisible();
    fireEvent.click(screen.getAllByRole("button", { name: "Cancelar" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" }));
    expect(screen.getByDisplayValue("Pizza House")).toBeVisible();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });

  it("protects a nested register draft from workspace navigation and browser unload", async () => {
    apiMock.mockResolvedValue([]);
    renderWorkspace("/configuracion/cajas");
    await screen.findByText("Aún no hay cajas");
    fireEvent.click(screen.getByRole("button", { name: "Nueva caja" }));
    fireEvent.change(screen.getByLabelText("Nombre de la caja"), { target: { value: "Caja terraza" } });
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "General" }));
    expect(screen.getByRole("alertdialog", { name: "Tienes cambios sin guardar" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Guardar y continuar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
    expect(screen.getByDisplayValue("Caja terraza")).toBeVisible();
  });

  it("preserves a draft on an unexpected branch switch and restores it without writing to the new context", async () => {
    const view = renderWorkspace("/configuracion/general");
    fireEvent.change(await screen.findByDisplayValue("Pizza House"), { target: { value: "Borrador principal" } });
    tenantMock.branch.id = 8;
    view.rerenderScope();
    const guard = screen.getByRole("alertdialog", { name: "Cambió el contexto de configuración" });
    expect(guard).toHaveTextContent("El borrador de Sucursal principal se conserva");
    expect(screen.getByDisplayValue("Borrador principal")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(1);
    fireEvent.click(within(guard).getByRole("button", { name: "Volver sin descartar" }));
    view.rerenderScope();
    expect(tenantMock.selectBranch).toHaveBeenCalledWith(7);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Borrador principal")).toBeVisible();
    expect(apiMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole("button", { name: "Guardar" })[0]);
    expect(await screen.findByText("La información de la empresa se actualizó.")).toBeVisible();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(1);
  });

  it("requires explicit discard before mounting the new business even on the same endpoint path", async () => {
    const view = renderWorkspace("/configuracion/general");
    fireEvent.change(await screen.findByDisplayValue("Pizza House"), { target: { value: "Borrador empresa A" } });
    tenantMock.context.business.id = 4;
    view.rerenderScope();
    const guard = screen.getByRole("alertdialog", { name: "Cambió el contexto de configuración" });
    expect(within(guard).queryByRole("button", { name: "Volver sin descartar" })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Borrador empresa A")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledTimes(1);
    apiMock.mockResolvedValueOnce({ id: 4, name: "Empresa B", version: 6 });
    fireEvent.click(within(guard).getByRole("button", { name: "Descartar y cargar ajustes actuales" }));
    expect(await screen.findByDisplayValue("Empresa B")).toBeVisible();
    expect(screen.queryByDisplayValue("Borrador empresa A")).not.toBeInTheDocument();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });

  it("never follows an old save-and-close continuation after switching context", async () => {
    const view = renderWorkspace({ pathname: "/configuracion/general", state: { settingsFrom: "/pedidos" } });
    fireEvent.change(await screen.findByDisplayValue("Pizza House"), { target: { value: "Guardando A" } });
    let finish!: (value: unknown) => void;
    apiMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar configuración" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar y continuar" }));
    tenantMock.context.business.id = 4;
    view.rerenderScope();
    expect(screen.getByRole("alertdialog", { name: "Cambió el contexto de configuración" })).toBeVisible();
    apiMock.mockResolvedValueOnce({ id: 4, name: "Empresa B", version: 6 });
    fireEvent.click(screen.getByRole("button", { name: "Descartar y cargar ajustes actuales" }));
    await screen.findByDisplayValue("Empresa B");
    await act(async () => { finish({ id: 3, name: "Guardando A", version: 3 }); });
    expect(screen.getByLabelText("ruta actual")).toHaveTextContent("/configuracion/general");
    expect(screen.getByDisplayValue("Empresa B")).toBeVisible();
    expect(screen.queryByText("La información de la empresa se actualizó.")).not.toBeInTheDocument();
  });

  it("preserves a nested register draft until context navigation is confirmed", async () => {
    apiMock.mockResolvedValue([]);
    const view = renderWorkspace("/configuracion/cajas");
    await screen.findByText("Aún no hay cajas");
    fireEvent.click(screen.getByRole("button", { name: "Nueva caja" }));
    fireEvent.change(screen.getByLabelText("Nombre de la caja"), { target: { value: "Borrador caja A" } });
    tenantMock.branch.id = 8;
    view.rerenderScope();
    expect(screen.getByDisplayValue("Borrador caja A")).toBeInTheDocument();
    const guard = screen.getByRole("alertdialog", { name: "Cambió el contexto de configuración" });
    fireEvent.click(within(guard).getByRole("button", { name: "Descartar y cargar ajustes actuales" }));
    await screen.findByText("Aún no hay cajas");
    expect(screen.queryByDisplayValue("Borrador caja A")).not.toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/cash/registers?branch_id=8");
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });
});
