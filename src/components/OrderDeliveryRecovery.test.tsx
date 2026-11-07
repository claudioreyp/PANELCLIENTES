import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, apiBlob } from "../lib/api";
import { collectibleDeliveryPayment, nextAction } from "../lib/order-detail-model";
import type { OrderDetail, PaymentEvidence } from "../types";
import { OrderDeliveryFee } from "./OrderDeliveryFee";
import { NewOrderPaymentModal } from "./NewOrderPaymentModal";
import { OrderEvidenceHistory } from "./OrderEvidenceHistory";

const role = vi.hoisted(() => ({ value: "cashier" }));
vi.mock("../lib/tenant", () => ({ useTenant: () => ({ context: { role: role.value } }) }));
vi.mock("../lib/api", async original => ({ ...await original<typeof import("../lib/api")>(), api: vi.fn(), apiBlob: vi.fn() }));
const original: PaymentEvidence = { id: 50, order_id: 5, provider: "yape", status: "paid", image_url: "/payment-evidence/50/image", warnings: [], created_at: "2026-11-06T20:00:00Z" };
const shipping = { id: "ship-5", order_id: 5, purpose: "delivery" as const, method: "yape" as const, status: "pending", amount: 6, version: 1, items: [] };
const order: OrderDetail = { id: 5, business_id: 1, branch_id: 1, number: "TEST", folio: 5, source: "whatsapp_agent", channel: "delivery", status: "ready", version: 2,
  payment_method: "yape", payment_status: "partial", subtotal: 15, discount: 0, delivery_fee: 6, delivery_fee_status: "final", total: 21, paid_amount: 15, remaining_amount: 6,
  created_at: original.created_at, items: [], payments: [{ id: 1, order_id: 5, method: "yape", amount: 15, status: "confirmed", created_at: original.created_at }],
  payment_evidences: [original], payment_requests: [shipping], kitchen_tickets: [] };
const deliveryReceipt = { ...original, id: 60, status: "under_review", payment_request_id: shipping.id, amount_detected: 17.5 };
const mistaken: OrderDetail = { ...order, status: "draft", subtotal: 4.5, total: 10.5, paid_amount: 0, remaining_amount: 10.5, payments: [], payment_status: "under_review",
  payment_evidences: [deliveryReceipt], payment_requests: [{ ...shipping, status: "under_review" }] };

beforeEach(() => {
  role.value = "cashier";
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(apiBlob).mockResolvedValue(new Blob());
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.mocked(api).mockImplementation(async path => path.startsWith("/cash/registers") ? [{ id: 1, name: "Caja principal", active: true }]
    : path.startsWith("/cash/sessions") ? [{ id: 4, register_id: 1, status: "open" }] : {} as never);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("physical dispatch is separate from shipping collection", () => {
  it("allows dispatch with selected unpaid Yape and keeps the original payment unchanged", () => {
    expect(nextAction(order)).toEqual({ label: "Despachar delivery", kind: "dispatched" });
    expect(nextAction({ ...order, status: "dispatched" })).toEqual({ label: "Marcar entregado", kind: "delivered", requiresCourierCollection: true });
    expect(order.paid_amount).toBe(15);
    expect(order.payment_requests![0].status).toBe("pending");
  });
  it("allows only delivery receipts to travel and requires their review before delivery", () => {
    const underReview = { ...order, payment_evidences: [original, deliveryReceipt], payment_requests: [{ ...shipping, status: "under_review" }] };
    expect(nextAction(underReview)?.disabledReason).toBeUndefined();
    expect(nextAction({ ...underReview, status: "dispatched" })?.disabledReason).toMatch(/comprobantes pendientes/);
    expect(nextAction({ ...order, payment_evidences: [{ ...original, status: "under_review" }] })?.disabledReason).toMatch(/comprobantes pendientes/);
  });
  it.each(["awaiting_base_review", "requires_review", "under_review"])("keeps %s additions blocked", status => {
    expect(nextAction({ ...order, payment_requests: [shipping, { ...shipping, id: "extra", purpose: "addition", status }] })?.disabledReason).toMatch(/adicionales pendientes/);
  });
  it("does not choose a shipping request when the distribution is ambiguous", () => {
    expect(nextAction({ ...order, payment_requests: [shipping, { ...shipping, id: "other" }] })?.disabledReason).toMatch(/solicitudes de cobro/);
    render(<OrderDeliveryFee order={{ ...order, payment_requests: [shipping, { ...shipping, id: "other" }] }} onSaved={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Registrar cobro del envío" })).toBeNull();
  });
});

describe("shipping uses the regular POS checkout", () => {
  it("retains the delivery status without a second collection form", () => {
    render(<OrderDeliveryFee order={{ ...order, status: "delivered", payment_requests: [{ ...shipping, collection_pending_with_courier: true }] }} onSaved={vi.fn()} />);
    expect(screen.getByText(/Cobro pendiente del repartidor/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Registrar cobro del envío" })).toBeNull();
    expect(collectibleDeliveryPayment(order)?.id).toBe(shipping.id);
  });
  it("keeps receipts, ambiguous balances and unpaid products out of delivery settlement", () => {
    expect(collectibleDeliveryPayment({ ...order, remaining_amount: 10 })).toBeUndefined();
    expect(collectibleDeliveryPayment({ ...order, payment_evidences: [original, deliveryReceipt] })).toBeUndefined();
    expect(collectibleDeliveryPayment({ ...order, payment_evidences: [] })).toBeUndefined();
    expect(collectibleDeliveryPayment({ ...order, payment_requests: [shipping, { ...shipping, id: "other" }] })).toBeUndefined();
    expect(collectibleDeliveryPayment({ ...order, delivery_fee_status: "pending_quote" })).toBeUndefined();
  });
  it("uses the existing cash controls and locks the selection while recovering one payment", async () => {
    const confirm = vi.fn();
    const props = { branch: { id: 1, accepted_payment_methods: ["cash", "yape", "card"] } as never, total: 6, busy: false,
      allowDeferredPayment: false, allowCombinedPayment: false, allowedMethods: ["cash", "yape"] as const, onClose: vi.fn(), onConfirm: confirm };
    const view = render(<NewOrderPaymentModal {...props} />);
    expect(screen.getByRole("dialog", { name: "Cobrar al cliente" })).toBeVisible();
    expect(screen.queryByRole("radio", { name: /Tarjeta|Múltiples/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Efectivo/ }));
    fireEvent.change(screen.getByLabelText("Cantidad recibida"), { target: { value: "10" } });
    await screen.findByText("Caja principal");
    fireEvent.click(screen.getByRole("button", { name: /^Cobrar / }));
    expect(confirm.mock.calls[0][0].plan).toEqual({ payments: [{ method: "cash", amount: 6, cashReceived: 10, cashSessionId: 4 }], change: 4, error: null });
    view.rerender(<NewOrderPaymentModal {...props} recovering />);
    expect(screen.getByLabelText("Cantidad recibida")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Yape/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar confirmación" }));
    expect(confirm.mock.calls[1][0]).toEqual(confirm.mock.calls[0][0]);
  });
  it("recovers the frozen payment when cash sessions arrive after its first submission", async () => {
    let resolveSessions!: (sessions: unknown) => void;
    const sessions = new Promise(resolve => { resolveSessions = resolve; });
    vi.mocked(api).mockImplementation(async path => path.startsWith("/cash/registers")
      ? [{ id: 1, name: "Caja principal", active: true }]
      : sessions as never);
    const confirm = vi.fn();
    const props = { branch: { id: 1, accepted_payment_methods: ["cash"] } as never, total: 6, busy: false,
      allowDeferredPayment: false, onClose: vi.fn(), onConfirm: confirm };
    const view = render(<NewOrderPaymentModal {...props} />);
    fireEvent.click(screen.getByRole("radio", { name: /Efectivo/ }));
    fireEvent.change(screen.getByLabelText("Cantidad recibida"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: /^Cobrar / }));
    expect(confirm).toHaveBeenCalledTimes(1);
    view.rerender(<NewOrderPaymentModal {...props} recovering />);
    await act(async () => resolveSessions([
      { id: 4, register_id: 1, status: "open" }, { id: 5, register_id: 1, status: "open" },
    ]));
    expect(screen.getByLabelText("Turno de caja")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar confirmación" }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1][0].plan.error).toMatch(/Selecciona la caja/);
  });
});

describe("human correction of a receipt linked to shipping", () => {
  it.each(["original", "original_and_delivery"] as const)("requires verified money, note and allocation for %s", allocation => {
    const review = vi.fn(); render(<OrderEvidenceHistory order={mistaken} working={false} onReview={review} />);
    const approve = screen.getByRole("button", { name: "Aplicar y aprobar pago" });
    expect(screen.getByLabelText("Importe realmente verificado")).toHaveValue(null);
    expect(approve).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Aplicar comprobante a"), { target: { value: allocation } });
    fireEvent.change(screen.getByLabelText("Motivo de la corrección"), { target: { value: "Verificado en cuenta del restaurante" } });
    fireEvent.change(screen.getByLabelText("Importe realmente verificado"), { target: { value: allocation === "original" ? "4.501" : "10.49" } });
    expect(approve).toBeDisabled();
    const amount = allocation === "original" ? 4.5 : 17.5;
    fireEvent.change(screen.getByLabelText("Importe realmente verificado"), { target: { value: String(amount) } });
    if (allocation === "original_and_delivery") expect(screen.getByText(/Exceso confirmado/)).toHaveTextContent("S/ 7.00");
    fireEvent.click(approve);
    expect(review).toHaveBeenCalledWith(true, deliveryReceipt, { allocation, confirmed_amount: amount, note: "Verificado en cuenta del restaurante" });
    expect(mistaken.payments).toEqual([]);
  });
  it("does not offer reassignment with another original receipt or additional request", () => {
    const view = render(<OrderEvidenceHistory order={{ ...mistaken, payment_evidences: [deliveryReceipt, { ...original, status: "under_review" }] }} working={false} onReview={vi.fn()} />);
    expect(screen.queryByLabelText("Aplicar comprobante a")).toBeNull();
    view.rerender(<OrderEvidenceHistory order={{ ...mistaken, payment_requests: [...mistaken.payment_requests!, { ...shipping, id: "extra", purpose: "addition", status: "awaiting_base_review" }] }} working={false} onReview={vi.fn()} />);
    expect(screen.queryByLabelText("Aplicar comprobante a")).toBeNull();
  });
});
