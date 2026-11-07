import { useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { apiBlob } from "../lib/api";
import { useTenant } from "../lib/tenant";
import type { EvidenceReviewDetails, OrderDetail, OrderPaymentRequest, PaymentEvidence } from "../types";
import { activePaymentRequests } from "../lib/order-detail-model";
import { Money, StatusPill } from "./ui";

function EvidenceCard({ evidence, request, working, mayReview, initialPaid, kitchenAlreadyReleased, recovery, onReview }: {
  evidence: PaymentEvidence; request?: OrderPaymentRequest; working: boolean; mayReview: boolean;
  initialPaid: boolean; kitchenAlreadyReleased: boolean; recovery?: { originalAmount: number; totalAmount: number };
  onReview: (approve: boolean, evidence: PaymentEvidence, financialReview?: EvidenceReviewDetails) => Promise<void>;
}) {
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [reviewNote, setReviewNote] = useState("");
  const [confirmedAmount, setConfirmedAmount] = useState(!recovery && evidence.amount_detected != null ? String(evidence.amount_detected) : "");
  const [allocation, setAllocation] = useState<NonNullable<EvidenceReviewDetails["allocation"]> | "">("");
  const financialReviewComplete = reviewNote.trim().length > 0 && Number.isFinite(Number(confirmedAmount)) && Number(confirmedAmount) > 0;
  const confirmedCents = Math.round(Number(confirmedAmount) * 100);
  const recoveryComplete = Boolean(recovery && financialReviewComplete && Math.abs(Number(confirmedAmount) * 100 - confirmedCents) < 0.000001 && allocation && (allocation === "original"
    ? confirmedCents === Math.round(recovery.originalAmount * 100)
    : confirmedCents >= Math.round(recovery.totalAmount * 100)));
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    setImage(null); setError(false);
    const imagePath = evidence.image_url.startsWith("/api/v1/") ? evidence.image_url.slice("/api/v1".length) : evidence.image_url;
    void apiBlob(imagePath).then((blob) => {
      if (!alive) return;
      url = URL.createObjectURL(blob); setImage(url);
    }).catch(() => { if (alive) setError(true); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [evidence.image_url, attempt]);
  const label = request?.purpose === "addition" ? "Productos adicionales" : request?.purpose === "delivery" ? "Costo de envío" : "Pedido original";
  const reviewable = ["evidence_received", "under_review"].includes(evidence.status);
  return <section className={`payment-review-card review-${evidence.status}`} aria-label={`Comprobante: ${label}`}>
    <div className="payment-evidence-image">{image ? <img src={image} alt={`Comprobante ${evidence.provider}: ${label}`} />
      : error ? <div role="alert"><p>No se pudo cargar el comprobante.</p><button type="button" className="button button-secondary" onClick={() => setAttempt((value) => value + 1)}>Reintentar imagen</button></div>
        : <span><ShieldCheck /> Cargando comprobante privado...</span>}</div>
    <div className="payment-evidence-data"><div className="counter-block-title"><span>{label} · {evidence.provider.toUpperCase()}</span><StatusPill value={evidence.status} /></div>
      <dl>{evidence.expected_amount != null && <div><dt>Importe a verificar</dt><dd><Money value={evidence.expected_amount} /></dd></div>}
        <div><dt>Monto detectado</dt><dd>{evidence.amount_detected == null ? "Por revisar" : <Money value={evidence.amount_detected} />}</dd></div>
        <div><dt>Número de operación</dt><dd>{evidence.operation_number || "No legible"}</dd></div>
        <div><dt>Código de seguridad</dt><dd className="security-code">{evidence.security_code || "---"}</dd></div>
        <div><dt>Destinatario</dt><dd>{evidence.recipient || "Por revisar"}</dd></div></dl>
      {evidence.warnings.length > 0 && <p className="evidence-warning">Revisar: {evidence.warnings.join(" · ")}</p>}
      {evidence.rejection_reason && <p>{evidence.rejection_reason}</p>}
      {evidence.requires_financial_review && reviewable && !recovery && <div className="agent-attention-review" role="group" aria-label="Revisión del importe tras cambio de entrega">
        <strong>El importe cambió después de recibir el comprobante</strong>
        {evidence.financial_review && <p>Importe original: <Money value={evidence.financial_review.original_expected_amount} />. Total actual: <Money value={evidence.financial_review.current_total} />.</p>}
        <p>Verifica el pago real. La aprobación conservará el saldo o exceso correspondiente; no realiza devoluciones automáticas.</p>
        {mayReview && <><label>Importe realmente verificado<input type="number" min="0.01" step="0.01" value={confirmedAmount} disabled={working} onChange={event => setConfirmedAmount(event.target.value)} /></label>
          <label>Nota de revisión financiera<textarea maxLength={1000} value={reviewNote} disabled={working} onChange={event => setReviewNote(event.target.value)} /></label></>}
      </div>}
      {recovery && mayReview && reviewable && <div className="agent-attention-review" role="group" aria-label="Corregir aplicación del comprobante">
        <strong>Este comprobante está asociado al envío</strong>
        <p>El pago de los productos sigue pendiente. Si el comprobante corresponde a ese pago, verifica el importe y corrige su aplicación antes de aprobarlo.</p>
        <label>Aplicar comprobante a<select value={allocation} disabled={working} onChange={event => setAllocation(event.target.value as typeof allocation)}><option value="">Selecciona qué cubre el pago</option><option value="original">Productos</option><option value="original_and_delivery">Productos + envío</option></select></label>
        <p>Productos: <Money value={recovery.originalAmount} />. Productos + envío: <Money value={recovery.totalAmount} />.</p>
        <label>Importe realmente verificado<input type="number" min="0.01" step="0.01" value={confirmedAmount} disabled={working} onChange={event => setConfirmedAmount(event.target.value)} /></label>
        <label>Motivo de la corrección<textarea maxLength={1000} value={reviewNote} disabled={working} onChange={event => setReviewNote(event.target.value)} /></label>
        {confirmedAmount && allocation === "original" && confirmedCents !== Math.round(recovery.originalAmount * 100) && <p role="note">Para productos, el importe debe coincidir con su saldo. Si también cubre el envío, selecciona Productos + envío.</p>}
        {confirmedAmount && allocation === "original_and_delivery" && Number(confirmedAmount) < recovery.totalAmount && <p role="note">El importe verificado no cubre productos y envío. El comprobante seguirá pendiente de revisión.</p>}
        {allocation === "original_and_delivery" && Number(confirmedAmount) > recovery.totalAmount && <p role="note">Exceso confirmado: <Money value={Number(confirmedAmount) - recovery.totalAmount} />. Se conservará para revisión; no se devuelve automáticamente.</p>}
      </div>}
      {request && !initialPaid && reviewable && !recovery && <p>Primero aprueba el comprobante del pedido original.</p>}
      {mayReview && reviewable && <div className="review-actions">
        <button type="button" className="button button-success" disabled={working || (recovery ? !recoveryComplete : Boolean(request && !initialPaid) || Boolean(evidence.requires_financial_review && !financialReviewComplete))} onClick={() => void onReview(true, evidence, recovery && allocation ? { note: reviewNote.trim(), confirmed_amount: Number(confirmedAmount), allocation } : evidence.requires_financial_review ? { note: reviewNote.trim(), confirmed_amount: Number(confirmedAmount) } : undefined)}><CheckCircle2 />{recovery ? "Aplicar y aprobar pago" : request?.purpose === "delivery" ? "Aprobar pago del envío" : request ? "Aprobar pago y agregar productos" : kitchenAlreadyReleased ? "Aprobar pago" : "Aprobar pago y preparar"}</button>
        <button type="button" className="button button-danger" disabled={working} onClick={() => void onReview(false, evidence)}><XCircle /> Rechazar comprobante</button>
      </div>}
    </div>
  </section>;
}

export function OrderEvidenceHistory({ order, working, onReview }: {
  order: OrderDetail; working: boolean; onReview: (approve: boolean, evidence?: PaymentEvidence, financialReview?: EvidenceReviewDetails) => Promise<void>;
}) {
  const { context } = useTenant();
  const mayReview = [context?.role, ...(context?.roles || [])].some((role) => ["superadmin", "owner", "manager", "cashier"].includes(role || ""));
  const evidence = order.payment_evidences || (order.payment_evidence ? [order.payment_evidence] : []);
  const kitchenAlreadyReleased = ["agent", "n8n", "whatsapp", "whatsapp_agent"].includes(order.source || "")
    && Boolean(order.sent_to_kitchen_at || order.kitchen_tickets?.length);
  const initialPaid = order.payment_method !== "yape" || evidence.some((item) => !item.payment_request_id && item.status === "paid");
  const activeRequests = activePaymentRequests(order);
  const deliveryRequests = activeRequests.filter(request => request.purpose === "delivery");
  const currentEvidence = evidence.filter(item => ["evidence_received", "under_review"].includes(item.status));
  const delivery = deliveryRequests.length === 1 ? deliveryRequests[0] : undefined;
  const recoverable = !initialPaid && ["agent", "n8n", "whatsapp", "whatsapp_agent"].includes(order.source)
    && !["cancelled", "closed", "delivered", "dispatched"].includes(order.status)
    && order.paid_amount === 0 && !(order.payments || []).some(payment => payment.status === "confirmed")
    && !evidence.some(item => !item.payment_request_id && ["paid", "evidence_received", "under_review"].includes(item.status))
    && delivery?.method === "yape" && !delivery.payment_id && ["pending", "under_review", "rejected"].includes(delivery.status)
    && !activeRequests.some(request => request.purpose === "addition") && currentEvidence.length === 1
    && order.delivery_fee_status === "final" && order.total > delivery.amount;
  return <>{evidence.map((item) => <EvidenceCard key={item.id} evidence={item} working={working} mayReview={mayReview}
    initialPaid={initialPaid} kitchenAlreadyReleased={kitchenAlreadyReleased}
    recovery={recoverable && item.payment_request_id === delivery?.id && currentEvidence[0]?.id === item.id ? { originalAmount: order.total - delivery.amount, totalAmount: order.total } : undefined}
    request={order.payment_requests?.find((request) => request.id === item.payment_request_id)} onReview={onReview} />)}</>;
}
