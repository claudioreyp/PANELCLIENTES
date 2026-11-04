import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { api, apiBlob } from "../lib/api";
import { OrdersPage } from "./Orders";
vi.mock("../lib/tenant", () => ({ useTenant: () => ({ branch: { id: 1 }, context: { role: "owner", business: { id: 1, timezone: "America/Lima" } } }) }));
vi.mock("../lib/hooks", async original => ({ ...await original<typeof import("../lib/hooks")>(), useBranchRealtime: vi.fn() }));
vi.mock("../lib/api", async original => ({ ...await original<typeof import("../lib/api")>(), api: vi.fn(), apiBlob: vi.fn().mockRejectedValue(new Error("offline image double")) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const cases = ["confirmed", "ready", "dispatched", "delivered"].flatMap(status =>
  [true, false].map(approve => ({ status, approve, source: "whatsapp_agent", hasRequests: false })));
cases.push({ status: "ready", approve: false, source: "whatsapp_agent", hasRequests: true });
for (const hasRequests of [false, true]) for (const approve of [false, true]) {
  cases.push({ status: "ready", approve, source: "pos", hasRequests });
}
it.each(cases)("confirmation/outcome at $status, approve=$approve, source=$source, requests=$hasRequests", async ({ status, approve, source, hasRequests }) => {
  vi.mocked(api).mockReset();
  vi.mocked(apiBlob).mockRejectedValue(new Error("offline image double"));
  let paid = false;
  const released = status !== "confirmed";
  const agentReleased = released && ["agent", "n8n", "whatsapp", "whatsapp_agent"].includes(source);
  const saved = () => ({ id: 27, business_id: 1, branch_id: 1, folio: 27, number: "SYNTHETIC-27", version: paid ? 6 : 5,
    channel: "takeaway", source, status, payment_status: paid ? approve ? "paid" : "rejected" : "evidence_received", payment_method: "yape",
    sent_to_kitchen_at: released ? "2026-10-24T15:00:00Z" : null,
    total: 20, subtotal: 20, discount: 0, delivery_fee: 0, created_at: "2026-10-24T15:00:00Z",
    items: [{ id: 1, product_id: 4, name: "Agua", quantity: 1, unit_price: 20, line_total: 20, status: "pending", modifiers: [] }] });
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === "/payment-evidence/2/review") { paid = true; return {}; }
    if (options?.method) throw new Error("Unexpected offline mutation " + path);
    if (path.startsWith("/orders/workspace?")) return { items: [{ ...saved(), item_count: 1, requires_review: !paid }], total: 1,
      review_count: paid ? 0 : 1, page: 1, page_size: 12, period: "all", view: "orders" };
    if (path.startsWith("/agent-attention?")) return [];
    if (path.startsWith("/catalog?")) return { branch: { id: 1 }, products: [], categories: [], modifier_groups: [], ingredients: [], promotions: [] };
    if (path === "/orders/27/detail") return { order: saved(), payments: [], tickets: [], payment_summary: { paid: paid ? 20 : 0, remaining: paid ? 0 : 20 },
      payment_requests: hasRequests ? [{ id: "cash-addition", order_id: 27, purpose: "addition", method: "cash", status: "committed", amount: 5, version: 1, items: [] }] : [],
      payment_evidence: [{ id: 2, order_id: 27, provider: "yape", status: paid ? approve ? "paid" : "rejected" : "under_review", amount_detected: 20,
        expected_amount: 20, warnings: [], image_url: "/api/v1/payment-evidence/2/image", created_at: "2026-10-24T15:00:00Z" }] };
    throw new Error("Unexpected offline read " + path);
  });
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<MemoryRouter><OrdersPage /></MemoryRouter>);
  fireEvent.click((await screen.findAllByRole("button", { name: "Abrir pedido 27 de cliente sin nombre" }))[0]);
  fireEvent.click(await screen.findByRole("button", { name: approve ? agentReleased ? "Aprobar pago" : "Aprobar pago y preparar" : "Rechazar comprobante" }));
  const question = String(confirm.mock.calls[0][0]);
  expect(question).toContain(agentReleased ? approve ? "conserva su estado actual" : "conserva su estado"
    : approve ? "pasará a cocina" : hasRequests ? "Las adiciones quedarán pendientes" : "se cancelará");
  if (agentReleased) expect(question).not.toMatch(/pasará a cocina|imprim|se cancelará|stock|Las adiciones quedarán pendientes/);
  const message = approve ? agentReleased ? "Pago aprobado. El pedido conserva su estado actual." : "Pago aprobado y pedido enviado a preparación."
    : agentReleased ? "Comprobante rechazado. El pedido conserva su estado y el pago sigue pendiente."
      : hasRequests ? "Comprobante original rechazado. Revisa las adiciones pendientes." : "Comprobante rechazado y stock liberado.";
  await waitFor(() => expect(screen.getByText(message)).toBeVisible());
  const writes = vi.mocked(api).mock.calls.filter(([path]) => path === "/payment-evidence/2/review");
  expect(writes).toHaveLength(1);
  expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ approve, expected_version: 5 });
});
