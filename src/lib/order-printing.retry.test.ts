import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OrderPrinting, type PosPrintJob } from "./order-printing";
import { api } from "./api";
import { qzBridge } from "./qz-tray";
import { PRINT_RETRY_CUTOVER } from "./print-retry-policy";

vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), api: vi.fn() }));
vi.mock("./qz-tray", () => ({ qzBridge: { dispatch: vi.fn() } }));
vi.mock("./thermal-print", () => ({ renderThermalDocument: vi.fn(() => "<p>synthetic</p>") }));
let jobs: PosPrintJob[];
const controllers: AbortController[] = [];
function job(id = "receipt", created_at = new Date(PRINT_RETRY_CUTOVER + 1).toISOString()): PosPrintJob {
  return { id, order_id: 12, branch_id: 7, job_type: "customer_receipt", status: "pending", retryable: false, attempts: 0, created_at,
    payload: { snapshot_version: 1, printer_name: "Test", paper_width_mm: 80, copies: 1,
      business: { name: "Synthetic" }, branch: { name: "Synthetic" }, ticket: null,
      order: { id: 12, business_id: 2, branch_id: 7, folio: 12, number: "SYNTHETIC" } as PosPrintJob["payload"]["order"] } };
}
function printing(notify = vi.fn()) {
  const controller = new AbortController(); controllers.push(controller);
  return { instance: new OrderPrinting(7, controller.signal, notify, 2), controller, notify };
}
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(PRINT_RETRY_CUTOVER + 10000);
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: (key: string, _options: unknown, run: () => Promise<unknown>) => {
    const task = (queues.get(key) ?? Promise.resolve()).then(run); queues.set(key, task.catch(() => {})); return task;
  } } });
  jobs = [job()];
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path.startsWith("/orders/printing/pending?")) return { branch_id: 7, items: jobs.some(item => item.status === "pending") ? [{ order_id: 12, version: 2 }] : [], next_after_order_id: null };
    if (path === "/orders/12/printing") return { order_id: 12, items: structuredClone(jobs), recoverable_error: false };
    const target = jobs.find(item => path.includes(`/${item.id}/`))!;
    if (path.endsWith("/claim")) { target.status = "claimed"; return { dispatch_allowed: true }; }
    if (path.endsWith("/complete")) {
      const { outcome } = JSON.parse(String(options?.body)); target.status = outcome === "printed" ? "printed" : "failed";
      target.retryable = outcome === "not_sent"; return target;
    }
    throw new Error(`Unexpected ${path}`);
  });
  vi.mocked(qzBridge.dispatch).mockImplementation(async options => { await options.beforeSend(); options.onSending(); });
});
afterEach(() => { controllers.splice(0).forEach(controller => controller.abort()); vi.useRealTimers(); vi.restoreAllMocks(); });

it("automatically retries new unsent work once after one second, then stays silent across reload and days", async () => {
  vi.mocked(qzBridge.dispatch).mockRejectedValue(new Error("No printer"));
  const first = printing(); await first.instance.discover();
  expect(qzBridge.dispatch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(999); expect(qzBridge.dispatch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(qzBridge.dispatch).toHaveBeenCalledTimes(2);
  first.controller.abort(); await vi.advanceTimersByTimeAsync(86400000);
  const next = printing(); await next.instance.discover(); await next.instance.discover();
  expect(qzBridge.dispatch).toHaveBeenCalledTimes(2); expect(next.notify).not.toHaveBeenCalled();
});

it("gives old pending documents one final attempt and no delayed retry", async () => {
  jobs = [job("old", new Date(PRINT_RETRY_CUTOVER - 1).toISOString())];
  vi.mocked(qzBridge.dispatch).mockRejectedValue(new Error("No printer"));
  const first = printing(); await first.instance.discover(); await vi.advanceTimersByTimeAsync(3000);
  first.controller.abort(); const next = printing(); await next.instance.discover();
  expect(qzBridge.dispatch).toHaveBeenCalledTimes(1); expect(next.notify).not.toHaveBeenCalled();
});

it("restores a safe retry after remount even when the failed job disappeared from the pending queue", async () => {
  vi.mocked(qzBridge.dispatch).mockImplementationOnce(async options => { await options.beforeSend(); throw new Error("Not sent"); });
  const first = printing(); await first.instance.run(12); first.controller.abort();
  expect(jobs[0]).toMatchObject({ status: "failed", retryable: true });
  await vi.advanceTimersByTimeAsync(1000);
  const next = printing(); await next.instance.discover();
  expect(qzBridge.dispatch).toHaveBeenCalledTimes(2); expect(jobs[0].status).toBe("printed");
  const claims = vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/claim"));
  expect(JSON.parse(String(claims[1][1]?.body)).retry_not_sent).toBe(true);
});

it("keeps a dismissed notice closed while performing its remaining safe retry", async () => {
  vi.mocked(qzBridge.dispatch).mockRejectedValue(new Error("No printer"));
  const first = printing(); await first.instance.run(12);
  first.instance.dismiss(first.notify.mock.lastCall![0]); await vi.advanceTimersByTimeAsync(0);
  first.notify.mockClear(); await vi.advanceTimersByTimeAsync(1000);
  expect(qzBridge.dispatch).toHaveBeenCalledTimes(2); expect(first.notify).not.toHaveBeenCalled();
});

it("prints a new addition without resurrecting the exhausted older document's warning", async () => {
  jobs = [job("old", new Date(PRINT_RETRY_CUTOVER - 1).toISOString())];
  vi.mocked(qzBridge.dispatch).mockRejectedValueOnce(new Error("No printer"));
  const first = printing(); await first.instance.discover(); first.notify.mockClear();
  jobs.push({ ...job("addition"), job_type: "kitchen_ticket" });
  await first.instance.discover();
  expect(qzBridge.dispatch).toHaveBeenCalledTimes(2);
  expect(jobs[0].status).toBe("pending"); expect(jobs[1].status).toBe("printed");
  expect(first.notify).toHaveBeenLastCalledWith(expect.objectContaining({ warning: false, message: expect.stringContaining("Comanda enviada"), jobIds: ["addition"] }));
});

it("does not retry unknown sends or repeat their warning on discovery", async () => {
  vi.mocked(qzBridge.dispatch).mockImplementationOnce(async options => { await options.beforeSend(); options.onSending(); throw new Error("Unknown"); });
  const first = printing(); await first.instance.run(12); first.notify.mockClear();
  await vi.advanceTimersByTimeAsync(2000); await first.instance.discover();
  expect(qzBridge.dispatch).toHaveBeenCalledTimes(1); expect(first.notify).not.toHaveBeenCalled();
});

it("does not let another tab consume a second dispatch or publish empty print notices", async () => {
  const first = printing(), second = printing();
  await Promise.all([first.instance.run(12), second.instance.run(12)]);
  expect(qzBridge.dispatch).toHaveBeenCalledTimes(1); expect(second.notify).not.toHaveBeenCalled();
});

it("fails quietly once when durable storage is unavailable, while explicit printing still works", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Full"); });
  const first = printing(); await first.instance.discover(); await first.instance.discover();
  expect(qzBridge.dispatch).not.toHaveBeenCalled(); expect(first.notify).toHaveBeenCalledTimes(1);
  await first.instance.run(12, true); expect(qzBridge.dispatch).toHaveBeenCalledTimes(1);
});

it("rejects a foreign-business payload before dispatch", async () => {
  jobs[0].payload.order.business_id = 9;
  await printing().instance.run(12); expect(qzBridge.dispatch).not.toHaveBeenCalled();
});

it("retires a queued retry after explicit success without resetting its history", async () => {
  vi.mocked(qzBridge.dispatch).mockRejectedValueOnce(new Error("No printer"));
  const first = printing(); await first.instance.run(12); await first.instance.run(12, true);
  first.controller.abort(); await vi.advanceTimersByTimeAsync(2000);
  const reads = vi.mocked(api).mock.calls.filter(([path]) => path === "/orders/12/printing").length;
  const next = printing(); await next.instance.discover();
  expect(vi.mocked(api).mock.calls.filter(([path]) => path === "/orders/12/printing")).toHaveLength(reads);
  expect(qzBridge.dispatch).toHaveBeenCalledTimes(2); expect(next.notify).not.toHaveBeenCalled();
});
