import { beforeEach, describe, expect, it, vi } from "vitest";
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
