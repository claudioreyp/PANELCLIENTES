import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, apiBlob, ApiError } from "../lib/api";
import { nextAction } from "../lib/order-detail-model";
import type { OrderDetail, PaymentEvidence } from "../types";
import { OrderDeliveryFee } from "./OrderDeliveryFee";
import { OrderEvidenceHistory } from "./OrderEvidenceHistory";

const role = vi.hoisted(() => ({ current: "owner" }));
vi.mock("../lib/tenant", () => ({ useTenant: () => ({ context: { role: role.current } }) }));
vi.mock("../lib/api", async (original) => ({ ...await original<typeof import("../lib/api")>(), api: vi.fn(), apiBlob: vi.fn() }));
const order: OrderDetail = { id: 1, business_id: 1, branch_id: 1, number: "TEST", folio: 25, source: "whatsapp_agent",
  channel: "delivery", status: "ready", payment_method: "yape", payment_status: "partial", subtotal: 20, discount: 0,
  total: 20, delivery_fee: 0, delivery_fee_status: "pending_quote", final_total: null, version: 4, created_at: "2026-09-20T15:00:00Z",
  items: [], payments: [], kitchen_tickets: [], paid_amount: 20, remaining_amount: 0 };
const evidence: PaymentEvidence = { id: 1, order_id: 1, provider: "yape", status: "under_review", image_url: "/evidence/1",
  expected_amount: 20, warnings: [], created_at: order.created_at, operation_number: "TEST-001", security_code: "012" };

beforeEach(() => {
  role.current = "owner";
  vi.mocked(apiBlob).mockResolvedValue(new Blob());
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe("independent shipping collection", () => {
  it("keeps an uncertain operation immutable and reuses the exact body and key", async () => {
    vi.mocked(api).mockRejectedValueOnce(new ApiError("lost", 0)).mockResolvedValueOnce({});
    const saved = vi.fn().mockResolvedValue(undefined);
    render(<OrderDeliveryFee order={order} onSaved={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "Definir costo de envío" }));
    fireEvent.change(screen.getByLabelText("Costo de envío (S/)"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar costo" }));
    await screen.findByRole("alert");
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Costo de envío (S/)")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar confirmación" }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(vi.mocked(api).mock.calls[0]).toEqual(vi.mocked(api).mock.calls[1]);
    expect(JSON.parse(vi.mocked(api).mock.calls[0][1]!.body as string)).toEqual({ expected_version: 4, amount: 5, method: null });
  });
  it("denies fee editing to kitchen and never equates pending quote with paid", () => {
    role.current = "kitchen";
    render(<OrderDeliveryFee order={order} onSaved={vi.fn()} />);
    expect(screen.getByText("Envío por cotizar")).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
    expect(nextAction(order)).toBeNull();
  });
  it("offers fulfillment only for the matching ready WhatsApp modality", () => {
    expect(nextAction({ ...order, delivery_fee_status: "final", channel: "takeaway" })?.label).toBe("Marcar recogido");
    expect(nextAction({ ...order, delivery_fee_status: "final", channel: "counter" })?.label).toBe("Marcar servido");
    expect(nextAction({ ...order, delivery_fee_status: "final", channel: "counter", source: "pos" })).toBeNull();
  });
  it("drops late save effects when another order replaces the form", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const saved = vi.fn();
    const view = render(<OrderDeliveryFee order={order} onSaved={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "Definir costo de envío" }));
    fireEvent.change(screen.getByLabelText("Costo de envío (S/)"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar costo" }));
    view.rerender(<OrderDeliveryFee order={{ ...order, id: 2 }} onSaved={saved} />);
    resolve({});
    await waitFor(() => expect(screen.getByLabelText("Costo de envío (S/)")).toHaveValue(null));
    expect(saved).not.toHaveBeenCalled();
  });
});

describe("independent receipts", () => {
  it("shows all proofs and requires the initial approval before an extra", async () => {
    const extra = { ...evidence, id: 2, image_url: "/evidence/2", payment_request_id: "extra", security_code: "456" };
    const proofOrder: OrderDetail = { ...order, payment_evidences: [evidence, extra], payment_requests: [
      { id: "extra", order_id: 1, purpose: "addition", method: "yape", amount: 10, status: "under_review", version: 1, items: [] }] };
    const onReview = vi.fn().mockResolvedValue(undefined);
    const view = render(<OrderEvidenceHistory order={proofOrder} working={false} onReview={onReview} />);
    const extraCard = screen.getByRole("region", { name: "Comprobante: Productos adicionales" });
    expect(within(extraCard).getByRole("button", { name: "Aprobar pago y preparar adición" })).toBeDisabled();
    fireEvent.click(within(extraCard).getByRole("button", { name: "Rechazar comprobante" }));
    expect(onReview).toHaveBeenCalledWith(false, extra);
    view.rerender(<OrderEvidenceHistory order={{ ...proofOrder, payment_evidences: [{ ...evidence, status: "paid" }, extra] }} working={false} onReview={onReview} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Aprobar pago y preparar adición" })).toBeEnabled());
    expect(screen.getByText("012")).toBeVisible();
    expect(screen.getByText("456")).toBeVisible();
  });
  it("reports image errors and retries without claiming payment success", async () => {
    vi.mocked(apiBlob).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(new Blob());
    render(<OrderEvidenceHistory order={{ ...order, payment_evidences: [evidence] }} working={false} onReview={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar imagen" }));
    await screen.findByRole("img", { name: "Comprobante yape: Pedido original" });
    expect(api).not.toHaveBeenCalled();
  });
});
