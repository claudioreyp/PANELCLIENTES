import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import type { OrderDetail, OrderWorkspaceItem } from "../types";
import { HistoricalOrderContent, TableHistory } from "./TableHistory";
import { OrderListPanel } from "./OrderListPanel";

vi.mock("../lib/api", () => ({ api: vi.fn(), ApiError: class extends Error {} }));
vi.mock("../lib/hooks", async (original) => ({ ...await original<typeof import("../lib/hooks")>(), useBranchRealtime: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const detail = (patch: Partial<OrderDetail> = {}): OrderDetail => ({ id: 7, business_id: 1, branch_id: 1, folio: 7, number: "HISTORY-FULL-CODE", channel: "dine_in", source: "pos", table_id: 10, table_context: { table_id: 10, table_name: "Mesa original" }, status: "closed", payment_status: "paid", subtotal: 50, discount: 7, delivery_fee: 0, total: 43, version: 2, created_at: "2026-09-08T23:00:00", paid_amount: 43, remaining_amount: 0, items: [{ id: 1, product_id: 2, name: "Alitas", variant_name: "grande", quantity: 1, unit_price: 50, modifiers: [], status: "preparing", line_total: 50 }], payments: [{ id: 1, order_id: 7, amount: 43, method: "card", status: "confirmed", created_at: "2026-09-09T01:00:00Z", cash_register_name: "Caja Principal" }], kitchen_tickets: [{ id: 3, order_id: 7, version: 1, sequence: 1, station: "kitchen", status: "ready", created_at: "2026-09-08T23:00:00", created_by_name: "Ana", print_count: 0, items: [{ item_id: 1, name: "Alitas", variant_name: "grande", quantity: 1, modifiers: [], line_total: 50 }] }], ...patch });
const row = (id: number): OrderWorkspaceItem => ({ ...detail({ id, folio: id }), requires_review: false, item_count: 1 });
const callbacks = () => ({ onPrint: vi.fn(), onPrintTicket: vi.fn() });

describe("table history detail", () => {
  it("keeps a read-only detail, saved table/code, Lima time, payment and print-only command menu", async () => {
    const actions = callbacks();
    render(<HistoricalOrderContent order={detail()} busy={false} {...actions} />);
    expect(screen.getByText("#HISTORY-FULL-CODE")).toBeVisible();
    expect(screen.getByText("Mesa original")).toBeVisible();
    expect(screen.getByText("Caja Principal")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Cobrar|Agregar|Transferir|Reabrir/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Comanda #1/ }));
    expect(screen.getByText(/Alitas/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Acciones de la comanda 1" }));
    expect(await screen.findAllByRole("menuitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("menuitem", { name: "Imprimir comanda" }));
    expect(actions.onPrintTicket).toHaveBeenCalledWith(detail().kitchen_tickets[0]);
    fireEvent.click(screen.getByRole("button", { name: "Imprimir cuenta" }));
    expect(actions.onPrint).toHaveBeenCalledOnce();
  });

  it("shows cancellation without erasing confirmed amounts or enabling account printing", () => {
    render(<HistoricalOrderContent order={detail({ status: "cancelled", cancellation_reason: "Cliente cambió de planes" })} busy={false} {...callbacks()} />);
    expect(screen.getByText("Cliente cambió de planes")).toBeVisible();
    expect(screen.getByText("Pagado")).toBeVisible();
    expect(screen.queryByText("Anulado")).toBeNull();
    expect(screen.getByRole("button", { name: "Imprimir cuenta" })).toBeDisabled();
    expect(screen.getByText(/no anula los cobros confirmados/)).toBeVisible();
    expect(screen.queryByText("0 S/")).toBeNull();
  });

  it("uses explicit missing-history labels and never invents a table or reason", () => {
    render(<HistoricalOrderContent order={detail({ status: "cancelled", payment_status: "pending", paid_amount: 0, payments: [], cancellation_reason: null, table_context: null })} busy={false} {...callbacks()} />);
    expect(screen.getByText("Motivo no registrado")).toBeVisible();
    expect(screen.getByText("Mesa")).toBeVisible();
    expect(screen.getByText("Anulado")).toBeVisible();
    expect(screen.getByText("43 S/")).toBeVisible();
  });

  it("renders cancelled table rows with real totals and no date or creation control", () => {
    render(<OrderListPanel items={[{ ...row(7), status: "cancelled", paid_amount: 43 }]} total={1} reviewCount={0} page={1} pageSize={12} search="" loading={false} allDates tableHistory onPage={vi.fn()} onSearch={vi.fn()} onRefresh={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText("Todo el historial")).toBeVisible();
    expect(screen.queryByLabelText("Fecha")).toBeNull();
    expect(screen.queryByRole("button", { name: "Nuevo pedido" })).toBeNull();
    expect(screen.getAllByText("43 S/")).toHaveLength(2);
    expect(screen.getAllByText("Pagado")).toHaveLength(2);
    expect(within(screen.getByRole("table")).getByText("Cancelado")).toBeVisible();
  });
});

describe("table history list", () => {
  it("queries all dates, paginates on the server and preserves confirmed rows on refresh failure", async () => {
    const open = vi.fn();
    vi.mocked(api).mockImplementation(async (path) => {
      const page = Number(new URL(path, "http://test.invalid").searchParams.get("page"));
      return { period: "all", view: "table_history", items: [row(page === 1 ? 7 : 3)], total: 14, page, page_size: 12, review_count: 0 };
    });
    render(<TableHistory branchId={1} onBack={vi.fn()} onOpen={open} />);
    await screen.findAllByRole("button", { name: /Abrir pedido 7/ });
    expect(vi.mocked(api).mock.calls[0][0]).toContain("period=all");
    expect(vi.mocked(api).mock.calls[0][0]).toContain("view=table_history");
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    fireEvent.click((await screen.findAllByRole("button", { name: /Abrir pedido 3/ }))[0]);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
    vi.mocked(api).mockRejectedValue(new Error("Conexión interrumpida"));
    fireEvent.click(screen.getByRole("button", { name: "Actualizar pedidos" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Conservamos la última consulta");
    expect(screen.getAllByRole("button", { name: /Abrir pedido 3/ })).toHaveLength(2);
    expect(screen.getByText("13 - 14 de 14 pedidos")).toBeVisible();
  });

  it("does not display a late response after the branch-keyed history remounts", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api).mockImplementation(async (path) => path.includes("branch_id=1") ? new Promise((done) => { resolve = done; }) : { period: "all", view: "table_history", items: [row(22)], total: 1, page: 1, page_size: 12, review_count: 0 });
    const view = render(<TableHistory key={1} branchId={1} onBack={vi.fn()} onOpen={vi.fn()} />);
    view.rerender(<TableHistory key={2} branchId={2} onBack={vi.fn()} onOpen={vi.fn()} />);
    await screen.findAllByRole("button", { name: /Abrir pedido 22/ });
    await act(async () => resolve({ period: "all", view: "table_history", items: [row(7)], total: 1, page: 1, page_size: 12, review_count: 0 }));
    await waitFor(() => expect(screen.queryAllByRole("button", { name: /Abrir pedido 7/ })).toHaveLength(0));
  });
});
