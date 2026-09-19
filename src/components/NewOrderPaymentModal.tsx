import {
  Banknote,
  Clock3,
  CreditCard,
  Globe2,
  Landmark,
  Layers3,
  LoaderCircle,
  Smartphone,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "../lib/api";
import { DialogPortal, useDialogSurface } from "../lib/dialog";
import {
  buildCheckoutPaymentPlan,
  normalizeCheckoutPaymentMethods,
  paymentMethodLabel,
  type CheckoutMode,
  type CheckoutPaymentMethod,
  type CheckoutPaymentPlan,
  type CheckoutTenderValues,
} from "../lib/order-checkout";
import type { Branch } from "../types";
import { Money } from "./ui";

type Register = { id: number; name: string; active: boolean };
type CashSession = { id: number; register_id: number; status: string };

export type NewOrderCheckoutSelection = {
  deferPayment: boolean;
  mode: CheckoutMode;
  plan: CheckoutPaymentPlan;
};

type NewOrderPaymentModalProps = {
  branch: Branch;
  total: number;
  busy: boolean;
  allowDeferredPayment?: boolean;
  helperText?: string;
  onClose: () => void;
  onConfirm: (selection: NewOrderCheckoutSelection) => void;
};

const methodDescriptions: Record<CheckoutPaymentMethod, string> = {
  cash: "Registra lo recibido y calcula el cambio.",
  card: "Cobro presencial con tarjeta.",
  yape: "Pago confirmado por el operador en Yape.",
  plin: "Pago confirmado por el operador en Plin.",
  transfer: "Transferencia bancaria verificada.",
  online: "Pago confirmado por un canal digital.",
};

function MethodIcon({ method }: { method: CheckoutPaymentMethod }) {
  if (method === "cash") return <Banknote aria-hidden="true" />;
  if (method === "card") return <CreditCard aria-hidden="true" />;
  if (method === "transfer") return <Landmark aria-hidden="true" />;
  if (method === "online") return <Globe2 aria-hidden="true" />;
  return <Smartphone aria-hidden="true" />;
}

export function NewOrderPaymentModal({
  branch,
  total,
  busy,
  allowDeferredPayment = true,
  helperText,
  onClose,
  onConfirm,
}: NewOrderPaymentModalProps) {
  const titleId = useId();
  const errorId = useId();
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const modeSectionRef = useRef<HTMLElement | null>(null);
  const cashContextRef = useRef<HTMLDivElement | null>(null);
  const [deferPayment, setDeferPayment] = useState(false);
  const [mode, setMode] = useState<CheckoutMode>(null);
  const [tenders, setTenders] = useState<CheckoutTenderValues>({});
  const [submitted, setSubmitted] = useState(false);
  const [cashLoading, setCashLoading] = useState(false);
  const [cashLoadError, setCashLoadError] = useState<string | null>(null);
  const [registers, setRegisters] = useState<Register[]>([]);
  const [cashSessions, setCashSessions] = useState<CashSession[]>([]);
  const [cashSessionId, setCashSessionId] = useState<number | null>(null);
  const methods = normalizeCheckoutPaymentMethods(branch.accepted_payment_methods || []);
  const cashConfigured = (branch.accepted_payment_methods || []).some((method) => method.trim().toLowerCase() === "cash");
  const canCombine = methods.length > 1;
  const plan = buildCheckoutPaymentPlan({
    total,
    mode,
    tenders,
    cashSessionId,
    cashSessionRequired: cashSessions.length > 1,
  });
  const cashChange = Math.max(0, Number(tenders.cash || 0) - total);
  const usesCash = mode === "cash" || (mode === "multiple" && Number(tenders.cash || 0) > 0);
  const showPlanError = !deferPayment
    && Boolean(plan.error)
    && (submitted || (mode === "multiple" && plan.error?.includes("exceder el total")));
  const nonCashAllocationError = showPlanError && mode === "multiple" && plan.error?.includes("medios distintos al efectivo");
  const cashAllocationError = showPlanError && (mode === "cash" || (mode === "multiple" && !nonCashAllocationError));
  const cashSessionError = showPlanError && usesCash && plan.error?.includes("Selecciona la caja");
  const cashAmountError = cashAllocationError && !cashSessionError;

  const surfaceRef = useDialogSurface(() => {
    if (!busy) onClose();
  });

  useEffect(() => {
    if (!cashConfigured) return;
    let active = true;
    setCashLoading(true);
    Promise.all([
      api<Register[]>(`/cash/registers?branch_id=${branch.id}`),
      api<CashSession[]>(`/cash/sessions?branch_id=${branch.id}&status=open`),
    ])
      .then(([nextRegisters, nextSessions]) => {
        if (!active) return;
        const openSessions = nextSessions.filter((session) => session.status === "open");
        setRegisters(nextRegisters);
        setCashSessions(openSessions);
        setCashSessionId(openSessions.length === 1 ? openSessions[0].id : null);
        setCashLoadError(null);
      })
      .catch(() => {
        if (!active) return;
        setCashLoadError("No pudimos consultar los turnos de caja. Puedes cobrar con otro método o guardar el pago como pendiente.");
      })
      .finally(() => {
        if (active) setCashLoading(false);
      });
    return () => {
      active = false;
    };
  }, [branch.id, cashConfigured]);

  useEffect(() => {
    if (!showPlanError) return;
    const frame = window.requestAnimationFrame(() => {
      errorRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [plan.error, showPlanError]);

  useEffect(() => {
    if (mode !== "cash" && mode !== "multiple") return;
    const frame = window.requestAnimationFrame(() => {
      modeSectionRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  useEffect(() => {
    if (!usesCash || Number(tenders.cash || 0) <= 0) return;
    const frame = window.requestAnimationFrame(() => {
      cashContextRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [tenders.cash, usesCash]);

  function changeTender(method: CheckoutPaymentMethod, value: string) {
    setTenders((current) => ({ ...current, [method]: value === "" ? 0 : Number(value) }));
    setSubmitted(false);
  }

  function submit() {
    if (deferPayment) {
      onConfirm({ deferPayment: true, mode: null, plan: { payments: [], change: 0, error: null } });
      return;
    }
    setSubmitted(true);
    if (plan.error) {
      window.requestAnimationFrame(() => {
        errorRef.current?.scrollIntoView({ block: "nearest" });
        errorRef.current?.focus();
      });
      return;
    }
    onConfirm({ deferPayment: false, mode, plan });
  }

  const selectedCashSession = cashSessions.find((session) => session.id === cashSessionId);
  const selectedRegister = registers.find((register) => register.id === selectedCashSession?.register_id);

  return (
    <DialogPortal>
      <div className="new-order-payment-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
        <section ref={surfaceRef} className="new-order-payment-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1}>
          <header className="new-order-payment-summary">
            <button className="icon-button" aria-label="Cerrar cobro" onClick={onClose} disabled={busy}><X /></button>
            <span id={titleId}>Cobrar al cliente</span>
            <strong><Money value={total} /></strong>
            <small>{helperText || "Si registras el pago, el pedido se enviará directamente a cocina."}</small>
          </header>

          <div className="new-order-payment-content">
            {allowDeferredPayment && <label className={`new-order-defer-payment ${deferPayment ? "selected" : ""}`}>
              <input
                data-dialog-initial-focus
                type="checkbox"
                disabled={busy}
                checked={deferPayment}
                onChange={(event) => {
                  setDeferPayment(event.target.checked);
                  setSubmitted(false);
                }}
              />
              <Clock3 aria-hidden="true" />
              <span><strong>Cobrar después</strong><small>Se enviará la comanda a cocina y el pago quedará pendiente.</small></span>
            </label>}

            {!deferPayment && (
              <fieldset className="new-order-payment-methods" disabled={busy}>
                <legend>Método de pago</legend>
                {methods.map((method, index) => (
                  <label key={method} className={mode === method ? "selected" : ""}>
                    <input data-dialog-initial-focus={!allowDeferredPayment && index === 0 ? true : undefined} type="radio" name="new-order-payment-method" checked={mode === method} onChange={() => { setMode(method); setSubmitted(false); }} />
                    <span className={`new-order-payment-method-icon method-${method}`}><MethodIcon method={method} /></span>
                    <span><strong>{paymentMethodLabel(method)}</strong><small>{methodDescriptions[method]}</small></span>
                    <i aria-hidden="true" />
                  </label>
                ))}
                {canCombine && (
                  <label className={mode === "multiple" ? "selected" : ""}>
                    <input type="radio" name="new-order-payment-method" checked={mode === "multiple"} onChange={() => { setMode("multiple"); setSubmitted(false); }} />
                    <span className="new-order-payment-method-icon method-multiple"><Layers3 aria-hidden="true" /></span>
                    <span><strong>Múltiples métodos de pago</strong><small>Distribuye el total entre los medios aceptados.</small></span>
                    <i aria-hidden="true" />
                  </label>
                )}
                {!methods.length && <p className="new-order-payment-empty">No hay métodos de pago configurados para esta sucursal.{allowDeferredPayment ? " Guarda el pedido con pago pendiente." : " Configúralos antes de cobrar."}</p>}
              </fieldset>
            )}

            {!deferPayment && mode === "cash" && (
              <section ref={modeSectionRef} className="new-order-cash-entry" aria-label="Cobro en efectivo">
                <label>Cantidad recibida<input type="number" min="0" step="0.01" inputMode="decimal" value={tenders.cash || ""} onChange={(event) => changeTender("cash", event.target.value)} placeholder="S/ 0.00" disabled={busy} aria-invalid={cashAmountError || undefined} aria-describedby={cashAmountError ? errorId : undefined} /></label>
                {Number(tenders.cash || 0) >= total && <div><span>Cambio</span><strong><Money value={cashChange} /></strong></div>}
                {showPlanError && <p ref={errorRef} id={errorId} className="new-order-payment-error" role="alert" tabIndex={-1}>{plan.error}</p>}
              </section>
            )}

            {!deferPayment && mode === "multiple" && (
              <section ref={modeSectionRef} className="new-order-split-payment" aria-label="Distribución del cobro">
                <header><strong>Distribuye el cobro</strong><span>Total <Money value={total} /></span></header>
                {methods.map((method) => (
                  <label key={method} className={(method === "cash" ? cashAmountError : nonCashAllocationError) ? "invalid" : ""}>
                    <span className={`new-order-payment-method-icon method-${method}`}><MethodIcon method={method} /></span>
                    <span>{method === "cash" ? "Recibido en efectivo" : `Cobrado con ${paymentMethodLabel(method)}`}</span>
                    <input type="number" min="0" step="0.01" inputMode="decimal" value={tenders[method] || ""} onChange={(event) => changeTender(method, event.target.value)} placeholder="S/ 0.00" disabled={busy} aria-invalid={(method === "cash" ? cashAmountError : nonCashAllocationError) || undefined} aria-describedby={(method === "cash" ? cashAmountError : nonCashAllocationError) ? errorId : undefined} />
                  </label>
                ))}
                {!plan.error && plan.change > 0 && <div className="new-order-payment-change"><span>Cambio</span><strong><Money value={plan.change} /></strong></div>}
                {showPlanError && <p ref={errorRef} id={errorId} className="new-order-payment-error" role="alert" tabIndex={-1}>{plan.error}</p>}
              </section>
            )}

            {!deferPayment && usesCash && (
              <div ref={cashContextRef} className="new-order-cash-context">
                {cashSessions.length > 1 && !cashLoading && !cashLoadError ? (
                  <label className={`new-order-cash-session ${cashSessionError ? "invalid" : ""}`}>
                    Turno de caja
                    <select
                      value={cashSessionId || ""}
                      onChange={(event) => {
                        setCashSessionId(Number(event.target.value) || null);
                        setSubmitted(false);
                      }}
                      disabled={busy}
                      aria-invalid={cashSessionError || undefined}
                      aria-describedby={cashSessionError ? errorId : undefined}
                    >
                      <option value="">Selecciona el turno</option>
                      {cashSessions.map((session) => (
                        <option key={session.id} value={session.id}>
                          {registers.find((register) => register.id === session.register_id)?.name || `Caja ${session.register_id}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className={`new-order-cash-status ${cashLoadError ? "warning" : ""}`}>
                    {cashLoading ? <><LoaderCircle className="spin" /><span>Consultando caja...</span></> : selectedCashSession ? <><Banknote /><span>Se registrará en <strong>{selectedRegister?.name || `Caja ${selectedCashSession.register_id}`}</strong>.</span></> : <><Banknote /><span>{cashLoadError || "Caja Principal abrirá su período automáticamente al confirmar el cobro."}</span></>}
                  </div>
                )}
              </div>
            )}

            {showPlanError && mode !== "cash" && mode !== "multiple" && <p ref={errorRef} id={errorId} className="new-order-payment-error" role="alert" tabIndex={-1}>{plan.error}</p>}
          </div>

          <footer className="new-order-payment-actions">
            <button className="button button-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
            <button className="button button-primary" onClick={submit} disabled={busy || (!deferPayment && !mode)}>
              {busy && <LoaderCircle className="spin" />}
              {busy ? "Procesando..." : deferPayment ? "Enviar a cocina" : <>Cobrar <Money value={total} /></>}
            </button>
          </footer>
        </section>
      </div>
    </DialogPortal>
  );
}
