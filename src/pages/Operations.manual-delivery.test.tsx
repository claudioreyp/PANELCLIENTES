import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryPage } from "./Operations";
import { api } from "../lib/api";

const fixture = vi.hoisted(() => ({ refresh: vi.fn(), order: { id: 27, version: 8, business_id: 1, branch_id: 2, number: "TEST-27", source: "pos", channel: "delivery", delivery_fee_status: "pending_quote", customer_name: "Cliente manual de prueba", status: "ready", total: 20, created_at: "2026-11-07T15:00:00Z", items: [], delivery_address: { delivery_service: "own" } } }));
vi.mock("../lib/tenant", () => ({ useTenant: () => ({ branch: { id: 2 } }) }));
vi.mock("../lib/hooks", () => ({ useBranchRealtime: vi.fn(), usePolling: () => ({ data: { orders: [{ order: fixture.order, delivery: { status: "ready" } }], couriers: [{ id: 4, name: "Repartidor de prueba", phone: "999888777", active: true, status: "available" }] }, refresh: fixture.refresh }) }));
vi.mock("../lib/api", async original => ({ ...await original<typeof import("../lib/api")>(), api: vi.fn().mockResolvedValue({}) }));
beforeEach(() => { fixture.order.source = "pos"; fixture.order.delivery_fee_status = "pending_quote"; fixture.order.version = 8; vi.clearAllMocks(); });
afterEach(cleanup);

describe("manual delivery assignment before quotation", () => {
  it("keeps a pending manual order assignable only after its shipping cost is entered", () => {
    render(<DeliveryPage />);
    const assign = screen.getByRole("button", { name: "Asignar" });
    expect(assign).toBeDisabled();
    expect(screen.getByText("Agrega el costo de envío desde Pedidos antes de asignar un repartidor.")).toBeVisible();
    fireEvent.click(assign);
    expect(screen.queryByRole("dialog", { name: "Asignar repartidor" })).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });

  it.each([["pos", "final"], ["whatsapp_agent", "pending_quote"]])("preserves assignment for %s orders with fee status %s", async (source, feeStatus) => {
    fixture.order.source = source; fixture.order.delivery_fee_status = feeStatus;
    render(<DeliveryPage />);
    const assign = screen.getByRole("button", { name: "Asignar" });
    expect(assign).toBeEnabled();
    expect(screen.queryByText(/desde Pedidos antes de asignar/)).toBeNull();
    fireEvent.click(assign);
    fireEvent.change(screen.getByLabelText("Repartidor"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar asignación" }));
    await waitFor(() => expect(fixture.refresh).toHaveBeenCalledTimes(1));
    expect(api).toHaveBeenCalledExactlyOnceWith("/delivery/orders/27/assign", { method: "POST", body: JSON.stringify({ courier_id: 4, expected_version: 8 }) });
  });
});
