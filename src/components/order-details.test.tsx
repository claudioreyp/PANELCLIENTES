import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";
import { orderEditChanges, orderEditDraft, validateOrderEdit } from "../lib/order-edit";
import { draftOrderPresentation, groupOrderModifiers, orderClipboardText, savedOrderLines, whatsappPhone } from "../lib/order-presentation";
import type { Branch, Catalog, OrderDetail } from "../types";
import { OrderActionsMenu } from "./OrderActionsMenu";
import { OrderBreakdown } from "./OrderBreakdown";
import { OrderEditDrawer } from "./OrderEditDrawer";
import { Modal } from "./ui";

vi.mock("../lib/api", async (original) => ({ ...await original<typeof import("../lib/api")>(), api: vi.fn() }));
const branch = { id: 1, delivery_fee: 5 } as Branch;
const order: OrderDetail = {
  id: 1, branch_id: 1, business_id: 1, number: "0001", channel: "takeaway", source: "pos", status: "preparing", payment_status: "pending", customer_name: "Pepe", customer_phone: "+51912345678",
  subtotal: 52, discount: 9, promotion_discount: 9, delivery_fee: 0, total: 43, version: 2, created_at: "2026-09-08T12:00:00Z",
  items: [{ id: 1, product_id: 1, name: "Alitas", variant_name: "Grande", quantity: 1, unit_price: 52, line_total: 52, promotion_discount: 9, status: "preparing", notes: "Salsas aparte", modifiers: [
    { modifier_id: 1, name: "BBQ", price_delta: 0, group_id: 1, group_name: "Elige tus salsas" },
    { modifier_id: 2, name: "Ranch", price_delta: 3.5, group_id: 2, group_name: "Extras" },
    { modifier_id: 2, name: "Ranch", price_delta: 3.5, group_id: 2, group_name: "Extras" },
  ] }], payments: [], kitchen_tickets: [], paid_amount: 0, remaining_amount: 43,
};

describe("order presentation and editor", () => {
  afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });
  it("groups repetitions by group and multiplies quantities once", () => {
    const groups = groupOrderModifiers(order.items[0].modifiers, 2);
    expect(groups[1].options[0]).toMatchObject({ name: "Ranch", quantity: 4, amount: 14 });
    expect(groups[0].options[0].amount).toBe(0);
  });
  it("renders persisted discounts, notes, variants and a legacy group fallback", () => {
    render(<OrderBreakdown lines={savedOrderLines(order.items)} />);
    expect(screen.getByText("1 × Alitas - Grande")).toBeVisible();
    expect(screen.getByText("Salsas aparte")).toBeVisible();
    expect(screen.getByText("2 × Ranch")).toBeVisible();
    expect(document.querySelector("del")).toHaveTextContent("S/ 52.00");
    expect(screen.getByText("S/ 43.00")).toBeVisible();
    expect(groupOrderModifiers([{ name: "Opción antigua", price_delta: 0 }], 1)[0].name).toBe("Personalizaciones");
  });
  it("copies the requested summary without IDs or creating another order", () => {
    expect(orderClipboardText(order)).toBe("Nombre: Pepe\n\nPara llevar\n\nProductos: 52 S/\nDescuento: -9 S/\nTotal: 43 S/");
    expect(orderClipboardText({ ...order, delivery_fee: 5, total: 48 })).toContain("Costo de envío: 5 S/");
    expect(whatsappPhone("912 345 678")).toBe("51912345678");
    expect(whatsappPhone("no tengo")).toBeNull();
  });
  it("filters draft promotions by Lima date, weekday and channel", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-09T02:00:00Z")); // Tuesday in Lima.
    const catalog: Catalog = {
      branch, categories: [], modifier_groups: [], ingredients: [],
      products: [{ id: 1, category_id: 1, sku: "ALITAS", name: "Alitas", price: 50, service_channels: ["pos_takeaway", "pos_delivery"], product_type: "standard", available: true, track_stock: false, preparation_station: "kitchen", sort_order: 0, variants: [], modifier_groups: [], recipe: [], combo_components: [] }],
      promotions: [{ id: 1, business_id: 1, branch_id: 1, name: "Martes", sort_order: 0, version: 1, active: true, archived_at: null, starts_on: "2026-09-08", ends_on: "2026-09-08", weekdays: [1], service_channels: ["pos_takeaway"], promotion_type: "product_discount", target_scope: "products", target_ids: [1], discount_type: "percentage", discount_value: 20 }],
    };
    const cart = [{ key: "1", productId: 1, name: "Alitas", quantity: 1, unitPrice: 50, modifiers: [] }];
    expect(draftOrderPresentation(cart, catalog, "takeaway").pricing.total).toBe(40);
    expect(draftOrderPresentation(cart, catalog, "delivery").pricing.total).toBe(50);
    vi.setSystemTime(new Date("2026-09-09T06:00:00Z"));
    expect(draftOrderPresentation(cart, catalog, "takeaway").pricing.total).toBe(50);
  });
  it("does not rewrite legacy address or location on a customer-only edit", () => {
    const delivered = { ...order, channel: "delivery", delivery_address: { address: "Av. Lima 10", reference: "Puerta verde", latitude: -12, longitude: -77 } };
    const initial = orderEditDraft(delivered);
    expect(orderEditChanges(delivered, initial, { ...initial, name: "Ana" })).toEqual({ customer_name: "Ana" });
    const changes = orderEditChanges(delivered, initial, { ...initial, street: "Av. Lima 20" });
    expect(changes.delivery_address).not.toHaveProperty("latitude");
    expect(changes.delivery_address).toHaveProperty("address", "Av. Lima 20");
  });
  it("keeps the draft on real failure and allows a retry", async () => {
    vi.mocked(api).mockRejectedValueOnce(new ApiError("Revisa los datos", 422)).mockResolvedValueOnce({ ...order, customer_name: "Ana", version: 3 });
    const saved = vi.fn();
    render(<OrderEditDrawer order={order} branch={branch} onClose={vi.fn()} onSaved={saved} />);
    fireEvent.change(screen.getByLabelText("Nombre de cliente"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Nombre de cliente")).toHaveValue("Ana");
    expect(saved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  });
  it("reconciles a lost response against persisted state", async () => {
    const persisted = { ...order, customer_name: "Ana", version: 3 };
    vi.mocked(api).mockRejectedValueOnce(new ApiError("connection", 0)).mockResolvedValueOnce(persisted);
    const saved = vi.fn();
    render(<OrderEditDrawer order={order} branch={branch} onClose={vi.fn()} onSaved={saved} />);
    fireEvent.change(screen.getByLabelText("Nombre de cliente"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(persisted));
    expect(vi.mocked(api).mock.calls[1]).toEqual(["/orders/1"]);
  });
  it("requires confirmation of an authoritative total change", async () => {
    vi.mocked(api).mockRejectedValueOnce(new ApiError("changed", 409, { detail: { total: 52 } }, "ORDER_TOTAL_CHANGED")).mockResolvedValueOnce({ ...order, channel: "counter", total: 52, version: 3 });
    const saved = vi.fn();
    render(<OrderEditDrawer order={order} branch={branch} onClose={vi.fn()} onSaved={saved} />);
    fireEvent.change(screen.getByLabelText("Tipo de pedido"), { target: { value: "counter" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar nuevo total" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(JSON.parse(vi.mocked(api).mock.calls[1][1]!.body as string).expected_total).toBe(52);
  });
  it("switches own/external delivery fields without mutating the order", () => {
    render(<OrderEditDrawer order={order} branch={branch} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Tipo de pedido"), { target: { value: "delivery" } });
    expect(screen.getByLabelText("Costo de envío")).toHaveValue(5);
    expect(screen.getByLabelText("Referencias")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Servicio de entrega"), { target: { value: "rappi" } });
    expect(screen.getByLabelText("ID de pedido de Rappi")).toBeVisible();
    expect(screen.queryByLabelText("Costo de envío")).toBeNull();
    expect(order.channel).toBe("takeaway");
  });
  it("locks fulfillment after payment and resets the form on reopen", () => {
    const props = { order: { ...order, paid_amount: 5 }, branch, onClose: vi.fn(), onSaved: vi.fn() };
    const { unmount } = render(<OrderEditDrawer {...props} />);
    expect(screen.getByLabelText("Tipo de pedido")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Nombre de cliente"), { target: { value: "Sin guardar" } });
    unmount(); render(<OrderEditDrawer {...props} />);
    expect(screen.getByLabelText("Nombre de cliente")).toHaveValue("Pepe");
  });
  it("initializes the own delivery fee once when returning from an external service", () => {
    render(<OrderEditDrawer order={{ ...order, channel: "delivery", delivery_address: { delivery_service: "rappi" } }} branch={branch} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Servicio de entrega"), { target: { value: "own" } });
    expect(screen.getByLabelText("Costo de envío")).toHaveValue(5);
    fireEvent.change(screen.getByLabelText("Costo de envío"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Servicio de entrega"), { target: { value: "rappi" } });
    fireEvent.change(screen.getByLabelText("Servicio de entrega"), { target: { value: "own" } });
    expect(screen.getByLabelText("Costo de envío")).toHaveValue(0);
  });
  it("allows a legacy note correction without requesting unchanged delivery data", () => {
    const draft = orderEditDraft({ ...order, channel: "delivery", customer_phone: null });
    expect(validateOrderEdit(draft, { notes: "Tocar el timbre" })).toBeNull();
    expect(validateOrderEdit(draft, { delivery_fee: 10 })).toContain("Completa nombre");
  });
  it("opens a keyboard menu and Escape closes only the menu", async () => {
    const close = vi.fn(); const action = vi.fn();
    render(<Modal title="Detalle" onClose={close}><OrderActionsMenu label="Acciones del pedido" actions={[{ label: "Editar pedido", icon: null, onSelect: action }, { label: "Contactar cliente", icon: null, disabled: true, onSelect: action }, { label: "Cancelar pedido", icon: null, onSelect: action }]} /></Modal>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus());
    const trigger = screen.getByRole("button", { name: "Acciones del pedido" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Editar pedido" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Cancelar pedido" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull(); expect(trigger).toHaveFocus(); expect(close).not.toHaveBeenCalled();
  });
});
