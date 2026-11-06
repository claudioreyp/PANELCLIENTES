// Immutable release boundary: existing queued documents receive one final attempt.
export const PRINT_RETRY_CUTOVER = Date.parse("2026-11-06T15:25:16Z");
export const PRINT_RETRY_DELAY_MS = 1000;

export type AutomaticPrintJob = {
  id: string; order_id: number; created_at?: string; attempts?: number;
  status: string; retryable: boolean;
};
export type PrintAttemptOutcome = "printed" | "not_sent" | "unknown";
type Entry = {
  orderId: number; attempts: number; limit: 1 | 2;
  outcome: PrintAttemptOutcome | "reserved" | "manual";
  retryAt?: number; dismissed?: boolean;
};
type LockProvider = Pick<LockManager, "request">;
const ERROR = "No se pudo guardar el control de impresión automática. Puedes reimprimir manualmente desde el pedido.";
export class PrintPolicyError extends Error { constructor() { super(ERROR); } }

/** Only counters/IDs are durable. Dispatch authorizations and payloads never are. */
export class PrintRetryPolicy {
  private prefix: string;
  constructor(businessId: number, branchId: number,
    private storage: Storage = localStorage,
    private locks: LockProvider | undefined = navigator.locks,
    private now: () => number = Date.now) {
    this.prefix = `impulsa.print-retry.v1:${businessId}:${branchId}:`;
  }

  private key(jobId: string) { return `${this.prefix}${encodeURIComponent(jobId)}`; }
  private read(jobId: string): Entry | undefined {
    let raw: string | null;
    try { raw = this.storage.getItem(this.key(jobId)); } catch { throw new PrintPolicyError(); }
    if (raw == null) return;
    let entry: Entry;
    try { entry = JSON.parse(raw) as Entry; } catch { throw new PrintPolicyError(); }
    if (!entry || typeof entry !== "object") throw new PrintPolicyError();
    if (!Number.isInteger(entry.orderId) || entry.orderId <= 0 || !Number.isInteger(entry.attempts)
      || entry.attempts < 0 || ![1, 2].includes(entry.limit)
      || !["printed", "not_sent", "unknown", "reserved", "manual"].includes(entry.outcome)
      || (entry.retryAt != null && !Number.isFinite(entry.retryAt))) throw new PrintPolicyError();
    return entry;
  }
  private write(jobId: string, entry: Entry) {
    const raw = JSON.stringify(entry);
    try {
      this.storage.setItem(this.key(jobId), raw);
      if (this.storage.getItem(this.key(jobId)) !== raw) throw new PrintPolicyError();
    } catch { throw new PrintPolicyError(); }
  }
  private async lock<T>(jobId: string, signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    if (!this.locks) throw new PrintPolicyError();
    return this.locks.request(this.key(jobId), { mode: "exclusive", signal }, async () => {
      signal.throwIfAborted();
      return action();
    });
  }
  private eligible(job: AutomaticPrintJob, entry: Entry | undefined) {
    if (entry?.outcome === "manual" || entry?.outcome === "printed" || entry?.outcome === "unknown") return false;
    if (entry && entry.attempts >= entry.limit) return false;
    if (entry?.retryAt != null && entry.retryAt > this.now()) return false;
    // A persisted reservation can recover only after the API proves no send.
    if (job.status === "pending") return true;
    return Boolean(entry && job.status === "failed" && job.retryable);
  }
  canAttempt(job: AutomaticPrintJob) { return this.eligible(job, this.read(job.id)); }

  async attempt<T extends { outcome: PrintAttemptOutcome }>(job: AutomaticPrintJob, signal: AbortSignal,
    send: (retry: boolean) => Promise<T>): Promise<{ attempted: false } | { attempted: true; result: T }> {
    return this.lock(job.id, signal, async () => {
      const previous = this.read(job.id);
      if (!this.eligible(job, previous)) return { attempted: false };
      const created = job.created_at == null ? NaN : Date.parse(job.created_at);
      const limit = previous?.limit ?? (Number.isFinite(created) && created >= PRINT_RETRY_CUTOVER ? 2 : 1);
      const next: Entry = { orderId: job.order_id, attempts: (previous?.attempts ?? 0) + 1,
        limit, outcome: "reserved", ...((previous?.attempts ?? 0) + 1 < limit ? { retryAt: this.now() + PRINT_RETRY_DELAY_MS } : {}),
        ...(previous?.dismissed ? { dismissed: true } : {}) };
      this.write(job.id, next); // Must succeed before QZ or a dispatch claim.
      let result: T;
      try { result = await send(Boolean(previous?.attempts)); }
      catch (error) { this.write(job.id, { ...next, outcome: "unknown" }); throw error; }
      const finished = { ...next };
      delete finished.retryAt;
      this.write(job.id, { ...finished, outcome: result.outcome,
        ...(result.outcome === "not_sent" && next.attempts < limit ? { retryAt: this.now() + PRINT_RETRY_DELAY_MS } : {}) });
      return { attempted: true, result };
    });
  }

  private entries(): (Entry & { jobId: string })[] {
    const result: (Entry & { jobId: string })[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key?.startsWith(this.prefix)) {
        const jobId = decodeURIComponent(key.slice(this.prefix.length));
        const entry = this.read(jobId);
        if (entry) result.push({ ...entry, jobId });
      }
    }
    return result;
  }
  retries() {
    return this.entries().filter(entry => ["not_sent", "reserved"].includes(entry.outcome) && entry.attempts < entry.limit && entry.retryAt != null)
      .map(entry => ({ orderId: entry.orderId, jobId: entry.jobId, at: entry.retryAt! }));
  }
  markManual(jobId: string, orderId: number) {
    this.write(jobId, { orderId, attempts: 0, limit: 1, outcome: "manual" });
  }
  async observe(job: AutomaticPrintJob, signal: AbortSignal) {
    // Only immutable terminal outcomes can retire a retry from a stale read.
    // A claimed document may still finish safely not_sent, so do not retire it.
    if (!["printed", "cancelled"].includes(job.status) && !(job.status === "failed" && !job.retryable)) return;
    await this.lock(job.id, signal, async () => {
      const entry = this.read(job.id);
      if (!entry?.retryAt) return;
      delete entry.retryAt;
      entry.outcome = job.status === "printed" ? "printed" : "unknown";
      this.write(job.id, entry);
    });
  }
  isDismissed(jobIds: string[]) { return jobIds.length > 0 && jobIds.every(id => this.read(id)?.dismissed); }
  async dismiss(jobIds: string[], signal: AbortSignal) {
    for (const id of jobIds) await this.lock(id, signal, async () => {
      const entry = this.read(id);
      if (entry) this.write(id, { ...entry, dismissed: true });
    });
  }
}
