import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { SettingsStateProvider } from "./SettingsState";
import type { RestaurantTable } from "../../types";
import { RegistersSettings, ZonesAndTablesSettings } from "./ResourceSettings";
import { ApiError } from "../../lib/api";

const apiMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", async (importOriginal) => ({ ...await importOriginal<typeof import("../../lib/api")>(), api: apiMock }));

describe("resource settings drafts", () => {
  beforeEach(() => { apiMock.mockReset(); apiMock.mockResolvedValue([]); });
  afterEach(cleanup);

  async function newRegister() {
    render(<RegistersSettings branchId={7} />);
    await screen.findByText("Aún no hay cajas");
    fireEvent.click(screen.getByRole("button", { name: "Nueva caja" }));
    fireEvent.change(screen.getByLabelText("Nombre de la caja"), { target: { value: "Terraza" } });
    return screen.getByRole("dialog", { name: "Nueva caja" });
  }

  it.each(["cancel", "escape", "backdrop"])("guards register draft on %s", async (close) => {
    const drawer = await newRegister();
    if (close === "cancel") fireEvent.click(within(drawer).getByRole("button", { name: "Cancelar" }));
    if (close === "escape") fireEvent.keyDown(document, { key: "Escape" });
    if (close === "backdrop") fireEvent.mouseDown(drawer.parentElement!);
    expect(screen.getByRole("alertdialog", { name: "Tienes cambios sin guardar" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
    expect(screen.getByDisplayValue("Terraza")).toBeVisible();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });

  it("preserves the register after write failure and reports a later successful write despite reload failure", async () => {
    const drawer = await newRegister();
    apiMock.mockRejectedValueOnce(new Error("No se pudo guardar la caja."));
    fireEvent.click(within(drawer).getByRole("button", { name: "Crear caja" }));
    expect(await within(drawer).findByRole("alert")).toHaveTextContent("No se pudo guardar");
    expect(screen.getByDisplayValue("Terraza")).toBeVisible();
    apiMock.mockResolvedValueOnce({ id: 12, name: "Terraza", version: 1 }).mockRejectedValueOnce(new Error("Reload failed"));
    fireEvent.click(within(drawer).getByRole("button", { name: "Crear caja" }));
    expect(await screen.findByText("La caja se creó correctamente.")).toBeVisible();
    expect(screen.getByText(/no se pudo actualizar la lista/)).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blocks dismissal and duplicate submission while saving", async () => {
    const drawer = await newRegister();
    let finish!: (value: unknown) => void;
    apiMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Crear caja" }));
    expect(within(drawer).getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(within(drawer).getByRole("button", { name: "Cerrar" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(drawer.parentElement!);
    fireEvent.click(within(drawer).getByRole("button", { name: "Guardando..." }));
    expect(drawer).toBeVisible();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
    finish({ id: 12, name: "Terraza", version: 1 });
    await waitFor(() => expect(drawer).not.toBeInTheDocument());
  });

});

const area = { id: 9, name: "Patio", branch_id: 7, version: 1, columns: 7, rows: 5, sort_order: 0 };
const table: RestaurantTable = { id: 70, name: "Mesa ventana", code: "VENTANA", branch_id: 7, area_id: 9, version: 3, capacity: 6, position_x: 156, position_y: 132, width: 220, height: 76, shape: "rectangle", status: "available" };
const registration = vi.fn();

function Zones({ enabled = true, branchId = 7, scope = "1:7" }: { enabled?: boolean; branchId?: number; scope?: string }) {
  return <SettingsStateProvider scopeKey={scope} enabled={enabled} onRegistration={registration}><ZonesAndTablesSettings branchId={branchId} /></SettingsStateProvider>;
}

describe("visual settings zones", () => {
  beforeEach(() => {
    registration.mockReset();
    apiMock.mockReset();
    apiMock.mockImplementation(async (path) => {
      if (path.startsWith("/areas?")) return [area];
      if (path.startsWith("/tables?")) return [];
      throw new Error(path);
    });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  async function editor() {
    const opener = await screen.findByRole("button", { name: "Editar zona Patio" });
    opener.focus();
    fireEvent.click(opener);
    return screen.getByRole("dialog", { name: "Patio" });
  }

  it("creates one confirmed 7x5 zone, opens it immediately and leaves it empty on exit", async () => {
    apiMock.mockImplementation(async (path, options) => {
      if (path === "/areas" && options?.method === "POST") return area;
      if (path.startsWith("/areas?") || path.startsWith("/tables?")) return [];
      throw new Error("No se permite una recarga secundaria");
    });
    render(<StrictMode><Zones /></StrictMode>);
    const create = await screen.findByRole("button", { name: "Nueva zona" });
    await waitFor(() => expect(create).toBeEnabled());
    create.focus();
    fireEvent.click(create);
    const input = screen.getByLabelText("Nombre de zona");
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: "Patio" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    const layout = await screen.findByRole("dialog", { name: "Patio" });
    expect(layout.parentElement).toHaveClass("zone-editor-settings-layer");
    expect(within(layout).getAllByRole("button", { name: /Agregar mesa en fila/ })).toHaveLength(35);
    expect(apiMock).toHaveBeenCalledWith("/areas", expect.objectContaining({ method: "POST", body: JSON.stringify({ branch_id: 7, name: "Patio", sort_order: 0, columns: 7, rows: 5 }) }));
    fireEvent.click(within(layout).getByRole("button", { name: "Salir" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("0 mesas")).toBeVisible();
    await waitFor(() => expect(create).toHaveFocus());
    await editor();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(1);
  });

  it("keeps the name form and registration after creation fails", async () => {
    render(<Zones />);
    await screen.findByText("Patio");
    fireEvent.click(screen.getByRole("button", { name: "Nueva zona" }));
    fireEvent.change(screen.getByLabelText("Nombre de zona"), { target: { value: "Terraza" } });
    apiMock.mockRejectedValueOnce(new Error("No se pudo crear"));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo crear");
    expect(screen.getByDisplayValue("Terraza")).toBeVisible();
    expect(registration).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: true, saving: false }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
    expect(screen.getByRole("dialog", { name: "Agrega una zona" })).toBeVisible();
  });

  it.each(["name", "menu"])("opens existing layout by %s, preserving positions, dimensions and focus", async (source) => {
    apiMock.mockImplementation(async (path) => path.startsWith("/areas?") ? [area] : [table]);
    render(<Zones />);
    const opener = await screen.findByRole("button", { name: source === "name" ? "Editar zona Patio" : "Abrir acciones" });
    opener.focus();
    fireEvent.click(opener);
    if (source === "menu") fireEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
    const layout = screen.getByRole("dialog", { name: "Patio" });
    const existing = within(layout).getByRole("button", { name: "Editar Mesa ventana" });
    expect(existing).toHaveStyle({ gridColumn: "2 / span 2", gridRow: "2 / span 1" });
    fireEvent.click(existing);
    expect(within(layout).getByLabelText("Forma")).toHaveValue("rectangle");
    expect(within(layout).getByLabelText("Capacidad")).toHaveValue(6);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });

  it("keeps dirty table drafts on rejected exit, then discards only unsaved tables", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Zones />);
    const layout = await editor();
    fireEvent.click(within(layout).getByRole("button", { name: "Agregar mesa en fila 1, columna 1" }));
    fireEvent.change(within(layout).getByLabelText("Identificador de mesa"), { target: { value: "Temporal" } });
    expect(registration).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: true }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(confirm).toHaveBeenCalledOnce();
    expect(within(layout).getByDisplayValue("Temporal")).toBeVisible();
    confirm.mockReturnValue(true);
    fireEvent.click(within(layout).getByRole("button", { name: "Salir" }));
    const reopened = await editor();
    expect(within(reopened).queryByRole("button", { name: /Editar Mesa/ })).toBeNull();
    expect(screen.getByText("0 mesas")).toBeVisible();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });

  it("does not interpret unavailable table data as an empty layout or permit archival", async () => {
    let fail = true;
    apiMock.mockImplementation(async (path) => {
      if (path.startsWith("/areas?")) return [area];
      if (fail) throw new Error("No se pudieron cargar las mesas");
      return [table];
    });
    render(<Zones />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar");
    expect(screen.queryByText("0 mesas")).toBeNull();
    expect(screen.getByRole("button", { name: "Editar zona Patio" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Abrir acciones" }));
    expect(screen.getByRole("menuitem", { name: /^Borrar/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Editar" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Editar zona Patio" })).toBeEnabled());
    expect(screen.getByText("1 mesa")).toBeVisible();
  });

  it("allows confirmed tables to be archived with their zone after explicit confirmation", async () => {
    apiMock.mockImplementation(async (path, options) => {
      if (path.startsWith("/areas?")) return [area];
      if (path.startsWith("/tables?")) return [];
      if (path === "/tables") return { ...JSON.parse(String(options.body)), id: 70, version: 1, status: "available" };
      throw new Error(path);
    });
    render(<Zones />);
    const layout = await editor();
    fireEvent.click(within(layout).getByRole("button", { name: "Agregar mesa en fila 1, columna 1" }));
    fireEvent.click(within(layout).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("1 mesa")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Abrir acciones" }));
    expect(screen.getByRole("menuitem", { name: /^Borrar/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Borrar/ }));
    expect(screen.getByRole("alertdialog", { name: "Archivar zona" })).toHaveTextContent("sus 1 mesas");
    expect(apiMock.mock.calls.filter(([, options]) => options?.method === "DELETE")).toHaveLength(0);
  });

  it("keeps confirmed zone and table writes after a partial save and retries only the missing creation", async () => {
    let creates = 0;
    let patches = 0;
    const persisted: RestaurantTable[] = [];
    apiMock.mockImplementation(async (path, options) => {
      if (path.startsWith("/areas?")) return [area];
      if (path.startsWith("/tables?")) return [...persisted];
      if (path === "/areas/9") { patches++; return { ...area, name: "Patio amplio", version: 2 }; }
      if (path === "/tables") {
        creates++;
        if (creates === 2) throw new Error("Segunda mesa sin confirmar");
        const saved = { ...JSON.parse(String(options.body)), id: 70 + creates, version: 1, status: "available" };
        persisted.push(saved);
        return saved;
      }
      throw new Error(path);
    });
    render(<Zones />);
    const layout = await editor();
    fireEvent.change(within(layout).getByLabelText("Nombre de zona"), { target: { value: "Patio amplio" } });
    fireEvent.click(within(layout).getByRole("button", { name: "Agregar mesa en fila 1, columna 1" }));
    fireEvent.click(within(layout).getByRole("button", { name: "Agregar mesa en fila 1, columna 2" }));
    fireEvent.click(within(layout).getByRole("button", { name: "Guardar" }));
    expect(await within(layout).findByRole("alert")).toHaveTextContent("Segunda mesa");
    expect(screen.getByText("1 mesa")).toBeVisible();
    expect(within(layout).getAllByRole("button", { name: /Editar Mesa/ })).toHaveLength(2);
    fireEvent.click(within(layout).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(patches).toBe(1);
    expect(creates).toBe(3);
    expect(screen.getByText("2 mesas")).toBeVisible();
  });

  it("never recreates a reconciled table when patching its newer draft fails", async () => {
    let persisted: RestaurantTable | null = null;
    let creates = 0;
    let patches = 0;
    apiMock.mockImplementation(async (path, options) => {
      if (path.startsWith("/areas?")) return [area];
      if (path.startsWith("/tables?")) return persisted ? [persisted] : [];
      if (path === "/tables") {
        creates++;
        persisted = { ...JSON.parse(String(options.body)), id: 70, version: 1, status: "available" };
        throw new Error("Respuesta de creación perdida");
      }
      if (path === "/tables/70") {
        patches++;
        if (patches === 1) throw new Error("Error al actualizar");
        return { ...persisted, name: "Mesa Ventana", version: 2 };
      }
      throw new Error(path);
    });
    render(<Zones />);
    const layout = await editor();
    fireEvent.click(within(layout).getByRole("button", { name: "Agregar mesa en fila 1, columna 1" }));
    fireEvent.click(within(layout).getByRole("button", { name: "Guardar" }));
    await within(layout).findByText("Respuesta de creación perdida");
    fireEvent.change(within(layout).getByLabelText("Identificador de mesa"), { target: { value: "Ventana" } });
    fireEvent.click(within(layout).getByRole("button", { name: "Guardar" }));
    await within(layout).findByText("Error al actualizar");
    expect(screen.getByText("1 mesa")).toBeVisible();
    fireEvent.click(within(layout).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(creates).toBe(1);
    expect(patches).toBe(2);
  });

  it("discards only the remaining drafts when exiting a partially confirmed save", async () => {
    let creates = 0;
    apiMock.mockImplementation(async (path, options) => {
      if (path.startsWith("/areas?")) return [area];
      if (path.startsWith("/tables?")) return [];
      if (path === "/tables") {
        creates++;
        if (creates === 2) throw new Error("Mesa sin guardar");
        return { ...JSON.parse(String(options.body)), id: 70, version: 1, status: "available" };
      }
      throw new Error(path);
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Zones />);
    const layout = await editor();
    fireEvent.click(within(layout).getByRole("button", { name: "Agregar mesa en fila 1, columna 1" }));
    fireEvent.click(within(layout).getByRole("button", { name: "Agregar mesa en fila 1, columna 2" }));
    fireEvent.click(within(layout).getByRole("button", { name: "Guardar" }));
    await within(layout).findByText("Mesa sin guardar");
    fireEvent.click(within(layout).getByRole("button", { name: "Salir" }));
    const reopened = await editor();
    expect(within(reopened).getByRole("button", { name: "Editar Mesa 1" })).toBeVisible();
    expect(within(reopened).queryByRole("button", { name: "Editar Mesa 2" })).toBeNull();
    expect(screen.getByText("1 mesa")).toBeVisible();
  });

  it("archives an empty zone only after confirmation and keeps the confirmed removal on refresh failure", async () => {
    let reads = 0;
    apiMock.mockImplementation(async (path, options) => {
      if (path === "/areas?branch_id=7") {
        reads++;
        if (reads > 1) throw new Error("No se pudo recargar");
        return [area];
      }
      if (path.startsWith("/tables?")) return [];
      if (path === "/areas/9" && options?.method === "DELETE") return { ...area, archived_at: "2026-10-02T18:00:00Z", archived_table_ids: [] };
      throw new Error(path);
    });
    render(<Zones />);
    await screen.findByText("Patio");
    fireEvent.click(screen.getByRole("button", { name: "Abrir acciones" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Borrar" }));
    expect(screen.getByRole("alertdialog", { name: "Archivar zona" })).toBeVisible();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Archivar zona" }));
    expect(await screen.findByText(/su historial permanece intacto/)).toBeVisible();
    expect(await screen.findByText(/no se pudo actualizar la lista/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Editar zona Patio" })).toBeNull();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method === "DELETE")).toHaveLength(1);
  });

  it("discards a persisted table removal on exit before Save", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    apiMock.mockImplementation(async (path) => path.startsWith("/areas?") ? [area] : [table]);
    render(<Zones />);
    const layout = await editor();
    fireEvent.click(within(layout).getByRole("button", { name: "Editar Mesa ventana" }));
    fireEvent.click(within(layout).getByRole("button", { name: "Borrar mesa" }));
    expect(within(layout).queryByRole("button", { name: "Editar Mesa ventana" })).toBeNull();
    expect(screen.getByText("1 mesa")).toBeVisible();
    fireEvent.click(within(layout).getByRole("button", { name: "Salir" }));
    const reopened = await editor();
    expect(within(reopened).getByRole("button", { name: "Editar Mesa ventana" })).toBeVisible();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });

  it("keeps a reserved table in the confirmed list when its archival is rejected", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    apiMock.mockImplementation(async (path, options) => {
      if (path.startsWith("/areas?")) return [area];
      if (path.startsWith("/tables?")) return [table];
      if (options?.method === "DELETE") throw new ApiError("Resuelve la reserva vigente antes de archivar esta mesa.", 409);
      throw new Error(path);
    });
    render(<Zones />);
    const layout = await editor();
    fireEvent.click(within(layout).getByRole("button", { name: "Editar Mesa ventana" }));
    fireEvent.click(within(layout).getByRole("button", { name: "Borrar mesa" }));
    fireEvent.click(within(layout).getByRole("button", { name: "Guardar" }));
    expect(await within(layout).findByRole("alert")).toHaveTextContent("reserva vigente");
    expect(screen.getByText("1 mesa")).toBeVisible();
    expect(screen.queryByText(/quedaron guardadas/)).toBeNull();
    fireEvent.click(within(layout).getByRole("button", { name: "Salir" }));
    const reopened = await editor();
    expect(within(reopened).getByRole("button", { name: "Editar Mesa ventana" })).toBeVisible();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method === "DELETE")).toHaveLength(1);
  });

  it("retains confirmed removals after a partial save and retries only the unconfirmed table", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const second = { ...table, id: 71, code: "PUERTA", name: "Mesa puerta", position_x: 540, width: 92, shape: "square" as const };
    let attempts = 0;
    apiMock.mockImplementation(async (path, options) => {
      if (path.startsWith("/areas?")) return [area];
      if (path.startsWith("/tables?")) return [table, second];
      if (path === "/tables/70" && options?.method === "DELETE") return { ...table, active: false };
      if (path === "/tables/71" && options?.method === "DELETE") {
        attempts++;
        if (attempts === 1) throw new Error("Segunda baja sin confirmar");
        return { ...second, active: false };
      }
      throw new Error(path);
    });
    render(<Zones />);
    const layout = await editor();
    for (const name of ["Editar Mesa ventana", "Editar Mesa puerta"]) {
      fireEvent.click(within(layout).getByRole("button", { name }));
      fireEvent.click(within(layout).getByRole("button", { name: "Borrar mesa" }));
    }
    fireEvent.click(within(layout).getByRole("button", { name: "Guardar" }));
    expect(await within(layout).findByRole("alert")).toHaveTextContent("Segunda baja");
    expect(screen.getByText("1 mesa")).toBeVisible();
    const failed = apiMock.mock.calls.find(([path]) => path === "/tables/71");
    fireEvent.click(within(layout).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("0 mesas")).toBeVisible();
    expect(apiMock.mock.calls.filter(([path]) => path === "/tables/70")).toHaveLength(1);
    expect(apiMock.mock.calls.filter(([path]) => path === "/tables/71")).toEqual([failed, failed]);
  });

  it("archives a zone and its free tables with one versioned operation after a lost response", async () => {
    const second = { ...table, id: 71, code: "PUERTA", name: "Mesa puerta", version: 4 };
    let archiveAttempts = 0;
    let archived = false;
    apiMock.mockImplementation(async (path, options) => {
      if (path.startsWith("/areas?")) return archived ? [] : [area];
      if (path.startsWith("/tables?")) return [table, second];
      if (path === "/areas/9" && options?.method === "DELETE") {
        archived = true;
        archiveAttempts++;
        if (archiveAttempts === 1) throw new Error("Respuesta de archivado perdida");
        return { ...area, archived_at: "2026-10-02T18:00:00Z", archived_table_ids: [70, 71] };
      }
      throw new Error(path);
    });
    render(<Zones />);
    await screen.findByText("2 mesas");
    fireEvent.click(screen.getByRole("button", { name: "Abrir acciones" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Borrar" }));
    const confirmation = screen.getByRole("alertdialog", { name: "Archivar zona" });
    expect(confirmation).toHaveTextContent("sus 2 mesas");
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
    fireEvent.click(within(confirmation).getByRole("button", { name: "Archivar zona" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Respuesta de archivado perdida");
    expect(screen.queryByText(/su historial permanece intacto/)).toBeNull();
    const first = apiMock.mock.calls.find(([, options]) => options?.method === "DELETE")!;
    expect(JSON.parse(String(first[1]?.body))).toEqual({ expected_version: 1, include_tables: true, tables: [{ id: 70, expected_version: 3 }, { id: 71, expected_version: 4 }] });
    fireEvent.click(within(confirmation).getByRole("button", { name: "Seguir editando" }));
    expect(screen.getByRole("alertdialog", { name: "Archivar zona" })).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent("Reintenta Archivar zona antes de salir");
    expect(apiMock.mock.calls.filter(([, options]) => options?.method === "DELETE")).toHaveLength(1);
    fireEvent.click(within(confirmation).getByRole("button", { name: "Archivar zona" }));
    expect(await screen.findByText(/su historial permanece intacto/)).toBeVisible();
    const writes = apiMock.mock.calls.filter(([, options]) => options?.method === "DELETE");
    expect(writes).toEqual([first, first]);
    expect(screen.queryByRole("button", { name: "Editar zona Patio" })).toBeNull();
  });

  it("keeps the zone and tables after an archive reservation error", async () => {
    apiMock.mockImplementation(async (path, options) => {
      if (path.startsWith("/areas?")) return [area];
      if (path.startsWith("/tables?")) return [table];
      if (options?.method === "DELETE") throw new ApiError("Una mesa tiene una reserva vigente.", 409);
      throw new Error(path);
    });
    render(<Zones />);
    await screen.findByText("1 mesa");
    fireEvent.click(screen.getByRole("button", { name: "Abrir acciones" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Borrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Archivar zona" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("reserva vigente");
    expect(screen.getByRole("alertdialog", { name: "Archivar zona" })).toBeVisible();
    expect(screen.queryByText(/su historial permanece intacto/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
    expect(screen.getByRole("button", { name: "Editar zona Patio" })).toBeVisible();
    expect(screen.getByText("1 mesa")).toBeVisible();
  });

  it.each([
    { id: 99, branch_id: 7, archived_at: "2026-10-02T18:00:00Z", archived_table_ids: [70, 71] },
    { id: 9, branch_id: 8, archived_at: "2026-10-02T18:00:00Z", archived_table_ids: [70, 71] },
    { id: 9, branch_id: 7, archived_at: null, archived_table_ids: [70, 71] },
    { id: 9, branch_id: 7, archived_at: "2026-10-02T18:00:00Z", archived_table_ids: [] },
    { id: 9, branch_id: 7, archived_at: "2026-10-02T18:00:00Z", archived_table_ids: [70, 70] },
  ])("retains the zone and exact operation when its archive response is incomplete or foreign: %j", async (unexpected) => {
    const second = { ...table, id: 71, code: "PUERTA", name: "Mesa puerta", version: 4 };
    let writes = 0;
    let archived = false;
    apiMock.mockImplementation(async (path, options) => {
      if (path.startsWith("/areas?")) return archived ? [] : [area];
      if (path.startsWith("/tables?")) return [table, second];
      if (path === "/areas/9" && options?.method === "DELETE") {
        writes++;
        if (writes === 1) return unexpected;
        archived = true;
        return { ...area, archived_at: "2026-10-02T18:00:00Z", archived_table_ids: [70, 71] };
      }
      throw new Error(path);
    });
    render(<Zones />);
    await screen.findByText("2 mesas");
    fireEvent.click(screen.getByRole("button", { name: "Abrir acciones" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Borrar" }));
    const confirmation = screen.getByRole("alertdialog", { name: "Archivar zona" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "Archivar zona" }));
    await screen.findByRole("alert");
    expect(screen.queryByText(/su historial permanece intacto/)).toBeNull();
    expect(screen.getByText("2 mesas")).toBeVisible();
    const first = apiMock.mock.calls.find(([, options]) => options?.method === "DELETE")!;
    fireEvent.click(within(confirmation).getByRole("button", { name: "Seguir editando" }));
    expect(screen.getByRole("alertdialog", { name: "Archivar zona" })).toBeVisible();
    fireEvent.click(within(confirmation).getByRole("button", { name: "Archivar zona" }));
    expect(await screen.findByText(/su historial permanece intacto/)).toBeVisible();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method === "DELETE")).toEqual([first, first]);
  });

  it("invalidates pending saves when Settings disables the same branch context, even if restored before response", async () => {
    let resolve!: (value: unknown) => void;
    apiMock.mockImplementation(async (path, options) => {
      if (path.startsWith("/areas?")) return [area];
      if (path.startsWith("/tables?")) return [];
      if (options?.method) return new Promise((done) => { resolve = done; });
      throw new Error(path);
    });
    const view = render(<Zones />);
    const layout = await editor();
    fireEvent.click(within(layout).getByRole("button", { name: "Agregar mesa en fila 1, columna 1" }));
    fireEvent.click(within(layout).getByRole("button", { name: "Guardar" }));
    view.rerender(<Zones enabled={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(registration).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: true, saving: false }));
    const writes = apiMock.mock.calls.filter(([, options]) => options?.method).length;
    fireEvent.click(within(layout).getByRole("button", { name: "Guardar", hidden: true }));
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(writes);
    view.rerender(<Zones />);
    await screen.findByRole("dialog", { name: "Patio" });
    await act(async () => resolve({ ...table, name: "Mesa tardía" }));
    expect(screen.queryByText(/quedaron guardadas/)).toBeNull();
    expect(within(layout).getByRole("button", { name: "Editar Mesa 1" })).toBeVisible();
    expect(registration).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: true, saving: false }));
  });

  it("does not open a newly created zone from a previous branch's late response", async () => {
    let resolve!: (value: unknown) => void;
    apiMock.mockImplementation(async (path, options) => {
      if (options?.method === "POST") return new Promise((done) => { resolve = done; });
      return path.startsWith("/areas?") ? [area] : [];
    });
    const view = render(<Zones />);
    await screen.findByText("Patio");
    fireEvent.click(screen.getByRole("button", { name: "Nueva zona" }));
    fireEvent.change(screen.getByLabelText("Nombre de zona"), { target: { value: "Anterior" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    view.rerender(<Zones branchId={8} scope="1:8" enabled={false} />);
    await act(async () => resolve({ ...area, id: 10, name: "Anterior" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar zona Anterior" })).toBeNull();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });
});
