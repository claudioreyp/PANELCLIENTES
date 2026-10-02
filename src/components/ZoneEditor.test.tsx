import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SettingsWorkspace } from "./SettingsWorkspace";
import { ZoneEditor } from "./ZoneEditor";
import type { RestaurantTable } from "../types";

const apiMock = vi.hoisted(() => vi.fn());
const tenant = vi.hoisted(() => ({
  branch: { id: 7, name: "Principal" },
  context: { business: { id: 1 }, branches: [{ id: 7 }, { id: 8 }] },
  selectBranch: vi.fn(),
}));
vi.mock("../lib/tenant", () => ({ useTenant: () => tenant }));
vi.mock("../lib/api", async (original) => ({ ...await original<typeof import("../lib/api")>(), api: apiMock }));
const area = { id: 9, branch_id: 7, name: "Patio", sort_order: 0, rows: 5, columns: 7, version: 1 };

function Tree() {
  return <MemoryRouter initialEntries={["/configuracion/zonas"]}><Routes><Route path="/configuracion/:seccion" element={<SettingsWorkspace />} /></Routes></MemoryRouter>;
}

describe("zone editor inside settings", () => {
  beforeEach(() => {
    tenant.branch = { id: 7, name: "Principal" };
    tenant.context.business.id = 1;
    tenant.selectBranch.mockImplementation((id: number) => { tenant.branch = { id, name: "Principal" }; });
    apiMock.mockReset();
    apiMock.mockImplementation(async (path) => {
      if (path === "/areas?branch_id=7") return [area];
      if (path === "/areas?branch_id=8") return [{ ...area, id: 10, branch_id: 8, name: "Norte" }];
      if (path.startsWith("/tables?")) return [];
      if (path.startsWith("/cash/registers?")) return [];
      throw new Error(path);
    });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("contains focus above Settings, guards Escape, and returns focus to the zone row", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Tree />);
    const opener = await screen.findByRole("button", { name: "Editar zona Patio" });
    opener.focus();
    fireEvent.click(opener);
    const layout = screen.getByRole("dialog", { name: "Patio" });
    expect(layout.parentElement).toHaveClass("zone-editor-settings-layer");
    await waitFor(() => expect(within(layout).getByLabelText("Nombre de zona")).toHaveFocus());
    const exit = within(layout).getByRole("button", { name: "Salir" });
    exit.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(within(layout).getByRole("button", { name: "Agregar mesa en fila 5, columna 7" })).toHaveFocus();
    fireEvent.change(within(layout).getByLabelText("Nombre de zona"), { target: { value: "Patio nuevo" } });
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "Patio nuevo" })).toBeVisible();
    confirm.mockReturnValue(true);
    fireEvent.click(exit);
    expect(screen.queryByRole("dialog", { name: "Patio nuevo" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Configuración" })).toBeVisible();
    expect(opener).toHaveFocus();
  });

  it("preserves the draft under a branch confirmation and loads only the chosen new scope", async () => {
    const view = render(<Tree />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar zona Patio" }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar mesa en fila 1, columna 1" }));
    tenant.branch = { id: 8, name: "Norte" };
    view.rerender(<Tree />);
    const warning = screen.getByRole("alertdialog", { name: "Cambió el contexto de configuración" });
    expect(warning).toHaveTextContent("El borrador de Principal se conserva");
    expect(screen.queryByRole("dialog", { name: "Patio" })).toBeNull();
    expect(apiMock).not.toHaveBeenCalledWith("/areas?branch_id=8", expect.anything());
    fireEvent.click(within(warning).getByRole("button", { name: "Descartar y cargar ajustes actuales" }));
    expect(await screen.findByRole("button", { name: "Editar zona Norte" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Editar zona Patio" })).toBeNull();
    expect(apiMock.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  });

  it("restores the previous branch draft without letting its portal cover the context dialog", async () => {
    const view = render(<Tree />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar zona Patio" }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar mesa en fila 1, columna 1" }));
    fireEvent.change(screen.getByLabelText("Identificador de mesa"), { target: { value: "Ventana" } });
    tenant.branch = { id: 8, name: "Norte" };
    view.rerender(<Tree />);
    fireEvent.click(screen.getByRole("button", { name: "Volver sin descartar" }));
    view.rerender(<Tree />);
    const layout = await screen.findByRole("dialog", { name: "Patio" });
    expect(within(layout).getByDisplayValue("Ventana")).toBeVisible();
    expect(within(layout).getByRole("button", { name: "Guardar" })).toBeEnabled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("table removal drafts", () => {
  const savedTable: RestaurantTable = { id: 70, branch_id: 7, area_id: 9, code: "M1", name: "Mesa 1", capacity: 4, position_x: 28, position_y: 28, width: 92, height: 76, shape: "square", status: "available", version: 3 };
  beforeEach(() => { apiMock.mockReset(); vi.spyOn(window, "confirm").mockReturnValue(true); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  function editor(tables: RestaurantTable[] = []) {
    const onProgress = vi.fn();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(<ZoneEditor area={area} tables={tables} onProgress={onProgress} onSaved={onSaved} onClose={onClose} />);
    return { onProgress, onSaved, onClose, layout: screen.getByRole("dialog", { name: "Patio" }) };
  }

  it("removes a new table locally without creating or archiving anything", async () => {
    const { layout, onProgress, onSaved } = editor();
    fireEvent.click(within(layout).getByRole("button", { name: "Agregar mesa en fila 1, columna 1" }));
    fireEvent.click(within(layout).getByRole("button", { name: "Borrar mesa" }));
    expect(within(layout).queryByRole("button", { name: "Editar Mesa 1" })).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();
    fireEvent.click(within(layout).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(apiMock).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("archives a persisted removal only on Save and reports progress only after confirmation", async () => {
    let finish!: (value: unknown) => void;
    apiMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { layout, onProgress, onSaved } = editor([savedTable]);
    fireEvent.click(within(layout).getByRole("button", { name: "Editar Mesa 1" }));
    fireEvent.click(within(layout).getByRole("button", { name: "Borrar mesa" }));
    expect(apiMock).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalled();
    fireEvent.click(within(layout).getByRole("button", { name: "Guardar" }));
    expect(apiMock).toHaveBeenCalledWith("/tables/70", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ expected_version: 3 }), idempotencyKey: expect.any(String) }));
    expect(onProgress).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(within(layout).getByRole("button", { name: "Salir" })).toBeDisabled();
    await act(async () => finish({ ...savedTable, active: false }));
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(area, [], [70]);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("preserves the exact archive body and key after a lost response", async () => {
    apiMock.mockRejectedValueOnce(new Error("Respuesta perdida")).mockResolvedValueOnce({ ...savedTable, active: false });
    const { layout, onProgress, onSaved, onClose } = editor([savedTable]);
    fireEvent.click(within(layout).getByRole("button", { name: "Editar Mesa 1" }));
    fireEvent.click(within(layout).getByRole("button", { name: "Borrar mesa" }));
    fireEvent.click(within(layout).getByRole("button", { name: "Guardar" }));
    expect(await within(layout).findByRole("alert")).toHaveTextContent("Respuesta perdida");
    expect(onProgress).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    const first = apiMock.mock.calls[0];
    fireEvent.click(within(layout).getByRole("button", { name: "Salir" }));
    expect(within(layout).getByRole("alert")).toHaveTextContent("Reintenta Guardar antes de salir");
    expect(onClose).not.toHaveBeenCalled();
    expect(apiMock).toHaveBeenCalledOnce();
    fireEvent.click(within(layout).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(apiMock.mock.calls[1]).toEqual(first);
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(area, [], [70]);
  });

  it.each([
    { status: "reserved" as const }, { status: "occupied" as const }, { active_order_id: 44 },
  ])("blocks removal with a known reservation or account: %j", (state) => {
    const { layout } = editor([{ ...savedTable, ...state }]);
    fireEvent.click(within(layout).getByRole("button", { name: "Editar Mesa 1" }));
    expect(within(layout).getByRole("button", { name: "Borrar mesa" })).toBeDisabled();
    expect(within(layout).getByText(/resuelve la reserva/)).toBeVisible();
    expect(apiMock).not.toHaveBeenCalled();
  });
});
