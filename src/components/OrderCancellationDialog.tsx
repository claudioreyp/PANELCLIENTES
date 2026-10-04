import { CircleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { checkoutPaymentMethods, paymentMethodLabel, type CheckoutPaymentMethod } from "../lib/order-checkout";
import type { Order, OrderDetail, OrderFinancialSummary, OrderRefund } from "../types";
import { ErrorState, LoadingState, Modal, Money } from "./ui";
import "./order-cancellation.css";

type Register = { id: number; name: string; version: number; session_id: number | null; session_version: number };
export type CancellationPreview = {
  order_id: number; branch_id: number; order_version: number; can_cancel: boolean;
  can_refund: boolean; reason: string | null; refundable_amount: number;
  financial_summary: OrderFinancialSummary; refund_methods: CheckoutPaymentMethod[]; registers: Register[];
};
type CancellationResult = { order: Order; refunds: OrderRefund[]; financial_summary: OrderFinancialSummary };
type FrozenIntent = { path: string; body: string; key: string };
type Props = { order: OrderDetail; onClose: () => void; onSaved: (order: OrderDetail) => void; onLocked: (locked: boolean) => void };

function moneyCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, decimals = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function OrderCancellationDialog({ order, onClose, onSaved, onLocked }: Props) {
  const [preview, setPreview] = useState<CancellationPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [reason, setReason] = useState("");
  const [registerId, setRegisterId] = useState<number | null>(null);
  const [method, setMethod] = useState<CheckoutPaymentMethod | "multiple" | "">("");
  const [splits, setSplits] = useState<Partial<Record<CheckoutPaymentMethod, string>>>({});
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const intent = useRef<FrozenIntent | null>(null);
  const sending = useRef(false);
  const mounted = useRef(true);
  const errorId = useId();
  const locked = busy || uncertain;
  const refundable = Number(preview?.refundable_amount ?? 0);
  const methods = (preview?.refund_methods ?? []).filter((candidate) => checkoutPaymentMethods.includes(candidate));
  const register = preview?.registers.find((candidate) => candidate.id === registerId);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onLocked(locked); }, [locked, onLocked]);
  useEffect(() => {
    if (!locked) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [locked]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setPreviewError(null);
    api<CancellationPreview>(`/orders/${order.id}/cancellation-preview`).then((next) => {
      if (!active) return;
      if (next.order_id !== order.id || next.branch_id !== order.branch_id) throw new Error("La consulta no corresponde al pedido y sucursal seleccionados.");
      setPreview(next);
      setRegisterId((current) => next.registers.some((candidate) => candidate.id === current) ? current : current == null && reload === 0 && next.registers.length === 1 ? next.registers[0].id : null);
    }).catch((caught) => { if (active) { setPreview(null); setPreviewError(caught instanceof Error ? caught.message : "No se pudo consultar la cancelación."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [order.id, order.branch_id, reload]);

  function close() {
    if (sending.current || locked) return;
    if ((reason.trim() || method || attested) && !window.confirm("¿Descartar los datos de cancelación y volver al pedido?")) return;
    onClose();
  }

  async function submit() {
    if (sending.current || !preview) return;
    if (!intent.current) {
      if (!preview.can_cancel) return;
      if (!reason.trim()) { setError("Explica el motivo de la cancelación."); formRef.current?.querySelector("textarea")?.focus(); return; }
      const refunds: { method: CheckoutPaymentMethod; amount: number }[] = [];
      if (refundable > 0) {
        if (!preview.can_refund) { setError("No tienes permiso para registrar esta devolución."); return; }
        if (!register) { setError("Selecciona la caja donde registrarás la devolución."); formRef.current?.querySelector("select")?.focus(); return; }
        if (!method) { setError("Selecciona el método de devolución."); formRef.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus(); return; }
        if (method === "multiple") {
          for (const candidate of methods) {
            const value = splits[candidate]?.trim() ?? "";
            if (!value) continue;
            const cents = moneyCents(value);
            if (cents == null) { setError("Ingresa importes válidos con hasta dos decimales."); return; }
            if (cents > 0) refunds.push({ method: candidate, amount: cents / 100 });
          }
          if (refunds.length < 2 || refunds.reduce((sum, refund) => sum + Math.round(refund.amount * 100), 0) !== Math.round(refundable * 100)) {
            setError("Distribuye exactamente el importe a devolver entre al menos dos métodos."); return;
          }
        } else refunds.push({ method, amount: refundable });
        if (!attested) { setError("Confirma que realizaste la devolución antes de registrarla."); formRef.current?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus(); return; }
      }
      intent.current = {
        path: `/orders/${order.id}/cancel`, key: crypto.randomUUID(),
        body: JSON.stringify({ reason: reason.trim(), expected_version: preview.order_version, refunds, refund_confirmed: refundable > 0 && attested,
          ...(refundable > 0 && register ? { register_id: register.id, expected_session_id: register.session_id, expected_cash_version: register.session_version } : {}),
        }),
      };
    }
    const request = intent.current;
    sending.current = true;
    setBusy(true);
    onLocked(true);
    setError(null);
    try {
      const result = await api<CancellationResult>(request.path, { method: "POST", body: request.body, idempotencyKey: request.key });
      if (!mounted.current) return;
      if (result.order.id !== order.id || result.order.branch_id !== order.branch_id || result.order.status !== "cancelled") throw new Error("No se pudo verificar el resultado de la cancelación. Reintenta la misma operación.");
      intent.current = null;
      setUncertain(false);
      onLocked(false);
      onSaved({ ...order, ...result.order, cancellation_reason: JSON.parse(request.body).reason, refunds: result.refunds, financial_summary: result.financial_summary,
        kitchen_tickets: order.kitchen_tickets.map((ticket) => ["queued", "preparing"].includes(ticket.status) ? { ...ticket, status: "cancelled" as const } : ticket),
      });
    } catch (caught) {
      if (!mounted.current) return;
      const definitive = caught instanceof ApiError && caught.status >= 400 && caught.status < 500 && caught.status !== 408;
      if (definitive) {
        intent.current = null;
        setUncertain(false);
        onLocked(false);
        if (caught.status === 409 || caught.code === "ORDER_REFUND_AMOUNT_MISMATCH") { setAttested(false); setReload((current) => current + 1); }
      } else { setUncertain(true); onLocked(true); }
      setError(caught instanceof Error ? caught.message : "No se pudo cancelar el pedido.");
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <Modal title="Cancelar pedido" className="order-cancel-modal" onClose={close}>
    {loading ? <LoadingState label="Consultando pedido y cajas..." /> : previewError ? <ErrorState message={previewError} onRetry={() => setReload((current) => current + 1)} /> : preview && <form ref={formRef} className="form-stack" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p>El pedido {order.folio != null ? `#${order.folio}` : "sin folio"} será cancelado y no podrás deshacer esta acción.</p>
      {!preview.can_cancel && <p role="alert">{preview.reason || "Este pedido no admite cancelación."}</p>}
      <label>Motivo de cancelación<textarea value={reason} maxLength={1000} required disabled={locked || !preview.can_cancel} aria-describedby={error ? errorId : undefined} onChange={(event) => setReason(event.target.value)} /></label>
      {refundable > 0 && <>
        <div className="order-refund-warning"><CircleAlert aria-hidden="true" /><div><strong>Reembolso pendiente de <Money value={refundable} />{register ? ` en caja ${register.name}` : ""}</strong><p>Devuelve al cliente exactamente lo cobrado en este pedido y selecciona cómo lo devolviste.</p></div></div>
        {!preview.can_refund && preview.can_cancel && <p role="alert">Se necesita un cajero o encargado con permiso de caja para cancelar este pedido y registrar la devolución.</p>}
        <fieldset disabled={locked || !preview.can_refund || !preview.can_cancel}>
          <label>Caja para la devolución<select required value={registerId ?? ""} onChange={(event) => setRegisterId(Number(event.target.value) || null)}><option value="">Selecciona una caja</option>{preview.registers.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>
          {!preview.registers.length && <p>No hay cajas activas en esta sucursal. Habilita una caja antes de registrar la devolución.</p>}
        </fieldset>
        <fieldset disabled={locked || !preview.can_refund || !preview.can_cancel}><legend>Método de pago del reembolso</legend><div className="order-refund-options">
          {methods.map((candidate) => <label key={candidate}><input type="radio" name="refund-method" value={candidate} checked={method === candidate} onChange={() => setMethod(candidate)} required />{paymentMethodLabel(candidate)}</label>)}
          {methods.length > 1 && <label><input type="radio" name="refund-method" value="multiple" checked={method === "multiple"} onChange={() => setMethod("multiple")} />Múltiples métodos de pago</label>}
        </div></fieldset>
        {method === "multiple" && <fieldset className="order-refund-split" disabled={locked || !preview.can_refund || !preview.can_cancel}><legend>Distribución de la devolución</legend>{methods.map((candidate) => <label key={candidate}>{paymentMethodLabel(candidate)}<input aria-label={`Devolución en ${paymentMethodLabel(candidate)}`} type="number" min="0" step="0.01" value={splits[candidate] ?? ""} onChange={(event) => setSplits((current) => ({ ...current, [candidate]: event.target.value }))} /></label>)}<small>Total a devolver: <Money value={refundable} /></small></fieldset>}
        <label className="order-refund-attestation"><input type="checkbox" checked={attested} disabled={locked || !preview.can_refund || !preview.can_cancel} onChange={(event) => setAttested(event.target.checked)} />Confirmo que realicé la devolución al cliente por el importe y los métodos indicados.</label>
      </>}
      {error && <p id={errorId} className="order-cancel-error" role="alert">{error}</p>}
      {uncertain && <p className="order-cancel-recovery">La respuesta no quedó confirmada. Reintenta esta misma operación para recuperar su resultado antes de salir. Los datos se conservaron.</p>}
      <div className="modal-form-actions"><button className="button button-secondary" type="button" disabled={locked} onClick={close}>Volver al pedido</button><button className="button button-danger" type="submit" disabled={busy || (!uncertain && (!preview.can_cancel || !reason.trim() || (refundable > 0 && !preview.can_refund)))}>{busy ? "Cancelando..." : uncertain ? "Reintentar cancelación" : "Confirmar cancelación"}</button></div>
    </form>}
  </Modal>;
}
