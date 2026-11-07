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
vi.mock("./NewOrderPaymentModal", () => ({ NewOrderPaymentModal: ({ total, onClose, onConfirm, busy, forceDeferredPayment }: { total: number; onClose: () => void; onConfirm: (selection: NewOrderCheckoutSelection) => void; busy: boolean; forceDeferredPayment?: boolean }) => {
  const surfaceRef = useDialogSurface<HTMLDivElement>(() => { if (!busy) onClose(); });
  return <div ref={surfaceRef} role="dialog" aria-modal="true" aria-label="Cobro" tabIndex={-1}><span>Total a cobrar: {total}</span><span>{forceDeferredPayment ? "Solo guardar sin cobrar" : "Cobro habilitado"}</span><button disabled={busy} onClick={onClose}>Volver al pedido</button><button disabled={busy} onClick={() => onConfirm({ deferPayment: true, mode: null, plan: { payments: [], change: 0, error: null } })}>{forceDeferredPayment ? "Guardar sin cobrar" : "Enviar a cocina"}</button><button disabled={busy} onClick={() => onConfirm({ deferPayment: false, mode: "yape", plan: { payments: [{ method: "yape", amount: total }], change: 0, error: null } })}>Simular selección de cobro</button></div>;
} }));
vi.mock("./settings/LocationPicker", () => ({ LocationPicker: ({ onCancel, onSelect }: { onCancel: () => void; onSelect: (point: MapPoint) => void }) => <div role="dialog" aria-label="Ubicación de prueba"><button onClick={onCancel}>Cancelar ubicación</button><button onClick={() => onSelect({ latitude: 0, longitude: 0, maps_url: "https://www.google.com/maps?q=0,0" })}>Elegir punto</button></div> }));

const branch = { id: 1, business_id: 1, delivery_fee: 99 } as Branch;
const catalog = { branch, categories: [], modifier_groups: [], ingredients: [], promotions: [], products: [{ id: 1, name: "Pizza", price: 20, service_channels: ["pos_delivery", "pos_counter"], variants: [], modifier_groups: [] }] } as unknown as Catalog;
const apiMock = vi.mocked(api);
const calls = (path: string) => apiMock.mock.calls.filter(([url]) => url === path);
const body = (call: (typeof apiMock.mock.calls)[number]) => JSON.parse(String(call[1]?.body));

function show(customCatalog = catalog) {
  const onError = vi.fn(); const onClose = vi.fn(); const onCreated = vi.fn();
  const props = { branch, catalog: customCatalog, onError, onClose, onCreated, initialChannel: "delivery" as const };
  const view = render(<NewOrderDrawer {...props} />);
  const drawer = screen.getByRole("dialog", { name: "Agrega un pedido" });
  fireEvent.click(within(drawer).getByRole("button", { name: "Agregar productos" })); fireEvent.click(screen.getByRole("button", { name: "Elegir pizza" }));
  for (const [name, value] of [["Nombre del cliente", "Ana"], ["Número de teléfono", "999888777"]]) fireEvent.change(within(drawer).getByLabelText(name), { target: { value } });
  return { ...view, props, drawer, onError, onClose, onCreated };
}
const next = () => fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
const checkout = () => screen.findByRole("dialog", { name: "Cobro" });
const fee = (amount: string) => fireEvent.change(screen.getByLabelText(/^Costo de envío/), { target: { value: amount } });
async function back() { fireEvent.click(screen.getByRole("button", { name: "Volver al pedido" })); await screen.findByRole("button", { name: "Continuar" }); }
async function save() { fireEvent.click(screen.getByRole("button", { name: /^(Guardar sin cobrar|Enviar a cocina)$/ })); await waitFor(() => expect(calls("/orders/12/confirm-and-send")).toHaveLength(1)); }

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(async (path, options) => {
    if (path === "/orders") { const payload = JSON.parse(String(options?.body)); return { id: 12, version: 1, total: payload.items.reduce((sum: number, item: { quantity: number }) => sum + item.quantity * 20, 0) + payload.delivery_fee }; }
    if (path === "/orders/12/payments") return { order: { id: 12, version: 2 } };
    if (path === "/orders/12/confirm-and-send") return { order: { id: 12 }, tickets: [{ id: 1 }] };
    throw new Error(`Unexpected test path: ${path}`);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("manual delivery orders", () => {
  it("saves with only name and phone, a pending fee and no automatic quotation or payment", async () => {
    const { onCreated } = show();
    expect(screen.getByLabelText(/^Costo de envío/)).toHaveValue(""); expect(screen.getByLabelText(/^Costo de envío/)).not.toHaveAttribute("readonly");
    expect(api).not.toHaveBeenCalled(); expect(screen.getByLabelText(/^Calle/)).not.toBeRequired(); expect(screen.getByLabelText(/^Referencias/)).not.toBeRequired();
    expect(screen.getByRole("complementary")).toHaveTextContent("Por cotizar"); next(); await checkout();
    expect(screen.getByText("Solo guardar sin cobrar")).toBeInTheDocument(); expect(screen.getByText("Total a cobrar: 20")).toBeInTheDocument(); await save();
    await waitFor(() => expect(onCreated).toHaveBeenCalledExactlyOnceWith({ orderId: 12, outcome: "pending_and_sent" }));
    expect(body(calls("/orders")[0])).toMatchObject({ customer_name: "Ana", customer_phone: "999888777", delivery_fee: 0, allow_pending_delivery_quote: true, delivery_address: { address: "", street: "", reference: null } });
    expect(body(calls("/orders")[0])).not.toHaveProperty("delivery_quote_id");
    expect(apiMock.mock.calls.map(([path]) => path)).toEqual(["/orders", "/orders/12/confirm-and-send"]);
  });

  it.each(["Nombre del cliente", "Número de teléfono"])("requires %s", (label) => {
    const { onError } = show(); fireEvent.change(screen.getByLabelText(label), { target: { value: " " } }); next();
    expect(onError).toHaveBeenCalledWith("Completa el nombre y teléfono para el delivery.");
    expect(screen.queryByRole("dialog", { name: "Cobro" })).not.toBeInTheDocument(); expect(api).not.toHaveBeenCalled();
  });

  it.each([["0", 20], ["12.50", 32.5], ["5,25", 25.25]] as const)("accepts explicit fee %s without quote confirmation and enables normal payment", async (amount, total) => {
    const { onCreated } = show(); fee(amount); next(); await checkout();
    expect(screen.getByText("Cobro habilitado")).toBeInTheDocument(); expect(screen.getByText(`Total a cobrar: ${total}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Simular selección de cobro" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledExactlyOnceWith({ orderId: 12, outcome: "paid_and_sent" }));
    expect(body(calls("/orders")[0])).toMatchObject({ delivery_fee: total - 20 });
    expect(body(calls("/orders")[0])).not.toHaveProperty("allow_pending_delivery_quote"); expect(body(calls("/orders")[0])).not.toHaveProperty("delivery_quote_id");
    expect(body(calls("/orders/12/payments")[0])).toMatchObject({ amount: total, method: "yape", expected_version: 1 });
    expect(body(calls("/orders/12/confirm-and-send")[0])).toEqual({ expected_version: 2 });
  });

  it.each(["-1", "12.345", "NaN", "1e2", "10000000000"])("rejects invalid nonblank manual fee %s without treating it as pending", (amount) => {
    show(); fee(amount); next(); expect(screen.getByRole("alert")).toHaveTextContent("Ingresa un costo de envío de cero o mayor");
    expect(screen.queryByRole("dialog", { name: "Cobro" })).not.toBeInTheDocument(); expect(api).not.toHaveBeenCalled();
  });

  it("does not charge a pending quote even if checkout supplies a nondeferred selection", async () => {
    const { onCreated } = show(); next(); await checkout(); fireEvent.click(screen.getByRole("button", { name: "Simular selección de cobro" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledExactlyOnceWith({ orderId: 12, outcome: "pending_and_sent" })); expect(calls("/orders/12/payments")).toHaveLength(0);
  });

  it("preserves optional delivery fields and zero coordinates in the order", async () => {
    show();
    for (const [label, value] of [[/^Calle/, "Jr. Flores"], [/^Número casa/, "245"], [/^Colonia/, "Centro"], [/Entre calles/, "A y B"], [/^Referencias/, "Puerta azul"]] as const) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar ubicación" })); fireEvent.click(screen.getByRole("button", { name: "Elegir punto" })); next(); await checkout(); await save();
    expect(body(calls("/orders")[0]).delivery_address).toEqual({ address: "Jr. Flores 245, Centro, Entre A y B", street: "Jr. Flores", number: "245", cross_streets: "A y B", neighborhood: "Centro", reference: "Puerta azul", latitude: 0, longitude: 0, maps_url: "https://www.google.com/maps?q=0,0" });
  });

  it("keeps promotions and product totals when the manual shipping fee is unknown", async () => {
    const promotion = { id: 1, business_id: 1, branch_id: 1, name: "Descuento", promotion_type: "product_discount", discount_type: "percentage", discount_value: 25, target_scope: "products", target_ids: [1], starts_on: null, ends_on: null, weekdays: [], service_channels: ["pos_delivery"], active: true, sort_order: 0, version: 1 } as Promotion;
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((path, options) => path === "/orders" ? Promise.resolve({ id: 12, version: 1, total: 15 }) : original(path, options));
    const { onCreated } = show({ ...catalog, promotions: [promotion] }); next(); await checkout();
    expect(screen.getByText("Total a cobrar: 15")).toBeInTheDocument(); await save();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ orderId: 12, outcome: "pending_and_sent" })); expect(body(calls("/orders")[0]).items[0]).toMatchObject({ product_id: 1, quantity: 1 });
  });

  it("reviews a changed authoritative total before collecting or sending to kitchen", async () => {
    apiMock.mockResolvedValueOnce({ id: 12, version: 1, total: 50 }); const { onCreated } = show(); fee("5"); next(); await checkout();
    fireEvent.click(screen.getByRole("button", { name: "Simular selección de cobro" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ orderId: 12, outcome: "total_changed" }))); expect(api).toHaveBeenCalledTimes(1);
  });

  it("retains the exact order body/key after a lost response and prevents closing before recovery", async () => {
    const original = apiMock.getMockImplementation()!; let failed = false;
    apiMock.mockImplementation((path, options) => {
      if (path === "/orders" && !failed) { failed = true; return Promise.reject(new ApiError("Respuesta perdida", 0, undefined, "NETWORK_UNREACHABLE")); }
      return original(path, options);
    });
    const { onError, onCreated } = show(); next(); await checkout(); fireEvent.click(screen.getByRole("button", { name: "Guardar sin cobrar" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Respuesta perdida")); fireEvent.click(screen.getByRole("button", { name: "Volver al pedido" }));
    expect(screen.getByRole("dialog", { name: "Cobro" })).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "Guardar sin cobrar" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ orderId: 12, outcome: "pending_and_sent" }));
    expect(calls("/orders")).toHaveLength(2); expect(calls("/orders")[0]).toEqual(calls("/orders")[1]); expect(calls("/orders/12/payments")).toHaveLength(0);
  });

  it("does not collect or send after the branch changes during creation", async () => {
    let resolve!: (value: unknown) => void; apiMock.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = show(); fee("5"); next(); await checkout(); fireEvent.click(screen.getByRole("button", { name: "Simular selección de cobro" }));
    await waitFor(() => expect(calls("/orders")).toHaveLength(1)); view.rerender(<NewOrderDrawer {...view.props} branch={{ ...branch, id: 2 }} />);
    await act(async () => resolve({ id: 12, total: 25, version: 1 }));
    expect(api).toHaveBeenCalledTimes(1); expect(view.onCreated).not.toHaveBeenCalled(); expect(view.onError).toHaveBeenCalledWith(expect.stringContaining("sucursal cambió"));
  });

  it("recomputes totals after returning to edit the cart and pending fee", async () => {
    show(); next(); await checkout(); await back(); fee("5"); fireEvent.click(screen.getByRole("button", { name: "Agregar una unidad de Pizza" })); next(); await checkout();
    expect(screen.getByText("Total a cobrar: 45")).toBeInTheDocument(); expect(screen.getByText("Cobro habilitado")).toBeInTheDocument(); expect(api).not.toHaveBeenCalled();
  });

  it("restores Continue after Escape closes checkout without closing the order", async () => {
    const { onClose } = show(); const trigger = screen.getByRole("button", { name: "Continuar" }); act(() => trigger.focus()); next(); await checkout();
    await waitFor(() => expect(screen.getByRole("button", { name: "Volver al pedido" })).toHaveFocus()); fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus()); expect(onClose).not.toHaveBeenCalled();
  });

  it("does not steal focus from a higher dialog while restoring checkout focus", async () => {
    show(); next(); await checkout(); await waitFor(() => expect(screen.getByRole("button", { name: "Volver al pedido" })).toHaveFocus());
    const trigger = screen.getByRole("button", { name: "Continuar", hidden: true }); fireEvent.keyDown(document.activeElement!, { key: "Escape" }); const focus = vi.spyOn(trigger, "focus");
    render(<SettingsConfirmDialog title="Confirmación superior" detail="Revisa antes de continuar." confirmLabel="Aceptar" onCancel={vi.fn()} onConfirm={vi.fn()} />);
    const dialog = screen.getByRole("alertdialog", { name: "Confirmación superior" }); await waitFor(() => expect(within(dialog).getByRole("button", { name: "Seguir editando" })).toHaveFocus()); expect(focus).not.toHaveBeenCalled();
  });

  it("cancels location without clearing optional fields or an external map link", () => {
    show(); fireEvent.change(screen.getByLabelText(/^Calle/), { target: { value: "Jr. Flores" } }); fireEvent.change(screen.getByLabelText(/^Referencias/), { target: { value: "Puerta azul" } });
    fireEvent.change(screen.getByLabelText(/Enlace de Google Maps/), { target: { value: "https://maps.google.com/?q=demo" } }); fireEvent.click(screen.getByRole("button", { name: "Agregar ubicación" })); fireEvent.click(screen.getByRole("button", { name: "Cancelar ubicación" }));
    expect(screen.getByLabelText(/^Calle/)).toHaveValue("Jr. Flores"); expect(screen.getByLabelText(/^Referencias/)).toHaveValue("Puerta azul"); expect(screen.getByLabelText(/Enlace de Google Maps/)).toHaveValue("https://maps.google.com/?q=demo");
  });

  it.each([/^Calle/, /^Número casa/, /^Colonia/])("clears stale coordinates and map link when %s changes", async (label) => {
    show(); fireEvent.click(screen.getByRole("button", { name: "Agregar ubicación" })); fireEvent.click(screen.getByRole("button", { name: "Elegir punto" })); fireEvent.change(screen.getByLabelText(label), { target: { value: "Otro destino" } });
    expect(screen.getByLabelText(/Enlace de Google Maps/)).toHaveValue(""); expect(screen.queryByRole("button", { name: "Cambiar ubicación" })).not.toBeInTheDocument(); next(); await checkout(); await save();
    expect(body(calls("/orders")[0]).delivery_address).not.toHaveProperty("latitude"); expect(body(calls("/orders")[0]).delivery_address.maps_url).toBeNull();
  });
});
