import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";
import type { Branch, Catalog, Promotion } from "../types";
import type { MapPoint } from "../lib/google-map";
import type { OrderCartLine } from "../lib/order-builder";
import type { NewOrderCheckoutSelection } from "./NewOrderPaymentModal";
import { NewOrderDrawer } from "./NewOrderDrawer";
import { useDialogSurface } from "../lib/dialog";
import { SettingsConfirmDialog } from "./settings/SettingsPrimitives";

vi.mock("../lib/api", async (original) => ({ ...await original<typeof import("../lib/api")>(), api: vi.fn() }));
vi.mock("../lib/orders", () => ({ loadOrderDetail: vi.fn() }));
vi.mock("./OrderProductPicker", () => ({ OrderProductPicker: ({ onSave }: { onSave: (lines: OrderCartLine[]) => void }) => <button onClick={() => onSave([{ key: "pizza", productId: 1, name: "Pizza", quantity: 1, unitPrice: 20, modifiers: [] }])}>Elegir pizza</button> }));
vi.mock("./NewOrderPaymentModal", () => ({ NewOrderPaymentModal: ({ total, onClose, onConfirm, busy }: { total: number; onClose: () => void; onConfirm: (selection: NewOrderCheckoutSelection) => void; busy: boolean }) => {
  const surfaceRef = useDialogSurface<HTMLDivElement>(() => { if (!busy) onClose(); });
  return <div ref={surfaceRef} role="dialog" aria-modal="true" aria-label="Cobro" tabIndex={-1}><span>Total a cobrar: {total}</span><button disabled={busy} onClick={onClose}>Volver al pedido</button><button disabled={busy} onClick={() => onConfirm({ deferPayment: true, mode: null, plan: { payments: [], change: 0, error: null } })}>Enviar a cocina</button></div>;
} }));
vi.mock("./settings/LocationPicker", () => ({ LocationPicker: ({ onCancel, onSelect }: { onCancel: () => void; onSelect: (point: MapPoint) => void }) => <div role="dialog" aria-label="Ubicación de prueba"><button onClick={onCancel}>Cancelar ubicación</button><button onClick={() => onSelect({ latitude: 0, longitude: 0, maps_url: "https://www.google.com/maps?q=0,0" })}>Elegir punto</button></div> }));

const branch = { id: 1, business_id: 1, delivery_fee: 99 } as Branch;
const catalog = { branch, categories: [], modifier_groups: [], ingredients: [], promotions: [], products: [{ id: 1, name: "Pizza", price: 20, service_channels: ["pos_delivery", "pos_counter"], variants: [], modifier_groups: [] }] } as unknown as Catalog;
let mode: string;
let version: number;
let serverFee: number;
let supported: boolean;
let sequence: number;
const apiMock = vi.mocked(api);
const calls = (path: string) => apiMock.mock.calls.filter(([url]) => url === path);
const quotes = () => apiMock.mock.calls.filter(([url]) => url.endsWith("/delivery/quotes"));
const body = (call: (typeof apiMock.mock.calls)[number]) => JSON.parse(String(call[1]?.body));
const policy = () => ({ version, delivery_mode: mode, fixed_delivery_fee: 15, pos_quotes_supported: supported, delivery_policy: { neighborhoods: [{ name: "Centro", fee: 15 }] } });
const result = (fee: number | null) => ({ id: `quote-${++sequence}`, fee, requires_quote: fee === null, configuration_version: version, expires_at: new Date(Date.now() + 60000).toISOString(), fee_status: fee === null ? "pending_quote" : "final" });

function show(customCatalog = catalog) {
  const onError = vi.fn(); const onClose = vi.fn(); const onCreated = vi.fn();
  const props = { branch, catalog: customCatalog, onError, onClose, onCreated, initialChannel: "delivery" as const };
  const view = render(<NewOrderDrawer {...props} />);
  const drawer = screen.getByRole("dialog", { name: "Agrega un pedido" });
  fireEvent.click(within(drawer).getByRole("button", { name: "Agregar productos" }));
  fireEvent.click(screen.getByRole("button", { name: "Elegir pizza" }));
  for (const [name, value] of [["Nombre del cliente", "Ana"], ["Número de teléfono", "999888777"], ["Calle", "Jr. Flores"], ["Referencias", "Puerta azul"]]) fireEvent.change(within(drawer).getByLabelText(name), { target: { value } });
  return { ...view, props, drawer, onError, onClose, onCreated };
}
const next = () => fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
const checkout = () => screen.findByRole("dialog", { name: "Cobro" });
async function ready() { await waitFor(() => expect(screen.getByLabelText("Costo de envío")).toHaveAccessibleDescription(/servidor/)); }
async function back() { fireEvent.click(screen.getByRole("button", { name: "Volver al pedido" })); await screen.findByRole("button", { name: "Continuar" }); }
function confirmFee(amount: string) {
  fireEvent.change(screen.getByLabelText("Costo de envío"), { target: { value: amount } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar importe de envío" }));
}

beforeEach(() => {
  mode = "fixed"; version = 3; serverFee = 15; supported = true; sequence = 0;
  apiMock.mockReset();
  apiMock.mockImplementation(async (path, options) => {
    if (path.endsWith("/delivery")) return policy();
    if (path.endsWith("/delivery/quotes")) {
      const payload = JSON.parse(String(options?.body));
      const pending = mode === "quote" || (mode === "neighborhoods" && payload.destination.neighborhood !== "Centro");
      return result(pending ? payload.confirmed_fee ?? null : serverFee);
    }
    if (path === "/orders") { const payload = JSON.parse(String(options?.body)); return { id: 12, version: 1, total: payload.items.reduce((sum: number, item: { quantity: number }) => sum + item.quantity * 20, 0) + payload.delivery_fee }; }
    if (path === "/orders/12/confirm-and-send") return { order: { id: 12 }, tickets: [{ id: 1 }] };
    throw new Error("Unexpected test path");
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("new delivery orders", () => {
  it("restores Continue after an async quote blurred its opener and Escape closes only checkout", async () => {
    const original = apiMock.getMockImplementation()!;
    let resolve!: (value: unknown) => void;
    apiMock.mockImplementation((path, options) => path.endsWith("/quotes") ? new Promise((done) => { resolve = done; }) : original(path, options));
    const { onClose } = show(); await ready();
    const trigger = screen.getByRole("button", { name: "Continuar" });
    act(() => trigger.focus()); next();
    await waitFor(() => expect(trigger).toBeDisabled());
    act(() => trigger.blur());
    await waitFor(() => expect(quotes()).toHaveLength(1));
    await act(async () => resolve(result(15)));
    await checkout();
    await waitFor(() => expect(screen.getByRole("button", { name: "Volver al pedido" })).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not steal focus from a higher dialog while restoring checkout focus", async () => {
    show(); await ready(); next(); await checkout();
    await waitFor(() => expect(screen.getByRole("button", { name: "Volver al pedido" })).toHaveFocus());
    const trigger = screen.getByRole("button", { name: "Continuar", hidden: true });
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    const focus = vi.spyOn(trigger, "focus");
    render(<SettingsConfirmDialog title="Confirmación superior" detail="Revisa antes de continuar." confirmLabel="Aceptar" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    const dialog = screen.getByRole("alertdialog", { name: "Confirmación superior" });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Seguir editando" })).toHaveFocus());
    expect(focus).not.toHaveBeenCalled();
  });

  it("shows current fixed configuration read-only, never branch fallback, and quotes only at Continue", async () => {
    show(); await ready();
    expect(screen.getByLabelText("Costo de envío")).toHaveValue("S/ 15.00");
    expect(screen.getByLabelText("Costo de envío")).toHaveAttribute("readonly");
    fireEvent.change(screen.getByLabelText("Calle"), { target: { value: "Otra calle" } });
    expect(quotes()).toHaveLength(0);
    next(); await checkout();
    expect(quotes()).toHaveLength(1);
    expect(body(quotes()[0])).toMatchObject({ subtotal: 20, expected_configuration_version: 3, destination: { street: "Otra calle" } });
    expect(screen.getByText("Total a cobrar: 35")).toBeInTheDocument();
  });

  it("serializes the identical rich destination in quote and order, then confirms kitchen", async () => {
    const { onCreated } = show(); await ready();
    for (const [name, value] of [[/^Número casa/, "245"], [/^Colonia/, "Centro"], [/Entre calles/, "A y B"]] as const) fireEvent.change(screen.getByLabelText(name), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar ubicación" }));
    fireEvent.click(screen.getByRole("button", { name: "Elegir punto" }));
    next(); await checkout();
    fireEvent.click(screen.getByRole("button", { name: "Enviar a cocina" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledExactlyOnceWith({ orderId: 12, outcome: "pending_and_sent" }));
    expect(body(calls("/orders")[0]).delivery_address).toEqual(body(quotes()[0]).destination);
    expect(body(calls("/orders")[0])).toMatchObject({ delivery_quote_id: "quote-1", delivery_fee: 15, delivery_address: { address: "Jr. Flores 245, Centro, Entre A y B", street: "Jr. Flores", number: "245", cross_streets: "A y B", reference: "Puerta azul", latitude: 0, longitude: 0, maps_url: "https://www.google.com/maps?q=0,0" } });
    expect(quotes()).toHaveLength(1);
    expect(calls("/settings/branches/1/delivery")).toHaveLength(3);
  });

  it("uses subtotal before promotions rather than discounted checkout total", async () => {
    const promotion = { id: 1, business_id: 1, branch_id: 1, name: "Descuento", promotion_type: "product_discount", discount_type: "percentage", discount_value: 25, target_scope: "products", target_ids: [1], starts_on: null, ends_on: null, weekdays: [], service_channels: ["pos_delivery"], active: true, sort_order: 0, version: 1 } as Promotion;
    show({ ...catalog, promotions: [promotion] }); await ready(); next(); await checkout();
    expect(body(quotes()[0]).subtotal).toBe(20);
    expect(screen.getByText("Total a cobrar: 30")).toBeInTheDocument();
  });

  it.each(["0", "12.50"])("shows an empty manual field before Continue and requires explicit confirmation for %s", async (amount) => {
    mode = "quote"; show(); await ready();
    const input = screen.getByLabelText("Costo de envío");
    expect(input).toHaveValue(""); expect(input).not.toHaveAttribute("readonly");
    expect(input).toHaveAccessibleName("Costo de envío");
    expect(input.previousElementSibling).toHaveTextContent("S/");
    expect(input.previousElementSibling).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("complementary")).toHaveTextContent("Por cotizar");
    fireEvent.change(input, { target: { value: amount } });
    next(); await screen.findByRole("alert");
    expect(screen.queryByRole("dialog", { name: "Cobro" })).not.toBeInTheDocument();
    expect(body(quotes()[0])).not.toHaveProperty("confirmed_fee");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importe de envío" }));
    next(); await checkout();
    expect(quotes()).toHaveLength(2);
    expect(body(quotes()[1]).confirmed_fee).toBe(Number(amount));
    expect(screen.getByText(`Total a cobrar: ${20 + Number(amount)}`)).toBeInTheDocument();
  });

  it("accepts a fee confirmed before any quote, but sends it only after a pending server quote", async () => {
    mode = "quote"; show(); await ready(); confirmFee("10");
    expect(quotes()).toHaveLength(0); next(); await checkout();
    expect(quotes().map((call) => body(call).confirmed_fee)).toEqual([undefined, 10]);
  });

  it("does not override a final server tariff with a manually entered fee", async () => {
    mode = "quote"; show(); await ready(); confirmFee("10"); serverFee = 0; mode = "free";
    next(); await checkout();
    expect(quotes()).toHaveLength(1); expect(body(quotes()[0])).not.toHaveProperty("confirmed_fee");
    expect(screen.getByText("Total a cobrar: 20")).toBeInTheDocument();
  });

  it("allows unknown/manual neighborhoods and requires a confirmed quote instead of rejecting them locally", async () => {
    mode = "neighborhoods"; show(); await ready();
    fireEvent.change(screen.getByLabelText(/^Nombre de colonia/), { target: { value: "Nueva colonia" } });
    confirmFee("7"); next(); await checkout();
    expect(body(quotes()[0]).destination.neighborhood).toBe("Nueva colonia");
    expect(body(quotes()[1]).confirmed_fee).toBe(7);
    await back(); fireEvent.change(screen.getByLabelText("Colonia", { exact: true }), { target: { value: "Centro" } });
    next(); await checkout();
    expect(body(quotes().at(-1)!).destination.neighborhood).toBe("Centro");
    expect(body(quotes().at(-1)!)).not.toHaveProperty("confirmed_fee");
  });

  it("keeps a cached quote across checkout cancellation, invalidates it on cart or reference edits", async () => {
    show(); await ready(); next(); await checkout(); await back(); next(); await checkout();
    expect(quotes()).toHaveLength(1);
    await back(); fireEvent.change(screen.getByLabelText("Referencias"), { target: { value: "Nueva referencia" } });
    next(); await checkout(); expect(quotes()).toHaveLength(2);
    await back(); fireEvent.click(screen.getByRole("button", { name: "Agregar una unidad de Pizza" }));
    next(); await checkout(); expect(quotes()).toHaveLength(3);
    expect(body(quotes()[2]).subtotal).toBe(40);
  });

  it("refreshes policy on Continue and requires another review if fee changes before creation", async () => {
    show(); await ready(); version = 4; serverFee = 8; next(); await checkout();
    expect(body(quotes()[0]).expected_configuration_version).toBe(4);
    expect(screen.getByText("Total a cobrar: 28")).toBeInTheDocument();
    version = 5; serverFee = 12;
    fireEvent.click(screen.getByRole("button", { name: "Enviar a cocina" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("costo de envío cambió");
    expect(calls("/orders")).toHaveLength(0);
    next(); await checkout(); expect(screen.getByText("Total a cobrar: 32")).toBeInTheDocument();
  });

  it("invalidates manual confirmation when policy version changes", async () => {
    mode = "quote"; show(); await ready(); confirmFee("10"); version = 4;
    next(); await screen.findByRole("alert");
    expect(quotes()).toHaveLength(1); expect(body(quotes()[0])).not.toHaveProperty("confirmed_fee");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar importe de envío" }));
    next(); await checkout(); expect(body(quotes()[1])).toMatchObject({ confirmed_fee: 10, expected_configuration_version: 4 });
  });

  it("rejects incompatible API without a fixed fallback or order write", async () => {
    supported = false; show();
    expect(await screen.findByRole("alert")).toHaveTextContent("no admite cotizaciones");
    expect(screen.getByLabelText("Costo de envío")).toHaveValue("Por cotizar");
    next(); await waitFor(() => expect(calls("/settings/branches/1/delivery")).toHaveLength(2));
    expect(quotes()).toHaveLength(0); expect(calls("/orders")).toHaveLength(0);
  });

  it("surfaces server authorization rejection for a manual fee without checkout", async () => {
    mode = "quote"; const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation(async (path, options) => {
      if (path.endsWith("/quotes") && JSON.parse(String(options?.body)).confirmed_fee !== undefined) throw new ApiError("No tienes permiso para confirmar este costo.", 403);
      return original(path, options);
    });
    show(); await ready(); confirmFee("10"); next();
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes permiso");
    expect(screen.queryByRole("dialog", { name: "Cobro" })).not.toBeInTheDocument(); expect(calls("/orders")).toHaveLength(0);
  });

  it.each(["branch", "cart", "cancel", "unmount"])("ignores a late quote after %s", async (change) => {
    const original = apiMock.getMockImplementation()!;
    let resolve!: (value: unknown) => void;
    apiMock.mockImplementation((path, options) => path.endsWith("/quotes") ? new Promise((done) => { resolve = done; }) : original(path, options));
    const view = show(); await ready(); next(); await waitFor(() => expect(quotes()).toHaveLength(1));
    if (change === "branch") view.rerender(<NewOrderDrawer {...view.props} branch={{ ...branch, id: 2 }} />);
    if (change === "cart") fireEvent.click(screen.getByRole("button", { name: "Agregar una unidad de Pizza" }));
    if (change === "cancel") { vi.spyOn(window, "confirm").mockReturnValue(true); fireEvent.click(screen.getByRole("button", { name: "Cancelar" })); }
    if (change === "unmount") view.unmount();
    await act(async () => resolve(result(15)));
    expect(screen.queryByRole("dialog", { name: "Cobro" })).not.toBeInTheDocument(); expect(calls("/orders")).toHaveLength(0);
    expect(view.onCreated).not.toHaveBeenCalled();
  });

  it("ignores a late old-branch policy while loading the new branch", async () => {
    const original = apiMock.getMockImplementation()!;
    let resolve!: (value: unknown) => void;
    apiMock.mockImplementation((path, options) => path === "/settings/branches/1/delivery" ? new Promise((done) => { resolve = done; }) : original(path, options));
    const view = show(); view.rerender(<NewOrderDrawer {...view.props} branch={{ ...branch, id: 2 }} />);
    await ready(); await act(async () => resolve({ ...policy(), fixed_delivery_fee: 99, version: 100 }));
    expect(screen.getByLabelText("Costo de envío")).toHaveValue("S/ 15.00");
    next(); await checkout(); expect(quotes()[0][0]).toBe("/settings/branches/2/delivery/quotes");
  });

  it("retains the exact order body/key after a lost response, even after policy/quote expiration", async () => {
    const original = apiMock.getMockImplementation()!; let failed = false;
    apiMock.mockImplementation((path, options) => {
      if (path === "/orders" && !failed) { failed = true; return Promise.reject(new ApiError("Respuesta perdida", 0, undefined, "NETWORK_UNREACHABLE")); }
      return original(path, options);
    });
    const { onError, onCreated } = show(); await ready(); next(); await checkout();
    fireEvent.click(screen.getByRole("button", { name: "Enviar a cocina" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Respuesta perdida"));
    const reads = calls("/settings/branches/1/delivery").length;
    version = 9; serverFee = 80; vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120000);
    fireEvent.click(screen.getByRole("button", { name: "Volver al pedido" }));
    expect(screen.getByRole("dialog", { name: "Cobro" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enviar a cocina" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ orderId: 12, outcome: "pending_and_sent" }));
    expect(calls("/orders")).toHaveLength(2); expect(calls("/orders")[0]).toEqual(calls("/orders")[1]);
    expect(calls("/settings/branches/1/delivery")).toHaveLength(reads); expect(quotes()).toHaveLength(1);
  });

  it("cancels location without clearing address, reference or the entered map link", async () => {
    show(); await ready(); fireEvent.change(screen.getByLabelText(/Enlace de Google Maps/), { target: { value: "https://maps.google.com/?q=demo" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar ubicación" })); fireEvent.click(screen.getByRole("button", { name: "Cancelar ubicación" }));
    expect(screen.getByLabelText("Calle")).toHaveValue("Jr. Flores"); expect(screen.getByLabelText("Referencias")).toHaveValue("Puerta azul"); expect(screen.getByLabelText(/Enlace de Google Maps/)).toHaveValue("https://maps.google.com/?q=demo");
  });

  it.each(["Calle", /^Número casa/, /^Colonia/])("clears both coordinates and stale map link when %s changes", async (label) => {
    show(); await ready();
    fireEvent.click(screen.getByRole("button", { name: "Agregar ubicación" }));
    fireEvent.click(screen.getByRole("button", { name: "Elegir punto" }));
    expect(screen.getByLabelText(/Enlace de Google Maps/)).toHaveValue("https://www.google.com/maps?q=0,0");
    fireEvent.change(screen.getByLabelText(label), { target: { value: "Otro destino" } });
    expect(screen.getByLabelText(/Enlace de Google Maps/)).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Cambiar ubicación" })).not.toBeInTheDocument();
    next(); await checkout();
    expect(body(quotes()[0]).destination).not.toHaveProperty("latitude");
    expect(body(quotes()[0]).destination.maps_url).toBeNull();
  });

  it("clears a manual external map link when choosing another configured neighborhood", async () => {
    mode = "neighborhoods"; show(); await ready();
    fireEvent.change(screen.getByLabelText(/Enlace de Google Maps/), { target: { value: "https://maps.google.com/?q=old" } });
    fireEvent.change(screen.getByLabelText("Colonia", { exact: true }), { target: { value: "Centro" } });
    expect(screen.getByLabelText(/Enlace de Google Maps/)).toHaveValue("");
  });
});
