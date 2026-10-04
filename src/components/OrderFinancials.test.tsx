import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderDetail } from "../types";
import { OrderFinancials } from "./OrderFinancials";
import { OrderDetailContent } from "./OrderDetailContent";

vi.mock("../lib/tenant", () => ({ useTenant: () => ({ branch: { id: 2 }, context: { role: "owner", business: { timezone: "America/Lima" } } }) }));

const order: OrderDetail = { id: 70, business_id: 1, branch_id: 2, number: "FULL-70", folio: 9, version: 4, channel: "takeaway", source: "pos", status: "cancelled", payment_status: "paid", subtotal: 24, discount: 0, delivery_fee: 0, total: 24, paid_amount: 24, remaining_amount: 0, created_at: "2026-10-04T20:00:00Z", payments: [{ id: 1, order_id: 70, method: "card", amount: 24, status: "confirmed", created_at: "2026-10-04T20:00:00", cash_register_name: "Principal" }], kitchen_tickets: [], items: [] };
afterEach(cleanup);

describe("immutable payments and actual refunds", () => {
  it("shows original card payment and a later cash refund with distinct identities and Lima times", () => {
    render(<OrderFinancials order={{ ...order, financial_summary: { collected: 24, refunded: 24, net_collected: 0, refundable: 0, status: "refunded" }, refunds: [{ id: 1, order_id: 70, method: "cash", amount: 24, signed_amount: -24, register_id: 2, register_name: "Barra", session_id: 8, created_at: "2026-10-04T20:02:00" }] }} />);
    expect(screen.getByText("Reembolsado")).toBeVisible();
    const payments = screen.getByLabelText("Pagos de la cuenta");
    expect(within(payments).getByText(/Pago de 24 S\/ en/)).toHaveTextContent("Tarjeta");
    expect(within(payments).getByText(/Reembolso de 24 S\/ en/)).toHaveTextContent("Efectivo");
    expect(screen.getByText("3:00 p. m.")).toBeVisible();
    expect(screen.getByText("3:02 p. m.")).toBeVisible();
    expect(screen.getByText("Principal")).toBeVisible();
    expect(screen.getByText("Barra")).toBeVisible();
    expect(screen.getByText("Total").parentElement).toHaveTextContent("24 S/");
    expect(screen.getByText("Monto cobrado").parentElement).toHaveTextContent("24 S/");
    expect(screen.getByText("Monto reembolsado").parentElement).toHaveTextContent("24 S/");
    expect(screen.queryByText("Monto restante")).toBeNull();
  });

  it("labels a historical cancelled payment as not refunded without manufacturing a ledger entry", () => {
    render(<OrderFinancials order={order} />);
    expect(screen.getByText("Reembolso no registrado")).toBeVisible();
    expect(screen.getByText(/Los cobros confirmados se conservan/)).toHaveTextContent("24 S/");
    expect(screen.queryByText(/Reembolso de/)).toBeNull();
    expect(screen.getByText("Monto cobrado").parentElement).toHaveTextContent("24 S/");
  });

  it("shows voided unpaid cancellations and omits all cancelled collection controls", () => {
    render(<OrderDetailContent order={{ ...order, payments: [], paid_amount: 0, remaining_amount: 24, payment_status: "pending", cancellation_reason: "No desea el pedido", financial_summary: { collected: 0, refunded: 0, net_collected: 0, refundable: 0, status: "voided" } }} canEdit deliveryExpanded={false} working={false} onEdit={vi.fn()} onCopy={vi.fn()} onEditTicket={vi.fn()} onPrintTicket={vi.fn()} onDeliveryToggle={vi.fn()} onPrint={vi.fn()} onPayment={vi.fn()} onAppend={vi.fn()} onReview={vi.fn()} onAdvance={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("No desea el pedido")).toBeVisible();
    expect(screen.getByText("Anulado")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Cobrar/ })).toBeNull();
    expect(screen.queryByText("Monto restante")).toBeNull();
  });
});
