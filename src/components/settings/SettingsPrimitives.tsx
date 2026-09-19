import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  LoaderCircle,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { DialogPortal, useDialogSurface } from "../../lib/dialog";
import { useDirtyRegistration } from "./SettingsState";

export function SettingsSectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="settings-section-header">
      <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
      {action && <div className="settings-section-action">{action}</div>}
    </header>
  );
}

export function SettingsCard({
  title,
  description,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`settings-card ${className}`.trim()}>
      {(title || description) && <header className="settings-card-header"><div>{title && <h3>{title}</h3>}{description && <p>{description}</p>}</div></header>}
      <div className="settings-card-content">{children}</div>
    </section>
  );
}

export function SettingsFormActions({
  dirty,
  saving,
  disabled,
  onCancel,
  onSave,
  saveLabel = "Guardar",
}: {
  dirty: boolean;
  saving: boolean;
  disabled?: boolean;
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  return (
    <footer className="settings-form-actions">
      <button className="button button-secondary" type="button" disabled={!dirty || saving} onClick={() => setConfirmCancel(true)}>Cancelar</button>
      <button className="button button-primary" type="button" disabled={!dirty || saving || disabled} onClick={onSave}>
        {saving && <LoaderCircle className="spin" />}{saving ? "Guardando..." : saveLabel}
      </button>
      {confirmCancel && <SettingsConfirmDialog title="Descartar cambios" detail="Se perderán los cambios sin guardar de esta sección." confirmLabel="Descartar cambios" danger busy={saving} onCancel={() => setConfirmCancel(false)} onConfirm={() => { setConfirmCancel(false); onCancel(); }} />}
    </footer>
  );
}

export function SettingsFeedback({
  notice,
  error,
  success,
}: {
  notice?: string | null;
  error?: string | null;
  success?: string | null;
}) {
  return <>{([
    { tone: "success", message: success },
    { tone: "warning", message: notice },
    { tone: "error", message: error },
  ] as const).filter(({ message }) => message).map(({ tone, message }) => <div key={tone} className={`settings-feedback settings-feedback-${tone}`} role={tone === "error" ? "alert" : "status"} aria-live="polite">
    {tone === "success" ? <Check /> : <AlertCircle />}<span>{message}</span>
  </div>)}</>;
}

export function SettingsSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="settings-skeleton" aria-label="Cargando configuración">{Array.from({ length: rows }, (_, index) => <span key={index} />)}</div>;
}

export function SettingsSwitch({
  checked,
  onChange,
  label,
  description,
  disabled,
  busy,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="settings-switch-row">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-busy={busy || undefined}
        className={`settings-switch ${checked ? "is-on" : ""}`}
        disabled={disabled || busy}
        onClick={() => onChange(!checked)}
      ><span /></button>
      <div><strong>{label}</strong>{description && <p>{description}</p>}</div>
    </div>
  );
}

export function SettingsTable({ children, label }: { children: ReactNode; label: string }) {
  return <div className="settings-table-scroll" tabIndex={0} role="region" aria-label={label}><table className="settings-data-table">{children}</table></div>;
}

export function SettingsPagination({
  page,
  pageSize,
  total,
  onPage,
  noun = "elementos",
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  noun?: string;
}) {
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(total, page * pageSize);
  return (
    <div className="settings-pagination">
      <button className="icon-button" type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft /></button>
      <span>{start} - {end} de {total} {noun}</span>
      <button className="icon-button" type="button" aria-label="Página siguiente" disabled={end >= total} onClick={() => onPage(page + 1)}><ChevronRight /></button>
    </div>
  );
}

export function SettingsActionMenu({
  editLabel = "Editar",
  archiveLabel = "Borrar",
  editDisabled,
  editHelp,
  archiveDisabled,
  archiveHelp,
  onEdit,
  onArchive,
}: {
  editLabel?: string;
  archiveLabel?: string;
  editDisabled?: boolean;
  editHelp?: string;
  archiveDisabled?: boolean;
  archiveHelp?: string;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className="settings-action-menu" ref={rootRef}>
      <button className="icon-button" type="button" aria-label="Abrir acciones" aria-expanded={open} onClick={() => setOpen((value) => !value)}><Ellipsis /></button>
      {open && <div className="settings-action-popover" role="menu"><strong>Acciones</strong>
        <button type="button" role="menuitem" disabled={editDisabled} onClick={() => { setOpen(false); onEdit(); }}><Pencil />{editLabel}{editDisabled && editHelp && <small>{editHelp}</small>}</button>
        <button type="button" role="menuitem" className="danger" disabled={archiveDisabled} onClick={() => { setOpen(false); onArchive(); }}><Trash2 />{archiveLabel}{archiveDisabled && archiveHelp && <small>{archiveHelp}</small>}</button>
      </div>}
    </div>
  );
}

export function SettingsDrawer({
  title,
  children,
  onClose,
  footer,
  dirty = false,
  busy = false,
  onDiscard,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode | ((requestClose: () => void) => ReactNode);
  dirty?: boolean;
  busy?: boolean;
  onDiscard?: () => void;
}) {
  const titleId = useId();
  const [confirmClose, setConfirmClose] = useState(false);
  function requestClose() {
    if (busy) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  }
  useDirtyRegistration({ dirty, saving: busy, save: null });
  const surfaceRef = useDialogSurface(requestClose);
  return (
    <DialogPortal>
      <div className="settings-layer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
        <section ref={surfaceRef} className="settings-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
          <header><h2 id={titleId}>{title}</h2><button className="icon-button" type="button" disabled={busy} data-dialog-initial-focus onClick={requestClose} aria-label="Cerrar"><X /></button></header>
          <div className="settings-drawer-body" inert={busy || undefined}>{children}</div>
          {footer && <footer>{typeof footer === "function" ? footer(requestClose) : footer}</footer>}
        </section>
      </div>
      {confirmClose && <SettingsConfirmDialog title="Tienes cambios sin guardar" detail="Puedes seguir editando o descartar el borrador antes de cerrar." confirmLabel="Descartar cambios" danger busy={busy} onCancel={() => setConfirmClose(false)} onConfirm={() => { setConfirmClose(false); onDiscard?.(); onClose(); }} />}
    </DialogPortal>
  );
}

export function SettingsConfirmDialog({
  title,
  detail,
  confirmLabel,
  confirmationValue,
  expectedConfirmation,
  danger = false,
  busy = false,
  onCancel,
  onConfirm,
  extraAction,
}: {
  title: string;
  detail: string;
  confirmLabel: string;
  confirmationValue?: string;
  expectedConfirmation?: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  extraAction?: ReactNode;
}) {
  const [typed, setTyped] = useState(confirmationValue || "");
  const titleId = useId();
  const surfaceRef = useDialogSurface(() => { if (!busy) onCancel(); });
  const canConfirm = !expectedConfirmation || typed.trim() === expectedConfirmation.trim();
  return (
    <DialogPortal>
      <div className="settings-confirm-backdrop" role="presentation">
        <section ref={surfaceRef} className="settings-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
          <h2 id={titleId}>{title}</h2><p>{detail}</p>
          {expectedConfirmation && <label>Escribe <strong>{expectedConfirmation}</strong> para confirmar<input data-dialog-initial-focus value={typed} onChange={(event) => setTyped(event.target.value)} /></label>}
          <footer>{extraAction}<button className="button button-secondary" type="button" disabled={busy} onClick={onCancel}>Seguir editando</button><button className={`button ${danger ? "button-danger" : "button-primary"}`} type="button" disabled={!canConfirm || busy} onClick={onConfirm}>{busy ? "Procesando..." : confirmLabel}</button></footer>
        </section>
      </div>
    </DialogPortal>
  );
}
