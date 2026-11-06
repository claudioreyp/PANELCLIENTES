import { api, ApiError } from "./api";
import { qzBridge } from "./qz-tray";
import { renderThermalDocument, type ThermalPrintTemplate } from "./thermal-print";
import type { KitchenTicket, OrderDetail } from "../types";
import type { ManualPrintRequest } from "./print-events";
import { PrintPolicyError, PrintRetryPolicy, type PrintAttemptOutcome } from "./print-retry-policy";

export type PosPrintJob = {
  id: string; order_id: number; branch_id: number;
  job_type: "customer_receipt" | "kitchen_ticket";
  status: "pending" | "claimed" | "printed" | "failed" | "cancelled";
  retryable: boolean;
  attempts?: number;
  created_at?: string;
  payload: {
    snapshot_version: 1; printer_name: string; paper_width_mm: 58 | 80; copies: number;
    print_language?: "pixel" | "escpos";
    template?: ThermalPrintTemplate;
    business: { name: string }; branch: { name: string; address?: string | null };
    order: OrderDetail; ticket: KitchenTicket | null;
  };
};
type PrintingResponse = { order_id: number; items: PosPrintJob[]; recoverable_error: boolean };
type Completion = { terminal_id: string; claim_token: string; outcome: "printed" | "not_sent" | "unknown" };
type PendingAck = { path: string; body: Completion; key: string };
export type PrintNotice = { orderId: number; folio?: number | null; busy: boolean; message: string; retryable: boolean; warning: boolean; jobIds?: string[] };
type DispatchResult = { outcome: PrintAttemptOutcome; error?: unknown };

function printingError(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : "No se pudo verificar la impresión.";
  const messages: Record<string, string> = {
    "Enable advanced printing and select a printer first": "Activa Impresión avanzada y guarda una impresora en Configuración > Impresión antes de imprimir.",
    "Order changed; refresh before requesting a print": "El pedido cambió. Actualiza su detalle y solicita la impresión nuevamente.",
    "Kitchen ticket changed or was cancelled; refresh before printing": "La comanda cambió o fue cancelada. Actualiza el pedido antes de imprimirla.",
    "Cancelled orders cannot dispatch kitchen tickets": "El pedido está cancelado. Puedes imprimir su ticket, pero no enviar una comanda a cocina.",
    "Print job is cancelled or stale": "El pedido o la comanda cambiaron. Actualiza el detalle y solicita el documento nuevamente.",
    "Print job already claimed; dispatch outcome may be unknown": "Otra terminal tomó este documento. Revisa la impresora antes de solicitar otra copia.",
    "Print job cannot be dispatched again": "Este documento no se reenviará. Revisa la impresora antes de solicitar otra copia.",
    "Printing queue unavailable; retry": "No se pudo preparar la impresión. Reintenta sin registrar otro pedido.",
  };
  if (messages[error.message]) return messages[error.message];
  if (error.status === 403) return "No tienes permiso para imprimir este pedido en la sucursal seleccionada.";
  if (error.status === 404 && error.code !== "API_CONTRACT_UNSUPPORTED") return "No encontramos el pedido o la comanda. Actualiza el listado e inténtalo nuevamente.";
  return error.message;
}

// Lifetime is one authenticated tenant scope. Claims stay in memory, never storage.
export class OrderPrinting {
  private terminal = crypto.randomUUID();
  private active = new Map<number, Promise<void>>();
  private seen = new Set<string>();
  private folios = new Map<number, number | null>();
  private acknowledgements = new Map<string, PendingAck>();
  private manualIntents = new Map<number, { body: string; key: string; jobId?: string }>();
  private discovery: Promise<void> | null = null;
  private discoveryAgain = false;
  private discoveryFailed = false;
  private awaitingConfirmation = new Map<number, string | undefined>();
  private reconciliationEpoch = new Map<number, number>();
  private reconciliations = new Map<number, { epoch: number; task: Promise<void> }>();
  private retryPolicy?: PrintRetryPolicy;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private noticeJobs = new Map<number, string[]>();
  private explicitPublishing = new Set<number>();
  private policyFailed = false;
  private retryWakeups = new Set<string>();

  constructor(private branchId: number, private signal: AbortSignal, private notify: (notice: PrintNotice) => void, private businessId?: number) {
    if (businessId != null) {
      try { this.retryPolicy = new PrintRetryPolicy(businessId, branchId); }
      catch { this.policyFailure(); }
    }
    signal.addEventListener("abort", () => {
      this.awaitingConfirmation.clear();
      this.reconciliationEpoch.clear();
      clearTimeout(this.retryTimer);
    }, { once: true });
    this.scheduleRetries();
  }

  dismiss(notice: PrintNotice) {
    if (notice.jobIds?.length) void this.retryPolicy?.dismiss(notice.jobIds, this.signal).catch(() => this.policyFailure());
  }

  private policyFailure() {
    if (!this.policyFailed && !this.signal.aborted) {
      this.policyFailed = true;
      this.publish(0, "No se pudo guardar el control de impresión automática. Puedes reimprimir manualmente desde el pedido.", false, false, true);
    }
  }

  private clearAutomaticSeen(orderId: number) {
    for (const key of this.seen) if (key.startsWith(`${orderId}:`)) this.seen.delete(key);
  }

  private scheduleRetries() {
    clearTimeout(this.retryTimer);
    if (!this.retryPolicy || this.signal.aborted || this.policyFailed) return;
    try {
      const pending = this.retryPolicy.retries().filter(retry => !this.retryWakeups.has(`${retry.jobId}:${retry.at}`));
      if (!pending.length) return;
      const at = Math.min(...pending.map(retry => retry.at));
      this.retryTimer = setTimeout(() => {
        const due = pending.filter(retry => retry.at <= Date.now());
        due.forEach(retry => this.retryWakeups.add(`${retry.jobId}:${retry.at}`));
        const ready = [...new Set(due.map(retry => retry.orderId))];
        void (async () => {
          for (const orderId of ready) {
            if (this.signal.aborted) return;
            this.clearAutomaticSeen(orderId);
            await this.run(orderId);
          }
          this.scheduleRetries();
        })();
      }, Math.max(0, at - Date.now()));
    } catch { this.policyFailure(); }
  }

  discover(): Promise<void> {
    if (this.signal.aborted) return Promise.resolve();
    if (this.discovery) { this.discoveryAgain = true; return this.discovery; }
    this.discovery = this.discoverPages().finally(() => {
      this.discovery = null;
      if (this.discoveryAgain && !this.signal.aborted) { this.discoveryAgain = false; void this.discover(); }
    });
    return this.discovery;
  }

  private async discoverPages() {
    try {
      if (this.retryPolicy && !this.policyFailed) {
        const ready = [...new Set(this.retryPolicy.retries().filter(retry => retry.at <= Date.now()).map(retry => retry.orderId))];
        for (const orderId of ready) { this.clearAutomaticSeen(orderId); await this.run(orderId); }
      }
      // A completed claim disappears from the pending queue without changing
      // the order version. Refresh only claims this scope already observed.
      for (const orderId of [...this.awaitingConfirmation.keys()]) {
        await this.active.get(orderId);
        await this.reconcileConfirmation(orderId);
      }
      let cursor = 0;
      do {
        this.signal.throwIfAborted();
        const page = await api<{ branch_id: number; items: { order_id: number; version: number }[]; next_after_order_id: number | null }>(
          `/orders/printing/pending?branch_id=${this.branchId}&after_order_id=${cursor}`, { signal: this.signal });
        this.signal.throwIfAborted();
        if (page.branch_id !== this.branchId || !Array.isArray(page.items) || page.items.length > 100
          || page.items.some((row, i) => !Number.isInteger(row.order_id) || row.order_id <= (i ? page.items[i - 1].order_id : cursor)
            || !Number.isInteger(row.version) || row.version < 1)
          || (page.next_after_order_id !== null && (!page.items.length || page.next_after_order_id !== page.items.at(-1)?.order_id))) {
          throw new Error("La API devolvió una cola de impresión incompatible.");
        }
        for (const row of page.items) {
          this.signal.throwIfAborted();
          // The server found pending work, including a newly added document.
          // It may share the last observed order version; jobs remain the
          // dispatch authority, not the notification/version deduplication.
          this.seen.delete(`${row.order_id}:${row.version}`);
          await this.run(row.order_id, false, row.version);
        }
        if (page.next_after_order_id === null) break;
        cursor = page.next_after_order_id;
      } while (!this.signal.aborted);
      if (this.discoveryFailed && !this.signal.aborted) this.publish(0, "Se recuperó la consulta de impresión automática.");
      this.discoveryFailed = false;
    } catch {
      if (!this.signal.aborted) {
        this.discoveryFailed = true;
        this.publish(0, "No se pudo consultar la impresión automática. Reintenta para comprobar los pedidos recibidos.", false, true, true);
      }
    }
  }

  manual(request: ManualPrintRequest): Promise<void> {
    if (this.signal.aborted || request.branchId !== this.branchId) return Promise.resolve();
    const active = this.active.get(request.orderId);
    if (active) return active.then(() => this.manual(request));
    const body = JSON.stringify({ job_type: request.ticketId ? "kitchen_ticket" : "customer_receipt", kitchen_ticket_id: request.ticketId, expected_order_version: request.orderVersion, expected_ticket_version: request.ticketVersion });
    const previous = this.manualIntents.get(request.orderId);
    if (previous && previous.body !== body) {
      this.publish(request.orderId, "Hay una impresión pendiente para este pedido. Resuélvela antes de solicitar otro documento.", false, true, true);
      return Promise.resolve();
    }
    this.manualIntents.set(request.orderId, previous || { body, key: crypto.randomUUID() });
    return this.run(request.orderId, true);
  }

  run(orderId: number, explicit = false, version?: number): Promise<void> {
    if (this.signal.aborted) return Promise.resolve();
    const confirmation = `${orderId}:${version ?? "initial"}`;
    const active = this.active.get(orderId);
    if (active) {
      if (!explicit && version != null && !this.seen.has(confirmation)) return active.then(() => this.run(orderId, false, version));
      return active;
    }
    if (!explicit && this.seen.has(confirmation)) return Promise.resolve();
    this.seen.add(confirmation);
    this.reconciliationEpoch.set(orderId, (this.reconciliationEpoch.get(orderId) || 0) + 1);
    const task = this.process(orderId, explicit).finally(() => { this.active.delete(orderId); this.scheduleRetries(); });
    this.active.set(orderId, task);
    return task;
  }

  private publish(orderId: number, message: string, busy = false, retryable = false, warning = false) {
    const jobIds = this.noticeJobs.get(orderId);
    if (!this.explicitPublishing.has(orderId) && jobIds?.length && this.retryPolicy) {
      try { if (this.retryPolicy.isDismissed(jobIds)) return; }
      catch { this.policyFailure(); return; }
    }
    if (!this.signal.aborted) this.notify({ orderId, folio: this.folios.get(orderId), message, busy, retryable, warning,
      ...(jobIds?.length ? { jobIds } : {}) });
  }

  private async readJobs(orderId: number) {
    const response = await api<PrintingResponse>(`/orders/${orderId}/printing`, { signal: this.signal });
    this.signal.throwIfAborted();
    if (response.order_id !== orderId || !Array.isArray(response.items) || response.items.some((job) => job.branch_id !== this.branchId || job.order_id !== orderId
      || (this.businessId != null && job.payload.order.business_id !== this.businessId))) {
      throw new Error("La API devolvió una impresión de otra sucursal o un contrato incompatible.");
    }
    if (response.items.length) this.folios.set(orderId, response.items[0].payload.order.folio ?? null);
    if (this.retryPolicy && !this.policyFailed) {
      try { for (const job of response.items) await this.retryPolicy.observe(job, this.signal); }
      catch { if (!this.signal.aborted) this.policyFailure(); }
    }
    return response;
  }

  private hasPendingAck(orderId: number) {
    return [...this.acknowledgements.values()].some((ack) => ack.path.startsWith(`/orders/${orderId}/`));
  }

  private waitForConfirmation(milliseconds: number): Promise<boolean> {
    if (this.signal.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const finish = (active: boolean) => {
        clearTimeout(timer);
        this.signal.removeEventListener("abort", abort);
        resolve(active);
      };
      const abort = () => finish(false);
      const timer = setTimeout(() => finish(true), milliseconds);
      this.signal.addEventListener("abort", abort, { once: true });
    });
  }

  private publishConfirmation(orderId: number, response: PrintingResponse, manualJobId?: string) {
    if (manualJobId) response = { ...response, items: response.items.filter((job) => job.id === manualJobId) };
    if (!response.items.length) throw new Error("No se pudo comprobar el documento tomado por una terminal.");
    const claimed = response.items.some((job) => job.status === "claimed");
    const pending = response.items.some((job) => job.status === "pending" || job.status === "failed" && job.retryable);
    const unknown = response.items.some((job) => job.status === "failed" && !job.retryable);
    if (claimed) this.awaitingConfirmation.set(orderId, manualJobId);
    else this.awaitingConfirmation.delete(orderId);
    if (this.hasPendingAck(orderId)) this.publish(orderId, "Falta confirmar el resultado con la API. Reintenta para sincronizarlo; no se volverá a enviar el documento.", false, true, true);
    else if (unknown) this.publish(orderId, "Revisa la impresora: hay un envío cuyo resultado no se pudo confirmar. No se repetirá automáticamente.", false, pending, true);
    else if (claimed) this.publish(orderId, "Documento tomado por una terminal; resultado pendiente de confirmación. No se enviará otra copia automáticamente.");
    else if (pending || response.recoverable_error) this.publish(orderId, "Impresión pendiente. Revisa la impresora y el estado del documento antes de reintentar.", false, true, true);
    else if (manualJobId && response.items.some((job) => job.status === "cancelled")) this.publish(orderId, "El documento quedó desactualizado y no se imprimió. Actualiza el detalle y solicita la impresión nuevamente.", false, false, true);
    else this.publish(orderId, "No quedan trabajos automáticos pendientes.");
  }

  private reconcileConfirmation(orderId: number, boundedWait = false): Promise<void> {
    if (this.signal.aborted || !this.awaitingConfirmation.has(orderId)) return Promise.resolve();
    const epoch = this.reconciliationEpoch.get(orderId) || 0;
    const active = this.reconciliations.get(orderId);
    if (active?.epoch === epoch) return active.task;
    const manualJobId = this.awaitingConfirmation.get(orderId);
    const current = () => !this.signal.aborted && (this.reconciliationEpoch.get(orderId) || 0) === epoch;
    // Status reads never grant a claim, call QZ, create a copy or retry an ACK.
    // If the owner finishes later, focus/reconnect/discovery can read again.
    const task = (async () => {
      for (const delay of boundedWait ? [100, 400, 1000] : [0]) {
        if (delay && !await this.waitForConfirmation(delay)) return;
        if (!current() || !this.awaitingConfirmation.has(orderId)) return;
        try {
          const response = await this.readJobs(orderId);
          if (!current()) return;
          this.publishConfirmation(orderId, response, manualJobId);
        } catch (error) {
          if (!current()) return;
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) this.awaitingConfirmation.delete(orderId);
          if (this.hasPendingAck(orderId)) this.publish(orderId, "Falta confirmar el resultado con la API. Reintenta para sincronizarlo; no se volverá a enviar el documento.", false, true, true);
          else this.publish(orderId, "No se pudo actualizar el estado de impresión. El resultado sigue pendiente de confirmación; no se enviará otra copia automáticamente.", false, false, true);
          return;
        }
      }
    })().finally(() => {
      if (this.reconciliations.get(orderId)?.epoch === epoch) this.reconciliations.delete(orderId);
    });
    this.reconciliations.set(orderId, { epoch, task });
    return task;
  }

  private async acknowledge(jobId: string, ack: PendingAck) {
    this.acknowledgements.set(jobId, ack);
    await api(ack.path, { method: "POST", body: JSON.stringify(ack.body), idempotencyKey: ack.key, signal: this.signal });
    this.acknowledgements.delete(jobId);
  }

  private async dispatch(job: PosPrintJob, explicit: boolean): Promise<DispatchResult> {
    const claimToken = crypto.randomUUID();
    let claimed = false;
    let claimRequested = false;
    let sending = false;
    let outcome: Completion["outcome"] = "not_sent";
    let sendError: unknown;
    try {
      const payload = job.payload;
      if (payload.snapshot_version !== 1) throw new Error("Actualiza el POS: el formato de impresión no es compatible.");
      await qzBridge.dispatch({
        branchId: this.branchId, orderId: job.order_id, printerName: payload.printer_name,
        paperWidth: payload.paper_width_mm, copies: payload.copies,
        printLanguage: payload.print_language,
        html: renderThermalDocument({ order: payload.order, ticket: payload.ticket ?? undefined, businessName: payload.business.name, branchName: payload.branch.name, branchAddress: payload.branch.address, paperWidth: payload.paper_width_mm, template: payload.template }),
        jobName: `${job.job_type === "customer_receipt" ? "Ticket" : "Comanda"} - ${payload.order.number}`,
        signal: this.signal,
        beforeSend: async () => {
          claimRequested = true;
          const result = await api<{ dispatch_allowed: boolean }>(`/orders/${job.order_id}/printing/${job.id}/claim`, {
            method: "POST", signal: this.signal, idempotencyKey: `print-claim-${claimToken}`,
            body: JSON.stringify({ terminal_id: this.terminal, claim_token: claimToken, retry_not_sent: explicit && job.retryable }),
          });
          if (!result.dispatch_allowed) throw new Error("Este documento ya fue tomado por una terminal. Revisa la impresora antes de volver a imprimir.");
          claimed = true;
        },
        onSending: () => { sending = true; },
      });
      outcome = "printed";
    } catch (error) {
      sendError = error;
      outcome = sending ? "unknown" : "not_sent";
    }
    if (claimed) {
      try {
        await this.acknowledge(job.id, {
          path: `/orders/${job.order_id}/printing/${job.id}/complete`, key: `print-complete-${claimToken}`,
          body: { terminal_id: this.terminal, claim_token: claimToken, outcome },
        });
      } catch (error) { return { outcome: "unknown", error }; }
    }
    return { outcome: outcome === "not_sent" && claimRequested && !claimed ? "unknown" : outcome, error: sendError };
  }

  private async process(orderId: number, explicit: boolean) {
    if (!explicit && this.policyFailed) return;
    if (explicit) this.explicitPublishing.add(orderId);
    try {
      const attempted = new Set<string>();
      const manual = this.manualIntents.get(orderId);
      if (manual && !manual.jobId) {
        this.publish(orderId, "Preparando el documento solicitado...", true);
        const job = await api<PosPrintJob>(`/orders/${orderId}/printing`, { method: "POST", body: manual.body, idempotencyKey: manual.key, signal: this.signal });
        this.signal.throwIfAborted();
        if (job.order_id !== orderId || job.branch_id !== this.branchId || !job.id) throw new Error("La API devolvió un trabajo incompatible.");
        manual.jobId = job.id;
        try { this.retryPolicy?.markManual(job.id, orderId); } catch { this.policyFailure(); }
      }
      // Retry only the acknowledgement, never a document already submitted to QZ.
      for (const [jobId, ack] of this.acknowledgements) {
        if (ack.path.startsWith(`/orders/${orderId}/`)) {
          attempted.add(jobId);
          await this.acknowledge(jobId, ack);
        }
      }
      let response = await this.readJobs(orderId);
      if (!response.items.length) {
        if (manual) throw new Error("No se pudo verificar el documento solicitado. Reintenta para consultar su estado.");
        if (response.recoverable_error) throw new Error("No se pudo preparar la impresión. Reintenta sin registrar otro pedido.");
        if (explicit) this.publish(orderId, "No hay trabajos automáticos pendientes. Revisa que Impresión avanzada y ambos documentos estén activados para los próximos pedidos.");
        return;
      }
      let eligibleJobs: PosPrintJob[];
      try {
        eligibleJobs = response.items.filter(job => manual ? job.id === manual.jobId && (job.status === "pending" || job.status === "failed" && job.retryable)
          : explicit ? job.status === "pending" || job.status === "failed" && job.retryable
            : !this.retryPolicy ? job.status === "pending"
              : !this.policyFailed && this.retryPolicy.canAttempt(job));
      } catch { this.policyFailure(); return; }
      if (this.retryPolicy && !explicit && !eligibleJobs.length && !this.hasPendingAck(orderId)
        && !response.items.some(job => job.status === "claimed")) return;
      this.noticeJobs.set(orderId, (manual ? response.items.filter(job => job.id === manual.jobId)
        : eligibleJobs.length ? eligibleJobs : response.items).map(job => job.id));
      const observedClaims = new Set(response.items.filter(job => job.status === "claimed").map(job => job.id));
      let announced = false;
      const announce = () => {
        if (!announced) this.publish(orderId, "Enviando los documentos pendientes a la impresora...", true);
        announced = true;
      };
      if (!this.retryPolicy || explicit) announce();
      let failure = "";
      // API IDs are not a document order: always finish the receipt (and cut)
      // before sending kitchen documents, preserving their relative sequence.
      const ordered = [...response.items].sort((a, b) => Number(a.job_type === "kitchen_ticket") - Number(b.job_type === "kitchen_ticket"));
      for (const job of ordered) {
        this.signal.throwIfAborted();
        if (!eligibleJobs.some(eligible => eligible.id === job.id)) continue;
        try {
          if (!explicit && this.retryPolicy) {
            const outcome = await this.retryPolicy.attempt(job, this.signal, retry => { announce(); return this.dispatch(job, retry); });
            if (!outcome.attempted) continue;
            attempted.add(job.id);
            if (outcome.result.error) failure = printingError(outcome.result.error);
          } else {
            attempted.add(job.id);
            const outcome = await this.dispatch(job, explicit);
            if (outcome.error) failure = printingError(outcome.error);
          }
        }
        catch (error) {
          if (error instanceof PrintPolicyError) { this.policyFailure(); return; }
          failure = printingError(error);
        }
      }
      this.signal.throwIfAborted();
      response = await this.readJobs(orderId);
      if (this.retryPolicy && !explicit) {
        response.items = response.items.filter(job => attempted.has(job.id) || observedClaims.has(job.id));
        if (!response.items.length) return;
      }
      if (manual) {
        response.items = response.items.filter((job) => job.id === manual.jobId);
        if (!response.items.length) throw new Error("No se pudo verificar el documento solicitado. Reintenta para consultar su estado.");
      }
      const pendingAck = this.hasPendingAck(orderId);
      const pending = response.items.some((job) => job.status === "pending" || job.status === "failed" && job.retryable);
      const claimed = response.items.some((job) => job.status === "claimed");
      const uncertain = response.items.some((job) => job.status === "failed" && !job.retryable);
      if (claimed) this.awaitingConfirmation.set(orderId, manual?.jobId);
      else this.awaitingConfirmation.delete(orderId);
      const sent = response.items.filter((job) => job.status === "printed" && attempted.has(job.id));
      const printed = sent.length;
      const cancelled = response.items.some((job) => job.status === "cancelled");
      if (manual && !pendingAck && !pending) this.manualIntents.delete(orderId);
      if (pendingAck) this.publish(orderId, "Falta confirmar el resultado con la API. Reintenta para sincronizarlo; no se volverá a enviar el documento.", false, true, true);
      else if (uncertain) this.publish(orderId, `${printed ? `${printed} documento enviado. ` : ""}Revisa la impresora: hay un envío cuyo resultado no se pudo confirmar. No se repetirá automáticamente.`, false, pending, true);
      else if (claimed) this.publish(orderId, "Documento tomado por una terminal; resultado pendiente de confirmación. No se enviará otra copia automáticamente.");
      else if (pending || response.recoverable_error) this.publish(orderId, `${printed ? `${printed} documento enviado. ` : ""}Impresión pendiente. ${failure || "Abre QZ Tray y reintenta."}`, false, true, true);
      else if (manual && cancelled) this.publish(orderId, failure || "El documento quedó desactualizado y no se imprimió. Actualiza el detalle y solicita la impresión nuevamente.", false, false, true);
      else {
        const kinds = new Set(sent.map((job) => job.job_type));
        const label = kinds.size === 2 ? "Ticket y comanda enviados"
          : kinds.has("kitchen_ticket") ? (printed === 1 ? "Comanda enviada" : "Comandas enviadas")
            : printed === 1 ? "Ticket enviado" : "Tickets enviados";
        this.publish(orderId, printed ? `${label} a la impresora. El pedido está confirmado.` : "No quedan trabajos automáticos pendientes.");
      }
      if (claimed && !pendingAck) await this.reconcileConfirmation(orderId, true);
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && !this.manualIntents.get(orderId)?.jobId) {
        this.manualIntents.delete(orderId);
        this.publish(orderId, printingError(error), false, false, true);
        return;
      }
      this.publish(orderId, `El pedido sigue registrado. ${printingError(error)}`, false, true, true);
    } finally { this.explicitPublishing.delete(orderId); }
  }
}
