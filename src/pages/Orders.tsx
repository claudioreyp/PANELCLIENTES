import {
  Banknote,
  ChefHat,
  CheckCircle2,
  ChevronRight,
  CircleX,
  Clock3,
  ExternalLink,
  MapPin,
  MessageCircle,
  PackageCheck,
  Phone,
  Plus,
  Printer,
  RefreshCcw,
  Search,
  ShieldCheck,
  Split,
  Truck,
  UserRound,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, ErrorState, LoadingState, Modal, Money, PageHeader, StatusPill, Toast } from "../components/ui";
import { api, apiBlob } from "../lib/api";
import { useBranchRealtime, usePolling } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import type { Order, PaymentEvidence } from "../types";

type ToastState = { message: string; tone: "success" | "error" } | null;

function nextAction(order: Order) {
  if (order.status === "draft" || order.status === "pending_confirmation") {
    return { label: "Confirmar pedido", kind: "confirm" };
  }
  if (order.status === "confirmed" && order.payment_status !== "evidence_received") {
    return { label: "Enviar a cocina", kind: "kitchen" };
  }
  if (order.status === "sent_to_kitchen") return { label: "Marcar preparando", kind: "preparing" };
  if (order.status === "preparing") return { label: "Marcar listo", kind: "ready" };
  if (order.status === "ready" && order.channel === "delivery") {
    return { label: "Despachar delivery", kind: "dispatched" };
  }
  if (order.status === "dispatched") return { label: "Marcar entregado", kind: "delivered" };
  if (["ready", "delivered"].includes(order.status) && order.payment_status === "paid") {
    return { label: "Cerrar operación", kind: "closed" };
  }
  return null;
}

function isSubmittedOrder(order: Order) {
  if (!order.source.toLowerCase().includes("n8n") && order.source !== "whatsapp_agent") return true;
  return Boolean(order.submitted_at || order.status !== "draft");
}

function orderLocation(order: Order) {
  const address = order.delivery_address || {};
  const urlKeys = ["maps_url", "google_maps_url", "map_url", "url"];
  const url = urlKeys.map((key) => address[key]).find((value) => typeof value === "string") as string | undefined;
  const latitude = address.latitude ?? address.lat;
  const longitude = address.longitude ?? address.lng;
  const mapsUrl = url || (latitude && longitude ? `https://www.google.com/maps?q=${latitude},${longitude}` : null);
  const line = [address.address, address.street, address.number, address.district]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(" · ");
  const reference = String(address.reference || address.notes || "");
  return { mapsUrl, line, reference };
}

function formatChannel(channel: string) {
  const labels: Record<string, string> = {
    whatsapp: "WhatsApp",
    delivery: "Delivery propio",
    takeaway: "Para recoger",
    counter: "Mostrador",
    dine_in: "Comer en local",
    online: "Tienda online",
  };
  return labels[channel] || channel.replaceAll("_", " ");
}

export function OrdersPage() {
  const { branch } = useTenant();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const [evidenceImage, setEvidenceImage] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [splitParts, setSplitParts] = useState(2);
  const [splitResult, setSplitResult] = useState<number[] | null>(null);

  const resource = usePolling(async () => {
    if (!branch) throw new Error("Selecciona una sucursal");
    const params = new URLSearchParams({ branch_id: String(branch.id), limit: "200" });
    if (search.trim()) params.set("search", search.trim());
    const [orders, evidence] = await Promise.all([
      api<Order[]>(`/orders?${params}`),
      api<PaymentEvidence[]>(`/payment-evidence?branch_id=${branch.id}`),
    ]);
    return { orders, evidence };
  }, [branch?.id], 12000);
  useBranchRealtime(branch?.id, resource.refresh);

  const visibleOrders = (resource.data?.orders || []).filter(isSubmittedOrder);
  const activeOrders = visibleOrders.filter((order) => !["closed", "cancelled"].includes(order.status));
  const recentOrders = visibleOrders.filter((order) => ["closed", "cancelled"].includes(order.status)).slice(0, 5);
  const selected = visibleOrders.find((order) => order.id === selectedId) || null;
  const selectedEvidence = resource.data?.evidence.find((item) => item.order_id === selected?.id) || null;
  const selectedEvidenceId = selectedEvidence?.id;
  const selectedEvidenceUrl = selectedEvidence?.image_url;

  useEffect(() => {
    if (selectedId && visibleOrders.some((order) => order.id === selectedId)) return;
    setSelectedId(activeOrders[0]?.id || recentOrders[0]?.id || null);
  }, [activeOrders, recentOrders, selectedId, visibleOrders]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setEvidenceImage(null);
    if (!selectedEvidenceId || !selectedEvidenceUrl) return;
    void apiBlob(selectedEvidenceUrl)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setEvidenceImage(objectUrl);
      })
      .catch(() => setEvidenceImage(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedEvidenceId, selectedEvidenceUrl]);

  async function refreshSelection(orderId = selectedId) {
    await resource.refresh();
    if (orderId) setSelectedId(orderId);
  }

  async function advance(order: Order) {
    const action = nextAction(order);
    if (!action) return;
    setWorking(true);
    try {
      if (action.kind === "confirm") {
        await api(`/orders/${order.id}/confirm`, { method: "POST", idempotencyKey: `confirm-${order.id}` });
      } else if (action.kind === "kitchen") {
        await api(`/orders/${order.id}/send-to-kitchen`, { method: "POST", idempotencyKey: `kitchen-${order.id}` });
      } else {
        await api(`/orders/${order.id}/transition`, {
          method: "POST",
          body: JSON.stringify({ status: action.kind, expected_version: order.version }),
        });
      }
      await refreshSelection(order.id);
      setToast({ message: `${action.label}: operación completada.`, tone: "success" });
    } catch (caught) {
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo actualizar", tone: "error" });
    } finally {
      setWorking(false);
    }
  }

  async function reviewEvidence(approve: boolean) {
    if (!selected || !selectedEvidence) return;
    const question = approve
      ? "¿Confirmas que el monto y los datos del comprobante son correctos? El pedido pasará a cocina."
      : "¿Rechazar este comprobante? El pedido se cancelará y el stock reservado será revertido.";
    if (!window.confirm(question)) return;
    setWorking(true);
    try {
      await api(`/payment-evidence/${selectedEvidence.id}/review`, {
        method: "POST",
        body: JSON.stringify({ approve }),
      });
      await refreshSelection(selected.id);
      setToast({
        message: approve ? "Pago aprobado y pedido enviado a preparación." : "Comprobante rechazado y stock liberado.",
        tone: "success",
      });
    } catch (caught) {
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo revisar el comprobante", tone: "error" });
    } finally {
      setWorking(false);
    }
  }

  async function cancelOrder(order: Order) {
    if (!window.confirm("¿Cancelar este pedido? El stock reservado será revertido y quedará auditado.")) return;
    setWorking(true);
    try {
      await api(`/orders/${order.id}/transition`, {
        method: "POST",
        body: JSON.stringify({ status: "cancelled", expected_version: order.version }),
      });
      await refreshSelection(order.id);
      setToast({ message: "Pedido cancelado y stock revertido.", tone: "success" });
    } catch (caught) {
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo cancelar", tone: "error" });
    } finally {
      setWorking(false);
    }
  }

  async function createPayment() {
    if (!selected || paymentAmount <= 0) return;
    setWorking(true);
    try {
      await api(`/orders/${selected.id}/payments`, {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: JSON.stringify({ method: paymentMethod, amount: paymentAmount }),
      });
      setPaymentOpen(false);
      await refreshSelection(selected.id);
      setToast({ message: "Pago registrado correctamente.", tone: "success" });
    } catch (caught) {
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo registrar el pago", tone: "error" });
    } finally {
      setWorking(false);
    }
  }

  async function previewSplit() {
    if (!selected) return;
    try {
      const result = await api<{ parts: number[] }>(`/orders/${selected.id}/split-preview`, {
        method: "POST",
        body: JSON.stringify({ parts: splitParts }),
      });
      setSplitResult(result.parts);
    } catch (caught) {
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo dividir", tone: "error" });
    }
  }

  if (resource.loading && !resource.data) return <LoadingState label="Abriendo el Mostrador..." />;
  if (resource.error && !resource.data) return <ErrorState message={resource.error} onRetry={() => void resource.refresh()} />;

  const location = selected ? orderLocation(selected) : null;
  const action = selected ? nextAction(selected) : null;

  return (
    <div className="page-stack counter-page">
      <PageHeader
        eyebrow="Operación central"
        title="Mostrador"
        description="Pedidos presenciales y de WhatsApp, pago supervisado y preparación en una sola vista."
        actions={
          <>
            <button className="button button-secondary" onClick={() => void resource.refresh()}><RefreshCcw /> Actualizar</button>
            <Link className="button button-primary" to="/pos"><Plus /> Nuevo pedido</Link>
          </>
        }
      />

      <section className="counter-workspace">
        <aside className="counter-list panel">
          <div className="counter-search search-field">
            <Search />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void resource.refresh()}
              placeholder="Pedido, cliente o teléfono"
            />
          </div>
          <div className="counter-section-title"><span>En curso</span><strong>{activeOrders.length}</strong></div>
          <div className="counter-orders">
            {activeOrders.map((order) => (
              <button
                key={order.id}
                className={`counter-order-row ${selectedId === order.id ? "selected" : ""}`}
                onClick={() => setSelectedId(order.id)}
              >
                <span className="counter-order-id">#{order.number.slice(-6)}</span>
                <span className="counter-order-main">
                  <strong>{order.customer_name || "Cliente de mostrador"}</strong>
                  <small>{formatChannel(order.channel)} · {order.items.length} productos</small>
                </span>
                <span className="counter-order-meta">
                  <Money value={order.total} />
                  <StatusPill value={["evidence_received", "invalid_evidence"].includes(order.payment_status) ? order.payment_status : order.status} />
                </span>
              </button>
            ))}
            {!activeOrders.length && <EmptyState title="Sin pedidos en curso" detail="Los pedidos confirmados por WhatsApp aparecerán aquí." />}
          </div>
          <div className="counter-section-title closed"><span>Cerrados recientes</span><strong>{recentOrders.length}</strong></div>
          <div className="counter-orders counter-orders-closed">
            {recentOrders.map((order) => (
              <button
                key={order.id}
                className={`counter-order-row ${selectedId === order.id ? "selected" : ""}`}
                onClick={() => setSelectedId(order.id)}
              >
                <span className="counter-order-id">#{order.number.slice(-6)}</span>
                <span className="counter-order-main"><strong>{order.customer_name || "Cliente"}</strong><small>{formatChannel(order.channel)}</small></span>
                <span className="counter-order-meta"><Money value={order.total} /><StatusPill value={order.status} /></span>
              </button>
            ))}
          </div>
        </aside>

        <article className="counter-detail panel">
          {!selected ? (
            <EmptyState title="Selecciona un pedido" detail="Aquí verás sus artículos, contexto de WhatsApp, pago y acciones." />
          ) : (
            <>
              <header className="counter-detail-header">
                <div>
                  <span className="eyebrow">Pedido #{selected.number}</span>
                  <h2>{selected.customer_name || "Cliente de mostrador"}</h2>
                  <div className="counter-detail-pills"><StatusPill value={selected.status} /><StatusPill value={selected.payment_status} /><span>{formatChannel(selected.channel)}</span></div>
                </div>
                <div className="counter-total"><small>Total</small><Money value={selected.total} /></div>
              </header>

              <div className="counter-context-grid">
                <div><UserRound /><span><small>Cliente</small><strong>{selected.customer_name || "Sin nombre"}</strong></span></div>
                <div><Phone /><span><small>Teléfono de WhatsApp</small><strong>{selected.customer_phone || "No disponible"}</strong></span></div>
                <div><MessageCircle /><span><small>Origen</small><strong>{selected.source || "POS"}</strong></span></div>
                <div><Clock3 /><span><small>Inicio</small><strong>{new Date(selected.created_at).toLocaleString("es-PE")}</strong></span></div>
              </div>

              {selected.channel === "delivery" && location && (
                <section className="counter-location">
                  <MapPin />
                  <div><small>Entrega propia</small><strong>{location.line || "Dirección pendiente"}</strong>{location.reference && <span>Referencia: {location.reference}</span>}</div>
                  {location.mapsUrl && <a href={location.mapsUrl} target="_blank" rel="noreferrer">Abrir mapa <ExternalLink /></a>}
                </section>
              )}

              <section className="counter-ticket">
                <div className="counter-block-title"><span>Detalle del pedido</span><strong>{selected.items.length} líneas</strong></div>
                {selected.items.map((item) => (
                  <div className="counter-ticket-line" key={item.id}>
                    <strong>{item.quantity}×</strong>
                    <span><b>{item.name}</b>{item.variant_name && <small>{item.variant_name}</small>}{item.modifiers.length > 0 && <small>{item.modifiers.map((modifier) => modifier.name).join(", ")}</small>}{item.notes && <small className="note">{item.notes}</small>}</span>
                    <strong><Money value={item.line_total} /></strong>
                  </div>
                ))}
                <div className="counter-totals"><span>Subtotal <Money value={selected.subtotal} /></span>{selected.delivery_fee > 0 && <span>Envío <Money value={selected.delivery_fee} /></span>}<strong>Total <Money value={selected.total} /></strong></div>
              </section>

              {selected.notes && <section className="counter-note"><strong>Comentario operativo</strong><p>{selected.notes}</p></section>}

              {selectedEvidence && (
                <section className={`payment-review-card review-${selectedEvidence.status}`}>
                  <div className="payment-evidence-image">
                    {evidenceImage ? <img src={evidenceImage} alt={`Comprobante ${selectedEvidence.provider}`} /> : <span><ShieldCheck /> Cargando comprobante privado...</span>}
                  </div>
                  <div className="payment-evidence-data">
                    <div className="counter-block-title"><span>Comprobante {selectedEvidence.provider.toUpperCase()}</span><StatusPill value={selectedEvidence.status} /></div>
                    <dl>
                      <div><dt>Monto detectado</dt><dd>{selectedEvidence.amount_detected == null ? "Por revisar" : <Money value={selectedEvidence.amount_detected} />}</dd></div>
                      <div><dt>Número de operación</dt><dd>{selectedEvidence.operation_number || "No legible"}</dd></div>
                      <div><dt>Código de seguridad</dt><dd className="security-code">{selectedEvidence.security_code || "---"}</dd></div>
                      <div><dt>Destinatario</dt><dd>{selectedEvidence.recipient || "Por revisar"}</dd></div>
                    </dl>
                    {selectedEvidence.warnings.length > 0 && <p className="evidence-warning">Revisar: {selectedEvidence.warnings.join(" · ")}</p>}
                    {selectedEvidence.status === "under_review" && (
                      <div className="review-actions">
                        <button className="button button-success" disabled={working} onClick={() => void reviewEvidence(true)}><CheckCircle2 /> Aprobar pago y preparar</button>
                        <button className="button button-danger" disabled={working} onClick={() => void reviewEvidence(false)}><XCircle /> Rechazar comprobante</button>
                      </div>
                    )}
                  </div>
                </section>
              )}

              <footer className="counter-actions">
                <div>
                  <button className="button button-ghost" onClick={() => window.print()}><Printer /> Imprimir</button>
                  <button className="button button-ghost" onClick={() => void previewSplit()}><Split /> Dividir en {splitParts}</button>
                  <input aria-label="Partes" type="number" min="2" max="50" value={splitParts} onChange={(event) => { setSplitParts(Number(event.target.value)); setSplitResult(null); }} />
                  {splitResult && <small>{splitResult.map((part, index) => `Parte ${index + 1}: S/ ${part.toFixed(2)}`).join(" · ")}</small>}
                </div>
                <div>
                  {selected.payment_status !== "paid" && selected.payment_status !== "evidence_received" && <button className="button button-secondary" onClick={() => { setPaymentAmount(selected.total); setPaymentOpen(true); }}><Banknote /> Registrar pago</button>}
                  {action && <button className="button button-primary" disabled={working} onClick={() => void advance(selected)}>{action.kind === "kitchen" ? <ChefHat /> : action.kind === "dispatched" ? <Truck /> : <PackageCheck />}{action.label}<ChevronRight /></button>}
                  {!['closed', 'cancelled'].includes(selected.status) && <button className="icon-button danger" title="Cancelar pedido" disabled={working} onClick={() => void cancelOrder(selected)}><CircleX /></button>}
                </div>
              </footer>
            </>
          )}
        </article>
      </section>

      {paymentOpen && selected && (
        <Modal title="Registrar pago" onClose={() => setPaymentOpen(false)}>
          <div className="form-stack">
            <label>Método<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="yape">Yape</option><option value="plin">Plin</option><option value="transfer">Transferencia</option></select></label>
            <label>Monto<input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(Number(event.target.value))} /></label>
            <button className="button button-primary button-large" onClick={() => void createPayment()} disabled={working}><Banknote /> Confirmar pago</button>
          </div>
        </Modal>
      )}
      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
