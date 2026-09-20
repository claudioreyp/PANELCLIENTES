import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useTenant } from "../lib/tenant";
import type { OrderDetail } from "../types";
import { Modal, Money } from "./ui";

export function OrderDeliveryFee({ order, onSaved }: { order: OrderDetail; onSaved: () => Promise<void> }) {
  const { context } = useTenant();
  const [open, setOpen] = useState(false);
  const allowed = [context?.role, ...(context?.roles || [])].some((role) => ["superadmin", "owner", "manager", "cashier", "dispatcher"].includes(role || ""));
  const request = order.payment_requests?.find((item) => item.purpose === "delivery");
  if (order.delivery_fee_status !== "pending_quote" && !request) return null;
  return <section className="order-detail-note"><strong>{order.delivery_fee_status === "pending_quote" ? "Envío por cotizar" : "Cobro del envío"}</strong>
    <p>{order.delivery_fee_status === "pending_quote" ? "Confirma el importe antes de despachar. El pago de los productos no incluye este envío."
      : <><Money value={request!.amount} /> · {request!.method === "unselected" ? "Coordinar método de pago con el cliente" : request!.method === "cash" ? "Efectivo al recibir" : request!.status === "paid" ? "Yape aprobado" : "Yape pendiente de revisión"}</>}</p>
    {allowed && (order.delivery_fee_status === "pending_quote" || request?.method === "unselected") && !["cancelled", "closed", "dispatched", "delivered"].includes(order.status) && <button type="button" className="button button-secondary" onClick={() => setOpen(true)}>{request ? "Definir cobro del envío" : "Definir costo de envío"}</button>}
    {open && <FeeForm key={`${order.business_id}:${order.branch_id}:${order.id}`} order={order} onClose={() => setOpen(false)} onSaved={onSaved} />}
  </section>;
}

function FeeForm({ order, onClose, onSaved }: { order: OrderDetail; onClose: () => void; onSaved: () => Promise<void> }) {
  const request = order.payment_requests?.find((item) => item.purpose === "delivery");
  const methodOnly = order.delivery_fee_status !== "pending_quote" && Boolean(request);
  const [amount, setAmount] = useState(methodOnly ? String(request!.amount) : "");
  const [method, setMethod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const intent = useRef<{ key: string; body: string } | null>(null);
  const processing = useRef(false);
  const alive = useRef(true);
  const errorId = useId();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!amount) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [amount]);
  function close() { if (!processing.current && (!amount || window.confirm("¿Salir sin continuar con el costo de envío?"))) onClose(); }
  async function save() {
    if (processing.current || !amount.trim() || !Number.isFinite(Number(amount)) || Number(amount) < 0 || (methodOnly && !method)) return;
    intent.current ||= { key: crypto.randomUUID(), body: JSON.stringify({ expected_version: order.version, ...(!methodOnly ? { amount: Number(amount) } : {}), method: method || null }) };
    processing.current = true; setBusy(true); setError(null);
    try {
      await api(`/orders/${order.id}/${methodOnly ? "delivery-payment" : "delivery-fee"}`, { method: "PATCH", body: intent.current.body, idempotencyKey: intent.current.key });
      if (!alive.current) return;
      onClose(); void onSaved();
    } catch (caught) {
      if (!alive.current) return;
      const unknown = !(caught instanceof ApiError) || caught.status === 0 || caught.status >= 500;
      setUncertain(unknown);
      if (!unknown) intent.current = null;
      setError(unknown ? "No pudimos confirmar el resultado. Reintentar comprobará la misma operación, sin duplicarla." : caught.message);
    } finally { processing.current = false; if (alive.current) setBusy(false); }
  }
  return <Modal title="Definir costo de envío" onClose={close}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <p>Los productos y pagos anteriores no se modificarán.</p>
    <label>Costo de envío (S/)<input type="number" inputMode="decimal" min="0" step="0.01" required value={amount} disabled={busy || uncertain || methodOnly} onChange={(event) => setAmount(event.target.value)} aria-describedby={error ? errorId : undefined} /></label>
    <label>Forma de cobro acordada<select value={method} required={methodOnly} disabled={busy || uncertain} onChange={(event) => setMethod(event.target.value)}><option value="">Pendiente de coordinar</option><option value="cash">Efectivo al recibir</option><option value="yape">Otro Yape, con revisión humana</option></select></label>
    {error && <p id={errorId} role="alert">{error}</p>}
    <div className="modal-form-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={close}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy || !amount.trim()}>{busy ? "Guardando..." : uncertain ? "Reintentar confirmación" : "Confirmar costo"}</button></div>
  </form></Modal>;
}
