import { Eye, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { DialogPortal, useDialogSurface } from "../lib/dialog";
import { orderEditChanges, orderEditDraft, persistedEditMatches, validateOrderEdit, type OrderEditDraft } from "../lib/order-edit";
import { deliveryServices, fulfillmentLocked, isActiveOrderItem, orderChannels, savedOrderLines } from "../lib/order-presentation";
import { resolveIdempotentIntent, type IdempotentIntent } from "../lib/orders";
import type { Branch, Order, OrderDetail } from "../types";
import { OrderBreakdown } from "./OrderBreakdown";
import { Money } from "./ui";
import { OrderIdentity } from "./OrderIdentity";

export function OrderEditDrawer({ order, branch, onClose, onSaved }: { order: OrderDetail; branch: Branch; onClose: () => void; onSaved: (order: Order) => void }) {
  const [original] = useState(order);
  const [initial] = useState(() => orderEditDraft(order));
  const [draft, setDraft] = useState(initial);
  const [preview, setPreview] = useState(false);
  const [comment, setComment] = useState(Boolean(initial.notes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedTotal, setAcceptedTotal] = useState<number | null>(null);
  const intent = useRef<IdempotentIntent | null>(null);
  const processing = useRef(false);
  const ownFeeInitialized = useRef(initial.channel === "delivery" && initial.service === "own");
  const alive = useRef(true);
  const titleId = useId();
  const locked = fulfillmentLocked(order);
  const changes = orderEditChanges(original, initial, draft);
  const dirty = Object.keys(changes).length > 0;
  const ownDelivery = draft.channel === "delivery" && draft.service === "own";
  const total = acceptedTotal ?? Math.round((original.total - original.delivery_fee + (ownDelivery ? Number(draft.fee) : 0)) * 100) / 100;
  function close() { if (!processing.current && (!dirty || window.confirm("¿Descartar los cambios de este pedido?"))) onClose(); }
  const surface = useDialogSurface(close);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  function update<K extends keyof OrderEditDraft>(key: K, value: OrderEditDraft[K]) {
    const enteringOwnDelivery = (key === "channel" && value === "delivery" && draft.service === "own") || (key === "service" && value === "own" && draft.channel === "delivery");
    const initializeFee = enteringOwnDelivery && !ownFeeInitialized.current;
    if (initializeFee) ownFeeInitialized.current = true;
    setDraft((current) => ({ ...current, [key]: value, ...(initializeFee ? { fee: String(branch.delivery_fee || 0) } : {}) }));
    setAcceptedTotal(null); setError(null);
  }
  function reportError(message: string) { setError(message); setPreview(false); }
  async function save() {
    if (processing.current || !dirty) return;
    const validation = validateOrderEdit(draft, changes);
    if (validation) { reportError(validation); return; }
    const body = JSON.stringify({ ...changes, expected_version: original.version, expected_total: total });
    intent.current = resolveIdempotentIntent(intent.current, body, body);
    processing.current = true; setBusy(true); setError(null);
    try {
      const saved = await api<Order>(`/orders/${original.id}`, { method: "PATCH", idempotencyKey: intent.current.key, body: intent.current.body });
      if (alive.current) onSaved(saved);
    } catch (caught) {
      if (!alive.current) return;
      if (caught instanceof ApiError && caught.code === "ORDER_TOTAL_CHANGED") {
        const detail = (caught.details as { detail?: { total?: number } })?.detail;
        if (typeof detail?.total === "number") setAcceptedTotal(detail.total);
        reportError("El total cambió por la modalidad seleccionada. Revisa el nuevo importe y confirma para guardar.");
        intent.current = null;
      } else if (caught instanceof ApiError && (caught.status === 0 || caught.status >= 500)) {
        try {
          const persisted = await api<Order>(`/orders/${original.id}`);
          if (alive.current && persistedEditMatches(persisted, changes, original.version, total)) { onSaved(persisted); return; }
        } catch { /* Keep the same intent so a retry cannot apply the edit twice. */ }
        if (alive.current) reportError("No pudimos verificar el guardado. Tus cambios siguen aquí; vuelve a intentar guardar.");
      } else {
        intent.current = null;
        reportError(caught instanceof ApiError && caught.status === 409 ? "El pedido cambió o esta operación está bloqueada. Cierra y vuelve a abrir el editor para revisar su estado." : caught instanceof Error ? caught.message : "No se pudieron guardar los cambios. Revisa los datos e inténtalo nuevamente.");
      }
    } finally { processing.current = false; if (alive.current) setBusy(false); }
  }
  const field = (label: string, key: keyof OrderEditDraft, props: { placeholder?: string; disabled?: boolean; type?: string; autoComplete?: string } = {}) => <label>{label}<input {...props} value={draft[key]} disabled={busy || props.disabled} onChange={(event) => update(key, event.target.value)} /></label>;
  return <DialogPortal><div className="new-order-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <section className="new-order-drawer order-edit-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} ref={surface} tabIndex={-1}>
      <header className="new-order-header"><h2 id={titleId}>Editar pedido <OrderIdentity {...original} /></h2><div><button type="button" className="button button-secondary new-order-preview-toggle" aria-pressed={preview} onClick={() => setPreview(!preview)}><Eye />{preview ? "Volver al formulario" : "Vista previa"}</button><button type="button" className="icon-button" aria-label="Cerrar editor del pedido" onClick={close}><X /></button></div></header>
      <div className={`new-order-layout ${preview ? "show-order-preview" : ""}`}>
        <form id={`${titleId}-form`} className="new-order-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <section className="new-order-section">
            <label>Tipo de pedido<select value={draft.channel} disabled={busy || locked} onChange={(event) => update("channel", event.target.value)}>{!["counter", "takeaway", "delivery"].includes(draft.channel) && <option value={draft.channel}>{orderChannels[draft.channel] || draft.channel}</option>}{["takeaway", "counter", "delivery"].map((channel) => <option value={channel} key={channel}>{orderChannels[channel]}</option>)}</select></label>
            {draft.channel === "delivery" && <label>Servicio de entrega<select value={draft.service} disabled={busy || locked} onChange={(event) => update("service", event.target.value as OrderEditDraft["service"])}>{Object.entries(deliveryServices).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}
            {draft.channel === "delivery" && !ownDelivery && <>{field(`ID de pedido de ${deliveryServices[draft.service]}`, "externalId", { disabled: locked })}<p className="field-hint">Registro manual. No se enviará información a esta plataforma.</p></>}
            {locked && <p className="field-hint">{order.edit_policy?.reason || "La modalidad, dirección y tarifa están bloqueadas por el estado del pedido."}</p>}
            <label>Productos<button type="button" className="button button-secondary" disabled>Editar productos...</button><small>Los productos se editan desde las comandas del pedido.</small></label>
            <label className="new-order-comment-toggle"><input type="checkbox" checked={comment} disabled={busy} onChange={(event) => { setComment(event.target.checked); if (!event.target.checked) update("notes", ""); }} />Comentario adicional</label>
            {comment && <textarea aria-label="Comentario adicional" value={draft.notes} disabled={busy} rows={3} onChange={(event) => update("notes", event.target.value)} />}
          </section>
          {(draft.channel !== "delivery" || ownDelivery) && <section className="new-order-section"><h3>Datos de cliente</h3>
            {field("Nombre de cliente", "name", { autoComplete: "name" })}
            {field("Número de teléfono", "phone", { placeholder: "+51 912 345 678", type: "tel", autoComplete: "tel" })}
            {ownDelivery && <>{field("Colonia", "neighborhood", { disabled: locked })}{field("Calle", "street", { disabled: locked, autoComplete: "street-address" })}{field("Número (Casa, Depto, edificio)", "number", { disabled: locked })}{field("Entre calles", "crossStreets", { disabled: locked, placeholder: "Calle 1 y calle 2" })}{field("Referencias", "reference", { disabled: locked })}<label>Costo de envío<div className="order-fee-input"><span>S/</span><input aria-label="Costo de envío" inputMode="decimal" type="number" min="0" step="0.01" disabled={busy || locked} value={draft.fee} onChange={(event) => update("fee", event.target.value)} /></div></label></>}
          </section>}
          {error && <p role="alert" className="order-edit-error">{error}</p>}
        </form>
        <aside className={`new-order-preview ${preview ? "mobile-open" : ""}`} aria-label="Productos del pedido"><h3>Productos del pedido</h3><OrderBreakdown lines={savedOrderLines(original.items.filter(isActiveOrderItem))} /><div className="new-order-preview-total"><strong><span>Total al guardar</span><span><Money value={Number.isFinite(total) ? total : original.total} /></span></strong></div></aside>
      </div>
      <footer className="new-order-footer"><div aria-live="polite">{acceptedTotal !== null && <>Nuevo total: <Money value={acceptedTotal} /></>}</div><div><button type="button" className="button button-secondary" disabled={busy} onClick={close}>Cancelar</button><button form={`${titleId}-form`} className="button button-primary" disabled={busy || !dirty}>{busy ? "Guardando..." : acceptedTotal !== null ? "Confirmar nuevo total" : "Guardar cambios"}</button></div></footer>
    </section>
  </div></DialogPortal>;
}
