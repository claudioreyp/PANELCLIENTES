import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { useBranchRealtime } from "../lib/hooks";
import { TableZoneSessionProvider } from "../lib/table-zone-session";
import type { RestaurantTable } from "../types";
import { TablesWorkspace } from "./TablesWorkspace";

const tenant = vi.hoisted(() => ({ branch: { id: 1 }, context: { role: "owner", business: { id: 1 } } }));
vi.mock("../lib/tenant", () => ({ useTenant: () => tenant }));
vi.mock("../lib/api", () => ({ api: vi.fn() }));
vi.mock("../lib/hooks", async (original) => ({ ...await original<typeof import("../lib/hooks")>(), useBranchRealtime: vi.fn() }));
const area = { id: 51, branch_id: 1, name: "Sala principal", rows: 5, columns: 7, version: 1, sort_order: 0 };
beforeEach(() => { tenant.branch = { id: 1 }; tenant.context.business = { id: 1 }; tenant.context.role = "owner"; });
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

async function openEditor() {
  fireEvent.click(await screen.findByRole("button", { name: "Agregar mesas" }));
  fireEvent.click(screen.getByRole("button", { name: "Agregar mesa en fila 1, columna 1" }));
  return screen.getByRole("dialog");
}

const terrace = { ...area, id: 52, name: "Terraza" };

function SessionView({ show = true, session = "owner", onStartOrder }: { show?: boolean; session?: string; onStartOrder?: (table: RestaurantTable) => void }) {
  return <TableZoneSessionProvider key={session}>{show ? <TablesWorkspace onStartOrder={onStartOrder} /> : <div>Otra seccion</div>}</TableZoneSessionProvider>;
}

describe("session zone selection", () => {
  beforeEach(() => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.startsWith("/areas?")) return [area, terrace];
      if (path.startsWith("/tables?")) return [];
      throw new Error(path);
    });
  });

  it("remembers the selected zone across tab/section unmounts without browser storage", async () => {
    const stored = vi.spyOn(Storage.prototype, "setItem");
    const view = render(<SessionView />);
    fireEvent.click(await screen.findByRole("tab", { name: "Terraza" }));
    view.rerender(<SessionView show={false} />);
    view.rerender(<SessionView />);
    expect(await screen.findByRole("tab", { name: "Terraza", selected: true })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Terraza" })).toHaveAttribute("tabindex", "0");
    expect(stored).not.toHaveBeenCalled();
    stored.mockRestore();
  });

  it("isolates branch and business selections and restores each on return", async () => {
    const view = render(<SessionView />);
    fireEvent.click(await screen.findByRole("tab", { name: "Terraza" }));
    tenant.branch = { id: 2 };
    view.rerender(<SessionView />);
    expect(await screen.findByRole("tab", { name: "Sala principal", selected: true })).toHaveAttribute("aria-selected", "true");
    tenant.branch = { id: 1 };
    tenant.context.business = { id: 2 };
    view.rerender(<SessionView />);
    expect(await screen.findByRole("tab", { name: "Sala principal", selected: true })).toHaveAttribute("aria-selected", "true");
    tenant.context.business = { id: 1 };
    view.rerender(<SessionView />);
    expect(await screen.findByRole("tab", { name: "Terraza", selected: true })).toHaveAttribute("aria-selected", "true");
  });

  it("starts at the first zone in a new session or after provider unmount/reload", async () => {
    const view = render(<SessionView />);
    fireEvent.click(await screen.findByRole("tab", { name: "Terraza" }));
    view.rerender(<SessionView session="other-user" />);
    expect(await screen.findByRole("tab", { name: "Sala principal", selected: true })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Terraza" }));
    view.unmount();
    render(<SessionView session="other-user" />);
    expect(await screen.findByRole("tab", { name: "Sala principal", selected: true })).toHaveAttribute("aria-selected", "true");
  });

  it("does not discard a remembered zone during loading or a failed load", async () => {
    const view = render(<SessionView />);
    fireEvent.click(await screen.findByRole("tab", { name: "Terraza" }));
    view.rerender(<SessionView show={false} />);
    let reject!: (reason: Error) => void;
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.startsWith("/areas?")) return new Promise((_resolve, fail) => { reject = fail; });
      return [];
    });
    view.rerender(<SessionView />);
    expect(screen.getByText("Preparando el panel de mesas...")).toBeInTheDocument();
    await act(async () => reject(new Error("Sin conexion")));
    expect(await screen.findByText("Sin conexion")).toBeInTheDocument();
    view.rerender(<SessionView show={false} />);
    vi.mocked(api).mockImplementation(async (path) => path.startsWith("/areas?") ? [area, terrace] : []);
    view.rerender(<SessionView />);
    expect(await screen.findByRole("tab", { name: "Terraza", selected: true })).toHaveAttribute("aria-selected", "true");
  });

  it("falls back only after a successful load removes the zone and remembers that fallback", async () => {
    const view = render(<SessionView />);
    fireEvent.click(await screen.findByRole("tab", { name: "Terraza" }));
    view.rerender(<SessionView show={false} />);
    vi.mocked(api).mockImplementation(async (path) => path.startsWith("/areas?") ? [area] : []);
    view.rerender(<SessionView />);
    expect(await screen.findByRole("tab", { name: "Sala principal", selected: true })).toHaveAttribute("aria-selected", "true");
    view.rerender(<SessionView show={false} />);
    vi.mocked(api).mockImplementation(async (path) => path.startsWith("/areas?") ? [area, terrace] : []);
    view.rerender(<SessionView />);
    expect(await screen.findByRole("tab", { name: "Sala principal", selected: true })).toHaveAttribute("aria-selected", "true");
  });

  it("clears the remembered zone when a successful refresh returns no areas", async () => {
    const view = render(<SessionView />);
    fireEvent.click(await screen.findByRole("tab", { name: "Terraza" }));
    vi.mocked(api).mockResolvedValue([]);
    const refresh = vi.mocked(useBranchRealtime).mock.calls.at(-1)![1];
    await act(async () => refresh());
    expect(await screen.findByRole("button", { name: /Configurar zonas/ })).toBeInTheDocument();
    view.rerender(<SessionView show={false} />);
    vi.mocked(api).mockImplementation(async (path) => path.startsWith("/areas?") ? [area, terrace] : []);
    view.rerender(<SessionView />);
    expect(await screen.findByRole("tab", { name: "Sala principal", selected: true })).toHaveAttribute("aria-selected", "true");
  });

  it("ignores a previous branch's late area response", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === "/areas?branch_id=1") return new Promise((done) => { resolve = done; });
      if (path === "/areas?branch_id=2") return [{ ...terrace, branch_id: 2 }];
      return [];
    });
    const view = render(<SessionView />);
    tenant.branch = { id: 2 };
    view.rerender(<SessionView />);
    expect(await screen.findByRole("tab", { name: "Terraza", selected: true })).toHaveAttribute("aria-selected", "true");
    await act(async () => resolve([area]));
    expect(screen.queryByRole("tab", { name: "Sala principal" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Terraza" })).toHaveAttribute("aria-selected", "true");
  });

  it("preserves the zone when opening a table and omits the legend, not table status", async () => {
    const table: RestaurantTable = { id: 70, branch_id: 1, area_id: 52, code: "M1", name: "Mesa 1", capacity: 4, position_x: 28, position_y: 28, width: 92, height: 76, shape: "square", status: "available", version: 1 };
    vi.mocked(api).mockImplementation(async (path) => path.startsWith("/areas?") ? [area, terrace] : [table]);
    const onStartOrder = vi.fn();
    const view = render(<SessionView onStartOrder={onStartOrder} />);
    fireEvent.click(await screen.findByRole("tab", { name: "Terraza" }));
    expect(view.container.querySelector(".tables-legend")).toBeNull();
    expect(screen.queryByLabelText("Estados de mesa")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mesa 1, Libre, capacidad 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir mesa" }));
    await waitFor(() => expect(onStartOrder).toHaveBeenCalledWith(table));
    view.rerender(<SessionView show={false} />);
    view.rerender(<SessionView />);
    expect(await screen.findByRole("tab", { name: "Terraza", selected: true })).toHaveAttribute("aria-selected", "true");
  });

  it("selects and remembers the newly created and saved zone", async () => {
    let areas = [area];
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path.startsWith("/areas?")) return areas;
      if (path.startsWith("/tables?")) return [];
      if (path === "/areas" && options?.method === "POST") {
        areas = [area, terrace];
        return terrace;
      }
      if (path === "/areas/52" && options?.method === "PATCH") {
        const saved = { ...terrace, name: "Terraza cubierta", version: 2 };
        areas = [area, saved];
        return saved;
      }
      throw new Error(path);
    });
    const view = render(<SessionView />);
    fireEvent.click(await screen.findByRole("button", { name: "Nueva zona" }));
    fireEvent.change(screen.getByLabelText("Nombre de zona"), { target: { value: "Terraza" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    const editor = await screen.findByRole("dialog", { name: "Terraza" });
    fireEvent.change(within(editor).getByLabelText("Nombre de zona"), { target: { value: "Terraza cubierta" } });
    fireEvent.click(within(editor).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("tab", { name: "Terraza cubierta" })).toHaveAttribute("aria-selected", "true");
    view.rerender(<SessionView show={false} />);
    view.rerender(<SessionView />);
    expect(await screen.findByRole("tab", { name: "Terraza cubierta", selected: true })).toHaveAttribute("aria-selected", "true");
  });
});

describe("direct table layout save", () => {
  it("exposes one empty-zone action outside the desktop/mobile-only containers", async () => {
    vi.mocked(api).mockImplementation(async (path) => path.startsWith("/areas?") ? [area] : []);
    const view = render(<TablesWorkspace />);
    const button = await screen.findByRole("button", { name: "Agregar mesas" });
    expect(screen.getAllByRole("button", { name: "Agregar mesas" })).toHaveLength(1);
    expect(button.closest(".tables-operational-floor, .tables-mobile-list")).toBeNull();
    expect(view.container.querySelector(".zone-empty-panel")).toContainElement(button);
    button.focus();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Salir" }));
    expect(button).toHaveFocus();
  });

  it("shows the same empty-zone instructions without configuration actions for a cashier", async () => {
    tenant.context.role = "cashier";
    vi.mocked(api).mockImplementation(async (path) => path.startsWith("/areas?") ? [area] : []);
    render(<TablesWorkspace />);
    expect(await screen.findByText("No hay mesas en esta zona")).toBeVisible();
    expect(screen.getByText("Pide a un administrador que agregue las mesas.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Agregar mesas" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nueva zona" })).toBeNull();
    expect(vi.mocked(api).mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });

  it("reconciles an ambiguous create by code and never asks for destination", async () => {
    const persisted: RestaurantTable[] = [];
    let creates = 0;
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path.startsWith("/areas?")) return [area];
      if (path.startsWith("/tables?")) return [...persisted];
      if (path === "/tables" && options?.method === "POST") {
        creates++;
        persisted.push({ ...JSON.parse(String(options.body)), id: 70, version: 1, status: "available" });
        throw new Error("Respuesta perdida");
      }
      throw new Error(`Unexpected ${path}`);
    });
    render(<StrictMode><TablesWorkspace /></StrictMode>);
    const editor = await openEditor();
    fireEvent.click(within(editor).getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Respuesta perdida");
    expect(screen.queryByText("¿Dónde quieres guardar estas mesas?")).toBeNull();
    fireEvent.click(within(editor).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(creates).toBe(1);
    expect(persisted[0]).toMatchObject({ branch_id: 1, area_id: 51 });
    expect(screen.getByRole("status")).toHaveTextContent("guardadas en Sala principal");
  });
  it("retains confirmed writes and retries only the failed table", async () => {
    let creates = 0;
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path.startsWith("/areas?")) return [area];
      if (path.startsWith("/tables?")) return [];
      if (path === "/tables" && options?.method === "POST") {
        creates++;
        if (creates === 2) throw new Error("No se pudo guardar la segunda mesa");
        return { ...JSON.parse(String(options.body)), id: 70 + creates, version: 1, status: "available" };
      }
      throw new Error(`Unexpected ${path}`);
    });
    render(<TablesWorkspace />);
    const editor = await openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Agregar mesa en fila 1, columna 2" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Guardar" }));
    await screen.findByRole("alert");
    fireEvent.click(within(editor).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(creates).toBe(3);
    const payloads = vi.mocked(api).mock.calls.filter(([path]) => path === "/tables").map(([, opts]) => JSON.parse(String(opts?.body)));
    expect(payloads[1].code).toBe(payloads[2].code);
    expect(payloads[0].code).not.toBe(payloads[1].code);
  });
  it("closes the previous branch editor and ignores its late save", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path.startsWith("/areas?")) return path.includes("branch_id=1") ? [area] : [];
      if (path.startsWith("/tables?")) return [];
      if (options?.method === "POST") return new Promise((done) => { resolve = done; });
      throw new Error(path);
    });
    const view = render(<TablesWorkspace />);
    const editor = await openEditor();
    fireEvent.click(within(editor).getByRole("button", { name: "Guardar" }));
    tenant.branch = { id: 2 };
    view.rerender(<TablesWorkspace />);
    await screen.findByRole("button", { name: /Configurar zonas/ });
    await act(async () => resolve({ id: 70, branch_id: 1, area_id: 51, name: "Mesa anterior", version: 1 }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/guardadas en/)).toBeNull();
  });

  it.each(["table", "area"])("locks the %s controls while saving and unlocks them on failure", async (surface) => {
    let reject!: (reason: Error) => void;
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path.startsWith("/areas?")) return [area];
      if (path.startsWith("/tables?")) return [];
      if (options?.method) return new Promise((_resolve, fail) => { reject = fail; });
      throw new Error(path);
    });
    render(<TablesWorkspace />);
    const editor = await openEditor();
    if (surface === "area") {
      fireEvent.click(within(editor).getByRole("button", { name: "Mesa 1" }));
      fireEvent.change(within(editor).getByLabelText("Nombre de zona"), { target: { value: "Sala nueva" } });
    }
    fireEvent.click(within(editor).getByRole("button", { name: "Guardar" }));
    expect(within(editor).getByText(/Espera a que termine/)).toHaveAttribute("role", "status");
    for (const control of editor.querySelectorAll("input, select, button")) expect(control).toBeDisabled();
    fireEvent.click(within(editor).getByRole("button", { name: "Agregar mesa en fila 1, columna 2" }));
    expect(within(editor).queryByRole("button", { name: "Editar Mesa 2" })).toBeNull();
    await act(async () => reject(new Error("No se pudo guardar")));
    expect(within(editor).getByRole("button", { name: "Guardar" })).toBeEnabled();
    expect(within(editor).getByLabelText(surface === "area" ? "Nombre de zona" : "Identificador de mesa")).toBeEnabled();
    expect(within(editor).queryByText(/Espera a que termine/)).toBeNull();
  });

  it("keeps the submitted draft intact until a pending save succeeds", async () => {
    let resolve!: (value: unknown) => void;
    let payload!: RestaurantTable;
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path.startsWith("/areas?")) return [area];
      if (path.startsWith("/tables?")) return [];
      if (path === "/tables" && options?.method === "POST") {
        payload = JSON.parse(String(options.body));
        return new Promise((done) => { resolve = done; });
      }
      throw new Error(path);
    });
    render(<TablesWorkspace />);
    const editor = await openEditor();
    const name = within(editor).getByLabelText("Identificador de mesa");
    fireEvent.click(within(editor).getByRole("button", { name: "Guardar" }));
    expect(name).toBeDisabled();
    // Even a programmatically dispatched change cannot mutate the pending draft.
    fireEvent.change(name, { target: { value: "Ventana" } });
    expect(name).toHaveValue("1");
    await act(async () => resolve({ ...payload, id: 70, version: 1, status: "available" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(payload.name).toBe("Mesa 1");
    expect(screen.queryByText("Mesa Ventana")).toBeNull();
  });
});

describe("table movement", () => {
  it("persists a drag after an intermediate render using the pointerdown version", async () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    const table: RestaurantTable = { id: 70, branch_id: 1, area_id: 51, code: "M1", name: "Mesa 1", capacity: 4, position_x: 28, position_y: 28, width: 92, height: 76, shape: "square", status: "available", version: 4 };
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path.startsWith("/areas?")) return [area];
      if (path.startsWith("/tables?")) return [table];
      if (path === "/tables/70" && options?.method === "PATCH") return { ...table, ...JSON.parse(String(options.body)), version: 5 };
      throw new Error(path);
    });
    render(<TablesWorkspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Mover mesas" }));
    const button = screen.getByRole("button", { name: "Mesa 1, Libre, capacidad 4" });
    Object.defineProperty(button, "setPointerCapture", { value: vi.fn() });
    fireEvent.pointerDown(button, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(button, { clientX: 148, clientY: 100 });
    await waitFor(() => expect(button).toHaveStyle({ transform: "translate(80px, 32px)" }));
    fireEvent.pointerUp(button);
    await waitFor(() => expect(api).toHaveBeenCalledWith("/tables/70", expect.objectContaining({
      method: "PATCH", body: JSON.stringify({ position_x: 80, position_y: 32, expected_version: 4 }),
    })));
    const writes = () => vi.mocked(api).mock.calls.filter(([, options]) => options?.method === "PATCH");
    expect(writes()).toHaveLength(1);
    fireEvent.pointerDown(button, { clientX: 148, clientY: 100 });
    fireEvent.pointerUp(button);
    expect(writes()).toHaveLength(1);
    fireEvent.keyDown(button, { key: "ArrowRight" });
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(JSON.parse(String(writes()[1][1]?.body)).expected_version).toBe(5);
  });
});
