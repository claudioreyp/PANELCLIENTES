import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OrderEvidenceHistory } from "./OrderEvidenceHistory";
import { OrderPendingAdditions } from "./OrderPendingAdditions";
import { OrderFinancials } from "./OrderFinancials";
import { nextAction } from "../lib/order-detail-model";
import type { OrderDetail, PaymentEvidence } from "../types";
import { api, apiBlob } from "../lib/api";
vi.mock("../lib/tenant", () => ({ useTenant: () => ({ context: { role: "cashier" } }) }));
vi.mock("../lib/api", async original => ({ ...await original<typeof import("../lib/api")>(), api: vi.fn(), apiBlob: vi.fn().mockRejectedValue(new Error("test image unavailable")) }));
afterEach(() => { cleanup(); vi.mocked(api).mockReset(); });
const evidence: PaymentEvidence = { id: 1, order_id: 27, provider: "yape", expected_amount: 50, amount_detected: 50, status: "under_review", warnings: [], image_url: "/api/v1/payment-evidence/1/image", created_at: "2026-10-18T15:00:00Z", requires_financial_review: true, financial_review: { kind: "fulfillment_amount_changed", original_expected_amount: 50, current_total: 40 } };
const order = { id: 27, channel: "delivery", status: "ready", source: "whatsapp_agent", payment_status: "paid", payment_method: "yape", subtotal: 40, total: 40, delivery_fee: 0, discount: 0, paid_amount: 50, remaining_amount: 0, overpayment_amount: 10, items: [], payments: [], kitchen_tickets: [], payment_evidences: [evidence] } as unknown as OrderDetail;

it("requires the amount and a note before financial approval and keeps original evidence", async () => {
  const review = vi.fn(); render(<OrderEvidenceHistory order={order} working={false} onReview={review} />);
  const approve = screen.getByRole("button", { name: "Aprobar pago y preparar" });
  expect(approve).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Nota de revisión financiera"), { target: { value: "Verificado en la cuenta del local" } });
  fireEvent.change(screen.getByLabelText("Importe realmente verificado"), { target: { value: "48" } });
  fireEvent.click(approve);
  expect(review).toHaveBeenCalledWith(true, evidence, { note: "Verificado en la cuenta del local", confirmed_amount: 48 });
  expect(evidence.expected_amount).toBe(50);
  await screen.findByText("No se pudo cargar el comprobante.");
  expect(apiBlob).toHaveBeenCalledWith("/payment-evidence/1/image");
});

it.each(["awaiting_base_review", "requires_review"])("blocks dispatch while addition status is %s", status => {
  const pending = { ...order, payment_evidences: [], payment_requests: [{ id: "extra", order_id: 27, purpose: "addition" as const, method: "cash" as const, status, amount: 7, version: 1, items: [{ name: "Agua", quantity: "1" }] }] };
  expect(nextAction(pending)).toBeNull();
  render(<OrderPendingAdditions order={pending} />);
  expect(screen.getByRole("region", { name: "Estado de productos adicionales" })).toHaveTextContent(/Pendiente de aprobar|requiere revisión/);
});

it("cash committed is visible as unpaid and excess stays visible independently of attention notices", () => {
  render(<><OrderPendingAdditions order={{ ...order, payment_requests: [{ id: "extra", order_id: 27, purpose: "addition", method: "cash", status: "committed", amount: 7, version: 1, items: [] }] }} /><OrderFinancials order={{ ...order, overpayment_amount: undefined, financial_summary: { collected: 50, refunded: 0, net_collected: 50, refundable: 50, status: "paid", overpayment_amount: 10 } }} /></>);
  expect(screen.getByText(/Consulta el cobro en Pagos; este estado no confirma un pago/)).toBeVisible();
  expect(screen.getByText(/Exceso cobrado/)).toHaveTextContent("10 S/");
  expect(screen.getByText(/no registra una devolución/)).toBeVisible();
});

it.each(["superseded", "waived", "cancelled"])("does not block dispatch on an inactive delivery request: %s", status => {
  expect(nextAction({ ...order, payment_evidences: [], payment_requests: [{ id: "old", order_id: 27, purpose: "delivery", method: "yape", status, amount: 7, version: 1, items: [] }] })).toEqual({ label: "Despachar delivery", kind: "dispatched" });
});

it("retries the exact addition decline after a lost response without changing the original order", async () => {
  vi.mocked(api).mockRejectedValueOnce(new TypeError("lost response")).mockResolvedValueOnce({});
  const saved = vi.fn().mockResolvedValue(undefined);
  const original = { ...order, version: 9, payment_requests: [{ id: "extra", order_id: 27, purpose: "addition" as const, method: "cash" as const, status: "awaiting_base_review", amount: 7, version: 1, items: [] }] };
  render(<OrderPendingAdditions order={original} onSaved={saved} />);
  fireEvent.click(screen.getByText("Revisar solicitud adicional"));
  const reject = screen.getByRole("button", { name: "Rechazar solicitud adicional" });
  expect(reject).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Motivo del rechazo"), { target: { value: "Cliente no desea los adicionales" } });
  fireEvent.click(reject);
  fireEvent.click(await screen.findByRole("button", { name: "Reintentar el mismo rechazo" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(vi.mocked(api).mock.calls[0]).toEqual(vi.mocked(api).mock.calls[1]);
  expect(JSON.parse(String(vi.mocked(api).mock.calls[0][1]?.body))).toEqual({ expected_version: 9, action: "decline", note: "Cliente no desea los adicionales" });
  expect(original.paid_amount).toBe(50);
  expect(original.payment_requests[0].status).toBe("awaiting_base_review");
});
