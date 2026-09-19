import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KitchenTicket, OrderDetail } from "../types";
import { activeCommandItems, orderIdentityText } from "../lib/order-presentation";
import { mergeOrderItemsMutation } from "../lib/orders";
import { OrderIdentity } from "./OrderIdentity";
import { OrderBreakdown } from "./OrderBreakdown";
import { commandBreakdown } from "./OrderCommands";
import { CommandCard } from "./DigitalCommandBoard";
import { ModifierGroupSelector } from "./ModifierGroupSelector";

afterEach(cleanup);
const ticket: KitchenTicket = { id: 20, order_id: 99, order_folio: 7, order_number: "260910-ABCDEF", sequence: 1, version: 3, status: "queued", station: "kitchen", created_at: "2026-09-10T12:00:00Z", context: { modified_at: "2026-09-10T12:02:00Z" }, print_count: 0, items: [{ item_id: 3, name: "Alitas", variant_name: "Grande", quantity: 2, line_total: 74, modifiers: [{ name: "Ranch", group_name: "Extras", price_delta: 7 }], removed_modifiers: [{ name: "Ranch", group_name: "Extras", price_delta: 7 }] }] };

describe("folios and effective revisions", () => {
  it("displays absolute size prices, including base price, without additional labels", () => {
    const change = vi.fn();
    render(<ModifierGroupSelector name="Precios" groupId="sizes" priceDisplay="absolute" options={[{ id: 1, name: "Chico", priceDelta: 30 }, { id: 2, name: "Mediano", priceDelta: 45 }, { id: 3, name: "Grande", priceDelta: 60 }]} minimum={1} maximum={1} allowRepeats={false} selected={[1]} onChange={change} />);
    for (const price of ["30 S/", "45 S/", "60 S/"]) expect(screen.getByText(price)).toBeVisible();
    expect(screen.queryByText(/Sin adicional|\+/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Grande" }));
    expect(change).toHaveBeenCalledWith([3]);
  });
  it("keeps the complete code apart from the restaurant folio, without inventing it for legacy responses", () => {
    const { rerender } = render(<OrderIdentity folio={7} number="260910-ABCDEF" />);
    expect(screen.getByText("#7")).toHaveClass("order-folio");
    expect(screen.getByText("#260910-ABCDEF")).toHaveClass("order-code");
    expect(orderIdentityText({ folio: 7, number: "260910-ABCDEF" })).toBe("#7 · #260910-ABCDEF");
    rerender(<OrderIdentity number="260910-ABCDEF" />);
    expect(screen.queryByText("#7")).toBeNull();
  });
  it("strikes only removed repetitions while the current product and remaining extras are readable", () => {
    render(<OrderBreakdown lines={commandBreakdown(ticket)} />);
    expect(screen.getByText("2 × Alitas - Grande").closest("article")).not.toHaveClass("is-inactive");
    const options = screen.getAllByText("2 × Ranch");
    expect(options).toHaveLength(2);
    expect(options.filter((node) => node.tagName === "DEL")).toHaveLength(1);
    expect(screen.getByText("S/ 74.00")).toBeVisible();
  });
  it("flags an in-place revision even though ticket kind stays standard and the timer retains the original time", () => {
    const { container } = render(<CommandCard ticket={ticket} view="active" now={Date.parse("2026-09-10T12:02:05Z")} pending={false} onAction={vi.fn()} />);
    expect(screen.getByText("#7")).toBeVisible();
    expect(container.innerHTML).not.toContain(ticket.order_number);
    expect(screen.getByText("Modificado justo ahora")).toBeVisible();
    expect(screen.getByRole("timer")).toHaveTextContent("2:05");
    expect(screen.queryByText(/S\//)).toBeNull();
  });
  it("never multiplies previously retired extras by a later product quantity", () => {
    render(<OrderBreakdown lines={commandBreakdown({ items: [{ ...ticket.items[0], quantity: 3, removed_modifiers: [{ name: "Ranch", price_delta: 7, removed_quantity: 2 }] }] })} />);
    expect(screen.getByText("3 × Ranch").tagName).toBe("SPAN");
    expect(screen.getByText("2 × Ranch").tagName).toBe("DEL");
  });
  it("merges successful revisions without duplicating tickets and rejects old branches or versions", () => {
    const order = { id: 99, branch_id: 1, version: 3, total: 74, paid_amount: 0, kitchen_tickets: [ticket], items: [{ id: 1, status: "superseded" }, { id: 3, replaces_item_id: 1, status: "pending" }] } as OrderDetail;
    const updated = { ...ticket, version: 4 };
    const result = mergeOrderItemsMutation(order, { order: { ...order, version: 4, total: 60 }, tickets: [updated], updated_ticket_ids: [20] });
    expect(result.kitchen_tickets).toHaveLength(1);
    expect(result.remaining_amount).toBe(60);
    expect(result.kitchen_tickets[0].version).toBe(4);
    expect(mergeOrderItemsMutation(result, { order, tickets: [ticket] })).toBe(result);
    expect(mergeOrderItemsMutation(result, { order: { ...order, branch_id: 2 }, tickets: [] })).toBe(result);
    expect(activeCommandItems(order, ticket).map((item) => item.id)).toEqual([3]);
    const later = { ...ticket, id: 21, sequence: 2 };
    expect(activeCommandItems({ ...order, kitchen_tickets: [ticket, later] }, ticket)).toEqual([]);
    expect(activeCommandItems({ ...order, kitchen_tickets: [ticket, later] }, later).map((item) => item.id)).toEqual([3]);
  });
});
