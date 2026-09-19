import { ArrowRight, ChevronDown, Eye, Minus, Plus, ShoppingBag, TableProperties, Trash2, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError, isTransportError } from "../lib/api";
import { loadOrderDetail } from "../lib/orders";
import { requestOrderPrinting } from "../lib/print-events";
import { DialogPortal, useDialogSurface } from "../lib/dialog";
import {
  changeOrderLineQuantity,
  modifierSelectionLabel,
  productSupportsOrderChannel,
  serializeOrderCart,
  type OrderCartLine,
  type OrderDraftChannel,
} from "../lib/order-builder";
import type { Branch, Catalog, RestaurantTable } from "../types";
import { NewOrderPaymentModal, type NewOrderCheckoutSelection } from "./NewOrderPaymentModal";
import { Money } from "./ui";
import { OrderProductPicker } from "./OrderProductPicker";
import { OrderBreakdown } from "./OrderBreakdown";
import { draftOrderPresentation } from "../lib/order-presentation";
import { emptyDeliveryAddress, parseManualDeliveryFee, serializeDeliveryAddress } from "../lib/order-delivery";
import { useOrderDelivery, type DeliveryFeeConfirmation } from "../lib/use-order-delivery";
import { NewOrderDeliveryFields } from "./NewOrderDeliveryFields";

export type NewOrderCompletion = {
  orderId: number;
  outcome: "pending_and_sent" | "paid_and_sent" | "payment_failed" | "confirmation_failed" | "total_changed";
  message?: string;
};

type NewOrderDrawerProps = {
  branch: Branch;
  catalog: Catalog;
  onClose: () => void;
  onCreated: (completion: NewOrderCompletion) => void;
  onError: (message: string) => void;
  initialChannel?: OrderDraftChannel;
  table?: Pick<RestaurantTable, "id" | "name" | "capacity"> | null;
};

const channelDescriptions: Record<OrderDraftChannel, string> = {
  dine_in: "Pedido abierto para una mesa del salón.",
  counter: "Pedido anticipado para consumir en el local, sin mesa asignada.",
  takeaway: "El cliente recogerá el pedido en el restaurante.",
  delivery: "Entrega con el reparto propio del restaurante.",
};

function channelLabel(channel: OrderDraftChannel) {
  if (channel === "dine_in") return "Mesa";
  if (channel === "counter") return "Para comer aquí";
  if (channel === "takeaway") return "Para llevar";
  return "Domicilio";
}

export function NewOrderDrawer({ branch, catalog, onClose, onCreated, onError, initialChannel = "counter", table = null }: NewOrderDrawerProps) {
  const titleId = useId();
  const [channel, setChannel] = useState<OrderDraftChannel>(initialChannel);
  const [cart, setCart] = useState<OrderCartLine[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState(emptyDeliveryAddress);
  const [feeInput, setFeeInput] = useState("");
  const [feeConfirmation, setFeeConfirmation] = useState<DeliveryFeeConfirmation | null>(null);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [commentEnabled, setCommentEnabled] = useState(false);
  const [notes, setNotes] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [checkout, setCheckout] = useState<{ scope: string; identity: symbol; total: number; fee: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [creationPending, setCreationPending] = useState(false);
  const continueRef = useRef<HTMLButtonElement>(null);
  const restoreCheckoutFocus = useRef(false);
  const processingRef = useRef(false);
  const saveIntent = useRef<{ signature: string; key: string; scope: string; total: number; order?: { id: number; total?: number; version?: number }; pending: boolean } | null>(null);
  const paymentIntents = useRef(new Map<string, string>());
  const confirmationIntent = useRef<{ signature: string; key: string; body: string } | null>(null);
  const dirty = channel !== initialChannel || cart.length > 0 || customerName !== "" || customerPhone !== "" || JSON.stringify(deliveryAddress) !== JSON.stringify(emptyDeliveryAddress) || feeInput !== "" || notes !== "";
  const { lines: previewLines, pricing } = draftOrderPresentation(cart, catalog, channel);
  const subtotal = pricing.subtotal;
  const scope = `${branch.business_id}:${branch.id}`;
  const lifetime = useRef<{ active: boolean; scope: string }>({ active: true, scope });
  useLayoutEffect(() => {
    const current = { active: true, scope };
    lifetime.current = current;
    return () => { current.active = false; };
  }, [scope]);
  const destination = serializeDeliveryAddress(deliveryAddress);
  const delivery = useOrderDelivery({ branchId: branch.id, scope, enabled: channel === "delivery", subtotal, cartSignature: JSON.stringify([cart, pricing.total, feeInput]), destination });
  const configuredFee = delivery.policy?.mode === "fixed" ? delivery.policy.fixedFee : delivery.policy?.mode === "free" ? 0 : null;
  const deliveryFee = channel !== "delivery" ? 0 : delivery.quote ? delivery.quote.fee : configuredFee;
  const previewTotal = deliveryFee === null ? null : pricing.total + deliveryFee;
  const checkoutOpen = checkout !== null && checkout.scope === scope && (creationPending || checkout.identity === delivery.identity);
  const confirmedFee = feeConfirmation?.identity === delivery.identity && feeConfirmation.version === delivery.policy?.version;

  function requestClose() {
    if (processingRef.current) return;
    if (saveIntent.current?.pending) { onError("Falta verificar la creación del pedido. Reintenta la confirmación para recuperar el mismo pedido antes de cerrar."); return; }
    if (dirty && !window.confirm("¿Cerrar el nuevo pedido? Los cambios que no guardaste se perderán.")) return;
    delivery.cancel();
    onClose();
  }

  const surfaceRef = useDialogSurface(requestClose);

  useEffect(() => {
    if (checkoutOpen || !restoreCheckoutFocus.current) return;
    // Wait for the payment dialog's cleanup. Its opener may have blurred while
    // Continue was disabled during the asynchronous quote request.
    const timer = window.setTimeout(() => {
      restoreCheckoutFocus.current = false;
      const surface = surfaceRef.current;
      const target = continueRef.current;
      if (!surface || !target?.isConnected || target.disabled || surface.closest('[hidden], [inert], [aria-hidden="true"]')) return;
      const focusedDialog = document.activeElement?.closest('[role="dialog"], [role="alertdialog"]');
      if (focusedDialog !== surface) return;
      const higherDialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')).some((dialog) =>
        dialog !== surface && Boolean(surface.compareDocumentPosition(dialog) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !dialog.closest('[hidden], [inert], [aria-hidden="true"]') && window.getComputedStyle(dialog).display !== "none",
      );
      if (!higherDialog) target.focus({ preventScroll: true });
    });
    return () => window.clearTimeout(timer);
  }, [checkoutOpen, surfaceRef]);

  function changeChannel(nextChannel: OrderDraftChannel) {
    if (nextChannel === channel) return;
    const unsupportedProductIds = new Set(
      catalog.products
        .filter((product) => !productSupportsOrderChannel(product, nextChannel))
        .map((product) => product.id),
    );
    const removed = cart.filter((line) => unsupportedProductIds.has(line.productId));
    if (
      removed.length > 0
      && !window.confirm(
        `${removed.length === 1 ? "Un producto no está disponible" : `${removed.length} productos no están disponibles`} para ${channelLabel(nextChannel)}. ¿Cambiar la modalidad y retirarlos del pedido?`,
      )
    ) return;
    if (removed.length > 0) {
      setCart((current) => current.filter((line) => !unsupportedProductIds.has(line.productId)));
    }
    setChannel(nextChannel);
  }

  function validateOrder() {
    if (!cart.length) {
      onError("Agrega al menos un producto antes de continuar.");
      return false;
    }
    if (channel === "dine_in" && !table) {
      onError("Selecciona una mesa antes de guardar el pedido.");
      return false;
    }
    if (channel === "delivery" && (!customerName.trim() || !customerPhone.trim() || !deliveryAddress.street.trim() || !deliveryAddress.reference.trim())) {
      onError("Completa el nombre, teléfono, calle y referencias para el delivery.");
      return false;
    }
    return true;
  }

  async function continueToCheckout() {
    if (!validateOrder()) return;
    if (creationPending || processingRef.current) return;
    setDeliveryError(null);
    if (channel !== "delivery") { setCheckout({ scope, identity: delivery.identity, total: pricing.total, fee: 0 }); return; }
    try {
      const quote = await delivery.prepare(feeConfirmation);
      if (!quote) return;
      if (quote.requires_quote || quote.fee === null) {
        setDeliveryError("El envío está por cotizar. Ingresa y confirma el costo de envío antes de continuar.");
        return;
      }
      setCheckout({ scope, identity: delivery.identity, total: pricing.total + quote.fee, fee: quote.fee });
    } catch (error) {
      setDeliveryError(error instanceof Error ? error.message : "No se pudo cotizar el envío. Vuelve a continuar.");
    }
  }

  async function completeOrder(selection: NewOrderCheckoutSelection) {
    if (!validateOrder()) return;
    if (processingRef.current) return;
    if (!checkout || checkout.scope !== scope) return;
    if (saveIntent.current?.pending && saveIntent.current.scope !== scope) { onError("Regresa a la sucursal original para recuperar el pedido pendiente de confirmación."); return; }
    const current = lifetime.current;
    const stillHere = () => current.active && lifetime.current === current;
    processingRef.current = true;
    setSaving(true);
    try {
      let quotedFee = checkout.fee;
      let quoteId: string | undefined;
      if (!saveIntent.current?.pending && channel === "delivery") {
        const fresh = await delivery.prepare(feeConfirmation);
        if (!fresh || !stillHere()) return;
        if (fresh.requires_quote || fresh.fee === null || Math.abs(fresh.fee - checkout.fee) > 0.009) {
          setCheckout(null);
          setDeliveryError(fresh.requires_quote ? "El envío necesita una nueva cotización. Confirma su importe antes de continuar." : "El costo de envío cambió. Revisa el total y vuelve a continuar antes de cobrar.");
          return;
        }
        quotedFee = fresh.fee;
        quoteId = fresh.id;
      }
      if (!stillHere()) return;
      const payload = {
        branch_id: branch.id,
        channel,
        table_id: channel === "dine_in" ? table?.id : null,
        customer_name: customerName.trim() || null,
        customer_phone: customerPhone.trim() || null,
        delivery_address: channel === "delivery" ? destination : null,
        ...(quoteId ? { delivery_quote_id: quoteId } : {}),
        delivery_fee: quotedFee,
        discount: 0,
        notes: commentEnabled && notes.trim() ? notes.trim() : null,
        items: serializeOrderCart(cart),
      };
      const signature = JSON.stringify(payload);
      if (!saveIntent.current?.pending && (!saveIntent.current || saveIntent.current.signature !== signature)) {
        saveIntent.current = { signature, key: crypto.randomUUID(), scope, total: checkout.total, pending: false };
      }
      const intent = saveIntent.current!;
      intent.pending = true;
      setCreationPending(true);
      const order = intent.order || await api<{ id: number; total?: number; version?: number }>("/orders", {
        method: "POST",
        idempotencyKey: intent.key,
        body: intent.signature,
      });
      intent.order = order;
      if (!stillHere()) {
        onError("La sucursal cambió durante la creación. Regresa a la sucursal original para recuperar el mismo pedido; no se inició un cobro ni el envío a cocina.");
        return;
      }

      const authoritativeTotal = Number(order.total ?? intent.total);
      if (Math.abs(authoritativeTotal - intent.total) > 0.009) {
        saveIntent.current = null;
        paymentIntents.current.clear();
        onCreated({
          orderId: order.id,
          outcome: "total_changed",
          message: "El total cambió al aplicar las reglas del pedido. Revísalo antes de cobrar.",
        });
        return;
      }

      let expectedVersion = Number(order.version || 1);
      try {
        for (const payment of selection.deferPayment ? [] : selection.plan.payments) {
          if (!stillHere()) return;
          const note = payment.method === "cash" && payment.cashReceived != null
            ? `Efectivo recibido: ${payment.cashReceived.toFixed(2)} PEN. Cambio: ${selection.plan.change.toFixed(2)} PEN.`
            : undefined;
          const paymentSignature = JSON.stringify({
            order_id: order.id,
            method: payment.method,
            amount: payment.amount,
            cash_session_id: payment.cashSessionId || null,
            note: note || null,
          });
          let idempotencyKey = paymentIntents.current.get(paymentSignature);
          if (!idempotencyKey) {
            idempotencyKey = crypto.randomUUID();
            paymentIntents.current.set(paymentSignature, idempotencyKey);
          }
          const response = await api<{ order?: { version?: number } }>(`/orders/${order.id}/payments`, {
            method: "POST",
            idempotencyKey,
            body: JSON.stringify({
              method: payment.method,
              amount: payment.amount,
              cash_session_id: payment.cashSessionId || null,
              note,
              expected_version: expectedVersion,
            }),
          });
          expectedVersion = Number(response.order?.version || expectedVersion + 1);
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "No se pudo completar el cobro.";
        saveIntent.current = null;
        paymentIntents.current.clear();
        onCreated({
          orderId: order.id,
          outcome: "payment_failed",
          message: `El pedido se guardó, pero el cobro no terminó. Revisa sus pagos antes de reintentar. ${message}`,
        });
        return;
      }

      try {
        if (!stillHere()) return;
        const body = JSON.stringify({ expected_version: expectedVersion });
        const signature = `${order.id}:confirm:${expectedVersion}`;
        if (!confirmationIntent.current || confirmationIntent.current.signature !== signature) {
          confirmationIntent.current = { signature, key: crypto.randomUUID(), body };
        }
        await api(`/orders/${order.id}/confirm-and-send`, {
          method: "POST",
          idempotencyKey: confirmationIntent.current.key,
          body: confirmationIntent.current.body,
        });
      } catch (caught) {
        const persisted = isTransportError(caught) ? await loadOrderDetail(order.id, branch.id).catch(() => null) : null;
        if (!persisted?.kitchen_tickets.some((ticket) => ticket.items.length > 0)) {
          saveIntent.current = null;
          paymentIntents.current.clear();
          onCreated({
            orderId: order.id,
            outcome: "confirmation_failed",
            message: selection.deferPayment
              ? "No pudimos confirmar el envío a cocina. Revisa este pedido y usa Enviar a cocina para reintentar sin duplicarlo."
              : "El pago quedó registrado, pero no pudimos verificar el envío a cocina. Revisa el pedido antes de reintentar.",
          });
          return;
        }
        if (stillHere()) requestOrderPrinting({ orderId: order.id, branchId: branch.id, version: persisted.version });
      }

      saveIntent.current = null;
      paymentIntents.current.clear();
      confirmationIntent.current = null;
      if (stillHere()) {
        onCreated({ orderId: order.id, outcome: selection.deferPayment ? "pending_and_sent" : "paid_and_sent" });
      }
    } catch (caught) {
      // A definitive rejection did not create an order. An uncertain response must
      // retain the original quote/body/key, even if that quote subsequently expires.
      if (caught instanceof ApiError && caught.status >= 400 && caught.status < 500 && caught.status !== 408 && !saveIntent.current?.order) {
        saveIntent.current = null;
        if (channel === "delivery") setCheckout(null);
      }
      onError(caught instanceof Error ? caught.message : "No se pudo guardar el pedido.");
    } finally {
      processingRef.current = false;
      setSaving(false);
      setCreationPending(saveIntent.current?.pending === true);
    }
  }

  return (
    <DialogPortal>
      <div className="new-order-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
        <section
          ref={surfaceRef}
          className="new-order-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-hidden={checkoutOpen || undefined}
          inert={checkoutOpen || undefined}
          tabIndex={-1}
        >
          <header className="new-order-header"><div><h2 id={titleId}>Agrega un pedido</h2><span>Revisa el total y elige cómo cobrar antes de guardar.</span></div><div><button className="button button-secondary new-order-preview-toggle" aria-pressed={previewOpen} onClick={() => setPreviewOpen((current) => !current)}><Eye /> Vista previa</button><button className="icon-button" data-dialog-initial-focus aria-label="Cerrar nuevo pedido" onClick={requestClose}><X /></button></div></header>
          <div className="new-order-layout" inert={saving || creationPending || undefined}>
            <div className="new-order-form">
              <section className="new-order-section">
                <label className="new-order-select">Tipo de pedido<select value={channel} disabled={channel === "dine_in" && Boolean(table)} onChange={(event) => changeChannel(event.target.value as OrderDraftChannel)}>{table && <option value="dine_in">Mesa</option>}<option value="counter">Para comer aquí</option><option value="takeaway">Para llevar</option><option value="delivery">Domicilio</option></select><ChevronDown /></label>
                <p className="field-hint">{channelDescriptions[channel]}</p>
                {channel === "dine_in" && table && <div className="new-order-table-context"><TableProperties /><span><strong>{table.name}</strong><small>Capacidad para {table.capacity} personas</small></span></div>}
              </section>

              <section className="new-order-section">
                <div className="new-order-section-heading"><div><h3>Productos</h3><p>Agrega platos y configura sus opciones.</p></div><strong>{cart.reduce((sum, line) => sum + line.quantity, 0)}</strong></div>
                <button className="new-order-add-products" onClick={() => setPickerOpen(true)}><Plus /> {cart.length ? "Editar productos" : "Agregar productos"}</button>
                {cart.length > 0 && <div className="new-order-lines">{cart.map((line) => <article key={line.key}><div><strong>{line.name}{line.variantName ? ` · ${line.variantName}` : ""}</strong>{line.modifiers.length > 0 && <small>{modifierSelectionLabel(line.modifiers)}</small>}{line.notes && <small className="note">{line.notes}</small>}<b><Money value={line.unitPrice * line.quantity} /></b></div><div className="quantity-control"><button aria-label={`Quitar una unidad de ${line.name}`} onClick={() => setCart((current) => changeOrderLineQuantity(current, line.key, -1))}>{line.quantity === 1 ? <Trash2 /> : <Minus />}</button><strong>{line.quantity}</strong><button aria-label={`Agregar una unidad de ${line.name}`} onClick={() => setCart((current) => changeOrderLineQuantity(current, line.key, 1))}><Plus /></button></div></article>)}</div>}
              </section>

              <section className="new-order-section"><div className="new-order-section-heading"><div><h3>{channel === "delivery" ? "Datos del cliente" : "Cliente"}</h3><p>{channel === "delivery" ? "Necesario para coordinar la entrega." : channel === "takeaway" ? "Opcional para identificar el recojo." : channel === "dine_in" ? "Opcional para identificar la cuenta de la mesa." : "Opcional para identificar el pedido anticipado."}</p></div></div><div className="new-order-two-columns"><label>{channel === "delivery" ? "Nombre del cliente" : "Nombre"} {channel !== "delivery" && <span className="optional-label">opcional</span>}<input value={customerName} onChange={(event) => setCustomerName(event.target.value)} autoComplete="name" /></label><label>{channel === "delivery" ? "Número de teléfono" : "Teléfono"} {channel !== "delivery" && <span className="optional-label">opcional</span>}<input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} inputMode="tel" autoComplete="tel" /></label></div></section>

              {channel === "delivery" && <>
                <NewOrderDeliveryFields key={scope} value={deliveryAddress} onChange={(value) => { setDeliveryAddress(value); setDeliveryError(null); }} policy={delivery.policy} quote={delivery.quote} loading={delivery.loading} feeInput={feeInput} onFeeInput={(value) => { setFeeInput(value); setFeeConfirmation(null); setDeliveryError(null); }} confirmed={confirmedFee} onConfirmFee={() => {
                  const fee = parseManualDeliveryFee(feeInput);
                  if (fee !== null && delivery.policy) setFeeConfirmation({ identity: delivery.identity, version: delivery.policy.version, fee });
                }} />
                {(deliveryError || delivery.error) && <p className="new-order-delivery-feedback" role="alert">{deliveryError || delivery.error}</p>}
              </>}

              <section className="new-order-section"><label className="new-order-comment-toggle"><input type="checkbox" checked={commentEnabled} onChange={(event) => { setCommentEnabled(event.target.checked); if (!event.target.checked) setNotes(""); }} /><span>Comentario adicional</span></label>{commentEnabled && <textarea aria-label="Comentario adicional" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Observación general para cocina o atención" />}</section>
            </div>

            <aside className={`new-order-preview ${previewOpen ? "mobile-open" : ""}`} aria-label="Vista previa del pedido">
              <div className="new-order-preview-heading"><ShoppingBag /><span><strong>Vista previa</strong><small>{channel === "dine_in" && table ? `${table.name} · Mesa` : channelLabel(channel)}</small></span></div>
              {cart.length ? <OrderBreakdown lines={previewLines} /> : <div className="new-order-preview-empty"><ShoppingBag /><strong>El pedido está vacío</strong><span>Los productos seleccionados aparecerán aquí.</span></div>}
              <div className="new-order-preview-total"><span><span>Productos</span><span><Money value={subtotal} /></span></span>{pricing.discount > 0 && <span><span>Descuento</span><span>-<Money value={pricing.discount} /></span></span>}{channel === "delivery" && <span><span>Envío</span><span>{deliveryFee === null ? "Por cotizar" : <Money value={deliveryFee} />}</span></span>}<strong><span>Total</span><span>{previewTotal === null ? <span className="new-order-delivery-pending">Por cotizar</span> : <Money value={previewTotal} />}</span></strong></div>
            </aside>
          </div>
          <footer className="new-order-footer"><span>Al confirmar, enviaremos la comanda a cocina. Puedes cobrar ahora o después.</span><div><button className="button button-secondary" onClick={requestClose}>Cancelar</button><button ref={continueRef} className="button button-primary" disabled={saving || creationPending || delivery.busy || !cart.length} onClick={() => void continueToCheckout()}>{delivery.busy ? "Cotizando..." : "Continuar"} <ArrowRight /></button></div></footer>
        </section>
      </div>
      {pickerOpen && <OrderProductPicker catalog={catalog} channel={channel} initialLines={cart} onClose={() => setPickerOpen(false)} onSave={(lines) => { setCart(lines); setPickerOpen(false); }} />}
      {checkoutOpen && checkout && <NewOrderPaymentModal branch={branch} total={checkout.total} busy={saving} onClose={() => {
        if (saveIntent.current?.pending) { onError("Falta verificar la creación. Reintenta para recuperar el mismo pedido sin duplicarlo."); return; }
        restoreCheckoutFocus.current = true;
        delivery.cancel(); setCheckout(null);
      }} onConfirm={(selection) => void completeOrder(selection)} />}
    </DialogPortal>
  );
}
