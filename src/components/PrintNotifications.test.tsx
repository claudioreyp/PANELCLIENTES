import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrintNotifications } from "./PrintNotifications";
import { ORDER_PRINT_EVENT } from "../lib/print-events";
import type { PrintNotice } from "../lib/order-printing";

const mock = vi.hoisted(() => ({ discover: vi.fn(), run: vi.fn(), dismiss: vi.fn(), off: vi.fn(), subscribe: vi.fn(), signals: [] as AbortSignal[], scopes: [] as (number | undefined)[], notify: null as ((notice: PrintNotice) => void) | null }));
vi.mock("../lib/query-session", () => ({ useQuerySession: () => null }));
vi.mock("../lib/branch-realtime", () => ({ defaultRealtimeScope: {}, subscribeBranch: mock.subscribe }));
vi.mock("../lib/order-printing", () => ({ OrderPrinting: class {
  discover = mock.discover; run = mock.run; dismiss = mock.dismiss;
  constructor(_branch: number, signal: AbortSignal, notify: (notice: PrintNotice) => void, businessId?: number) { mock.signals.push(signal); mock.scopes.push(businessId); mock.notify = notify; }
} }));
beforeEach(() => { vi.clearAllMocks(); mock.signals.length = 0; mock.scopes.length = 0; mock.notify = null; mock.subscribe.mockReturnValue(mock.off); });
afterEach(cleanup);

it("listens to remote events, reconnects and online recovery using the existing scoped connection", () => {
  const view = render(<PrintNotifications branchId={7} automatic />);
  expect(mock.discover).toHaveBeenCalledTimes(1);
  expect(mock.subscribe).toHaveBeenCalledWith(expect.anything(), 7, expect.any(Function), true);
  act(() => { mock.subscribe.mock.calls[0][2](); window.dispatchEvent(new Event("online")); });
  expect(mock.discover).toHaveBeenCalledTimes(3);
  view.unmount();
  expect(mock.signals[0].aborted).toBe(true); expect(mock.off).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("online"));
  expect(mock.discover).toHaveBeenCalledTimes(3);
});

it("does not query the remote print queue without an operational role", () => {
  render(<PrintNotifications branchId={7} />);
  window.dispatchEvent(new Event("online"));
  expect(mock.subscribe).not.toHaveBeenCalled(); expect(mock.discover).not.toHaveBeenCalled();
});

it("aborts old branch work and ignores local confirmation for a different branch", () => {
  const view = render(<PrintNotifications branchId={7} automatic />);
  view.rerender(<PrintNotifications branchId={8} automatic />);
  expect(mock.signals[0].aborted).toBe(true); expect(mock.signals[1].aborted).toBe(false);
  act(() => window.dispatchEvent(new CustomEvent(ORDER_PRINT_EVENT, { detail: { branchId: 7, orderId: 1, version: 2 } })));
  expect(mock.run).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new CustomEvent(ORDER_PRINT_EVENT, { detail: { branchId: 8, orderId: 2, version: 3 } })));
  expect(mock.run).toHaveBeenCalledWith(2, undefined, 3);
});

it("passes the business scope and persists dismissal of exactly the displayed documents", () => {
  render(<PrintNotifications businessId={2} branchId={7} automatic />);
  const notice: PrintNotice = { orderId: 12, folio: 29, busy: false, warning: true, retryable: true, message: "Impresora no disponible.", jobIds: ["receipt-12", "kitchen-12"] };
  act(() => mock.notify!(notice));
  expect(mock.scopes).toEqual([2]);
  expect(screen.getByText("Folio #29")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso de impresión" }));
  expect(mock.dismiss).toHaveBeenCalledExactlyOnceWith(notice);
  expect(screen.queryByText("Folio #29")).not.toBeInTheDocument();
});

it("keeps explicit recovery available without creating another print request", () => {
  render(<PrintNotifications businessId={2} branchId={7} />);
  act(() => mock.notify!({ orderId: 12, folio: 29, busy: false, warning: true, retryable: true, message: "El documento sigue pendiente." }));
  fireEvent.click(screen.getByRole("button", { name: "Reintentar impresión" }));
  expect(mock.run).toHaveBeenCalledExactlyOnceWith(12, true);
  expect(mock.discover).not.toHaveBeenCalled();
});

it("replaces a notice for the same order and does not offer closing during dispatch", () => {
  render(<PrintNotifications businessId={2} branchId={7} />);
  act(() => mock.notify!({ orderId: 12, folio: 29, busy: true, warning: false, retryable: false, message: "Enviando documentos." }));
  expect(screen.queryByRole("button", { name: "Cerrar aviso de impresión" })).not.toBeInTheDocument();
  act(() => mock.notify!({ orderId: 12, folio: 29, busy: false, warning: false, retryable: false, message: "Comanda enviada." }));
  expect(screen.getAllByText("Folio #29")).toHaveLength(1);
  expect(screen.queryByText("Enviando documentos.")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Comanda enviada.");
});
