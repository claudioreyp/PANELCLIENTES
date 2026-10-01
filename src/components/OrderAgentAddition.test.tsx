import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderDetail, OrderWorkspaceItem } from "../types";
import { OrderDetailContent } from "./OrderDetailContent";
import { OrderListPanel } from "./OrderListPanel";

vi.mock("../lib/tenant", () => ({ useTenant: () => ({ context: null }) }));
afterEach(cleanup);

const addition = { at: "2026-10-01T23:35:00Z", source: "agent" as const, item_count: 1, summary: "Agregó 1 × Agua sin gas." };
const workspaceOrder: OrderWorkspaceItem = {
  id: 72, number: "261001-POS72", folio: 72, customer_name: "Cliente de mostrador", channel: "counter", source: "pos",
  created_at: "2026-10-01T23:30:00Z", status: "sent_to_kitchen", payment_status: "partial", total: 17,
  delivery_fee: 0, requires_review: false, item_count: 2, version: 2, recent_agent_addition: addition,
};
const pizza = { id: 1, product_id: 1, name: "Pizza Americana", variant_name: "Personal", quantity: 1, unit_price: 15, line_total: 15, modifiers: [], status: "sent" };
const water = { id: 2, product_id: 2, name: "Agua", variant_name: "sin gas", quantity: 1, unit_price: 2, line_total: 2, modifiers: [], status: "sent" };
const detailOrder: OrderDetail = {
  ...workspaceOrder, business_id: 1, branch_id: 1, subtotal: 17, discount: 0,
  items: [pizza, water], paid_amount: 15, remaining_amount: 2,
  payments: [{ id: 1, order_id: 72, method: "cash", amount: 15, status: "confirmed", created_at: workspaceOrder.created_at }],
  kitchen_tickets: [
    { id: 1, order_id: 72, sequence: 1, station: "kitchen", status: "ready", created_by_name: "AlonsoRey", created_at: workspaceOrder.created_at, print_count: 0, items: [{ ...pizza, item_id: 1 }] },
    { id: 2, order_id: 72, sequence: 2, station: "kitchen", status: "queued", created_by_name: "Agente de WhatsApp", created_at: addition.at, print_count: 0, kind: "addition", items: [{ ...water, item_id: 2 }] },
  ],
};
const listProps = { total: 1, reviewCount: 0, page: 1, pageSize: 12, search: "", loading: false, onPage: vi.fn(), onSearch: vi.fn(), onRefresh: vi.fn(), onOpen: vi.fn() };
const detailProps = {
  deliveryExpanded: false, working: false, canEdit: true, onEdit: vi.fn(), onCopy: vi.fn(),
  onEditTicket: vi.fn(), onPrintTicket: vi.fn(), onDeliveryToggle: vi.fn(), onPrint: vi.fn(),
  onPayment: vi.fn(), onAppend: vi.fn(), onReview: vi.fn().mockResolvedValue(undefined), onAdvance: vi.fn(), onCancel: vi.fn(),
};

describe("confirmed agent additions", () => {
  it.each([[1, "Producto agregado por el agente"], [2, "Productos agregados por el agente"]])("marks a confirmed %s-product addition in desktop and mobile without replacing the payment or total", (count, label) => {
    render(<OrderListPanel {...listProps} items={[{ ...workspaceOrder, recent_agent_addition: { ...addition, item_count: Number(count) } }]} />);
    expect(screen.getAllByText(label)).toHaveLength(2);
    expect(within(screen.getByRole("table")).getByText(label)).toBeVisible();
    expect(screen.getAllByText("Pago parcial")).toHaveLength(2);
    expect(screen.getAllByText("17 S/")).toHaveLength(2);
  });

  it("never infers an addition from the order source, older API data, or an uncommitted request", () => {
    const { rerender } = render(<OrderListPanel {...listProps} items={[{ ...workspaceOrder, source: "whatsapp_agent", recent_agent_addition: undefined }]} />);
    expect(screen.queryByText(/agregado.*por el agente/)).not.toBeInTheDocument();
    rerender(<OrderListPanel {...listProps} items={[{ ...workspaceOrder, recent_agent_addition: { ...addition, item_count: 0 } }]} />);
    expect(screen.queryByText(/agregado.*por el agente/)).not.toBeInTheDocument();
    render(<OrderDetailContent {...detailProps} order={{ ...detailOrder, recent_agent_addition: undefined, items: [pizza], kitchen_tickets: [detailOrder.kitchen_tickets[0]], payment_requests: [
      { id: "pending-extra", order_id: 72, purpose: "addition", method: "yape", amount: 2, status: "under_review", version: 1, items: [{ name: "Agua", quantity: "1" }] },
    ] }} />);
    expect(screen.queryByRole("region", { name: "Productos agregados por el agente" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Comanda #2/ })).not.toBeInTheDocument();
  });

  it("shows the saved addition and its own comanda, preserving the original preparation and amounts", () => {
    render(<OrderDetailContent {...detailProps} order={detailOrder} />);
    const notice = screen.getByRole("region", { name: "Productos agregados por el agente" });
    expect(within(notice).getByText("Producto agregado por el agente")).toBeVisible();
    expect(within(notice).getByText(addition.summary)).toBeVisible();
    expect(notice.querySelector("time")).toHaveAttribute("dateTime", addition.at);
    const original = screen.getByRole("button", { name: /Comanda #1/ });
    const extra = screen.getByRole("button", { name: /Comanda #2/ });
    expect(within(original).getByText(/Por AlonsoRey/)).toBeVisible();
    expect(within(extra).getByText(/Por Agente de WhatsApp/)).toBeVisible();
    fireEvent.click(original);
    fireEvent.click(extra);
    expect(within(original.closest("article")!).getByText("Preparado", { exact: true })).toBeVisible();
    expect(within(original.closest("article")!).getByText("S/ 15.00")).toBeVisible();
    expect(within(extra.closest("article")!).getByText("1 × Agua - sin gas")).toBeVisible();
    expect(within(extra.closest("article")!).getByText("S/ 2.00")).toBeVisible();
    expect(within(extra.closest("article")!).queryByText("Preparado", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(/todavía no se enviaron a cocina/)).not.toBeInTheDocument();
    expect(screen.getByText("Monto cobrado").parentElement).toHaveTextContent("15 S/");
    expect(screen.getByText("Monto restante").parentElement).toHaveTextContent("2 S/");
  });

  it("uses the specific addition notice instead of duplicating the generic agent-change notice", () => {
    const recentModification = { at: addition.at, source: "agent" as const, summary: addition.summary };
    render(<OrderListPanel {...listProps} items={[{ ...workspaceOrder, recent_modification: recentModification }]} />);
    render(<OrderDetailContent {...detailProps} order={{ ...detailOrder, recent_modification: recentModification }} />);
    expect(screen.queryByText("Cambio del agente · Revisar")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Cambio realizado por el agente" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Productos agregados por el agente" })).toBeVisible();
  });
});
