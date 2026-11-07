import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, X } from "lucide-react";
import { api, ApiError, privateImage } from "../lib/api";
import { useTenant } from "../lib/tenant";
import { useAuth } from "../lib/auth";
import { useQuery, useQuerySession } from "../lib/query-session";
import { QueryCache } from "../lib/query-cache";
import { ATTENTION_CLOSE_NOTE, attentionIntentScope, clearAttentionClose, readAttentionClose, saveAttentionClose } from "../lib/agent-attention-intent";
import { useBranchRealtime } from "../lib/hooks";
import { formatPosDate } from "../lib/pos-dates";
import { posTimestampDay } from "../lib/pos-day";
import { usePosDay } from "../lib/use-pos-day";
import { attentionContact, isAgentAttentionOrder } from "../lib/agent-attention-presentation";
import type { AgentAttention, Order } from "../types";
import "./agent-attention.css";

const labels = { pending: "Pendiente", acknowledged: "Revisada · seguimiento pendiente", resolved: "Resuelta" };
const financeRoles = ["owner", "manager", "cashier", "superadmin"];
const paymentMethodLabel = (value: unknown) => value === "yape" ? "Yape" : value === "cash" ? "Efectivo" : null;
const titles: Record<string, string> = {
  financial_review: "Revisión de pago", late_payment_receipt: "Comprobante por revisar",
  delivery_quote: "Cotización de envío", fulfillment_change: "Cambio de entrega",
  location_after_dispatch: "Cambio de ubicación", product_change_request: "Cambio de productos",
  catering: "Pedido especial", complaint: "Consulta del cliente", human_requested: "Atención al cliente",
  notification_review: "Aviso de WhatsApp",
};
type AttentionRow = { item: AgentAttention; order: Order | null };
type ResolutionIntent = { key: string; body: string; close?: boolean };

function titleFor(item: AgentAttention) {
  if (item.details.source === "agent_model_usage") return "Revisar conexión o consumo";
  return titles[item.kind] || "Revisión pendiente";
}

function AttentionReceipt({ attentionId, mediaRef, index }: { attentionId: string; mediaRef: string; index: number }) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    setImage(null); setImageError(false);
    if (open) {
      const path = `/api/v1/agent-attention/${encodeURIComponent(attentionId)}/attachments/${encodeURIComponent(mediaRef)}`;
      void privateImage(path).then(blob => {
        if (!alive) return;
        if (!["image/png", "image/jpeg", "image/webp"].includes(blob.type)) throw new Error("invalid_receipt_image");
        url = URL.createObjectURL(blob); setImage(url);
      }).catch(() => { if (alive) setImageError(true); });
    }
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [open, attentionId, mediaRef, attempt]);
  return <div className="agent-attention-receipt">
    <button type="button" className="button button-secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "Ocultar" : "Ver"} comprobante {index + 1}</button>
    {open && (image ? <img src={image} alt={`Comprobante recibido fuera de horario ${index + 1}`} />
      : imageError ? <div role="alert"><p>No se pudo cargar el comprobante.</p><button type="button" className="button button-secondary" onClick={() => setAttempt(value => value + 1)}>Reintentar imagen</button></div>
        : <p role="status">Cargando comprobante privado…</p>)}
  </div>;
}

export function AgentAttentionEntry({ item, mayResolve, onSaved, onOpenOrder, order = null, resolutionScope, keepResolved = false, onResolved }: {
  item: AgentAttention; mayResolve: boolean; onSaved: () => Promise<unknown>; onOpenOrder?: (id: number) => void;
  order?: Order | null; resolutionScope?: string; keepResolved?: boolean; onResolved?: (item: AgentAttention) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(() => Boolean(readAttentionClose(resolutionScope)));
  const [confirmed, setConfirmed] = useState<AgentAttention | null>(null);
  const intent = useRef<ResolutionIntent | null>(readAttentionClose(resolutionScope));
  const locked = useRef(false);
  const mounted = useRef(true);
  const fromMethod = paymentMethodLabel(item.details.from_method);
  const requestedMethod = paymentMethodLabel(item.details.requested_method);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const saved = item.status === "resolved" ? null : readAttentionClose(resolutionScope);
    if (item.status === "resolved") clearAttentionClose(resolutionScope);
    intent.current = saved;
    setPending(Boolean(saved)); setConfirmed(null); setError(null);
  }, [resolutionScope, item.id, item.status]);

  async function resolve(status: "acknowledged" | "resolved", close = false) {
    if (locked.current || !mayResolve || (!intent.current && !close && !note.trim())) return;
    locked.current = true; setBusy(true); setError(null);
    try {
      if (!intent.current) {
        const next = { key: crypto.randomUUID(), body: JSON.stringify({ expected_version: item.version, status, note: close ? ATTENTION_CLOSE_NOTE : note.trim() }), close };
        if (close) {
          try { saveAttentionClose(resolutionScope, { ...next, close: true }); }
          catch { setError("No se pudo preparar el cierre. Comprueba que el navegador permite guardar datos y vuelve a intentarlo."); return; }
        }
        intent.current = next;
      }
      const saved = await api<AgentAttention>(`/agent-attention/${encodeURIComponent(item.id)}/resolve`, { method: "POST", idempotencyKey: intent.current.key, body: intent.current.body });
      if (intent.current.close && (!saved || saved.id !== item.id || saved.business_id !== item.business_id || saved.branch_id !== item.branch_id
        || saved.status !== "resolved" || !Number.isInteger(saved.version) || saved.version <= JSON.parse(intent.current.body).expected_version)) throw new Error("Unconfirmed attention closure");
      clearAttentionClose(resolutionScope);
      intent.current = null;
      if (!mounted.current) return;
      setPending(false); setNote("");
      if (saved?.status === "resolved") { setConfirmed(saved); onResolved?.(saved); }
      // The write is already confirmed; a failed refresh must not turn it into
      // an uncertain operation or offer a second commercial/review mutation.
      try { await onSaved(); } catch { /* The next scheduled refresh can recover the list. */ }
    } catch (caught) {
      if (!mounted.current) return;
      const definitive = caught instanceof ApiError && caught.status >= 400 && caught.status < 500;
      if (definitive) { clearAttentionClose(resolutionScope); intent.current = null; setPending(false); void onSaved().catch(() => {}); }
      else setPending(true);
      setError(definitive ? caught.status === 409 ? "El aviso cambió. Revísalo antes de volver a cerrarlo." : caught.message : intent.current?.close ? "No se pudo confirmar el cierre. Reintenta el mismo cierre; el aviso sigue visible." : "No se pudo confirmar la revisión. Reintenta la misma operación antes de registrar otra.");
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }

  const currentConfirmation = confirmed && confirmed.version >= item.version ? confirmed : null;
  if (currentConfirmation?.status === "resolved" && !keepResolved) return null;
  const status = currentConfirmation?.status || item.status;
  const contact = attentionContact(item, order);
  return <article className={`agent-attention-entry attention-${item.kind}`}>
    <details>
    <summary><AlertTriangle aria-hidden="true" /><span className="agent-attention-summary"><strong>{titleFor(item)}</strong><small>{Number.isInteger(order?.folio) && Number(order?.folio) > 0 ? `Folio #${order!.folio} · ` : item.order_id === null ? "Sin pedido registrado · " : ""}<time dateTime={item.created_at}>{formatPosDate(item.created_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</time><span className="agent-attention-status">{labels[status]}</span></small><small>WhatsApp: {contact}</small></span><ChevronDown className="agent-attention-chevron" aria-hidden="true" /></summary>
    <div className="agent-attention-content">
      <p className="agent-attention-description">{item.summary}</p>
      {item.kind === "financial_review" && item.details.kind === "original_payment_method_change" && fromMethod && requestedMethod && <p>Cambio solicitado: de <strong>{fromMethod}</strong> a <strong>{requestedMethod}</strong>.</p>}
      {item.kind === "financial_review" && <p>Esta revisión no modifica cobros, saldos ni devoluciones. Comprueba los importes en el pedido.</p>}
      {item.kind === "late_payment_receipt" && <p>Comprobante recibido fuera del horario de atención. No hay pedido ni pago aprobado. Revisar esta incidencia no registra un pedido ni confirma el pago.</p>}
      {item.kind === "late_payment_receipt" && mayResolve && Array.isArray(item.details.attachments) && item.details.attachments.flatMap((value, index) => {
        const reference = typeof value === "object" && value !== null && "media_ref" in value ? value.media_ref : null;
        return typeof reference === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference)
          ? [<AttentionReceipt key={`${item.id}:${reference}`} attentionId={item.id} mediaRef={reference} index={index} />] : [];
      })}
      {Array.isArray(item.details.followups) && item.details.followups.some(value => typeof value === "string") && <div><strong>Actualizaciones:</strong><ul>{item.details.followups.filter((value): value is string => typeof value === "string").map((value, index) => <li key={index}>{value}</li>)}</ul></div>}
      {item.resolution_note && <p><strong>Última nota:</strong> {item.resolution_note}</p>}
      {item.resolved_by && <p>Registrado por: {item.resolved_by}{item.resolved_at && <> · {formatPosDate(item.resolved_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</>}</p>}
      {item.order_id !== null && onOpenOrder && <button type="button" className="button button-secondary" onClick={() => onOpenOrder(item.order_id!)}>Ver pedido</button>}
      {mayResolve && status !== "resolved" && <div className="agent-attention-review">
        <label>Nota de revisión<textarea maxLength={1000} value={note} disabled={busy || pending} onChange={event => setNote(event.target.value)} /></label>
        {pending ? null : <div>
          {item.status === "pending" && <button type="button" className="button button-secondary" disabled={busy || !note.trim()} onClick={() => void resolve("acknowledged")}>Marcar revisada</button>}
          <button type="button" className="button button-secondary" disabled={busy || !note.trim()} onClick={() => void resolve("resolved")}>Resolver incidencia</button>
        </div>}
      </div>}
    </div>
    </details>
    {mayResolve && status !== "resolved" && <button type="button" className="agent-attention-close" aria-label="Cerrar aviso" title="Cerrar aviso para todos" disabled={busy || pending} onClick={() => void resolve("resolved", true)}><X aria-hidden="true" /></button>}
    {(error || pending) && <div className="agent-attention-feedback">
      {error && <p role="alert">{error}</p>}
      {pending && mayResolve && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void resolve("acknowledged")}>{intent.current?.close ? "Reintentar cierre" : "Reintentar la misma revisión"}</button>}
    </div>}
  </article>;
}

function AttentionEntries({ rows, mayFinance, dispatcher, keepResolved, onSaved, onResolved, onOpenOrder }: {
  rows: AttentionRow[]; mayFinance: boolean; dispatcher: boolean; keepResolved: boolean;
  onSaved: () => Promise<unknown>; onResolved: (item: AgentAttention) => void; onOpenOrder?: (id: number) => void;
}) {
  const { user } = useAuth();
  return rows.map(({ item, order }) => <AgentAttentionEntry key={`${item.business_id}:${item.branch_id}:${item.id}`} item={item} order={order}
    mayResolve={Boolean(user?.id) && (mayFinance || (dispatcher && ["fulfillment_change", "location_after_dispatch"].includes(item.kind)))}
    resolutionScope={user?.id ? attentionIntentScope(user.id, item.business_id, item.branch_id, item.id) : undefined}
    onSaved={onSaved} onResolved={onResolved} keepResolved={keepResolved} onOpenOrder={onOpenOrder} />);
}

export function AgentAttentionPanel({ orderId, onOpenOrder }: { orderId?: number; onOpenOrder?: (id: number) => void }) {
  const { branch, context } = useTenant();
  const day = usePosDay();
  const [previousScope, setPreviousScope] = useState<string | null>(null);
  const dailyScope = `${context?.business.id}:${branch?.id}:${day}`;
  const showPrevious = previousScope === dailyScope;
  const sharedCache = useQuerySession();
  const [localCache] = useState(() => new QueryCache());
  const cache = sharedCache || localCache;
  const roles = [context?.role, ...(context?.roles || [])];
  const mayFinance = roles.some(role => financeRoles.includes(role || ""));
  const mayOperate = mayFinance || roles.includes("dispatcher");
  const enabled = Boolean(branch && mayOperate);
  const query = useQuery<AttentionRow[]>(["agent-attention", context?.business.id, branch?.id, orderId ?? "open"], async () => {
    const records = await api<AgentAttention[]>(`/agent-attention?branch_id=${branch!.id}&status=${orderId ? "all" : "open"}${orderId ? `&order_id=${orderId}` : ""}`);
    if (!Array.isArray(records) || records.some(item => item.branch_id !== branch!.id || (context?.business.id != null && item.business_id !== context.business.id) || (orderId && item.order_id !== orderId))) throw new Error("La consulta de incidencias no corresponde a esta sucursal o pedido.");
    const orders = new Map<number, Order | null>();
    const ids = [...new Set(records.flatMap(item => item.order_id === null ? [] : [item.order_id]))];
    // Share one scoped, short-lived order read per unique id, including folio.
    // Publish only a complete, scoped read. A failed refresh retains the last
    // complete notice list rather than changing the origin classification.
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
      while (next < ids.length) {
        const id = ids[next++];
        const key = JSON.stringify(["attention-order", context?.business.id, branch!.id, id]);
        await cache.fetch<Order>(key, () => api<Order>(`/orders/${id}`), 30000);
        const snapshot = cache.entry<Order>(key).snapshot, order = snapshot.data;
        orders.set(id, !snapshot.error && order?.id === id && order.branch_id === branch!.id
          && order.business_id === context?.business.id ? order : null);
      }
    }));
    if (ids.some(id => !orders.get(id))) throw new Error("No se pudo verificar el origen de todos los pedidos. Se conserva la última consulta completa.");
    return records.map(item => ({ item, order: item.order_id === null ? null : orders.get(item.order_id) || null }));
  }, 30000, enabled);
  useBranchRealtime(enabled ? branch?.id : undefined, () => { void query.refresh(); });
  if (!enabled) return null;
  const allRows = (query.data || []).filter(({ item, order }) => item.order_id === null || isAgentAttentionOrder(order));
  const isPrevious = ({ item }: AttentionRow) => {
    const itemDay = posTimestampDay(item.created_at);
    return !orderId && item.kind === "notification_review" && item.details.source !== "agent_model_usage"
      && itemDay !== null && itemDay < day;
  };
  const previousCount = allRows.filter(isPrevious).length;
  const rows = showPrevious ? allRows : allRows.filter(row => !isPrevious(row));
  if (!allRows.length && !query.error) return null;
  const onResolved = (saved: AgentAttention) => query.setData(current => current?.flatMap(row => row.item.id !== saved.id || row.item.version > saved.version ? [row] : orderId ? [{ ...row, item: { ...row.item, ...saved } }] : []) || null);
  return <section className={`agent-attention-panel${orderId ? "" : " agent-attention-overview"}`} tabIndex={orderId ? undefined : 0} aria-label={orderId ? "Revisiones del agente de este pedido" : "Atención del agente"}>
    <div className="agent-attention-heading">
      <h3>{orderId ? "Revisiones del pedido" : `Avisos pendientes (${rows.length})`}</h3>
      {!orderId && previousCount > 0 && <button type="button" className="button button-secondary" aria-expanded={showPrevious} onClick={() => setPreviousScope(showPrevious ? null : dailyScope)}>{showPrevious ? "Ocultar anteriores" : `Ver anteriores (${previousCount})`}</button>}
    </div>
    {!rows.length && previousCount > 0 && <p className="agent-attention-empty">No hay avisos nuevos. Puedes consultar los anteriores.</p>}
    {query.error && <div role="alert"><p>No se pudieron actualizar las incidencias. {query.error}</p><button type="button" className="button button-secondary" onClick={() => void query.refresh()}>Reintentar incidencias</button></div>}
    {rows.length > 0 && <AttentionEntries rows={rows} mayFinance={mayFinance} dispatcher={roles.includes("dispatcher")} keepResolved={Boolean(orderId)} onSaved={query.refresh} onResolved={onResolved} onOpenOrder={onOpenOrder} />}
  </section>;
}
