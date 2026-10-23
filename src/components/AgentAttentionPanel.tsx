import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api, ApiError, privateImage } from "../lib/api";
import { useTenant } from "../lib/tenant";
import { useQuery } from "../lib/query-session";
import { useBranchRealtime } from "../lib/hooks";
import { formatPosDate } from "../lib/pos-dates";
import type { AgentAttention } from "../types";
import "./agent-attention.css";

const labels = { pending: "Pendiente", acknowledged: "Revisada · seguimiento pendiente", resolved: "Resuelta" };
const financeRoles = ["owner", "manager", "cashier", "superadmin"];

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

export function AgentAttentionEntry({ item, mayResolve, onSaved, onOpenOrder }: {
  item: AgentAttention; mayResolve: boolean; onSaved: () => Promise<unknown>; onOpenOrder?: (id: number) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const intent = useRef<{ key: string; body: string } | null>(null);
  const locked = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function resolve(status: "acknowledged" | "resolved") {
    if (locked.current || !mayResolve || (!intent.current && !note.trim())) return;
    locked.current = true; setBusy(true); setError(null);
    intent.current ??= { key: crypto.randomUUID(), body: JSON.stringify({ expected_version: item.version, status, note: note.trim() }) };
    try {
      await api(`/agent-attention/${encodeURIComponent(item.id)}/resolve`, { method: "POST", idempotencyKey: intent.current.key, body: intent.current.body });
      if (!mounted.current) return;
      intent.current = null; setPending(false); setNote("");
      await onSaved();
    } catch (caught) {
      if (!mounted.current) return;
      const definitive = caught instanceof ApiError && caught.status >= 400 && caught.status < 500;
      if (definitive) { intent.current = null; setPending(false); void onSaved(); }
      else setPending(true);
      setError(definitive ? caught.message : "No se pudo confirmar la revisión. Reintenta la misma operación antes de registrar otra.");
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }

  return <details className={`agent-attention-entry attention-${item.kind}`}>
    <summary><AlertTriangle aria-hidden="true" /><span><strong>{item.summary}</strong><small>{labels[item.status]}{item.order_id === null ? " · Sin pedido registrado" : ""}</small></span></summary>
    <div className="agent-attention-content">
      <p><time dateTime={item.created_at}>{formatPosDate(item.created_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</time>{item.sender && <> · WhatsApp: {item.sender}</>}</p>
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
      {mayResolve && item.status !== "resolved" && <div className="agent-attention-review">
        <label>Nota de revisión<textarea maxLength={1000} value={note} disabled={busy || pending} onChange={event => setNote(event.target.value)} /></label>
        {pending ? <button type="button" className="button button-secondary" disabled={busy} onClick={() => void resolve("acknowledged")}>Reintentar la misma revisión</button> : <div>
          {item.status === "pending" && <button type="button" className="button button-secondary" disabled={busy || !note.trim()} onClick={() => void resolve("acknowledged")}>Marcar revisada</button>}
          <button type="button" className="button button-secondary" disabled={busy || !note.trim()} onClick={() => void resolve("resolved")}>Resolver incidencia</button>
        </div>}
      </div>}
      {error && <p role="alert">{error}</p>}
    </div>
  </details>;
}

export function AgentAttentionPanel({ orderId, onOpenOrder }: { orderId?: number; onOpenOrder?: (id: number) => void }) {
  const { branch, context } = useTenant();
  const roles = [context?.role, ...(context?.roles || [])];
  const mayFinance = roles.some(role => financeRoles.includes(role || ""));
  const mayOperate = mayFinance || roles.includes("dispatcher");
  const enabled = Boolean(branch && mayOperate);
  const query = useQuery<AgentAttention[]>(["agent-attention", branch?.id, orderId ?? "open"], async () => {
    const records = await api<AgentAttention[]>(`/agent-attention?branch_id=${branch!.id}&status=${orderId ? "all" : "open"}${orderId ? `&order_id=${orderId}` : ""}`);
    if (!Array.isArray(records) || records.some(item => item.branch_id !== branch!.id || (context?.business.id != null && item.business_id !== context.business.id) || (orderId && item.order_id !== orderId))) throw new Error("La consulta de incidencias no corresponde a esta sucursal o pedido.");
    return records;
  }, 30000, enabled);
  useBranchRealtime(enabled ? branch?.id : undefined, () => { void query.refresh(); });
  if (!enabled) return null;
  if (!query.data?.length && !query.error) return null;
  return <section className={`agent-attention-panel${orderId ? "" : " agent-attention-overview"}`} tabIndex={orderId ? undefined : 0} aria-label={orderId ? "Revisiones del agente de este pedido" : "Atención del agente"}>
    <h3>{orderId ? "Revisiones del agente" : `Atención del agente (${query.data?.length ?? 0})`}</h3>
    {query.error && <div role="alert"><p>No se pudieron actualizar las incidencias. {query.error}</p><button type="button" className="button button-secondary" onClick={() => void query.refresh()}>Reintentar incidencias</button></div>}
    {query.data?.map(item => <AgentAttentionEntry key={`${branch!.id}:${item.id}`} item={item} mayResolve={mayFinance || (roles.includes("dispatcher") && ["fulfillment_change", "location_after_dispatch"].includes(item.kind))} onSaved={query.refresh} onOpenOrder={onOpenOrder} />)}
  </section>;
}
