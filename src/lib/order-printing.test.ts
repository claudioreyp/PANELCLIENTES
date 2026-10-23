import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderPrinting, type PosPrintJob } from "./order-printing";
import { api, ApiError } from "./api";
import { qzBridge } from "./qz-tray";
import { renderThermalDocument } from "./thermal-print";

vi.mock("./api", async (original) => ({ ...await original<typeof import("./api")>(), api: vi.fn() }));
vi.mock("./qz-tray", () => ({ qzBridge: { dispatch: vi.fn() } }));
vi.mock("./thermal-print", () => ({ renderThermalDocument: vi.fn(() => "<p>confirmed snapshot</p>") }));

function job(id: string, kind: PosPrintJob["job_type"]): PosPrintJob {
  return { id, order_id: 12, branch_id: 7, job_type: kind, status: "pending", retryable: false, payload: {
    snapshot_version: 1, printer_name: "POS-80", paper_width_mm: 80, copies: 1,
    business: { name: "Test" }, branch: { name: "Test" }, order: { number: "ABC", id: 12 } as PosPrintJob["payload"]["order"], ticket: null,
  } };
}

describe("automatic order printing", () => {
  let jobs: PosPrintJob[];
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    jobs = [job("receipt", "customer_receipt"), job("kitchen", "kitchen_ticket")];
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path === "/orders/12/printing") return { order_id: 12, items: structuredClone(jobs), recoverable_error: false };
      const target = jobs.find((item) => path.includes(`/${item.id}/`))!;
      if (path.endsWith("/claim")) { target.status = "claimed"; return { job: target, dispatch_allowed: true }; }
      if (path.endsWith("/complete")) {
        const { outcome } = JSON.parse(String(options?.body));
        target.status = outcome === "printed" ? "printed" : "failed";
        target.retryable = outcome === "not_sent";
        return target;
      }
      throw new Error(`Unexpected ${path}`);
    });
    vi.mocked(qzBridge.dispatch).mockImplementation(async (options) => { await options.beforeSend(); options.onSending(); });
  });

  it("prints both confirmed snapshots once despite duplicate confirmation events", async () => {
    const notify = vi.fn();
    const printing = new OrderPrinting(7, new AbortController().signal, notify);
    const first = printing.run(12);
    expect(printing.run(12)).toBe(first);
    await first; await printing.run(12); await printing.run(12, true);
    expect(qzBridge.dispatch).toHaveBeenCalledTimes(2);
    expect(jobs.every((item) => item.status === "printed")).toBe(true);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("Ticket y comanda enviados"), warning: false }));
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ message: "No quedan trabajos automáticos pendientes.", warning: false }));
  });

  it.each([2, 3])("discovers a later addition at order version %s without repeating old documents", async (additionVersion) => {
    const normal = vi.mocked(api).getMockImplementation()!;
    let version = 2;
    vi.mocked(api).mockImplementation(async (path, options) => path.startsWith("/orders/printing/pending?")
      ? { branch_id: 7, items: jobs.some((row) => row.status === "pending") ? [{ order_id: 12, version }] : [], next_after_order_id: null }
      : normal(path, options));
    const printing = new OrderPrinting(7, new AbortController().signal, vi.fn());
    await printing.discover(); await printing.discover();
    expect(qzBridge.dispatch).toHaveBeenCalledTimes(2);
    version = additionVersion;
    jobs.push(job("addition", "kitchen_ticket"));
    await printing.discover(); await printing.discover();
    expect(qzBridge.dispatch).toHaveBeenCalledTimes(3);
    expect(qzBridge.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ jobName: "Comanda - ABC" }));
  });

  it("paginates remote discovery without truncating and does not enter another branch", async () => {
    const printing = new OrderPrinting(7, new AbortController().signal, vi.fn());
    const run = vi.spyOn(printing, "run").mockResolvedValue();
    vi.mocked(api).mockResolvedValueOnce({ branch_id: 7, items: [{ order_id: 12, version: 2 }], next_after_order_id: 12 })
      .mockResolvedValueOnce({ branch_id: 7, items: [{ order_id: 20, version: 1 }], next_after_order_id: null });
    await printing.discover();
    expect(run.mock.calls).toEqual([[12, false, 2], [20, false, 1]]);
    expect(api).toHaveBeenCalledWith(expect.stringContaining("after_order_id=12"), expect.anything());
    run.mockClear();
    vi.mocked(api).mockResolvedValue({ branch_id: 8, items: [{ order_id: 90, version: 1 }], next_after_order_id: null });
    await printing.discover();
    expect(run).not.toHaveBeenCalled();
  });

  it("cancels late discovery on scope change and surfaces API failure without printing", async () => {
    const controller = new AbortController(), notify = vi.fn();
    const printing = new OrderPrinting(7, controller.signal, notify);
    vi.mocked(api).mockRejectedValueOnce(new Error("offline"));
    await printing.discover();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ orderId: 0, retryable: true, warning: true }));
    let resolve!: (value: unknown) => void;
    vi.mocked(api).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const task = printing.discover(); controller.abort();
    resolve({ branch_id: 7, items: [{ order_id: 12, version: 2 }], next_after_order_id: null });
    await task;
    expect(qzBridge.dispatch).not.toHaveBeenCalled();
  });

  it("renders the saved branch address, never another terminal's current branch", async () => {
    jobs[0].payload.branch.address = "Direccion historica de la sucursal";
    await new OrderPrinting(7, new AbortController().signal, vi.fn()).run(12);
    expect(renderThermalDocument).toHaveBeenNthCalledWith(1, expect.objectContaining({ branchAddress: "Direccion historica de la sucursal" }));
  });

  it("finishes the receipt before starting a reversed automatic kitchen job", async () => {
    jobs.reverse();
    let release!: () => void;
    vi.mocked(qzBridge.dispatch).mockImplementationOnce(async (options) => {
      await options.beforeSend(); options.onSending();
      await new Promise<void>((resolve) => { release = resolve; });
    });
    const pending = new OrderPrinting(7, new AbortController().signal, vi.fn()).run(12);
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(qzBridge.dispatch).toHaveBeenCalledOnce();
    expect(qzBridge.dispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({ jobName: "Ticket - ABC" }));
    expect(jobs.map((item) => item.status)).toEqual(["pending", "claimed"]);
    expect(vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/claim")).map(([path]) => path)).toEqual(["/orders/12/printing/receipt/claim"]);
    release();
    await pending;
    expect(qzBridge.dispatch).toHaveBeenCalledTimes(2);
    expect(qzBridge.dispatch).toHaveBeenNthCalledWith(2, expect.objectContaining({ jobName: "Comanda - ABC" }));
    expect(vi.mocked(api).mock.calls.filter(([path]) => /\/(claim|complete)$/.test(path)).map(([path]) => path)).toEqual([
      "/orders/12/printing/receipt/claim", "/orders/12/printing/receipt/complete",
      "/orders/12/printing/kitchen/claim", "/orders/12/printing/kitchen/complete",
    ]);
    expect(jobs.every((item) => item.status === "printed")).toBe(true);
  });

  it("preserves the API sequence within each document kind and each saved print configuration", async () => {
    jobs = [job("kitchen-z", "kitchen_ticket"), job("receipt-z", "customer_receipt"), job("kitchen-a", "kitchen_ticket"), job("receipt-a", "customer_receipt")];
    for (const [index, item] of jobs.entries()) {
      item.payload = { ...item.payload, copies: index + 1, paper_width_mm: index % 2 ? 58 : 80, print_language: index % 2 ? "escpos" : "pixel", order: { ...item.payload.order, number: item.id } };
    }
    await new OrderPrinting(7, new AbortController().signal, vi.fn()).run(12);
    expect(qzBridge.dispatch).toHaveBeenCalledTimes(4);
    const expectedOrder = [jobs[1], jobs[3], jobs[0], jobs[2]];
    for (const [index, item] of expectedOrder.entries()) {
      expect(qzBridge.dispatch).toHaveBeenNthCalledWith(index + 1, expect.objectContaining({
        orderId: 12, branchId: 7, printerName: item.payload.printer_name,
        paperWidth: item.payload.paper_width_mm, copies: item.payload.copies, printLanguage: item.payload.print_language,
        jobName: `${item.job_type === "customer_receipt" ? "Ticket" : "Comanda"} - ${item.id}`,
      }));
    }
    expect(vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/claim")).map(([path]) => path)).toEqual(expectedOrder.map((item) => `/orders/12/printing/${item.id}/claim`));
    expect(jobs.every((item) => item.status === "printed")).toBe(true);
  });

  it("retries only the unsent document after a partial failure", async () => {
    vi.mocked(qzBridge.dispatch).mockRejectedValueOnce(new Error("QZ cerrado"));
    const notify = vi.fn(), printing = new OrderPrinting(7, new AbortController().signal, notify);
    await printing.run(12);
    expect(jobs.map((item) => item.status)).toEqual(["pending", "printed"]);
    expect(vi.mocked(api).mock.calls.filter(([path]) => /\/receipt\/(claim|complete)$/.test(path))).toHaveLength(0);
    await printing.run(12, true);
    expect(qzBridge.dispatch).toHaveBeenCalledTimes(3);
    expect(jobs.every((item) => item.status === "printed")).toBe(true);
  });

  it("prints a newly confirmed command after an earlier dispatch without repeating old jobs", async () => {
    let release!: () => void;
    vi.mocked(qzBridge.dispatch).mockImplementationOnce(async (options) => {
      await options.beforeSend(); options.onSending();
      await new Promise<void>((resolve) => { release = resolve; });
    });
    const printing = new OrderPrinting(7, new AbortController().signal, vi.fn());
    const first = printing.run(12, false, 3);
    await vi.waitFor(() => expect(release).toBeDefined());
    jobs.push(job("new-command", "kitchen_ticket"));
    const next = printing.run(12, false, 4);
    release(); await first; await next;
    await printing.run(12, false, 3); await printing.run(12, false, 4);
    expect(qzBridge.dispatch).toHaveBeenCalledTimes(3);
    expect(jobs.every((item) => item.status === "printed")).toBe(true);
  });

  it("reports only the added kitchen command, not previously printed documents", async () => {
    const notify = vi.fn(), printing = new OrderPrinting(7, new AbortController().signal, notify);
    await printing.run(12, false, 3);
    jobs.push(job("addition", "kitchen_ticket"));
    await printing.run(12, false, 4);
    expect(qzBridge.dispatch).toHaveBeenCalledTimes(3);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining("Comanda enviada"), warning: false }));
    expect(vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/addition/claim"))).toHaveLength(1);
  });

  it("never replays an uncertain QZ submission", async () => {
    vi.mocked(qzBridge.dispatch).mockImplementationOnce(async (options) => { await options.beforeSend(); options.onSending(); throw new Error("Connection lost"); });
    const notify = vi.fn(), printing = new OrderPrinting(7, new AbortController().signal, notify);
    await printing.run(12); await printing.run(12, true); await printing.run(12, true); await printing.run(12, false, 4);
    expect(jobs[0]).toMatchObject({ status: "failed", retryable: false });
    expect(qzBridge.dispatch).toHaveBeenCalledTimes(2);
    const claims = vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/receipt/claim"));
    const acks = vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/receipt/complete"));
    expect(claims).toHaveLength(1);
    expect(acks).toHaveLength(1);
    expect(JSON.parse(String(acks[0][1]?.body))).toMatchObject({ outcome: "unknown" });
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ warning: true, retryable: false }));
  });

  it.each([
    { outcome: "printed", committed: false }, { outcome: "printed", committed: true },
    { outcome: "unknown", committed: false }, { outcome: "unknown", committed: true },
  ] as const)("retries only the $outcome acknowledgement after a lost reply (committed: $committed)", async ({ outcome, committed }) => {
    const base = vi.mocked(api).getMockImplementation()!;
    let failed = false;
    if (outcome === "unknown") vi.mocked(qzBridge.dispatch).mockImplementationOnce(async (options) => { await options.beforeSend(); options.onSending(); throw new Error("QZ response lost"); });
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path.endsWith("/receipt/complete") && !failed) {
        failed = true;
        if (committed) await base(path, options);
        throw new Error("API offline");
      }
      return base(path, options);
    });
    const notify = vi.fn(), printing = new OrderPrinting(7, new AbortController().signal, notify);
    await printing.run(12);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ warning: true, retryable: true, message: expect.stringContaining("Falta confirmar el resultado con la API") }));
    await printing.run(12, true); await printing.run(12, true);
    expect(qzBridge.dispatch).toHaveBeenCalledTimes(2);
    const acks = vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/receipt/complete"));
    expect(acks).toHaveLength(2);
    expect(acks[0][1]?.idempotencyKey).toEqual(expect.any(String));
    expect(acks[0][1]?.idempotencyKey).toBe(acks[1][1]?.idempotencyKey);
    expect(acks[0][1]?.body).toBe(acks[1][1]?.body);
    const claims = vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/receipt/claim"));
    expect(claims).toHaveLength(1);
    const { terminal_id, claim_token } = JSON.parse(String(claims[0][1]?.body));
    expect(JSON.parse(String(acks[0][1]?.body))).toEqual({ terminal_id, claim_token, outcome });
    expect(jobs[0]).toMatchObject({ status: outcome === "printed" ? "printed" : "failed", retryable: false });
  });

  it("does not print when another terminal owns the claim", async () => {
    const base = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (path, options) => path.endsWith("/claim") ? { dispatch_allowed: false } : base(path, options));
    await new OrderPrinting(7, new AbortController().signal, vi.fn()).run(12);
    expect(vi.mocked(api).mock.calls.some(([path]) => path.endsWith("/complete"))).toBe(false);
  });

  it.each(["printed", "unknown"] as const)("converges two competing terminals to %s without another dispatch", async (outcome) => {
    vi.useFakeTimers();
    jobs = [job("addition", "kitchen_ticket")];
    const base = vi.mocked(api).getMockImplementation()!;
    const initialReaders: (() => void)[] = [];
    let initialReads = 0, authorizedSends = 0;
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path === "/orders/12/printing" && initialReads++ < 2) {
        const snapshot = structuredClone(jobs);
        await new Promise<void>((done) => { initialReaders.push(done); if (initialReaders.length === 2) initialReaders.forEach((release) => release()); });
        return { order_id: 12, items: snapshot, recoverable_error: false };
      }
      if (path.endsWith("/claim") && jobs[0].status !== "pending") throw new ApiError("Print job already claimed; dispatch outcome may be unknown", 409);
      return base(path, options);
    });
    let release!: () => void;
    vi.mocked(qzBridge.dispatch).mockImplementation(async (options) => {
      await options.beforeSend(); options.onSending(); authorizedSends++;
      await new Promise<void>((done) => { release = done; });
      if (outcome === "unknown") throw new Error("QZ reply lost");
    });
    const firstNotice = vi.fn(), secondNotice = vi.fn();
    const first = new OrderPrinting(7, new AbortController().signal, firstNotice).run(12, false, 4);
    const second = new OrderPrinting(7, new AbortController().signal, secondNotice).run(12, false, 4);
    await vi.advanceTimersByTimeAsync(0);
    expect(authorizedSends).toBe(1);
    expect(vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/claim"))).toHaveLength(2);
    expect([...firstNotice.mock.calls, ...secondNotice.mock.calls].some(([notice]) => notice.message.includes("pendiente de confirmación") && !notice.warning)).toBe(true);
    release();
    await vi.advanceTimersByTimeAsync(1600); await Promise.all([first, second]);
    expect(authorizedSends).toBe(1);
    expect(vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/complete"))).toHaveLength(1);
    expect(jobs[0].status).toBe(outcome === "printed" ? "printed" : "failed");
    expect(firstNotice).toHaveBeenLastCalledWith(expect.objectContaining({ warning: outcome === "unknown", retryable: false }));
    expect(secondNotice).toHaveBeenLastCalledWith(expect.objectContaining({ warning: outcome === "unknown", retryable: false }));
  });

  it("refreshes an observed claim after the bounded window even when the pending queue is empty", async () => {
    vi.useFakeTimers();
    jobs = [{ ...job("addition", "kitchen_ticket"), status: "claimed" }];
    const base = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (path, options) => path.startsWith("/orders/printing/pending?")
      ? { branch_id: 7, items: [], next_after_order_id: null } : base(path, options));
    const notify = vi.fn(), printing = new OrderPrinting(7, new AbortController().signal, notify);
    const first = printing.run(12, false, 4);
    await vi.advanceTimersByTimeAsync(1600); await first;
    expect(vi.mocked(api).mock.calls.filter(([path]) => path === "/orders/12/printing")).toHaveLength(5);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining("pendiente de confirmación"), warning: false }));
    jobs[0].status = "printed";
    await printing.discover();
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ message: "No quedan trabajos automáticos pendientes.", warning: false }));
    const reads = vi.mocked(api).mock.calls.filter(([path]) => path === "/orders/12/printing").length;
    await printing.discover(); await printing.discover();
    expect(vi.mocked(api).mock.calls.filter(([path]) => path === "/orders/12/printing")).toHaveLength(reads);
    expect(qzBridge.dispatch).not.toHaveBeenCalled();
    expect(vi.mocked(api).mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
  });

  it("keeps a local lost ACK ahead of status reconciliation without retrying it automatically", async () => {
    jobs[1].status = "claimed";
    const base = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path.startsWith("/orders/printing/pending?")) return { branch_id: 7, items: [], next_after_order_id: null };
      if (path.endsWith("/receipt/complete")) { await base(path, options); throw new Error("ACK response lost after commit"); }
      return base(path, options);
    });
    const notify = vi.fn(), printing = new OrderPrinting(7, new AbortController().signal, notify);
    await printing.run(12);
    jobs[1].status = "printed";
    const calls = vi.mocked(api).mock.calls.length;
    await printing.discover();
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining("Falta confirmar el resultado con la API"), retryable: true, warning: true }));
    expect(vi.mocked(api).mock.calls.slice(calls).every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
    expect(vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/receipt/complete"))).toHaveLength(1);
    expect(qzBridge.dispatch).toHaveBeenCalledOnce();
  });

  it.each(["wait", "read"])("aborts claim reconciliation during its %s without a late notice", async (phase) => {
    vi.useFakeTimers();
    jobs = [{ ...job("addition", "kitchen_ticket"), status: "claimed" }];
    const base = vi.mocked(api).getMockImplementation()!;
    let reads = 0, release!: (value: unknown) => void;
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path === "/orders/12/printing" && ++reads === 3 && phase === "read") return new Promise((done) => { release = done; });
      return base(path, options);
    });
    const controller = new AbortController(), notify = vi.fn(), printing = new OrderPrinting(7, controller.signal, notify);
    const task = printing.run(12);
    await vi.advanceTimersByTimeAsync(phase === "read" ? 100 : 0);
    const notices = notify.mock.calls.length;
    controller.abort();
    if (phase === "read") release({ order_id: 12, items: [{ ...jobs[0], status: "printed" }], recoverable_error: false });
    await task; await vi.advanceTimersByTimeAsync(5000); await printing.discover();
    expect(notify).toHaveBeenCalledTimes(notices);
    expect(reads).toBe(phase === "read" ? 3 : 2);
    expect(qzBridge.dispatch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains an unconfirmed notice when a status read fails and recovers on the next discovery", async () => {
    vi.useFakeTimers();
    jobs = [{ ...job("addition", "kitchen_ticket"), status: "claimed" }];
    const base = vi.mocked(api).getMockImplementation()!;
    let reads = 0;
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path.startsWith("/orders/printing/pending?")) return { branch_id: 7, items: [], next_after_order_id: null };
      if (path === "/orders/12/printing" && ++reads === 3) throw new Error("offline");
      return base(path, options);
    });
    const notify = vi.fn(), printing = new OrderPrinting(7, new AbortController().signal, notify);
    const first = printing.run(12); await vi.advanceTimersByTimeAsync(100); await first;
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining("No se pudo actualizar"), warning: true }));
    jobs[0].status = "printed"; await printing.discover();
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ message: "No quedan trabajos automáticos pendientes.", warning: false }));
    expect(qzBridge.dispatch).not.toHaveBeenCalled();
  });

  it.each(["addition", "manual"] as const)("ignores a stale reconciliation response after a new %s execution", async (kind) => {
    vi.useFakeTimers();
    jobs = [{ ...job("older", "kitchen_ticket"), status: "claimed" }];
    const base = vi.mocked(api).getMockImplementation()!;
    let holdRead = false, release!: (value: unknown) => void;
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path.startsWith("/orders/printing/pending?")) return { branch_id: 7, items: [], next_after_order_id: null };
      if (path === "/orders/12/printing" && options?.method === "POST") {
        const created = job("new-manual", "customer_receipt"); jobs.push(created); return created;
      }
      if (path === "/orders/12/printing" && holdRead) {
        holdRead = false;
        return new Promise((done) => { release = done; });
      }
      return base(path, options);
    });
    const notify = vi.fn(), printing = new OrderPrinting(7, new AbortController().signal, notify);
    const first = printing.run(12, false, 3); await vi.advanceTimersByTimeAsync(1600); await first;
    holdRead = true;
    const refresh = printing.discover(); await vi.advanceTimersByTimeAsync(0);
    expect(release).toBeDefined();
    const stale = structuredClone(jobs);
    jobs[0].status = "printed";
    if (kind === "addition") { jobs.push(job("new-addition", "kitchen_ticket")); await printing.run(12, false, 4); }
    else await printing.manual({ branchId: 7, orderId: 12, orderVersion: 4 });
    expect(jobs.every((entry) => entry.status === "printed")).toBe(true);
    const notices = notify.mock.calls.length, latest = notify.mock.lastCall?.[0];
    release({ order_id: 12, items: stale, recoverable_error: false }); await refresh;
    expect(notify).toHaveBeenCalledTimes(notices);
    expect(notify).toHaveBeenLastCalledWith(latest);
    const reads = vi.mocked(api).mock.calls.filter(([path]) => path === "/orders/12/printing").length;
    await printing.discover();
    expect(vi.mocked(api).mock.calls.filter(([path]) => path === "/orders/12/printing")).toHaveLength(reads);
    expect(qzBridge.dispatch).toHaveBeenCalledOnce();
  });

  it.each(["printed", "cancelled", "unknown", "missing"] as const)("keeps manual reconciliation scoped to its own %s document", async (outcome) => {
    vi.useFakeTimers();
    jobs = [{ ...job("old-unknown", "customer_receipt"), status: "failed", retryable: false }];
    const manualJob = { ...job("manual-copy", "kitchen_ticket"), status: "claimed" as const };
    const base = vi.mocked(api).getMockImplementation()!;
    let reads = 0;
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path === "/orders/12/printing" && options?.method === "POST") { jobs.push(manualJob); return manualJob; }
      if (path === "/orders/12/printing" && ++reads === 3) {
        if (outcome === "missing") jobs = jobs.filter((entry) => entry.id !== manualJob.id);
        else jobs = jobs.map((entry) => entry.id === manualJob.id ? { ...entry, status: outcome === "unknown" ? "failed" : outcome } : entry);
      }
      return base(path, options);
    });
    const notify = vi.fn(), printing = new OrderPrinting(7, new AbortController().signal, notify);
    const task = printing.manual({ branchId: 7, orderId: 12, orderVersion: 2, ticketId: 33, ticketVersion: 4 });
    await vi.advanceTimersByTimeAsync(1600); await task;
    const message = outcome === "printed" ? "No quedan trabajos automáticos pendientes."
      : outcome === "cancelled" ? "El documento quedó desactualizado y no se imprimió."
        : outcome === "unknown" ? "Revisa la impresora: hay un envío cuyo resultado no se pudo confirmar."
          : "No se pudo actualizar el estado de impresión.";
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ message: expect.stringContaining(message), warning: outcome !== "printed" }));
    expect(qzBridge.dispatch).not.toHaveBeenCalled();
    expect(vi.mocked(api).mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
    expect(jobs.find((entry) => entry.id === "old-unknown")).toMatchObject({ status: "failed", retryable: false });
  });

  it("deduplicates concurrent discoveries of an observed claim", async () => {
    vi.useFakeTimers();
    jobs = [{ ...job("addition", "kitchen_ticket"), status: "claimed" }];
    const base = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (path, options) => path.startsWith("/orders/printing/pending?")
      ? { branch_id: 7, items: [], next_after_order_id: null } : base(path, options));
    const printing = new OrderPrinting(7, new AbortController().signal, vi.fn());
    const initial = printing.run(12); await vi.advanceTimersByTimeAsync(1600); await initial;
    const reads = vi.mocked(api).mock.calls.filter(([path]) => path === "/orders/12/printing").length;
    const first = printing.discover();
    expect(printing.discover()).toBe(first);
    expect(printing.discover()).toBe(first);
    await first; await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(api).mock.calls.filter(([path]) => path === "/orders/12/printing").length - reads).toBe(2);
    await vi.advanceTimersByTimeAsync(30000);
    expect(vi.mocked(api).mock.calls.filter(([path]) => path === "/orders/12/printing").length - reads).toBe(2);
    expect(qzBridge.dispatch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("manual printing submits only the requested job and permits another deliberate copy", async () => {
    const base = vi.mocked(api).getMockImplementation()!;
    let copies = 0;
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path === "/orders/12/printing" && options?.method === "POST") {
        expect(JSON.parse(String(options.body))).toEqual({ job_type: "kitchen_ticket", kitchen_ticket_id: 33, expected_order_version: 2, expected_ticket_version: 4 });
        const created = job(`manual-${++copies}`, "kitchen_ticket"); jobs.push(created); return created;
      }
      return base(path, options);
    });
    const printing = new OrderPrinting(7, new AbortController().signal, vi.fn());
    const request = { branchId: 7, orderId: 12, orderVersion: 2, ticketId: 33, ticketVersion: 4 };
    await printing.manual(request); await printing.manual(request);
    expect(qzBridge.dispatch).toHaveBeenCalledTimes(2);
    expect(jobs.slice(0, 2).map((item) => item.status)).toEqual(["pending", "pending"]);
    expect(jobs.slice(2).every((item) => item.status === "printed")).toBe(true);
  });

  it("keeps the same manual creation intent after an uncertain response", async () => {
    const base = vi.mocked(api).getMockImplementation()!;
    let key: string | undefined;
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path === "/orders/12/printing" && options?.method === "POST") {
        if (!key) { key = options.idempotencyKey; jobs.push(job("manual", "customer_receipt")); throw new Error("Connection lost"); }
        expect(options.idempotencyKey).toBe(key); return jobs[2];
      }
      return base(path, options);
    });
    const printing = new OrderPrinting(7, new AbortController().signal, vi.fn());
    await printing.manual({ branchId: 7, orderId: 12, orderVersion: 2 });
    expect(qzBridge.dispatch).not.toHaveBeenCalled();
    await printing.run(12, true);
    expect(qzBridge.dispatch).toHaveBeenCalledOnce();
  });

  it.each([
    [409, "Enable advanced printing and select a printer first", "Activa Impresión avanzada"],
    [409, "Order changed; refresh before requesting a print", "El pedido cambió"],
    [403, "Insufficient POS printing permission", "No tienes permiso"],
  ])("explains manual API %s failures without dispatching or claiming success", async (status, message, expected) => {
    const notify = vi.fn();
    vi.mocked(api).mockRejectedValueOnce(new ApiError(message, status));
    await new OrderPrinting(7, new AbortController().signal, notify).manual({ branchId: 7, orderId: 12, orderVersion: 2 });
    expect(qzBridge.dispatch).not.toHaveBeenCalled();
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ warning: true, busy: false, message: expect.stringContaining(expected) }));
  });

  it("reports a cancelled stale manual document instead of implying it was printed", async () => {
    const base = vi.mocked(api).getMockImplementation()!;
    const created = { ...job("stale-manual", "customer_receipt"), status: "cancelled" as const };
    jobs.push(created);
    vi.mocked(api).mockImplementation(async (path, options) => options?.method === "POST" && path.endsWith("/printing") ? created : base(path, options));
    const notify = vi.fn();
    await new OrderPrinting(7, new AbortController().signal, notify).manual({ branchId: 7, orderId: 12, orderVersion: 2 });
    expect(qzBridge.dispatch).not.toHaveBeenCalled();
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ warning: true, message: expect.stringContaining("no se imprimió") }));
  });

  it("drops late replies after branch change and rejects cross-branch snapshots", async () => {
    const notify = vi.fn(), controller = new AbortController();
    let resolve!: (value: unknown) => void;
    vi.mocked(api).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = new OrderPrinting(7, controller.signal, notify).run(12);
    controller.abort(); resolve({ order_id: 12, items: jobs, recoverable_error: false });
    await pending;
    expect(qzBridge.dispatch).not.toHaveBeenCalled(); expect(notify).not.toHaveBeenCalled();
    jobs[0].branch_id = 8;
    await new OrderPrinting(7, new AbortController().signal, notify).run(12);
    expect(qzBridge.dispatch).not.toHaveBeenCalled();
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ warning: true }));
  });
});
