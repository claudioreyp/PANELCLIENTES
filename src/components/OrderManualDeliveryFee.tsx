import { useEffect, useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { parseManualDeliveryFee } from "../lib/order-delivery";
import type { OrderDetail } from "../types";
import "./order-manual-delivery-fee.css";

type Props = { order: OrderDetail; disabled?: boolean; onSaved: () => Promise<void> };

/** The manual POS tariff is an order edit, not an agent payment request. */
export function OrderManualDeliveryFee({ order, disabled, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const intent = useRef<{ key: string; body: string } | null>(null);
  const processing = useRef(false);
  const alive = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const parsedAmount = parseManualDeliveryFee(amount);
  const validAmount = parsedAmount !== null;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!processing.current && !uncertain && !root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, uncertain]);
  useEffect(() => {
    if (!busy && !uncertain) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [busy, uncertain]);

  function close() {
    if (processing.current || uncertain) return;
    setOpen(false);
    trigger.current?.focus();
  }

  async function save() {
    if (processing.current || disabled || (!confirmed && !uncertain && !validAmount)) return;
    processing.current = true; setBusy(true); setError(null);
    try {
      if (!confirmed) {
        intent.current ||= { key: crypto.randomUUID(), body: JSON.stringify({
          delivery_fee: parsedAmount, expected_version: order.version,
          expected_total: Math.round((Number(order.total) - Number(order.delivery_fee) + Number(parsedAmount)) * 100) / 100,
        }) };
        await api(`/orders/${order.id}`, { method: "PATCH", body: intent.current.body, idempotencyKey: intent.current.key });
        if (!alive.current) return;
        setConfirmed(true); setUncertain(false);
      }
      try {
        await onSaved();
        if (alive.current) { setOpen(false); trigger.current?.focus(); }
      } catch {
        if (alive.current) setError("El costo se guardó. Actualiza el pedido para consultar el total confirmado.");
      }
    } catch (caught) {
      if (!alive.current) return;
      const unknown = !(caught instanceof ApiError) || caught.status === 0 || caught.status === 408 || caught.status >= 500;
      setUncertain(unknown);
      if (!unknown) intent.current = null;
      setError(unknown ? "No pudimos confirmar el guardado. Reintenta la misma operación, sin duplicarla."
        : caught instanceof Error ? caught.message : "No se pudo guardar el costo de envío.");
    } finally { processing.current = false; if (alive.current) setBusy(false); }
  }

  return <div ref={root} className="order-manual-delivery-fee">
    <button ref={trigger} type="button" className="order-manual-fee-trigger" disabled={disabled || busy} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}><Plus aria-hidden="true" />Agregar costo de envío</button>
    {open && <form id={id} className="order-manual-fee-popover" aria-label="Costo de envío" onSubmit={event => { event.preventDefault(); void save(); }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <label htmlFor={`${id}-amount`}>Costo de envío</label>
      <div className="order-fee-input"><span>S/</span><input ref={input} id={`${id}-amount`} type="text" inputMode="decimal" placeholder="0.00" autoComplete="off" value={amount} disabled={busy || uncertain || confirmed} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={event => { setAmount(event.target.value.replace(",", ".")); setError(null); }} /></div>
      {error && <p id={`${id}-error`} role="alert">{error}</p>}
      <div className="order-manual-fee-actions"><button type="button" className="button button-secondary" disabled={busy || uncertain} onClick={close}>Cancelar</button><button type="submit" className="button button-primary" disabled={busy || (!uncertain && !confirmed && !validAmount)}>{busy ? "Guardando..." : confirmed ? "Actualizar pedido" : uncertain ? "Reintentar confirmación" : "Guardar"}</button></div>
    </form>}
  </div>;
}
