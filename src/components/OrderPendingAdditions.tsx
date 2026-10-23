import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useTenant } from "../lib/tenant";
import type { OrderDetail, OrderPaymentRequest } from "../types";
import { Money } from "./ui";

const pendingStatuses = ["pending", "under_review", "awaiting_base_review", "requires_review"];

function DeclineAddition({ order, request, working, onSaved }: { order: OrderDetail; request: OrderPaymentRequest; working: boolean; onSaved: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intent = useRef<{ key: string; body: string } | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function decline() {
    if (locked.current || working || done || (!intent.current && !note.trim())) return;
    locked.current = true; setBusy(true); setError(null);
    intent.current ??= { key: crypto.randomUUID(), body: JSON.stringify({ expected_version: order.version, action: "decline", note: note.trim() }) };
    try {
      await api(`/orders/${order.id}/addition-requests/${encodeURIComponent(request.id)}/resolve`, { method: "POST", idempotencyKey: intent.current.key, body: intent.current.body });
      if (!mounted.current) return;
      intent.current = null; setPending(false); setDone(true); await onSaved();
    } catch (caught) {
      if (!mounted.current) return;
      const definitive = caught instanceof ApiError && caught.status >= 400 && caught.status < 500;
      if (definitive) { intent.current = null; setPending(false); void onSaved(); } else setPending(true);
      setError(definitive ? caught.message : "No se pudo confirmar el rechazo. Reintenta la misma operación antes de registrar otra.");
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  if (done) return <p role="status">Solicitud adicional rechazada. Los productos y cobros originales se conservan.</p>;
  return <details className="agent-attention-entry"><summary>Revisar solicitud adicional</summary><div className="agent-attention-review">
    <p>Rechazar esta solicitud no cancela el pedido original ni modifica sus cobros.</p>
    <label>Motivo del rechazo<textarea value={note} maxLength={1000} disabled={working || busy || pending} onChange={event => setNote(event.target.value)} /></label>
    <button type="button" className="button button-secondary" disabled={working || busy || (!pending && !note.trim())} onClick={() => void decline()}>{pending ? "Reintentar el mismo rechazo" : "Rechazar solicitud adicional"}</button>
    {error && <p role="alert">{error}</p>}
  </div></details>;
}

export function OrderPendingAdditions({ order, onSaved, working = false }: { order: OrderDetail; onSaved?: () => Promise<void>; working?: boolean }) {
  const { context } = useTenant();
  const canResolve = [context?.role, ...(context?.roles || [])].some(role => ["superadmin", "owner", "manager", "cashier"].includes(role || ""));
  const additions = (order.payment_requests || []).filter(item => item.purpose === "addition" && [...pendingStatuses, "committed", "declined"].includes(item.status));
  if (!additions.length) return null;
  return <section className="order-detail-note" aria-label="Estado de productos adicionales">
    <strong>Productos adicionales</strong>
    {additions.map(item => <div key={item.id}>
      <p>{item.items.map(product => `${product.quantity} × ${product.name}${product.variant_name ? ` · ${product.variant_name}` : ""}`).join(", ")} · <Money value={item.amount} /></p>
      <p>{item.status === "declined" ? "Solicitud adicional rechazada. No se incorporaron estos productos ni se modificaron cobros." : item.status === "committed" && item.method === "cash" ? "Productos incorporados para pago en efectivo. Consulta el cobro en Pagos; este estado no confirma un pago." : item.status === "awaiting_base_review" ? "Pendiente de aprobar el pedido original. Los adicionales todavía no se enviaron a cocina." : item.status === "requires_review" ? "La adición requiere revisión del encargado antes de incorporarse y enviarse a cocina." : "Adición pendiente. Los productos todavía no se incorporaron al pedido ni se enviaron a cocina."}</p>
      {canResolve && onSaved && pendingStatuses.includes(item.status) && <DeclineAddition order={order} request={item} working={working} onSaved={onSaved} />}
      {item.resolution_note && <p><strong>Motivo registrado:</strong> {item.resolution_note}</p>}
    </div>)}
  </section>;
}
