import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrderWorkspaceItem } from "../types";
import { OrderListPanel, OrderPaymentBadge } from "./OrderListPanel";

afterEach(cleanup);
describe("compact order list", () => {
  it.each([["pending", "Pago pendiente"], ["paid", "Pagado"], ["partial", "Pago parcial"], ["under_review", "Pendiente de revisión"]])("labels %s", (status, label) => {
    render(<OrderPaymentBadge status={status} />);
    expect(screen.getByText(label)).toBeVisible();
  });
  it("keeps all six columns, real numbers, suffix amounts, date/search and keyboard opening", () => {
    const callbacks = { onPage: vi.fn(), onDay: vi.fn(), onSearch: vi.fn(), onRefresh: vi.fn(), onCreate: vi.fn(), onOpen: vi.fn() };
    const order = { id: 1, folio: 7, number: "2026-0009", customer_name: "Pepe", channel: "takeaway", created_at: "2026-09-08T20:00:00", payment_status: "pending", total: 69, requires_review: true } as OrderWorkspaceItem;
    render(<OrderListPanel {...callbacks} items={[order]} total={13} reviewCount={1} page={1} pageSize={12} day="2026-09-08" today="2026-09-08" search="" loading={false} canCreate />);
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Pedido", "Nombre", "Tipo", "Fecha", "Estado de pago", "Total"]);
    expect(screen.getAllByText("69 S/")).toHaveLength(2);
    expect(screen.getAllByText("#7")).toHaveLength(2);
    expect(screen.queryByText(/2026-0009/)).not.toBeInTheDocument();
    expect(screen.getByText("1 - 12 de 13 pedidos")).toBeVisible();
    expect(screen.getByText("Hoy")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-09-07" } });
    expect(callbacks.onDay).toHaveBeenCalledWith("2026-09-07");
    fireEvent.change(screen.getByLabelText("Buscar pedidos"), { target: { value: "Pepe" } });
    expect(callbacks.onSearch).toHaveBeenCalledWith("Pepe");
    const table = screen.getByRole("table");
    const row = within(table).getAllByRole("row")[1];
    const open = within(row).getByRole("button", { name: "Abrir pedido 7 de Pepe" });
    expect(screen.getAllByRole("button", { name: "Abrir pedido 7 de Pepe" })).toHaveLength(2);
    expect(row).not.toHaveAttribute("role");
    expect(row).not.toHaveAttribute("tabindex");
    expect(within(row).getAllByRole("cell")).toHaveLength(6);
    expect(open.tagName).toBe("BUTTON");
    expect(open).toHaveAttribute("type", "button");
    // Native buttons emit a detail=0 click for keyboard activation.
    fireEvent.click(open, { detail: 0 });
    expect(callbacks.onOpen).toHaveBeenCalledWith(order);
    expect(callbacks.onOpen).toHaveBeenCalledTimes(1);
    expect(open).toHaveFocus();
    fireEvent.click(within(row).getByText("Pepe"));
    expect(callbacks.onOpen).toHaveBeenCalledTimes(2);
    expect(open).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(callbacks.onPage).toHaveBeenCalledWith(2);
  });
  it.each([false, true])("keeps codes out of both list layouts and preserves search/open contracts (history=%s)", (tableHistory) => {
    const callbacks = { onPage: vi.fn(), onSearch: vi.fn(), onRefresh: vi.fn(), onOpen: vi.fn() };
    const order = { id: 987654, folio: 7, number: "COMPLETE-ORDER-CODE", customer_name: "Pepe", channel: "dine_in", status: "cancelled", created_at: "2026-09-08T20:00:00", payment_status: "pending", paid_amount: 0, total: 69, requires_review: false } as OrderWorkspaceItem;
    const props = { ...callbacks, total: 1, reviewCount: 0, page: 1, pageSize: 12, search: "", loading: false, allDates: true, tableHistory };
    const { container, rerender } = render(<OrderListPanel {...props} items={[order]} />);
    expect(screen.getAllByText("#7")).toHaveLength(2);
    expect(container.innerHTML).not.toContain(order.number);
    expect(container.innerHTML).not.toContain(String(order.id));
    for (const button of screen.getAllByRole("button", { name: "Abrir pedido 7 de Pepe" })) fireEvent.click(button);
    expect(callbacks.onOpen).toHaveBeenCalledTimes(2);
    expect(callbacks.onOpen).toHaveBeenLastCalledWith(order);
    fireEvent.change(screen.getByLabelText("Buscar pedidos"), { target: { value: order.number } });
    expect(callbacks.onSearch).toHaveBeenCalledWith(order.number);

    for (const folio of [null, undefined]) {
      const legacy = { ...order, folio };
      rerender(<OrderListPanel {...props} items={[legacy]} />);
      expect(screen.getAllByText("Sin folio")).toHaveLength(2);
      expect(screen.queryByText("#7")).not.toBeInTheDocument();
      expect(container.innerHTML).not.toContain(order.number);
      expect(container.innerHTML).not.toContain(String(order.id));
      const buttons = screen.getAllByRole("button", { name: "Abrir pedido sin folio de Pepe" });
      expect(buttons).toHaveLength(2);
      for (const button of buttons) fireEvent.click(button, { detail: 0 });
      expect(callbacks.onOpen).toHaveBeenLastCalledWith(legacy);
      expect(buttons[1]).toHaveFocus();
    }
  });
});
