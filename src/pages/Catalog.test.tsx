import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import type { Catalog } from "../types";
import { CatalogPage } from "./Catalog";

const resource = vi.hoisted(() => ({ data: null as Catalog | null, loading: false, error: null, refresh: vi.fn(), setData: vi.fn() }));
vi.mock("../lib/tenant", () => ({ useTenant: () => ({ branch: resource.data?.branch }) }));
vi.mock("../lib/hooks", () => ({ usePolling: () => resource, useBranchRealtime: vi.fn() }));
vi.mock("../lib/query-session", () => ({ useQuery: () => resource }));
vi.mock("../lib/api", async (importOriginal) => ({ ...await importOriginal<typeof import("../lib/api")>(), api: vi.fn() }));

function activate(element: HTMLElement) {
  element.focus();
  fireEvent.click(element);
}

async function openProduct() {
  const opener = screen.getByRole("button", { name: "Nuevo producto" });
  activate(opener);
  const dialog = screen.getByRole("dialog", { name: "Agrega un producto" });
  const name = within(dialog).getByRole("textbox", { name: "Nombre del producto" });
  await waitFor(() => expect(name).toHaveFocus());
  return { dialog, opener, name };
}

describe("catalog dialog accessibility", () => {
  beforeEach(() => {
    resource.data = {
      branch: { id: 1, business_id: 1, slug: "principal", name: "Principal", active: true, opening_hours: {}, accepted_payment_methods: ["cash"], delivery_enabled: true, takeaway_enabled: true, delivery_fee: 0 },
      categories: [{ id: 2, name: "Comida", active: true, color: "", sort_order: 0 }],
      products: [], ingredients: [], promotions: [],
      modifier_groups: [{ id: 3, branch_id: 1, name: "Salsas", minimum: 0, maximum: 1, required: false, allow_repeats: false, sort_order: 0, modifiers: [] }],
    };
    vi.mocked(api).mockClear();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => "blob:catalog-test");
      static revokeObjectURL = vi.fn();
    });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("places product actions after the tabs and leaves dialogs unlocked until opened", () => {
    render(<StrictMode><CatalogPage /></StrictMode>);
    const tabs = screen.getByRole("tablist", { name: "Secciones del men\u00fa" });
    expect(tabs.nextElementSibling).toHaveClass("menu-page-actions");
    expect(document.querySelector(".menu-page-header .menu-page-actions")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    activate(screen.getByRole("tab", { name: "Personalizaciones" }));
    expect(document.querySelector(".menu-page-actions")).toBeNull();
  });

  it("portals the product drawer, contains Tab in both directions and restores its opener", async () => {
    render(<StrictMode><CatalogPage /></StrictMode>);
    const { dialog, opener } = await openProduct();
    expect(dialog.closest(".menu-page")).toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    const first = within(dialog).getByRole("button", { name: "Vista previa" });
    const last = within(dialog).getByRole("button", { name: "Agregar producto" });
    first.focus(); fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    expect(api).not.toHaveBeenCalled();
  });

  it("closes only the nested category, retaining the product draft and body lock", async () => {
    render(<CatalogPage />);
    const { dialog: product, opener, name } = await openProduct();
    fireEvent.change(name, { target: { value: "Producto pendiente" } });
    const nestedOpener = within(product).getByRole("button", { name: "Nueva categor\u00eda" });
    activate(nestedOpener);
    const category = screen.getByRole("dialog", { name: "Agrega una categor\u00eda" });
    const categoryName = within(category).getByRole("textbox", { name: "Nombre de categor\u00eda" });
    await waitFor(() => expect(categoryName).toHaveFocus());
    expect(product).toHaveAttribute("inert");
    expect(category.closest(".menu-page")).toBeNull();
    fireEvent.keyDown(categoryName, { key: "Tab", shiftKey: true });
    expect(within(category).getByRole("button", { name: "Cancelar" })).toHaveFocus();
    fireEvent.keyDown(category, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Agrega una categor\u00eda" })).not.toBeInTheDocument();
    expect(product).not.toHaveAttribute("inert");
    expect(name).toHaveValue("Producto pendiente");
    expect(nestedOpener).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    expect(window.confirm).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(product).toBeInTheDocument();
    vi.mocked(window.confirm).mockReturnValue(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    expect(api).not.toHaveBeenCalled();
  });

  it("returns focus after cancelling a standalone category", async () => {
    render(<CatalogPage />);
    const opener = screen.getByRole("button", { name: "Nueva categor\u00eda" });
    activate(opener);
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("textbox")).toHaveFocus());
    activate(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it.each(["category", "customization"])("restores a persistent trigger after the %s menu item unmounts", async (kind) => {
    render(<CatalogPage />);
    if (kind === "customization") activate(screen.getByRole("tab", { name: "Personalizaciones" }));
    const opener = screen.getByRole("button", { name: `Opciones de ${kind === "category" ? "Comida" : "Salsas"}` });
    activate(opener);
    activate(screen.getByRole("menuitem", { name: "Editar" }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    expect(screen.queryByRole("menuitem", { name: "Editar" })).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps customization close guards and restores focus without writing", async () => {
    render(<CatalogPage />);
    activate(screen.getByRole("tab", { name: "Personalizaciones" }));
    const opener = screen.getByRole("button", { name: "Nueva personalizaci\u00f3n" });
    activate(opener);
    const dialog = screen.getByRole("dialog", { name: "Agrega una personalizaci\u00f3n" });
    const input = within(dialog).getByRole("textbox", { name: /^Nombre de la personalizaci/ });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.change(input, { target: { value: "Personalizacion pendiente" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(dialog).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(window.confirm).toHaveBeenCalledTimes(1);
    vi.mocked(window.confirm).mockReturnValue(true);
    activate(within(dialog).getByRole("button", { name: "Cerrar editor" }));
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    expect(api).not.toHaveBeenCalled();
  });

  it("contains the inline personalization picker and Escape does not close its product", async () => {
    render(<CatalogPage />);
    const { dialog: product } = await openProduct();
    const opener = within(product).getByRole("button", { name: "Agregar personalizaci\u00f3n" });
    activate(opener);
    const picker = screen.getByRole("dialog", { name: "Agregar personalizaci\u00f3n" });
    const search = within(picker).getByRole("combobox");
    await waitFor(() => expect(search).toHaveFocus());
    fireEvent.keyDown(search, { key: "Tab", shiftKey: true });
    expect(within(picker).getByRole("option")).toHaveFocus();
    fireEvent.keyDown(picker, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Agregar personalizaci\u00f3n" })).not.toBeInTheDocument();
    expect(product).toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("keeps the image cropper above the product and Escape returns to the upload action", async () => {
    render(<CatalogPage />);
    const { dialog: product } = await openProduct();
    const upload = within(product).getByRole("button", { name: /Cargar imagen/ });
    upload.focus();
    fireEvent.change(product.querySelector('input[type="file"]')!, { target: { files: [new File(["image"], "sample.png", { type: "image/png" })] } });
    const crop = screen.getByRole("dialog", { name: "Ajusta el encuadre" });
    const close = within(crop).getByRole("button", { name: "Cerrar editor de imagen" });
    await waitFor(() => expect(close).toHaveFocus());
    expect(product).toHaveAttribute("inert");
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Ajusta el encuadre" })).not.toBeInTheDocument();
    expect(product).not.toHaveAttribute("inert");
    expect(upload).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
  });
});
