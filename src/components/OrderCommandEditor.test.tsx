import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Catalog, KitchenTicket, OrderItem, Product, Promotion } from "../types";
import { orderServiceChannel } from "../lib/order-presentation";
import { OrderCommandEditor } from "./OrderCommandEditor";

const product: Product = {
  id: 1, sku: "ALITAS", category_id: 1, name: "Alitas", price: 30, product_type: "standard", available: true, track_stock: false, preparation_station: "kitchen", sort_order: 0, recipe: [], combo_components: [], service_channels: ["pos_takeaway", "pos_counter"],
  variants: [{ id: 1, name: "Chico", price_delta: 0, active: true }, { id: 2, name: "Mediano", price_delta: 15, active: true }],
  modifier_groups: [{ id: 1, branch_id: 1, name: "Extras", minimum: 0, maximum: 3, required: false, allow_repeats: true, max_per_option: 3, sort_order: 0, modifiers: [{ id: 1, name: "Ranch", price_delta: 7, active: true, sort_order: 0 }] }],
};
const item: OrderItem = { id: 1, product_id: 1, name: "Alitas", variant_name: "Mediano", quantity: 1, unit_price: 59, line_total: 59, status: "preparing", notes: "Salsas aparte", modifiers: [{ modifier_id: 1, name: "Ranch", price_delta: 7 }, { modifier_id: 1, name: "Ranch", price_delta: 7 }] };
const promotion: Promotion = { id: 1, branch_id: 1, business_id: 1, name: "Descuento", promotion_type: "product_discount", discount_type: "percentage", discount_value: 20, target_scope: "products", target_ids: [1], weekdays: [], service_channels: ["pos_takeaway"], active: true, version: 1, sort_order: 0 };
const catalog: Catalog = { branch: { id: 1, business_id: 1, name: "Matriz", slug: "matriz", active: true, opening_hours: {}, delivery_enabled: true, takeaway_enabled: true, delivery_fee: 5, accepted_payment_methods: ["cash"] }, categories: [], ingredients: [], modifier_groups: product.modifier_groups, products: [product], promotions: [promotion] };
const ticket: KitchenTicket = { id: 1, order_id: 1, sequence: 1, station: "kitchen", status: "preparing", items: [{ item_id: 1, name: "Alitas", quantity: 1 }], print_count: 0, created_at: "2026-09-08T12:00:00Z" };
const props = { catalog, ticket, items: [item], activeItemCount: 2, busy: false, serviceChannel: "pos_takeaway" as const, onClose: vi.fn(), onSave: vi.fn() };

describe("command product actions", () => {
  it("blocks cancelling the final active product and preserves the editor", () => {
    render(<OrderCommandEditor {...props} activeItemCount={1} />);
    fireEvent.click(screen.getByLabelText("Acciones de Alitas"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Cancelar producto" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Por error" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar producto" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Para cancelar todos los productos");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(screen.getByText("Alitas - Mediano")).toBeVisible();
    expect(props.onSave).not.toHaveBeenCalled();
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });
  it("keeps the reference summary and keyboard actions in the initial state", async () => {
    render(<OrderCommandEditor {...props} />);
    expect(screen.getByText("Selecciona un producto")).toBeVisible();
    expect(screen.getByText("Alitas - Mediano")).toBeVisible();
    expect(screen.getByText('"Salsas aparte"')).toBeVisible();
    expect(screen.getByText("Ranch ×2")).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText("Cerrar editor")).toHaveFocus());
    const trigger = screen.getByLabelText("Acciones de Alitas");
    fireEvent.click(trigger);
    expect(screen.getAllByRole("menuitem").map((button) => button.textContent)).toEqual(["Editar", "Cancelar producto"]);
    expect(screen.getByRole("menuitem", { name: "Editar" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Cancelar producto" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveFocus();
    expect(props.onClose).not.toHaveBeenCalled();
  });
  it("shows absolute variant prices and only eligible promotion badges", () => {
    const { rerender } = render(<OrderCommandEditor {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Alitas - Mediano/ }));
    expect(screen.getByRole("radio", { name: /Chico/ })).not.toBeChecked();
    expect(screen.getByText("S/ 24.00")).toBeVisible();
    expect(screen.getByText("S/ 36.00")).toBeVisible();
    expect(screen.getAllByText("20%")).toHaveLength(2);
    rerender(<OrderCommandEditor {...props} serviceChannel="pos_counter" />);
    expect(screen.getByText("S/ 45.00")).toBeVisible();
    expect(screen.queryByText("20%")).toBeNull();
    expect(orderServiceChannel({ channel: "delivery", source: "n8n" })).toBe("digital_delivery");
  });
  it("retains staged changes when reopened and serializes repeated units", () => {
    render(<OrderCommandEditor {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Alitas - Mediano/ }));
    fireEvent.click(screen.getByLabelText("Agregar una unidad de Ranch"));
    expect(screen.getByLabelText("Cantidad de Ranch")).toHaveTextContent("3");
    expect(screen.getByLabelText("Agregar una unidad de Ranch")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Cantidad de Alitas"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Nota adicional"), { target: { value: "Sin sal" } });
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Editar producto" }));
    expect(screen.getByText('"Sin sal"')).toBeVisible();
    fireEvent.click(screen.getByLabelText("Acciones de Alitas"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Editar" }));
    expect(screen.getByLabelText("Cantidad de Ranch")).toHaveTextContent("3");
    expect(screen.getByLabelText("Cantidad de Alitas")).toHaveValue(2);
    expect(screen.getByLabelText("Nota adicional")).toHaveValue("Sin sal");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(props.onSave).toHaveBeenCalledWith([{ type: "edit", item_id: 1, replacement: { product_id: 1, quantity: 2, variant_name: "Mediano", notes: "Sin sal", modifiers: Array.from({ length: 3 }, () => ({ modifier_id: 1, name: "Ranch", price_delta: 7 })) } }]);
  });
  it("requires a reason and stages cancellation without sending before Save", async () => {
    render(<OrderCommandEditor {...props} />);
    fireEvent.click(screen.getByLabelText("Acciones de Alitas"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Cancelar producto" }));
    await waitFor(() => expect(screen.getByLabelText("Motivo")).toHaveFocus());
    expect(screen.getByRole("button", { name: "Cancelar producto" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "  Por error  " } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar producto" }));
    expect(props.onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Cancelación preparada")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(props.onSave).toHaveBeenCalledWith([{ type: "cancel", item_id: 1, reason: "Por error" }]);
  });
  it("protects unapplied changes and keeps data when close is declined", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<OrderCommandEditor {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Alitas - Mediano/ }));
    fireEvent.change(screen.getByLabelText("Nota adicional"), { target: { value: "Sin sal" } });
    fireEvent.click(screen.getByLabelText("Cerrar editor"));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nota adicional")).toHaveValue("Sin sal");
  });
  it("allows undoing a staged cancellation and keeps the actions button", () => {
    render(<OrderCommandEditor {...props} />);
    fireEvent.click(screen.getByLabelText("Acciones de Alitas"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Cancelar producto" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Por error" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar producto" }));
    fireEvent.click(screen.getByLabelText("Acciones de Alitas"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Deshacer cambios" }));
    expect(screen.queryByText("Cancelación preparada")).toBeNull();
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
  });
  it("disables editing and option controls while saving", () => {
    const { rerender } = render(<OrderCommandEditor {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Alitas - Mediano/ }));
    rerender(<OrderCommandEditor {...props} busy />);
    expect(screen.getByLabelText("Acciones de Alitas")).toBeDisabled();
    expect(screen.getByLabelText("Cantidad de Alitas")).toBeDisabled();
    expect(screen.getByLabelText("Agregar una unidad de Ranch")).toBeDisabled();
    expect(screen.getByLabelText("Nota adicional")).toBeDisabled();
  });
});
