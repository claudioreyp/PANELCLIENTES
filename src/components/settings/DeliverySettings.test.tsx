import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeliverySettingsSection } from "./CommerceSettings";

const apiMock = vi.hoisted(() => vi.fn());
const tenant = vi.hoisted(() => ({ branch: { id: 7, delivery_fee: 15 } }));
vi.mock("../../lib/api", async (original) => ({ ...await original<typeof import("../../lib/api")>(), api: apiMock }));
vi.mock("../../lib/tenant", () => ({ useTenant: () => tenant }));
const base = { version: 3, delivery_mode: "fixed", fixed_delivery_fee: 15, distance_base_fee: 2, distance_fee_per_km: 3, distance_max_km: 10, minimum_order_amount: null, free_delivery_threshold: null, bands: [], google_routes_configured: true, delivery_policy_supported: true, delivery_policy: { neighborhoods: [], origin: null, outside_band_mode: "reject" }, branch_origin: { latitude: -5, longitude: -80, maps_url: "https://maps.google.com/?q=-5,-80" } };
let stored: Record<string, unknown>;
const set = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const selectMode = (value: string) => set("Tipo de costo de envío", value);
const savedBody = () => JSON.parse(apiMock.mock.calls.find(([, options]) => options?.method === "PATCH")![1].body);

describe("DeliverySettings", () => {
  beforeEach(() => {
    tenant.branch.id = 7; stored = structuredClone(base);
    apiMock.mockReset().mockImplementation((_path: string, options?: RequestInit) => {
      if (options?.method === "PATCH") stored = { ...stored, ...JSON.parse(String(options.body)), version: 4 };
      return Promise.resolve(stored);
    });
  });
  afterEach(cleanup);
  async function open() { render(<DeliverySettingsSection />); await screen.findByLabelText("Tipo de costo de envío"); }
  async function save() { fireEvent.click(screen.getByRole("button", { name: "Guardar" })); await screen.findByText("Los costos de envío se actualizaron."); }

  it("saves fixed prices and thresholds without sending read-only capabilities", async () => {
    await open();
    set("Precio fijo de envío", "18");
    fireEvent.click(screen.getByRole("switch", { name: "Envío gratis si se alcanza una compra mínima" }));
    set("Monto para envío gratis", "50");
    fireEvent.click(screen.getByRole("switch", { name: "Se requiere una compra mínima para habilitar envíos" }));
    set("Compra mínima", "20"); await save();
    expect(savedBody()).toMatchObject({ expected_version: 3, delivery_mode: "fixed", fixed_delivery_fee: 18, free_delivery_threshold: 50, minimum_order_amount: 20 });
    expect(savedBody()).not.toHaveProperty("delivery_policy_supported");
    expect(savedBody()).not.toHaveProperty("branch_origin");
  });
  it("adds, validates and removes neighborhoods then saves their rates", async () => {
    await open(); selectMode("neighborhoods");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    set("Nombre de colonia 1", "Centro"); set("Costo de envío 1", "5");
    fireEvent.click(screen.getByRole("button", { name: "Agregar otra colonia" }));
    set("Nombre de colonia 2", " centro ");
    expect(screen.getByRole("alert")).toHaveTextContent("no pueden repetirse");
    set("Nombre de colonia 2", "Norte"); set("Costo de envío 2", "-2");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Eliminar colonia 2" })); await save();
    expect(savedBody()).toMatchObject({ delivery_mode: "neighborhoods", delivery_policy: { neighborhoods: [{ name: "Centro", fee: 5 }] } });
  });
  it("keeps new distance tiers continuous on add, boundary change and remove", async () => {
    await open(); selectMode("radius");
    expect(screen.getByLabelText("Desde nivel 1")).toHaveValue(0);
    fireEvent.click(screen.getByRole("button", { name: "Agregar otro nivel" }));
    set("Hasta nivel 1", "1.5");
    expect(screen.getByLabelText("Desde nivel 2")).toHaveValue(1.5);
    fireEvent.click(screen.getByRole("button", { name: "Eliminar nivel 1" }));
    expect(screen.getByLabelText("Desde nivel 1")).toHaveValue(0);
    await save();
    expect(savedBody()).toMatchObject({ delivery_mode: "bands", delivery_policy: { outside_band_mode: "quote" }, bands: [{ minimum_km: 0, maximum_km: 2.1, fee: 0 }] });
  });
  it("preserves saved coverage restrictions and legacy linear fees", async () => {
    stored.delivery_mode = "distance";
    await open();
    expect(screen.getByLabelText("Tipo de costo de envío")).toHaveValue("distance");
    set("Monto base", "4"); await save();
    expect(savedBody()).toMatchObject({ delivery_mode: "distance", distance_base_fee: 4, distance_fee_per_km: 3, delivery_policy: { outside_band_mode: "reject" } });
  });
  it("shows only the minimum toggle for free mode and restores drafts on cancel", async () => {
    await open(); selectMode("free");
    expect(screen.queryByRole("switch", { name: /Envío gratis/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" }));
    expect(screen.getByLabelText("Precio fijo de envío")).toHaveValue(15);
    expect(apiMock.mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(false);
  });
  it("reports an incompatible API instead of saving unsupported policies", async () => {
    stored = { ...base, delivery_policy_supported: false, delivery_policy: undefined };
    await open(); selectMode("neighborhoods"); set("Nombre de colonia 1", "Centro");
    expect(screen.getByRole("alert")).toHaveTextContent("API necesita actualizarse");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });
  it("keeps the confirmed settings and editable draft after a rejected save", async () => {
    await open(); selectMode("quote");
    apiMock.mockRejectedValueOnce(new Error("Conexión interrumpida"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Conexión interrumpida");
    expect(screen.getByLabelText("Tipo de costo de envío")).toHaveValue("quote");
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled());
    await save();
    expect(savedBody()).toMatchObject({ delivery_mode: "quote" });
  });
});
