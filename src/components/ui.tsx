import type { ReactNode } from "react";
import { AlertTriangle, LoaderCircle, X } from "lucide-react";

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
    evidence_received: "Comprobante recibido",
    under_review: "Pendiente de revisión",
    invalid_evidence: "Imagen no válida",
    not_a_receipt: "No es comprobante",
    pending_confirmation: "Pendiente de confirmación",
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

export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal-card ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X /></button></header>
        <div className="modal-content">{children}</div>
      </section>
    </div>
  );
}

export function Toast({ message, tone = "success", onDismiss }: { message: string; tone?: "success" | "error"; onDismiss: () => void }) {
  return <div className={`toast toast-${tone}`} role="status"><span>{message}</span><button onClick={onDismiss}><X size={16} /></button></div>;
}
