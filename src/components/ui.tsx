import { useEffect, useId, useRef, type ReactNode } from "react";
import { AlertTriangle, LoaderCircle, X } from "lucide-react";
import { DialogPortal, useDialogSurface } from "../lib/dialog";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function StatusPill({ value }: { value: string }) {
  const labels: Record<string, string> = {
    draft: "Borrador",
    pending: "Pendiente",
    partial: "Pago parcial",
    paid: "Pagado",
    confirmed: "Confirmado",
    sent_to_kitchen: "Enviado a cocina",
    preparing: "En preparación",
    ready: "Listo",
    dispatched: "Despachado",
    delivered: "Entregado",
    closed: "Cerrado",
    cancelled: "Cancelado",
    queued: "En cola",
    rejected: "Rechazado",
    evidence_received: "Comprobante recibido",
    under_review: "Pendiente de revisión",
    invalid_evidence: "Imagen no válida",
    not_a_receipt: "No es comprobante",
    pending_confirmation: "Pendiente de confirmación",
    available: "Libre",
    reserved: "Reservada",
    occupied: "Ocupada",
    cleaning: "Por limpiar",
    served: "Entregada",
  };
  const label = labels[value] || value.replaceAll("_", " ");
  return <span className={`status-pill status-${value}`}>{label}</span>;
}

export function Money({ value }: { value: number }) {
  return <>{new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(value)}</>;
}

export function MetricCard({ label, value, hint, tone = "default" }: { label: string; value: ReactNode; hint?: string; tone?: string }) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </article>
  );
}

export function LoadingState({ label = "Cargando operación..." }: { label?: string }) {
  return <div className="state-panel"><LoaderCircle className="spin" /><p>{label}</p></div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-panel state-error">
      <AlertTriangle />
      <p>{message}</p>
      {onRetry && <button className="button button-secondary" onClick={onRetry}>Reintentar</button>}
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><strong>{title}</strong><p>{detail}</p></div>;
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const titleId = useId();
  const surfaceRef = useDialogSurface(onClose);
  return (
    <DialogPortal>
      <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
        <section
          ref={surfaceRef}
          className={`modal-card ${wide ? "modal-wide" : ""} ${className}`.trim()}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          <header><h2 id={titleId}>{title}</h2><button className="icon-button" data-dialog-initial-focus onClick={onClose} aria-label="Cerrar"><X /></button></header>
          <div className="modal-content">{children}</div>
        </section>
      </div>
    </DialogPortal>
  );
}

export function Toast({
  message,
  tone = "success",
  durationMs,
  onDismiss,
}: {
  message: string;
  tone?: "success" | "error";
  durationMs?: number;
  onDismiss: () => void;
}) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!durationMs) return;
    const timer = window.setTimeout(() => dismissRef.current(), durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, message]);

  return (
    <div className={`toast toast-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Cerrar aviso"><X size={16} /></button>
    </div>
  );
}
