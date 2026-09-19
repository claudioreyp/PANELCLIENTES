import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KitchenTicket, OrderDetail } from "../types";
import { OrderCommands } from "./OrderCommands";

afterEach(cleanup);

const item = {
  id: 1, product_id: 1, name: "Alitas", variant_name: "Chico", quantity: 1,
  unit_price: 30, line_total: 30, status: "sent", notes: "Salsa aparte",
  modifiers: [{ name: "BBQ", price_delta: 0, group_name: "Elige las salsas" }],
};
const ticket: KitchenTicket = {
  id: 10, order_id: 7, sequence: 1, station: "kitchen", status: "queued", version: 1,
  created_at: "2026-09-12T20:57:00Z", created_by_name: "Ana", print_count: 0,
  items: [{ ...item, item_id: item.id }],
};
const order: OrderDetail = {
  id: 7, number: "PRUEBA-7", folio: 7, business_id: 1, branch_id: 1,
  channel: "counter", source: "pos", status: "preparing", payment_status: "pending",
  subtotal: 30, discount: 0, delivery_fee: 0, total: 30, paid_amount: 0, remaining_amount: 30,
  version: 1, created_at: ticket.created_at, items: [item], payments: [], kitchen_tickets: [ticket],
};
const callbacks = { editable: true, busy: false, onEdit: vi.fn(), onPrint: vi.fn() };

function expandFirstCommand() {
  fireEvent.click(screen.getByRole("button", { name: /Comanda #1/ }));
}

describe("preparation in order details", () => {
  it.each(["ready", "served"] as const)("shows each product as prepared for a %s command, independently of item/payment state", (status) => {
    render(<OrderCommands {...callbacks} order={{ ...order, kitchen_tickets: [{ ...ticket, status }] }} />);
    expandFirstCommand();
    expect(screen.getByText("Preparado", { exact: true })).toBeVisible();
    expect(screen.getByText("1 × Alitas - Chico")).toBeVisible();
    expect(screen.getByText("Salsa aparte")).toBeVisible();
    expect(screen.getByText("1 × BBQ")).toBeVisible();
    expect(screen.getByText("S/ 30.00")).toBeVisible();
  });

  it.each(["queued", "preparing", "cancelled"] as const)("never infers prepared for a %s command from a paid/ready order or stale timestamp", (status) => {
    render(<OrderCommands {...callbacks} order={{ ...order, status: "ready", payment_status: "paid", kitchen_tickets: [{ ...ticket, status, ready_at: ticket.created_at }] }} />);
    expandFirstCommand();
    expect(screen.queryByText("Preparado", { exact: true })).toBeNull();
  });

  it("reflects confirmed completion and reopening without remounting or collapsing the command", () => {
    const { rerender } = render(<OrderCommands {...callbacks} order={order} />);
    expandFirstCommand();
    expect(screen.queryByText("Preparado", { exact: true })).toBeNull();
    rerender(<OrderCommands {...callbacks} order={{ ...order, kitchen_tickets: [{ ...ticket, status: "ready", version: 2 }] }} />);
    expect(screen.getByText("Preparado", { exact: true })).toBeVisible();
    rerender(<OrderCommands {...callbacks} order={{ ...order, kitchen_tickets: [{ ...ticket, status: "preparing", version: 3 }] }} />);
    expect(screen.queryByText("Preparado", { exact: true })).toBeNull();
    expect(screen.getByRole("button", { name: /Comanda #1/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps additions and unsent products separate from the completed command", () => {
    const addition = { ...item, id: 2 };
    render(<OrderCommands {...callbacks} order={{ ...order, items: [item, addition, { ...item, id: 3 }], kitchen_tickets: [
      { ...ticket, status: "ready" },
      { ...ticket, id: 11, sequence: 2, items: [{ ...ticket.items[0], item_id: 2 }] },
    ] }} />);
    expandFirstCommand();
    const second = screen.getByRole("button", { name: /Comanda #2/ });
    fireEvent.click(second);
    expect(screen.getAllByText("Preparado", { exact: true })).toHaveLength(1);
    expect(within(second.closest("article")!).queryByText("Preparado", { exact: true })).toBeNull();
    expect(screen.getByText(/todavía no se enviaron a cocina/)).toBeVisible();
  });

  it("preserves prepared and cancelled badges together with original amounts and cancellation reason in history", () => {
    const cancelled = { ...item, id: 2, name: "Pizza", variant_name: null, status: "cancelled", cancellation_reason: "Cliente desistió" };
    render(<OrderCommands {...callbacks} readOnly order={{ ...order, items: [item, cancelled], kitchen_tickets: [
      { ...ticket, status: "ready", items: [...ticket.items, { ...cancelled, item_id: 2, action: "cancelled" }] },
    ] }} />);
    expandFirstCommand();
    expect(screen.getAllByText("Preparado", { exact: true })).toHaveLength(2);
    const cancelledLine = screen.getByText("1 × Pizza").closest("article")!;
    expect(cancelledLine).toHaveClass("is-inactive");
    expect(within(cancelledLine).getByText("Preparado", { exact: true })).toBeVisible();
    expect(within(cancelledLine).getByText("Cancelado", { exact: true })).toHaveAttribute("title", "Cliente desistió");
    expect(within(cancelledLine).getByText("S/ 30.00")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Acciones de la comanda 1" }));
    expect(screen.getByRole("menuitem", { name: "Imprimir comanda" })).toBeEnabled();
    expect(screen.queryByRole("menuitem", { name: "Editar productos" })).toBeNull();
  });
});
