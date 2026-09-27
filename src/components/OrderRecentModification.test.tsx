import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderDetail, OrderWorkspaceItem } from "../types";
import { OrderDetailContent } from "./OrderDetailContent";
import { OrderListPanel } from "./OrderListPanel";

vi.mock("../lib/tenant", () => ({ useTenant: () => ({ context: null }) }));

afterEach(cleanup);

const recentModification = {
  at: "2026-09-27T21:53:00Z",
  source: "agent" as const,
  summary: "Cambió a domicilio y actualizó la dirección de entrega.",
};

const workspaceOrder: OrderWorkspaceItem = {
  id: 42, number: "260927-AC1539", folio: 42, customer_name: "Hector Arturo", channel: "delivery", source: "whatsapp_agent",
  created_at: "2026-09-27T21:51:00Z", status: "confirmed", payment_status: "pending", total: 20,
  delivery_fee: 0, requires_review: false, item_count: 1, version: 2, recent_modification: recentModification,
};

const detailOrder: OrderDetail = {
  ...workspaceOrder, business_id: 1, branch_id: 1, subtotal: 20, discount: 0, notes: null,
  items: [{ id: 1, product_id: 1, name: "Lasaña", quantity: 1, unit_price: 20, modifiers: [], status: "pending", line_total: 20 }],
  payments: [], kitchen_tickets: [], paid_amount: 0, remaining_amount: 20,
};

describe("confirmed agent order modifications", () => {
  it("marks the order in both list layouts and stays silent for older API responses", () => {
    const props = {
      total: 1, reviewCount: 0, page: 1, pageSize: 12, search: "", loading: false,
      onPage: vi.fn(), onSearch: vi.fn(), onRefresh: vi.fn(), onOpen: vi.fn(),
    };
    const { rerender } = render(<OrderListPanel {...props} items={[workspaceOrder]} />);
    expect(within(screen.getByRole("table")).getByText("Cambio del agente · Revisar")).toBeVisible();
    expect(screen.getAllByText("Cambio del agente · Revisar")).toHaveLength(2);

    rerender(<OrderListPanel {...props} items={[{ ...workspaceOrder, recent_modification: undefined }]} />);
    expect(screen.queryByText("Cambio del agente · Revisar")).not.toBeInTheDocument();
  });

  it("shows the saved change and time in the order detail", () => {
    const props = {
      order: detailOrder, deliveryExpanded: false, working: false, canEdit: true,
      onEdit: vi.fn(), onCopy: vi.fn(), onEditTicket: vi.fn(), onPrintTicket: vi.fn(),
      onDeliveryToggle: vi.fn(), onPrint: vi.fn(), onPayment: vi.fn(), onAppend: vi.fn(),
      onReview: vi.fn().mockResolvedValue(undefined), onAdvance: vi.fn(), onCancel: vi.fn(),
    };
    const { rerender } = render(<OrderDetailContent {...props} />);
    const notice = screen.getByRole("region", { name: "Cambio realizado por el agente" });
    expect(within(notice).getByText("El agente modificó este pedido")).toBeVisible();
    expect(within(notice).getByText(recentModification.summary)).toBeVisible();
    expect(within(notice).getByText("Revisa los datos del pedido antes de continuar.")).toBeVisible();
    expect(within(notice).getByText(/27 set/)).toHaveAttribute("dateTime", recentModification.at);

    rerender(<OrderDetailContent {...props} order={{ ...detailOrder, recent_modification: null }} />);
    expect(screen.queryByRole("region", { name: "Cambio realizado por el agente" })).not.toBeInTheDocument();
  });
});
