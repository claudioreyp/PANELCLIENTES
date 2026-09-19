import { api, ApiError } from "./api";
import { qzBridge } from "./qz-tray";
import { renderThermalDocument, type ThermalPrintTemplate } from "./thermal-print";
import type { KitchenTicket, OrderDetail } from "../types";
import type { ManualPrintRequest } from "./print-events";

export type PosPrintJob = {
  id: string; order_id: number; branch_id: number;
  job_type: "customer_receipt" | "kitchen_ticket";
  status: "pending" | "claimed" | "printed" | "failed" | "cancelled";
  retryable: boolean;
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
export type PrintNotice = { orderId: number; folio?: number | null; busy: boolean; message: string; retryable: boolean; warning: boolean };

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

  constructor(private branchId: number, private signal: AbortSignal, private notify: (notice: PrintNotice) => void) {}

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
    const task = this.process(orderId, explicit).finally(() => this.active.delete(orderId));
    this.active.set(orderId, task);
    return task;
  }

  private publish(orderId: number, message: string, busy = false, retryable = false, warning = false) {
    if (!this.signal.aborted) this.notify({ orderId, folio: this.folios.get(orderId), message, busy, retryable, warning });
  }

  private async readJobs(orderId: number) {
    const response = await api<PrintingResponse>(`/orders/${orderId}/printing`, { signal: this.signal });
    this.signal.throwIfAborted();
    if (response.order_id !== orderId || !Array.isArray(response.items) || response.items.some((job) => job.branch_id !== this.branchId || job.order_id !== orderId)) {
      throw new Error("La API devolvió una impresión de otra sucursal o un contrato incompatible.");
    }
    if (response.items.length) this.folios.set(orderId, response.items[0].payload.order.folio ?? null);
    return response;
  }

  private async acknowledge(jobId: string, ack: PendingAck) {
    this.acknowledgements.set(jobId, ack);
    await api(ack.path, { method: "POST", body: JSON.stringify(ack.body), idempotencyKey: ack.key, signal: this.signal });
    this.acknowledgements.delete(jobId);
  }

  private async dispatch(job: PosPrintJob, explicit: boolean) {
    const claimToken = crypto.randomUUID();
    let claimed = false;
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
      await this.acknowledge(job.id, {
        path: `/orders/${job.order_id}/printing/${job.id}/complete`, key: `print-complete-${claimToken}`,
        body: { terminal_id: this.terminal, claim_token: claimToken, outcome },
      });
    }
    if (sendError) throw sendError;
  }

  private async process(orderId: number, explicit: boolean) {
    try {
      const attempted = new Set<string>();
      const manual = this.manualIntents.get(orderId);
      if (manual && !manual.jobId) {
        this.publish(orderId, "Preparando el documento solicitado...", true);
        const job = await api<PosPrintJob>(`/orders/${orderId}/printing`, { method: "POST", body: manual.body, idempotencyKey: manual.key, signal: this.signal });
        this.signal.throwIfAborted();
        if (job.order_id !== orderId || job.branch_id !== this.branchId || !job.id) throw new Error("La API devolvió un trabajo incompatible.");
        manual.jobId = job.id;
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
      this.publish(orderId, "Enviando los documentos pendientes a la impresora...", true);
      let failure = "";
      // API IDs are not a document order: always finish the receipt (and cut)
      // before sending kitchen documents, preserving their relative sequence.
      const ordered = [...response.items].sort((a, b) => Number(a.job_type === "kitchen_ticket") - Number(b.job_type === "kitchen_ticket"));
      for (const job of ordered) {
        this.signal.throwIfAborted();
        if (manual && job.id !== manual.jobId) continue;
        if (job.status !== "pending" && !(explicit && job.status === "failed" && job.retryable)) continue;
        attempted.add(job.id);
        try { await this.dispatch(job, explicit); }
        catch (error) { failure = printingError(error); }
      }
      this.signal.throwIfAborted();
      response = await this.readJobs(orderId);
      if (manual) {
        response.items = response.items.filter((job) => job.id === manual.jobId);
        if (!response.items.length) throw new Error("No se pudo verificar el documento solicitado. Reintenta para consultar su estado.");
      }
      const pendingAck = [...this.acknowledgements.values()].some((ack) => ack.path.startsWith(`/orders/${orderId}/`));
      const pending = response.items.some((job) => job.status === "pending" || job.status === "failed" && job.retryable);
      const uncertain = response.items.some((job) => job.status === "claimed" || job.status === "failed" && !job.retryable);
      const sent = response.items.filter((job) => job.status === "printed" && attempted.has(job.id));
      const printed = sent.length;
      const cancelled = response.items.some((job) => job.status === "cancelled");
      if (manual && !pendingAck && !pending) this.manualIntents.delete(orderId);
      if (pendingAck) this.publish(orderId, "Falta confirmar el resultado con la API. Reintenta para sincronizarlo; no se volverá a enviar el documento.", false, true, true);
      else if (uncertain) this.publish(orderId, `${printed ? `${printed} documento enviado. ` : ""}Revisa la impresora: hay un envío cuyo resultado no se pudo confirmar. No se repetirá automáticamente.`, false, pending, true);
      else if (pending || response.recoverable_error) this.publish(orderId, `${printed ? `${printed} documento enviado. ` : ""}Impresión pendiente. ${failure || "Abre QZ Tray y reintenta."}`, false, true, true);
      else if (manual && cancelled) this.publish(orderId, failure || "El documento quedó desactualizado y no se imprimió. Actualiza el detalle y solicita la impresión nuevamente.", false, false, true);
      else {
        const kinds = new Set(sent.map((job) => job.job_type));
        const label = kinds.size === 2 ? "Ticket y comanda enviados"
          : kinds.has("kitchen_ticket") ? (printed === 1 ? "Comanda enviada" : "Comandas enviadas")
            : printed === 1 ? "Ticket enviado" : "Tickets enviados";
        this.publish(orderId, printed ? `${label} a la impresora. El pedido está confirmado.` : "No quedan trabajos automáticos pendientes.");
      }
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && !this.manualIntents.get(orderId)?.jobId) {
        this.manualIntents.delete(orderId);
        this.publish(orderId, printingError(error), false, false, true);
        return;
      }
      this.publish(orderId, `El pedido sigue registrado. ${printingError(error)}`, false, true, true);
    }
  }
}
