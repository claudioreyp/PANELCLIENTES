import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SettingsWorkspace } from "./SettingsWorkspace";

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
