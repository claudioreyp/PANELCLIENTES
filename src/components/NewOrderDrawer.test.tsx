import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../lib/api";
import type { OrderCartLine } from "../lib/order-builder";
import { loadOrderDetail } from "../lib/orders";
import type { Branch, Catalog, OrderDetail } from "../types";
import { NewOrderDrawer } from "./NewOrderDrawer";
import type { NewOrderCheckoutSelection } from "./NewOrderPaymentModal";

vi.mock("../lib/api", async (original) => ({ ...await original<typeof import("../lib/api")>(), api: vi.fn() }));
vi.mock("../lib/orders", () => ({ loadOrderDetail: vi.fn() }));
vi.mock("./OrderProductPicker", () => ({ OrderProductPicker: ({ onSave }: { onSave: (lines: OrderCartLine[]) => void }) => <button onClick={() => onSave([{ key: "pizza", productId: 1, name: "Pizza", quantity: 1, unitPrice: 20, modifiers: [] }])}>Elegir pizza</button> }));
vi.mock("./NewOrderPaymentModal", () => ({ NewOrderPaymentModal: ({ onConfirm }: { onConfirm: (selection: NewOrderCheckoutSelection) => void }) => <button onClick={() => onConfirm({ deferPayment: true, mode: null, plan: { payments: [], change: 0, error: null } })}>Enviar a cocina</button> }));

const branch = { id: 1, delivery_fee: 0 } as Branch;
const catalog = { branch, categories: [], modifier_groups: [], ingredients: [], promotions: [], products: [{ id: 1, name: "Pizza", price: 20, service_channels: ["pos_counter"], variants: [], modifier_groups: [] }] } as unknown as Catalog;

function setup() {
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(<StrictMode><NewOrderDrawer branch={branch} catalog={catalog} onClose={onClose} onCreated={onCreated} onError={vi.fn()} /></StrictMode>);
  fireEvent.click(screen.getByRole("button", { name: "Agregar productos" }));
  fireEvent.click(screen.getByRole("button", { name: "Elegir pizza" }));
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
  return { onCreated, onClose };
}

describe("new orders go straight to a real kitchen command", () => {
  afterEach(() => { cleanup(); vi.resetAllMocks(); });

  it("waits for kitchen confirmation even without a payment and ignores double submission", async () => {
    let confirm!: (result: unknown) => void;
    vi.mocked(api).mockResolvedValueOnce({ id: 12, version: 1, total: 20 }).mockImplementationOnce(() => new Promise((resolve) => { confirm = resolve; }));
    const { onCreated, onClose } = setup();
    const button = screen.getByRole("button", { name: "Enviar a cocina" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(onCreated).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => confirm({ order: { id: 12, status: "sent_to_kitchen" }, tickets: [{ id: 1 }] }));
    expect(onCreated).toHaveBeenCalledExactlyOnceWith({ orderId: 12, outcome: "pending_and_sent" });
    expect(vi.mocked(api).mock.calls.map(([path]) => path)).toEqual(["/orders", "/orders/12/confirm-and-send"]);
    expect(vi.mocked(api).mock.calls[1][1]).toMatchObject({ method: "POST", idempotencyKey: expect.any(String), body: JSON.stringify({ expected_version: 1 }) });
  });

  it("keeps the same saved order recoverable when kitchen rejects confirmation", async () => {
    vi.mocked(api).mockResolvedValueOnce({ id: 12, version: 1, total: 20 }).mockRejectedValueOnce(new ApiError("Unavailable", 503));
    const { onCreated } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Enviar a cocina" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ orderId: 12, outcome: "confirmation_failed", message: expect.stringContaining("sin duplicarlo") })));
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("reconciles a lost kitchen response before reporting success", async () => {
    vi.mocked(api).mockResolvedValueOnce({ id: 12, version: 1, total: 20 }).mockRejectedValueOnce(new ApiError("Connection lost", 0, undefined, "NETWORK_UNREACHABLE"));
    vi.mocked(loadOrderDetail).mockResolvedValue({ kitchen_tickets: [{ id: 1, items: [{ item_id: 2 }] }] } as OrderDetail);
    const { onCreated } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Enviar a cocina" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ orderId: 12, outcome: "pending_and_sent" }));
    expect(loadOrderDetail).toHaveBeenCalledWith(12, 1);
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("does not send a changed total without the operator reviewing it", async () => {
    vi.mocked(api).mockResolvedValueOnce({ id: 12, version: 1, total: 25 });
    const { onCreated } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Enviar a cocina" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ orderId: 12, outcome: "total_changed" })));
    expect(api).toHaveBeenCalledTimes(1);
  });
});
