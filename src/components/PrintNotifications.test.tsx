import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PrintNotifications } from "./PrintNotifications";
import { ORDER_PRINT_EVENT } from "../lib/print-events";

const mock = vi.hoisted(() => ({ discover: vi.fn(), run: vi.fn(), off: vi.fn(), subscribe: vi.fn(), signals: [] as AbortSignal[] }));
vi.mock("../lib/query-session", () => ({ useQuerySession: () => null }));
vi.mock("../lib/branch-realtime", () => ({ defaultRealtimeScope: {}, subscribeBranch: mock.subscribe }));
vi.mock("../lib/order-printing", () => ({ OrderPrinting: class {
  discover = mock.discover; run = mock.run;
  constructor(_branch: number, signal: AbortSignal) { mock.signals.push(signal); }
} }));
beforeEach(() => { vi.clearAllMocks(); mock.signals.length = 0; mock.subscribe.mockReturnValue(mock.off); });
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
