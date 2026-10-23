import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import { OrdersPage } from "./Orders";

vi.mock("../lib/tenant", () => ({ useTenant: () => ({ branch: { id: 1 }, context: { role: "owner", business: { id: 1, timezone: "America/Lima" } } }) }));
vi.mock("../lib/hooks", async original => ({ ...await original<typeof import("../lib/hooks")>(), useBranchRealtime: vi.fn() }));
vi.mock("../lib/api", async original => ({ ...await original<typeof import("../lib/api")>(), api: vi.fn(), apiBlob: vi.fn().mockRejectedValue(new Error("Image unavailable in unit test")) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("retains the exact financial approval after a lost response and blocks an altered second operation", async () => {
  let paid = false;
  let calls = 0;
  const saved = () => ({ id: 27, business_id: 1, branch_id: 1, folio: 27, number: "TEST-27", version: paid ? 6 : 5,
    channel: "takeaway", source: "whatsapp_agent", status: paid ? "sent_to_kitchen" : "confirmed", payment_status: paid ? "paid" : "evidence_received", payment_method: "yape",
    total: 6, subtotal: 6, discount: 0, delivery_fee: 0, created_at: "2026-10-18T15:00:00Z", items: [{ id: 1, product_id: 4, name: "Agua", quantity: 2, unit_price: 3, line_total: 6, status: "pending", modifiers: [] }] });
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === "/payment-evidence/2/review") {
      calls++;
      if (calls === 1) throw new TypeError("lost response");
      paid = true; return {};
    }
    if (options?.method) throw new Error("Unexpected mutation");
    if (path.startsWith("/orders/workspace?")) return { items: [{ ...saved(), item_count: 2, requires_review: !paid }], total: 1, review_count: paid ? 0 : 1, page: 1, page_size: 12, period: "all", view: "orders" };
    if (path.startsWith("/agent-attention?")) return [];
    if (path.startsWith("/catalog?")) return { branch: { id: 1 }, products: [], categories: [], modifier_groups: [], ingredients: [], promotions: [] };
    if (path === "/orders/27/detail") return { order: saved(), payments: [], tickets: [], payment_summary: { paid: paid ? 11 : 0, remaining: paid ? 0 : 6 }, payment_evidence: [{ id: 2, order_id: 27, provider: "yape", status: paid ? "paid" : "under_review", amount_detected: 11, expected_amount: 11, requires_financial_review: !paid, financial_review: { original_expected_amount: 11, current_total: 6, kind: "fulfillment_amount_changed" }, warnings: [], image_url: "/api/v1/payment-evidence/2/image", created_at: "2026-10-18T15:00:00Z" }] };
    throw new Error(`Unexpected read ${path}`);
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<MemoryRouter><OrdersPage /></MemoryRouter>);
  fireEvent.click((await screen.findAllByRole("button", { name: "Abrir pedido 27 de cliente sin nombre" }))[0]);
  const note = await screen.findByLabelText("Nota de revisión financiera");
  fireEvent.change(note, { target: { value: "Monto comprobado en la cuenta" } });
  fireEvent.click(screen.getByRole("button", { name: "Aprobar pago y preparar" }));
  await screen.findByText("lost response");
  fireEvent.change(note, { target: { value: "Otra revisión" } });
  fireEvent.click(screen.getByRole("button", { name: "Aprobar pago y preparar" }));
  expect(calls).toBe(1);
  expect(screen.getByText(/Hay una revisión sin confirmar/)).toBeVisible();
  fireEvent.change(note, { target: { value: "Monto comprobado en la cuenta" } });
  fireEvent.click(screen.getByRole("button", { name: "Aprobar pago y preparar" }));
  await waitFor(() => expect(calls).toBe(2));
  const writes = vi.mocked(api).mock.calls.filter(([path]) => path === "/payment-evidence/2/review");
  expect(writes[0][1]).toEqual(writes[1][1]);
  expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ approve: true, expected_version: 5, note: "Monto comprobado en la cuenta", confirmed_amount: 11 });
  await waitFor(() => expect(screen.queryByLabelText("Nota de revisión financiera")).toBeNull());
});
