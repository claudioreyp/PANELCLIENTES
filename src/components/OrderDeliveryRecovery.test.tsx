import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, apiBlob, ApiError } from "../lib/api";
import { nextAction } from "../lib/order-detail-model";
import type { OrderDetail, PaymentEvidence } from "../types";
import { OrderDeliveryFee } from "./OrderDeliveryFee";
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

describe("one explicit shipping payment", () => {
  it("keeps an uncertain payment immutable and reuses its receipt key and body on retry", async () => {
    const saved = vi.fn().mockResolvedValue(undefined);
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (options?.method === "POST") throw new ApiError("lost response", 503);
      return path.startsWith("/cash/registers") ? [{ id: 1, name: "Caja principal", active: true }] : [{ id: 4, register_id: 1, status: "open" }] as never;
    });
    render(<OrderDeliveryFee order={{ ...order, status: "delivered", payment_requests: [{ ...shipping, collection_pending_with_courier: true }] }} onSaved={saved} />);
    expect(screen.getByText(/Cobro pendiente del repartidor/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Registrar cobro del envío" }));
    fireEvent.change(screen.getByLabelText("Forma de cobro"), { target: { value: "cash" } });
    fireEvent.change(screen.getByLabelText("Nota del cobro"), { target: { value: "Repartidor entregó el dinero en caja." } });
    const submit = screen.getByRole("button", { name: /^Registrar cobro$/ });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit); fireEvent.click(submit);
    await screen.findByText(/Reintenta esta misma operación/);
    expect(screen.getByLabelText("Forma de cobro")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    const first = vi.mocked(api).mock.calls.filter(([, options]) => options?.method === "POST")[0];
    vi.mocked(api).mockResolvedValueOnce({});
    fireEvent.click(screen.getByRole("button", { name: "Reintentar el mismo cobro" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    const writes = vi.mocked(api).mock.calls.filter(([, options]) => options?.method === "POST");
    expect(writes).toHaveLength(2); expect(writes[1]).toEqual(first);
    expect(JSON.parse(first[1]!.body as string)).toEqual({ method: "cash", amount: 6, cash_session_id: 4, note: "Repartidor entregó el dinero en caja.", expected_version: 2, payment_request_id: "ship-5" });
    expect(order.paid_amount).toBe(15);
  });
  it.each(["dispatcher", "waiter", "kitchen"])("does not offer money entry to %s", value => {
    role.value = value;
    render(<OrderDeliveryFee order={order} onSaved={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Registrar cobro del envío" })).toBeNull();
  });
  it("does not collect while another receipt or product balance remains unresolved", () => {
    const view = render(<OrderDeliveryFee order={{ ...order, remaining_amount: 10 }} onSaved={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Registrar cobro del envío" })).toBeNull();
    view.rerender(<OrderDeliveryFee order={{ ...order, payment_evidences: [original, deliveryReceipt] }} onSaved={vi.fn()} />);
    expect(screen.getByText(/Comprobante por revisar/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Registrar cobro del envío" })).toBeNull();
  });
  it("requires a cash-session choice when there are multiple open sessions", async () => {
    vi.mocked(api).mockImplementation(async path => path.startsWith("/cash/registers")
      ? [{ id: 1, name: "Principal", active: true }, { id: 2, name: "Barra", active: true }]
      : [{ id: 4, register_id: 1, status: "open" }, { id: 5, register_id: 2, status: "open" }] as never);
    render(<OrderDeliveryFee order={order} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Registrar cobro del envío" }));
    fireEvent.change(screen.getByLabelText("Forma de cobro"), { target: { value: "yape" } });
    fireEvent.change(screen.getByLabelText("Nota del cobro"), { target: { value: "Revisado" } });
    const selector = await screen.findByLabelText("Caja del cobro");
    expect(screen.getByRole("button", { name: /^Registrar cobro$/ })).toBeDisabled();
    fireEvent.change(selector, { target: { value: "5" } });
    expect(screen.getByRole("button", { name: /^Registrar cobro$/ })).toBeEnabled();
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
