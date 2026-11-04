import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { OrderEvidenceHistory } from "./OrderEvidenceHistory";
import type { OrderDetail, PaymentEvidence } from "../types";
vi.mock("../lib/tenant", () => ({ useTenant: () => ({ context: { role: "cashier" } }) }));
vi.mock("../lib/api", () => ({ apiBlob: vi.fn().mockRejectedValue(new Error("offline image double")) }));
afterEach(cleanup);
const evidence: PaymentEvidence = { id: 1, order_id: 27, provider: "yape", expected_amount: 20,
  amount_detected: 20, status: "under_review", warnings: [], image_url: "/api/v1/payment-evidence/1/image",
  created_at: "2026-10-24T15:00:00Z" };
const base = { id: 27, status: "confirmed", source: "whatsapp_agent", channel: "takeaway", payment_method: "yape",
  payment_status: "evidence_received", total: 20, items: [], payments: [], kitchen_tickets: [],
  payment_evidences: [evidence] } as unknown as OrderDetail;

it("retains prepare wording before the initial kitchen release", () => {
  render(<OrderEvidenceHistory order={base} working={false} onReview={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Aprobar pago y preparar" })).toBeEnabled();
});

it.each(["preparing", "ready", "dispatched", "delivered"])("uses payment-only wording for existing kitchen at %s", status => {
  render(<OrderEvidenceHistory order={{ ...base, status, sent_to_kitchen_at: "2026-10-24T15:00:00Z" }} working={false} onReview={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Aprobar pago" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: /preparar|imprimir/ })).toBeNull();
});

it("uses persisted kitchen tickets even when the historical timestamp is absent", () => {
  render(<OrderEvidenceHistory order={{ ...base, kitchen_tickets: [{ id: 9 }] } as OrderDetail} working={false} onReview={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Aprobar pago" })).toBeEnabled();
});

it.each(["agent", "n8n", "whatsapp", "whatsapp_agent"])("matches the API agent source boundary for %s", source => {
  render(<OrderEvidenceHistory order={{ ...base, source, sent_to_kitchen_at: "2026-10-24T15:00:00Z" }} working={false} onReview={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Aprobar pago" })).toBeEnabled();
});

it.each(["pos", "web", "manual"])("keeps the pre-existing manual wording for non-agent source %s", source => {
  render(<OrderEvidenceHistory order={{ ...base, source, sent_to_kitchen_at: "2026-10-24T15:00:00Z" }} working={false} onReview={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Aprobar pago y preparar" })).toBeEnabled();
});

it.each(["addition", "delivery"] as const)("preserves independent %s review wording", purpose => {
  const order = { ...base, payment_method: "cash", sent_to_kitchen_at: "2026-10-24T15:00:00Z",
    payment_evidences: [{ ...evidence, payment_request_id: "independent" }],
    payment_requests: [{ id: "independent", order_id: 27, purpose, method: "yape", status: "under_review", amount: 20, version: 1, items: [] }] } as OrderDetail;
  render(<OrderEvidenceHistory order={order} working={false} onReview={vi.fn()} />);
  expect(screen.getByRole("button", { name: purpose === "addition" ? "Aprobar pago y agregar productos" : "Aprobar pago del envío" })).toBeEnabled();
});

it("keeps superseded evidence visible without review actions or invented rejection", () => {
  render(<OrderEvidenceHistory order={{ ...base, payment_evidences: [{ ...evidence, status: "superseded",
    rejection_reason: "Historial conservado por cambio del medio de pago; no fue rechazado como pago." }] }} working={false} onReview={vi.fn()} />);
  expect(screen.getByText(/Historial conservado por cambio/)).toBeVisible();
  expect(screen.queryByRole("button", { name: /Aprobar|Rechazar/ })).toBeNull();
});
