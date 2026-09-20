import { useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { apiBlob } from "../lib/api";
import { useTenant } from "../lib/tenant";
import type { OrderDetail, OrderPaymentRequest, PaymentEvidence } from "../types";
import { Money, StatusPill } from "./ui";

function EvidenceCard({ evidence, request, working, mayReview, initialPaid, onReview }: {
  evidence: PaymentEvidence; request?: OrderPaymentRequest; working: boolean; mayReview: boolean;
  initialPaid: boolean; onReview: (approve: boolean, evidence: PaymentEvidence) => Promise<void>;
}) {
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    setImage(null); setError(false);
    void apiBlob(evidence.image_url).then((blob) => {
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
      {request && !initialPaid && reviewable && <p>Primero aprueba el comprobante del pedido original.</p>}
      {mayReview && reviewable && <div className="review-actions">
        <button type="button" className="button button-success" disabled={working || Boolean(request && !initialPaid)} onClick={() => void onReview(true, evidence)}><CheckCircle2 />{request?.purpose === "delivery" ? "Aprobar pago del envío" : request ? "Aprobar pago y preparar adición" : "Aprobar pago y preparar"}</button>
        <button type="button" className="button button-danger" disabled={working} onClick={() => void onReview(false, evidence)}><XCircle /> Rechazar comprobante</button>
      </div>}
    </div>
  </section>;
}

export function OrderEvidenceHistory({ order, working, onReview }: {
  order: OrderDetail; working: boolean; onReview: (approve: boolean, evidence?: PaymentEvidence) => Promise<void>;
}) {
  const { context } = useTenant();
  const mayReview = [context?.role, ...(context?.roles || [])].some((role) => ["superadmin", "owner", "manager", "cashier"].includes(role || ""));
  const evidence = order.payment_evidences || (order.payment_evidence ? [order.payment_evidence] : []);
  const initialPaid = order.payment_method !== "yape" || evidence.some((item) => !item.payment_request_id && item.status === "paid");
  return <>{evidence.map((item) => <EvidenceCard key={item.id} evidence={item} working={working} mayReview={mayReview}
    initialPaid={initialPaid} request={order.payment_requests?.find((request) => request.id === item.payment_request_id)} onReview={onReview} />)}</>;
}
