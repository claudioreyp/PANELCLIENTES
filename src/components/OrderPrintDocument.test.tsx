import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { OrderDetail, RestaurantContext } from "../types";
import { renderThermalBody } from "../lib/thermal-print";
import { OrderPrintDocument } from "./OrderPrintDocument";

const tenant = vi.hoisted(() => ({ context: null as RestaurantContext | null }));
vi.mock("../lib/tenant", () => ({ useTenant: () => tenant }));
const order: OrderDetail = {
  id: 90, business_id: 1, branch_id: 2, number: "TEST", folio: 4,
  channel: "counter", source: "pos", status: "preparing", payment_status: "pending",
  created_at: "2026-06-17T21:36:00Z", version: 1, subtotal: 20, discount: 0,
  delivery_fee: 0, total: 20, paid_amount: 0, remaining_amount: 20, payments: [], kitchen_tickets: [],
  items: [{ id: 1, product_id: null, name: "Producto de prueba", quantity: 1, unit_price: 20, line_total: 20, status: "preparing", modifiers: [] }],
};

describe("OrderPrintDocument", () => {
  afterEach(() => { cleanup(); tenant.context = null; });

  it("portals exactly the reusable thermal markup, with no automatic print side effects", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => undefined);
    const { unmount } = render(<OrderPrintDocument order={order} paperWidth={58} businessName="Restaurante de prueba" />);
    const surface = document.body.querySelector(".order-print-document")!;
    expect(surface.parentElement).toBe(document.body);
    const standalone = document.createElement("div");
    standalone.innerHTML = renderThermalBody({ order, paperWidth: 58, businessName: "Restaurante de prueba" });
    expect(surface.querySelector(".thermal-document")?.outerHTML).toBe(standalone.firstElementChild?.outerHTML);
    expect(surface).toHaveClass("order-print-58");
    expect(print).not.toHaveBeenCalled();
    unmount();
    expect(document.querySelector(".order-print-document")).toBeNull();
    print.mockRestore();
  });

  it("resolves the order's business and branch, not a different selected branch", () => {
    tenant.context = { business: { id: 1, name: "Negocio del pedido" }, branches: [{ id: 2, name: "Sucursal del pedido" }, { id: 3, name: "Otra sucursal" }] } as RestaurantContext;
    const { rerender } = render(<OrderPrintDocument order={order} />);
    expect(document.querySelector(".order-print-document")).toHaveTextContent("Negocio del pedido");
    expect(document.querySelector(".order-print-document")).toHaveTextContent("Sucursal del pedido");
    expect(document.querySelector(".order-print-document")).not.toHaveTextContent("Otra sucursal");
    tenant.context = { business: { id: 4, name: "Negocio ajeno" }, branches: [{ id: 2, name: "Sucursal ajena" }] } as RestaurantContext;
    rerender(<OrderPrintDocument order={order} />);
    expect(document.querySelector(".order-print-document")).not.toHaveTextContent("Negocio ajeno");
    expect(document.querySelector(".order-print-document")).not.toHaveTextContent("Sucursal ajena");
  });

  it("keeps historical explicit names and escapes their markup", () => {
    tenant.context = { business: { id: 1, name: "Nombre actual" }, branches: [] } as unknown as RestaurantContext;
    render(<OrderPrintDocument order={order} businessName={'<img src=x onerror="evil()"> Histórico'} />);
    expect(document.querySelector(".order-print-document")).toHaveTextContent('<img src=x onerror="evil()"> Histórico');
    expect(document.querySelector(".order-print-document img")).toBeNull();
    expect(document.querySelector(".order-print-document")).not.toHaveTextContent("Nombre actual");
  });

  it("owns print-only presentation with physical widths, not the app's cards", () => {
    const css = readFileSync("src/components/order-print-document.css", "utf8");
    expect(css).toContain(".order-print-document { display: none; }");
    expect(css).toContain("@media print");
    expect(css).toContain("width: 80mm");
    expect(css).toContain("width: 58mm");
    expect(css).toContain("body:has(.order-print-document) > * { display: none !important; }");
  });

  it("passes the same template to browser markup and standalone HTML rendering", () => {
    const options = { order, paperWidth: 80 as const, businessName: "Nombre oculto", template: { fields: [{ key: "business", enabled: false }, { key: "payment", enabled: false }] } };
    render(<OrderPrintDocument {...options} />);
    const expected = document.createElement("div");
    expected.innerHTML = renderThermalBody(options);
    expect(document.querySelector(".order-print-document .thermal-document")?.outerHTML).toBe(expected.firstElementChild?.outerHTML);
    expect(document.querySelector(".order-print-document")).not.toHaveTextContent("Nombre oculto");
    expect(document.querySelector(".thermal-totals")).toHaveTextContent("Monto a pagarS/ 20.00");
  });
});
