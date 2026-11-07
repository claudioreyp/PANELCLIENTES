import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";
import type { OrderDetail } from "../types";
import { OrderManualDeliveryFee } from "./OrderManualDeliveryFee";
import { OrderDetailContent } from "./OrderDetailContent";

vi.mock("../lib/api", async original => ({ ...await original<typeof import("../lib/api")>(), api: vi.fn() }));
vi.mock("../lib/tenant", () => ({ useTenant: () => ({ context: { role: "owner", roles: [], business: { id: 1, timezone: "America/Lima" } }, branch: { id: 2 } }) }));
vi.mock("./AgentAttentionPanel", () => ({ AgentAttentionPanel: () => null }));
const call = vi.mocked(api);
const order: OrderDetail = { id: 9, business_id: 1, branch_id: 2, number: "ORDER-9", folio: 9, source: "pos", channel: "delivery", status: "preparing", payment_status: "pending", version: 4, customer_name: "Claudio", customer_phone: "944197385", delivery_address: { delivery_service: "own" }, subtotal: 10, discount: 0, delivery_fee: 0, delivery_fee_status: "pending_quote", total: 10, paid_amount: 0, remaining_amount: 10, created_at: "2026-11-07T12:00:00Z", items: [], payments: [], kitchen_tickets: [] };
const detailProps = { canEdit: true, deliveryExpanded: false, working: false, onEdit: vi.fn(), onCopy: vi.fn(), onEditTicket: vi.fn(), onPrintTicket: vi.fn(), onDeliveryToggle: vi.fn(), onPrint: vi.fn(), onPayment: vi.fn(), onAppend: vi.fn(), onReview: vi.fn(), onAdvance: vi.fn(), onCancel: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); call.mockResolvedValue({}); });
afterEach(cleanup);

function open() { fireEvent.click(screen.getByRole("button", { name: "Agregar costo de envío" })); return screen.getByLabelText("Costo de envío", { selector: "input" }); }

describe("manual delivery fee", () => {
  it.each(["5", "0"])("sets an explicit %s tariff once with total/version and no agent request", async amount => {
    const saved = vi.fn().mockResolvedValue(undefined);
    render(<OrderManualDeliveryFee order={order} onSaved={saved} />);
    fireEvent.change(open(), { target: { value: amount } });
    const button = screen.getByRole("button", { name: "Guardar" });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("/orders/9", expect.objectContaining({ method: "PATCH", idempotencyKey: expect.any(String), body: JSON.stringify({ delivery_fee: Number(amount), expected_version: 4, expected_total: 10 + Number(amount) }) }));
  });

  it("preserves the request and key after a lost response, even after a newer version arrives", async () => {
    call.mockRejectedValueOnce(new ApiError("Sin respuesta", 0));
    const saved = vi.fn().mockResolvedValue(undefined);
    const view = render(<OrderManualDeliveryFee order={order} onSaved={saved} />);
    fireEvent.change(open(), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText(/No pudimos confirmar el guardado/);
    const first = call.mock.calls[0];
    expect(screen.getByLabelText("Costo de envío", { selector: "input" })).toBeDisabled();
    view.rerender(<OrderManualDeliveryFee order={{ ...order, version: 7 }} onSaved={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "Reintentar confirmación" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(call.mock.calls[1]).toEqual(first);
  });

  it("only reloads after a confirmed write when the subsequent read fails", async () => {
    const saved = vi.fn().mockRejectedValueOnce(new Error("Lectura falló")).mockResolvedValue(undefined);
    render(<OrderManualDeliveryFee order={order} onSaved={saved} />);
    fireEvent.change(open(), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText(/El costo se guardó/);
    fireEvent.click(screen.getByRole("button", { name: "Actualizar pedido" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid amounts and handles Escape without closing the order", () => {
    render(<OrderManualDeliveryFee order={order} onSaved={vi.fn()} />);
    const input = open();
    for (const amount of ["", "-1", "5.001", "Infinity"]) {
      fireEvent.change(input, { target: { value: amount } });
      expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    }
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("form", { name: "Costo de envío" })).toBeNull();
    expect(screen.getByRole("button", { name: "Agregar costo de envío" })).toHaveFocus();
    expect(call).not.toHaveBeenCalled();
  });

  it("keeps collection blocked for manual pending delivery and uses the inline edit", () => {
    render(<OrderDetailContent {...detailProps} order={order} onRefresh={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Cobrar 10 S/" })).toBeDisabled();
    expect(screen.getByText("Agrega un costo de envío para poder cobrar.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Agregar costo de envío" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Definir costo de envío" })).toBeNull();
  });

  it("retains the agent quotation path and allows paying products while its fee is pending", () => {
    render(<OrderDetailContent {...detailProps} order={{ ...order, source: "whatsapp_agent" }} onRefresh={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Cobrar 10 S/" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Definir costo de envío" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Agregar costo de envío" })).toBeNull();
  });

  it("does not expose tariff editing to read-only or locked orders", () => {
    const view = render(<OrderDetailContent {...detailProps} canEdit={false} order={order} onRefresh={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Agregar costo de envío" })).toBeNull();
    view.rerender(<OrderDetailContent {...detailProps} order={{ ...order, edit_policy: { can_edit: true, fulfillment_locked: true, reason: "Bloqueado" } }} onRefresh={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Agregar costo de envío" })).toBeNull();
  });
});
