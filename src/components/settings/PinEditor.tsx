import { Delete, X } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useDialogSurface } from "../../lib/dialog";
import "./PinEditor.css";

type PinEditorProps = {
  value: string;
  onChange: (value: string) => void;
  preserveExisting?: boolean;
  disabled?: boolean;
};

export function PinEditor({ value, onChange, preserveExisting = false, disabled = false }: PinEditorProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const incomplete = value.length > 0 && !/^\d{4}$/.test(value);

  // A save or permission change must not reopen a stale keypad when it finishes.
  if (open && disabled) setOpen(false);

  return (
    <div className="settings-pin-editor" role="group" aria-labelledby={`${id}-label`}>
      <span className="settings-pin-label" id={`${id}-label`}>PIN de acceso</span>
      <div className="settings-pin-anchor">
        <button
          ref={triggerRef}
          type="button"
          className="button button-secondary settings-pin-trigger"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? `${id}-popover` : undefined}
          aria-describedby={`${id}-hint${incomplete ? ` ${id}-error` : ""}`}
          disabled={disabled}
          onClick={() => {
            triggerRef.current?.focus();
            setOpen(!open);
          }}
        >{value ? "Editar PIN" : preserveExisting ? "Cambiar PIN" : "Agregar PIN"}</button>
        {open && !disabled && <PinPopover id={`${id}-popover`} value={value} onChange={onChange} preserveExisting={preserveExisting} onClose={() => setOpen(false)} />}
      </div>
      <small className="settings-pin-hint" id={`${id}-hint`}>
        {preserveExisting ? "Déjalo vacío para conservar el PIN actual. " : "Ingresa 4 dígitos. "}
        Se guarda al guardar el miembro y no se vuelve a mostrar. Para ingresar por PIN, vincula primero un dispositivo a la sucursal.
      </small>
      {incomplete && <small className="settings-pin-error" id={`${id}-error`}>Completa los 4 dígitos antes de guardar el miembro.</small>}
    </div>
  );
}

function PinPopover({ id, value, onChange, preserveExisting, onClose }: Omit<PinEditorProps, "disabled"> & { id: string; onClose: () => void }) {
  const surfaceRef = useDialogSurface<HTMLDivElement>(onClose);
  const displayRef = useRef<HTMLDivElement>(null);
  const [showError, setShowError] = useState(false);
  const complete = /^\d{4}$/.test(value) || (preserveExisting && value === "");

  function update(next: string) {
    setShowError(false);
    onChange(next);
    displayRef.current?.focus({ preventScroll: true });
  }

  function append(digit: string) {
    if (value.length < 4) update(value + digit);
  }

  function finish() {
    if (complete) onClose();
    else setShowError(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      append(event.key);
    } else if (event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      update(value.slice(0, -1));
    } else if (event.key === "Enter" && !(event.target instanceof HTMLElement && event.target.closest("button"))) {
      // Buttons retain native Enter/Space activation; Enter from the dots finishes.
      event.preventDefault();
      event.stopPropagation();
      finish();
    }
  }

  return (
    <div
      ref={surfaceRef}
      id={id}
      className="settings-pin-popover"
      role="dialog"
      aria-modal="true"
      aria-label="Editar PIN de acceso"
      aria-describedby={`${id}-instructions`}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <span className="settings-pin-sr-only" id={`${id}-instructions`}>
        Usa los números del teclado o los botones. Retroceso borra el último dígito.
        Intro desde los puntos termina la edición. Escape cierra solo el PIN y conserva el borrador.
      </span>
      <div
        ref={displayRef}
        className="settings-pin-display"
        role="group"
        aria-label="PIN del miembro"
        aria-describedby={`${id}-count`}
        tabIndex={0}
        data-dialog-initial-focus
      >
        <span className="settings-pin-dots" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => <span key={index} className={`settings-pin-dot${index < value.length ? " is-filled" : ""}`} />)}
        </span>
      </div>
      <span className="settings-pin-sr-only" id={`${id}-count`} role="status" aria-live="polite" aria-atomic="true">{value.length} de 4 dígitos ingresados.</span>
      <div className="settings-pin-keypad" role="group" aria-label="Teclado numérico">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <button key={digit} className="settings-pin-key" type="button" onClick={() => append(digit)}>{digit}</button>
        ))}
        <button className="settings-pin-key settings-pin-key-utility" type="button" aria-label="Limpiar PIN" onClick={() => update("")}><X aria-hidden="true" /></button>
        <button className="settings-pin-key" type="button" onClick={() => append("0")}>0</button>
        <button className="settings-pin-key settings-pin-key-utility" type="button" aria-label="Borrar último dígito" onClick={() => update(value.slice(0, -1))}><Delete aria-hidden="true" /></button>
      </div>
      {showError && <small className="settings-pin-error" role="alert">Ingresa exactamente 4 dígitos para terminar.</small>}
      <div className="settings-pin-footer">
        <button className="button button-secondary" type="button" aria-label="Cerrar PIN" onClick={onClose}>Cerrar</button>
        <button className="button button-secondary" type="button" onClick={finish}>Listo</button>
      </div>
    </div>
  );
}
