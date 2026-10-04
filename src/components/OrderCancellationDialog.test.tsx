import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";
import type { OrderDetail } from "../types";
import { OrderCancellationDialog, type CancellationPreview } from "./OrderCancellationDialog";

vi.mock("../lib/api", async (original) => ({ ...await original<typeof import("../lib/api")>(), api: vi.fn() }));
const saved: OrderDetail = { id: 70, business_id: 1, branch_id: 2, number: "FULL-70", folio: 9, version: 4, channel: "takeaway", source: "pos", status: "ready", payment_status: "paid", subtotal: 24, discount: 0, delivery_fee: 0, total: 24, paid_amount: 24, remaining_amount: 0, created_at: "2026-10-04T20:00:00Z", payments: [], kitchen_tickets: [], items: [] };
const preview = (patch: Partial<CancellationPreview> = {}): CancellationPreview => ({ order_id: 70, branch_id: 2, order_version: 4, can_cancel: true, can_refund: true, reason: null, refundable_amount: 24,
  financial_summary: { collected: 24, refunded: 0, net_collected: 24, refundable: 24, status: "paid" }, refund_methods: ["cash", "card", "yape", "transfer"],
  registers: [{ id: 3, name: "Principal", version: 1, session_id: 8, session_version: 6 }], ...patch });
const result = { order: { ...saved, status: "cancelled", version: 5 }, refunds: [], financial_summary: { collected: 24, refunded: 24, net_collected: 0, refundable: 0, status: "refunded" } };
const actions = () => ({ onClose: vi.fn(), onSaved: vi.fn(), onLocked: vi.fn() });
const writes = () => vi.mocked(api).mock.calls.filter(([, options]) => options?.method === "POST");
async function ready() { return screen.findByLabelText("Motivo de cancelación"); }
function fill(method = "Efectivo") {
  fireEvent.change(screen.getByLabelText("Motivo de cancelación"), { target: { value: "El cliente canceló" } });
  fireEvent.click(screen.getByRole("radio", { name: method }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Confirmo que realicé/ }));
}
beforeEach(() => {
  vi.mocked(api).mockImplementation(async (_path, options) => options?.method === "POST" ? result : preview());
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("confirmed cancellation and refunds", () => {
  it("uses the server refundable amount, selected current period, chosen alternate method and explicit attestation", async () => {
    const callbacks = actions();
    vi.mocked(api).mockImplementation(async (_path, options) => options?.method === "POST" ? result : preview({ refundable_amount: 12.35 }));
    render(<OrderCancellationDialog order={saved} {...callbacks} />);
    await ready();
    expect(screen.getByText(/Reembolso pendiente de/)).toHaveTextContent("12.35");
    fill("Tarjeta");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce());
    const [path, options] = writes()[0];
    expect(path).toBe("/orders/70/cancel");
    expect(options?.idempotencyKey).toBeTruthy();
    expect(JSON.parse(String(options?.body))).toEqual({ reason: "El cliente canceló", expected_version: 4, refunds: [{ method: "card", amount: 12.35 }], refund_confirmed: true, register_id: 3, expected_session_id: 8, expected_cash_version: 6 });
    expect(callbacks.onSaved).toHaveBeenCalledWith(expect.objectContaining({ total: 24, financial_summary: result.financial_summary }));
  });

  it("requires confirmation that the exact refund was already performed", async () => {
    render(<OrderCancellationDialog order={saved} {...actions()} />);
    await ready();
    fireEvent.change(screen.getByLabelText("Motivo de cancelación"), { target: { value: "Cliente se retiró" } });
    fireEvent.click(screen.getByRole("radio", { name: "Efectivo" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Confirma que realizaste");
    expect(screen.getByRole("checkbox")).toHaveFocus();
    expect(writes()).toHaveLength(0);
  });

  it("requires multiple refunds to sum exactly to the collected amount", async () => {
    render(<OrderCancellationDialog order={saved} {...actions()} />);
    await ready();
    fill("Múltiples métodos de pago");
    fireEvent.change(screen.getByLabelText("Devolución en Efectivo"), { target: { value: "10.01" } });
    fireEvent.change(screen.getByLabelText("Devolución en Yape"), { target: { value: "13.98" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Distribuye exactamente");
    expect(writes()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Devolución en Yape"), { target: { value: "13.99" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(String(writes()[0][1]?.body)).refunds).toEqual([{ method: "cash", amount: 10.01 }, { method: "yape", amount: 13.99 }]);
  });

  it("requires an explicit register choice when multiple boxes exist and permits a confirmed empty period", async () => {
    vi.mocked(api).mockImplementation(async (_path, options) => options?.method === "POST" ? result : preview({ registers: [{ id: 3, name: "Principal", version: 1, session_id: 8, session_version: 6 }, { id: 4, name: "Barra", version: 1, session_id: null, session_version: 0 }] }));
    render(<OrderCancellationDialog order={saved} {...actions()} />);
    await ready();
    fill();
    expect(screen.getByLabelText("Caja para la devolución")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Caja para la devolución"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(String(writes()[0][1]?.body))).toMatchObject({ register_id: 4, expected_session_id: null, expected_cash_version: 0 });
  });

  it("cancels an unpaid order with reason alone and no refund or box controls", async () => {
    const callbacks = actions();
    vi.mocked(api).mockImplementation(async (_path, options) => options?.method === "POST" ? result : preview({ refundable_amount: 0, can_refund: false }));
    render(<OrderCancellationDialog order={saved} {...callbacks} />);
    await ready();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByLabelText("Caja para la devolución")).toBeNull();
    fireEvent.change(screen.getByLabelText("Motivo de cancelación"), { target: { value: "Cliente se retiró" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce());
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({ reason: "Cliente se retiró", expected_version: 4, refunds: [], refund_confirmed: false });
  });

  it("blocks paid cancellation without cash permissions and mismatched preview scopes", async () => {
    vi.mocked(api).mockResolvedValue(preview({ can_refund: false }));
    const view = render(<OrderCancellationDialog order={saved} {...actions()} />);
    await ready();
    expect(screen.getByRole("button", { name: "Confirmar cancelación" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Efectivo" })).toBeDisabled();
    view.unmount();
    vi.mocked(api).mockResolvedValue(preview({ branch_id: 999 }));
    render(<OrderCancellationDialog order={saved} {...actions()} />);
    expect(await screen.findByText("La consulta no corresponde al pedido y sucursal seleccionados.")).toBeVisible();
    expect(screen.queryByLabelText("Motivo de cancelación")).toBeNull();
    expect(writes()).toHaveLength(0);
  });
});

describe("cancellation retries and scope safety", () => {
  it.each([0, 408, 503])("freezes path/body/key, locks dismissal and editing after an uncertain %s response, and recovers the same operation", async (status) => {
    const callbacks = actions();
    let attempts = 0;
    vi.mocked(api).mockImplementation(async (_path, options) => {
      if (options?.method !== "POST") return preview();
      if (++attempts === 1) throw new ApiError("Respuesta perdida", status);
      return result;
    });
    render(<OrderCancellationDialog order={saved} {...callbacks} />);
    await ready();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Respuesta perdida");
    expect(screen.getByLabelText("Motivo de cancelación")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Volver al pedido" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(callbacks.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar cancelación" }));
    await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce());
    expect(writes()[1]).toEqual(writes()[0]);
  });

  it("prevents double submission and drops a late successful response after scope unmount", async () => {
    const callbacks = actions();
    let resolve!: (value: unknown) => void;
    vi.mocked(api).mockImplementation(async (_path, options) => options?.method === "POST" ? new Promise((done) => { resolve = done; }) : preview());
    const view = render(<OrderCancellationDialog order={saved} {...callbacks} />);
    await ready();
    fill();
    const submit = screen.getByRole("button", { name: "Confirmar cancelación" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(writes()).toHaveLength(1);
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
    expect(callbacks.onClose).not.toHaveBeenCalled();
    view.unmount();
    await act(async () => resolve(result));
    expect(callbacks.onSaved).not.toHaveBeenCalled();
  });

  it("refreshes stale preview and creates a new intent only after a definitive rejection", async () => {
    let reads = 0;
    let attempts = 0;
    vi.mocked(api).mockImplementation(async (_path, options) => {
      if (options?.method !== "POST") return preview({ order_version: ++reads === 1 ? 4 : 5 });
      if (++attempts === 1) throw new ApiError("Versión obsoleta", 409);
      return result;
    });
    render(<OrderCancellationDialog order={saved} {...actions()} />);
    await ready();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    await waitFor(() => expect(vi.mocked(api).mock.calls.filter(([, options]) => !options?.method)).toHaveLength(2));
    await ready();
    expect(screen.getByLabelText("Motivo de cancelación")).toHaveValue("El cliente canceló");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelación" }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1][1]?.idempotencyKey).not.toBe(writes()[0][1]?.idempotencyKey);
    expect(JSON.parse(String(writes()[1][1]?.body)).expected_version).toBe(5);
  });
});
