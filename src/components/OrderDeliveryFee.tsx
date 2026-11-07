import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useTenant } from "../lib/tenant";
import type { OrderDetail, OrderPaymentRequest } from "../types";
import { activePaymentRequests, hasOpenPaymentEvidence, pendingDeliveryPayment } from "../lib/order-detail-model";
import { Modal, Money } from "./ui";

export function OrderDeliveryFee({ order, onSaved }: { order: OrderDetail; onSaved: () => Promise<void> }) {
  const { context } = useTenant();
  const [open, setOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const allowed = [context?.role, ...(context?.roles || [])].some((role) => ["superadmin", "owner", "manager", "cashier", "dispatcher"].includes(role || ""));
  const mayCollect = [context?.role, ...(context?.roles || [])].some(role => ["superadmin", "owner", "manager", "cashier"].includes(role || ""));
  const request = activePaymentRequests(order).find((item) => item.purpose === "delivery");
  const outstanding = pendingDeliveryPayment(order);
  const canCollect = mayCollect && outstanding && outstanding.method !== "unselected"
    && !["cancelled", "closed"].includes(order.status) && !hasOpenPaymentEvidence(order)
    && Math.abs(order.remaining_amount - outstanding.amount) < 0.005;
  const pendingReceipt = request && (order.payment_evidences || (order.payment_evidence ? [order.payment_evidence] : []))
    .some(evidence => evidence.payment_request_id === request.id && ["evidence_received", "under_review"].includes(evidence.status));
  if (order.delivery_fee_status !== "pending_quote" && !request) return null;
  return <section className="order-detail-note"><strong>{order.delivery_fee_status === "pending_quote" ? "Envío por cotizar" : "Cobro del envío"}</strong>
    <p>{order.delivery_fee_status === "pending_quote" ? "Confirma el importe antes de despachar. El pago de los productos no incluye este envío."
      : <><Money value={request!.amount} /> · {request!.status === "paid" ? "Envío pagado" : request!.collection_pending_with_courier ? "Cobro pendiente del repartidor" : pendingReceipt ? "Comprobante por revisar" : request!.method === "unselected" ? "Coordinar método de pago con el cliente" : request!.method === "cash" ? "Efectivo al recibir" : "Yape pendiente de recibir"}</>}</p>
    {request?.collection_pending_with_courier && request.status !== "paid" && <p>Pedido entregado. El cobro aún no se ha ingresado en caja y el saldo se mantiene pendiente.</p>}
    {allowed && (order.delivery_fee_status === "pending_quote" || request?.method === "unselected") && !["cancelled", "closed", "dispatched", "delivered"].includes(order.status) && <button type="button" className="button button-secondary" onClick={() => setOpen(true)}>{request ? "Definir cobro del envío" : "Definir costo de envío"}</button>}
    {open && <FeeForm key={`${order.business_id}:${order.branch_id}:${order.id}`} order={order} onClose={() => setOpen(false)} onSaved={onSaved} />}
    {canCollect && <button type="button" className="button button-secondary" onClick={() => setCollectionOpen(true)}>Registrar cobro del envío</button>}
    {collectionOpen && outstanding && <CollectionForm key={`${order.business_id}:${order.branch_id}:${order.id}:${outstanding.id}`} order={order} request={outstanding} onClose={() => setCollectionOpen(false)} onSaved={onSaved} />}
  </section>;
}

function FeeForm({ order, onClose, onSaved }: { order: OrderDetail; onClose: () => void; onSaved: () => Promise<void> }) {
  const request = activePaymentRequests(order).find((item) => item.purpose === "delivery");
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

function CollectionForm({ order, request, onClose, onSaved }: {
  order: OrderDetail; request: OrderPaymentRequest; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cashLoading, setCashLoading] = useState(true);
  const [cashError, setCashError] = useState(false);
  const [cashOptions, setCashOptions] = useState<{ id: number; label: string }[]>([]);
  const [cashSessionId, setCashSessionId] = useState("");
  const intent = useRef<{ key: string; body: string } | null>(null);
  const processing = useRef(false);
  const alive = useRef(true);
  const errorId = useId();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    Promise.all([
      api<{ id: number; name: string; active: boolean }[]>(`/cash/registers?branch_id=${order.branch_id}`),
      api<{ id: number; register_id: number; status: string }[]>(`/cash/sessions?branch_id=${order.branch_id}&status=open`),
    ]).then(([registers, sessions]) => {
      if (!active) return;
      const options = sessions.filter(session => session.status === "open" && registers.some(register => register.id === session.register_id && register.active))
        .map(session => ({ id: session.id, label: registers.find(register => register.id === session.register_id)!.name }));
      setCashOptions(options);
      if (options.length === 1) setCashSessionId(String(options[0].id));
    }).catch(() => { if (active) setCashError(true); }).finally(() => { if (active) setCashLoading(false); });
    return () => { active = false; };
  }, [order.branch_id]);
  function close() { if (!processing.current && !uncertain) onClose(); }
  async function save() {
    if (processing.current || !method || !note.trim() || (!intent.current && (cashLoading || cashError || (cashOptions.length > 1 && !cashSessionId)))) return;
    if (!intent.current && !window.confirm(`¿Confirmas que recibiste S/ ${request.amount.toFixed(2)} del envío? Se registrará un solo pago y se liquidará su saldo pendiente.`)) return;
    intent.current ||= { key: crypto.randomUUID(), body: JSON.stringify({ method, amount: request.amount,
      cash_session_id: cashSessionId ? Number(cashSessionId) : null, note: note.trim(),
      expected_version: order.version, payment_request_id: request.id }) };
    processing.current = true; setBusy(true); setError(null);
    try {
      await api(`/orders/${order.id}/payments`, { method: "POST", body: intent.current.body, idempotencyKey: intent.current.key });
      if (!alive.current) return;
      onClose(); void onSaved();
    } catch (caught) {
      if (!alive.current) return;
      const unknown = !(caught instanceof ApiError) || caught.status === 0 || caught.status >= 500;
      setUncertain(unknown);
      if (!unknown) intent.current = null;
      setError(unknown ? "No pudimos confirmar el resultado. Reintenta esta misma operación para consultar su recibo sin duplicar el cobro." : caught.message);
    } finally { processing.current = false; if (alive.current) setBusy(false); }
  }
  return <Modal title="Registrar cobro del envío" onClose={close}><form className="form-stack" onSubmit={event => { event.preventDefault(); void save(); }}>
    <p>Saldo del envío: <Money value={request.amount} />. Registra únicamente el dinero ya recibido; no se modificarán productos ni comandas.</p>
    <label>Forma de cobro<select value={method} required disabled={busy || uncertain} onChange={event => setMethod(event.target.value)}><option value="">Selecciona el método recibido</option><option value="cash">Efectivo</option><option value="yape">Yape verificado</option></select></label>
    {cashOptions.length > 1 && <label>Caja del cobro<select value={cashSessionId} required disabled={busy || uncertain} onChange={event => setCashSessionId(event.target.value)}><option value="">Selecciona una caja</option>{cashOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>}
    <label>Nota del cobro<textarea value={note} required maxLength={1000} disabled={busy || uncertain} onChange={event => setNote(event.target.value)} /></label>
    {cashLoading && <p role="status">Consultando cajas...</p>}
    {cashError && <p role="alert">No se pudieron consultar las cajas. Cierra este formulario y vuelve a intentarlo antes de registrar el cobro.</p>}
    {error && <p id={errorId} role="alert">{error}</p>}
    <div className="modal-form-actions"><button type="button" className="button button-secondary" disabled={busy || uncertain} onClick={close}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy || !method || !note.trim() || (!uncertain && (cashLoading || cashError || (cashOptions.length > 1 && !cashSessionId)))} aria-describedby={error ? errorId : undefined}>{busy ? "Registrando..." : uncertain ? "Reintentar el mismo cobro" : "Registrar cobro"}</button></div>
  </form></Modal>;
}
