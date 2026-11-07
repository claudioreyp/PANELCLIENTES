import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";
import type { Branch } from "../types";
import { NewOrderPaymentModal } from "./NewOrderPaymentModal";

vi.mock("../lib/api", async (original) => ({ ...await original<typeof import("../lib/api")>(), api: vi.fn() }));
const branch = { id: 1, business_id: 1, accepted_payment_methods: ["cash", "yape"] } as Branch;
beforeEach(() => { vi.mocked(api).mockResolvedValue([]); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("new order payment deferral", () => {
  it("forces pending-delivery saving without a payment method or cash reads", async () => {
    const onConfirm = vi.fn();
    render(<NewOrderPaymentModal branch={branch} total={20} busy={false} forceDeferredPayment onClose={vi.fn()} onConfirm={onConfirm} />);
    expect(screen.getByRole("checkbox")).toBeChecked(); expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("Agrega un costo de envío para poder cobrar al momento.");
    expect(screen.getByText("Importe de los productos. El envío está por cotizar.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument(); expect(api).not.toHaveBeenCalled();
    const save = screen.getByRole("button", { name: "Guardar sin cobrar" });
    await waitFor(() => expect(save).toHaveFocus()); fireEvent.click(save);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ deferPayment: true, mode: null, plan: { payments: [], change: 0, error: null } });
  });

  it("keeps ordinary checkout and cash change unchanged without the scoped option", async () => {
    const onConfirm = vi.fn();
    render(<NewOrderPaymentModal branch={branch} total={20} busy={false} onClose={vi.fn()} onConfirm={onConfirm} />);
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2)); expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.queryByRole("note")).not.toBeInTheDocument(); fireEvent.click(screen.getByRole("radio", { name: /Efectivo/ }));
    fireEvent.change(screen.getByLabelText("Cantidad recibida"), { target: { value: "25" } }); fireEvent.click(screen.getByRole("button", { name: /Cobrar/ }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ deferPayment: false, mode: "cash", plan: { payments: [{ method: "cash", amount: 20, cashReceived: 25 }], change: 5, error: null } });
  });

  it("keeps ordinary optional deferral and its existing action", async () => {
    const onConfirm = vi.fn();
    render(<NewOrderPaymentModal branch={branch} total={20} busy={false} onClose={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Enviar a cocina" }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ deferPayment: true, mode: null, plan: { payments: [], change: 0, error: null } });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  });

  it("hides a previously selected payment when the shipping quote becomes pending", async () => {
    const onConfirm = vi.fn(); const props = { branch, total: 20, busy: false, onClose: vi.fn(), onConfirm };
    const view = render(<NewOrderPaymentModal {...props} />);
    fireEvent.click(screen.getByRole("radio", { name: /Yape/ }));
    view.rerender(<NewOrderPaymentModal {...props} forceDeferredPayment />);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "Guardar sin cobrar" }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ deferPayment: true, mode: null, plan: { payments: [], change: 0, error: null } });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  });
});
