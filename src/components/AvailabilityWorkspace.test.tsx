import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicAssetUrl } from "../lib/api";
import type { Catalog, Product } from "../types";
import { AvailabilityWorkspace } from "./AvailabilityWorkspace";

const apiMock = vi.hoisted(() => vi.fn());
const tenantMock = vi.hoisted(() => ({ branch: { id: 1, name: "Sucursal principal" } }));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, api: apiMock };
});
vi.mock("../lib/tenant", () => ({ useTenant: () => tenantMock }));
vi.mock("../lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/hooks")>();
  return { ...actual, useBranchRealtime: vi.fn() };
});

const channels: Product["service_channels"] = ["pos_tables", "pos_counter", "digital_tables"];

function createCatalog(total = 12, unavailableIds: number[] = [2]): Catalog {
  return {
    branch: {
      id: 1,
      business_id: 1,
      slug: "principal",
      name: "Sucursal principal",
      opening_hours: {},
      accepted_payment_methods: ["cash"],
      delivery_enabled: true,
      takeaway_enabled: true,
      delivery_fee: 0,
      active: true,
    },
    categories: [
      { id: 10, name: "Pizzas", color: "#2f8b5a", sort_order: 0, active: true },
      { id: 11, name: "Bebidas", color: "#46758b", sort_order: 1, active: true },
    ],
    products: Array.from({ length: total }, (_, index) => {
      const id = index + 1;
      return {
        id,
        category_id: id % 2 === 0 ? 11 : 10,
        sku: `SKU-${String(id).padStart(2, "0")}`,
        name: id === 1 ? "Pizza Peperoni" : id === 2 ? "Chicha morada" : `Producto ${id}`,
        description: null,
        price: 10 + id,
        image_url: null,
        service_channels: channels,
        product_type: "standard" as const,
        available: !unavailableIds.includes(id),
        track_stock: false,
        preparation_station: "kitchen",
        sort_order: index,
        variants: [],
        modifier_groups: [],
        recipe: [],
        combo_components: [],
      };
    }),
    modifier_groups: [],
    ingredients: [],
    promotions: [],
  };
}

function installApiMock(initialCatalog: Catalog, failPatch = false) {
  let serverCatalog = structuredClone(initialCatalog);
  apiMock.mockImplementation((path: string, options?: RequestInit) => {
    if (path === "/catalog?branch_id=1") return Promise.resolve(structuredClone(serverCatalog));
    const match = path.match(/^\/catalog\/products\/(\d+)\/availability$/);
    if (match && options?.method === "PATCH") {
      if (failPatch) return Promise.reject(new Error("No se pudo guardar el cambio"));
      const id = Number(match[1]);
      const payload = JSON.parse(String(options.body)) as { available: boolean };
      serverCatalog = {
        ...serverCatalog,
        products: serverCatalog.products.map((product) => product.id === id ? { ...product, available: payload.available } : product),
      };
      return Promise.resolve({ id, available: payload.available });
    }
    return Promise.reject(new Error(`Ruta no simulada: ${path}`));
  });
}

describe("AvailabilityWorkspace", () => {
  beforeEach(() => {
    apiMock.mockReset();
    tenantMock.branch = { id: 1, name: "Sucursal principal" };
  });

  afterEach(() => cleanup());

  it("replicates the compact table, unavailable counter, and ten-item pagination", async () => {
    installApiMock(createCatalog());
    render(<AvailabilityWorkspace />);

    expect(await screen.findByRole("heading", { name: "Disponibilidad" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Todos" })).toHaveAttribute("aria-pressed", "true");
    const unavailableFilter = screen.getByRole("button", { name: "No disponibles (1)" });
    expect(unavailableFilter).toBeEnabled();
    expect(screen.getByText("1 - 10 de 12 items")).toBeVisible();
    expect(screen.getByText("Pizza Peperoni")).toBeVisible();
    expect(screen.queryByText("Producto 11")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(screen.getByText("11 - 12 de 12 items")).toBeVisible();
    expect(screen.getByText("Producto 11")).toBeVisible();

    fireEvent.click(unavailableFilter);
    expect(screen.getByText("Chicha morada")).toBeVisible();
    expect(screen.getByText("Desactivado")).toBeVisible();
    expect(screen.queryByText("Pizza Peperoni")).not.toBeInTheDocument();
    expect(screen.getByText("1 - 1 de 1 items")).toBeVisible();
  });

  it("loads a restaurant-uploaded product image from the API origin", async () => {
    const catalog = createCatalog(1, []);
    const imagePath = "/api/v1/public/catalog/products/1/image?v=pepperoni";
    catalog.products[0].image_url = imagePath;
    installApiMock(catalog);

    render(<AvailabilityWorkspace />);
    await screen.findByText("Pizza Peperoni");

    const image = document.querySelector<HTMLImageElement>(".availability-product-image img");
    expect(image).not.toBeNull();
    expect(image).toHaveAttribute("src", publicAssetUrl(imagePath));

    fireEvent.error(image!);
    expect(document.querySelector(".availability-product-image img")).not.toBeInTheDocument();
    expect(document.querySelector(".availability-product-image svg")).toBeInTheDocument();
  });

  it("expands search, matches category and SKU, and closes with Escape", async () => {
    installApiMock(createCatalog());
    render(<AvailabilityWorkspace />);
    await screen.findByText("Pizza Peperoni");

    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    const input = screen.getByRole("textbox", { name: "Buscar productos" });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("placeholder", "Buscar en todos");

    fireEvent.change(input, { target: { value: "bebidas" } });
    await waitFor(() => expect(screen.getByText("1 - 6 de 6 items")).toBeVisible());
    expect(screen.getByText("Chicha morada")).toBeVisible();
    expect(screen.queryByText("Pizza Peperoni")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "SKU-01" } });
    await waitFor(() => expect(screen.getByText("Pizza Peperoni")).toBeVisible());

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Buscar productos" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Buscar" })).toBeVisible();
    expect(screen.getByText("1 - 10 de 12 items")).toBeVisible();
  });

  it("waits for confirmation and sends the existing availability contract", async () => {
    installApiMock(createCatalog(2, [2]));
    render(<AvailabilityWorkspace />);
    await screen.findByText("Pizza Peperoni");

    const switchControl = screen.getByRole("switch", { name: "Desactivar Pizza Peperoni" });
    expect(switchControl).toHaveAttribute("aria-checked", "true");
    fireEvent.click(switchControl);

    expect(switchControl).toBeDisabled();
    expect(switchControl).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(screen.getByRole("switch", { name: "Activar Pizza Peperoni" })).toHaveAttribute("aria-checked", "false"));
    expect(screen.getAllByText("Desactivado")).toHaveLength(2);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/catalog/products/1/availability",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ available: false }) }),
    ));
    expect(await screen.findByRole("status")).toHaveTextContent("Pizza Peperoni desactivado en todos los canales");
    expect(screen.getByRole("button", { name: "No disponibles (2)" })).toBeEnabled();
  });

  it("rolls back the row and announces an API failure", async () => {
    installApiMock(createCatalog(2, [2]), true);
    render(<AvailabilityWorkspace />);
    await screen.findByText("Pizza Peperoni");

    fireEvent.click(screen.getByRole("switch", { name: "Desactivar Pizza Peperoni" }));

    await waitFor(() => expect(screen.getByRole("switch", { name: "Desactivar Pizza Peperoni" })).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo guardar el cambio");
    expect(screen.getByRole("button", { name: "No disponibles (1)" })).toBeEnabled();
  });

  it("disables the unavailable filter when every product is available", async () => {
    installApiMock(createCatalog(2, []));
    render(<AvailabilityWorkspace />);
    await screen.findByText("Pizza Peperoni");

    const unavailableFilter = screen.getByRole("button", { name: "No disponibles" });
    expect(unavailableFilter).toBeDisabled();
    expect(within(screen.getByRole("table")).getAllByRole("switch")).toHaveLength(2);
  });

  it("preserves a confirmed switch when the secondary read fails", async () => {
    const catalog = createCatalog(1, []);
    let saved = false;
    apiMock.mockImplementation((_path: string, options?: RequestInit) => {
      if (options?.method === "PATCH") { saved = true; return Promise.resolve({ id: 1, available: false }); }
      return saved ? Promise.reject(new Error("Offline")) : Promise.resolve(catalog);
    });
    render(<AvailabilityWorkspace />);
    fireEvent.click(await screen.findByRole("switch", { name: "Desactivar Pizza Peperoni" }));
    expect(await screen.findByRole("switch", { name: "Activar Pizza Peperoni" })).toHaveAttribute("aria-checked", "false");
    expect(await screen.findByRole("alert")).toHaveTextContent("Conservamos los últimos datos confirmados");
    expect(screen.getByRole("status")).toHaveTextContent("Pizza Peperoni desactivado");
  });

  it("ignores a pending write after switching branches", async () => {
    const catalog = createCatalog(1, []);
    const second = structuredClone(catalog);
    second.products[0].name = "Sucursal dos";
    let complete!: (value: unknown) => void;
    apiMock.mockImplementation((path: string, options?: RequestInit) => options?.method === "PATCH"
      ? new Promise((resolve) => { complete = resolve; })
      : Promise.resolve(path.endsWith("=2") ? second : catalog));
    const view = render(<AvailabilityWorkspace />);
    fireEvent.click(await screen.findByRole("switch", { name: "Desactivar Pizza Peperoni" }));
    tenantMock.branch = { id: 2, name: "Sucursal dos" };
    view.rerender(<AvailabilityWorkspace />);
    await screen.findByRole("switch", { name: "Desactivar Sucursal dos" });
    await act(async () => complete({ id: 1, available: false }));
    expect(screen.getByRole("switch", { name: "Desactivar Sucursal dos" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText("Pizza Peperoni")).not.toBeInTheDocument();
  });
});
