import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeliveryPage } from "./Operations";
import { api } from "../lib/api";

const fixture = vi.hoisted(() => ({ refresh: vi.fn(), orders: [{ order: { id: 27, version: 8, number: "TEST-27", customer_name: "Prueba aislada", status: "ready", total: 20, created_at: "2026-10-18T15:00:00Z", items: [], delivery_address: {} }, delivery: { status: "ready" } }] }));
vi.mock("../lib/tenant", () => ({ useTenant: () => ({ branch: { id: 2 } }) }));
vi.mock("../lib/hooks", () => ({ useBranchRealtime: vi.fn(), usePolling: () => ({ data: { orders: fixture.orders, couriers: [] }, refresh: fixture.refresh }) }));
vi.mock("../lib/api", async original => ({ ...await original<typeof import("../lib/api")>(), api: vi.fn().mockResolvedValue({}) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("sends the displayed order version for assignment and dispatch", async () => {
  render(<DeliveryPage />);
  fireEvent.click(screen.getByRole("button", { name: "Asignar" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirmar asignación" }));
  await waitFor(() => expect(fixture.refresh).toHaveBeenCalled());
  expect(JSON.parse(String(vi.mocked(api).mock.calls[0][1]?.body))).toEqual({ courier_id: null, expected_version: 8 });
  cleanup();
  fixture.orders[0].delivery.status = "assigned";
  render(<DeliveryPage />);
  fireEvent.click(screen.getByRole("button", { name: "Despachar" }));
  await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  expect(JSON.parse(String(vi.mocked(api).mock.calls[1][1]?.body))).toEqual({ status: "dispatched", expected_version: 8 });
});
