import { CheckCircle2, ChefHat, ChevronDown, ChevronRight, CircleX, Clipboard, Pencil, ExternalLink, MapPin, MessageCircle, PackageCheck, Plus, Printer, ShieldCheck, Truck, XCircle } from "lucide-react";
import type { KitchenTicket, OrderDetail } from "../types";
import { appendAllowed, countLabel, formatChannel, hasOpenPaymentEvidence, nextAction, orderLocation } from "../lib/order-detail-model";
import { deliveryServices, getDeliveryService, isActiveOrderItem, isOrderEditable, whatsappPhone } from "../lib/order-presentation";
import { formatPosDate } from "../lib/pos-dates";
import { requestOrderPrinting } from "../lib/print-events";
import { OrderIdentity } from "./OrderIdentity";
import { OrderActionsMenu } from "./OrderActionsMenu";
import { OrderCommands } from "./OrderCommands";
import { Money, StatusPill } from "./ui";

type DetailContentProps = {
  canEdit: boolean;
  onEdit: () => void;
  onCopy: () => void;
  onEditTicket: (ticket: KitchenTicket) => void;
  onPrintTicket: (ticket: KitchenTicket) => void;
  order: OrderDetail;
  evidenceImage: string | null;
  deliveryExpanded: boolean;
  working: boolean;
  onDeliveryToggle: () => void;
  onPrint: () => void;
  onPayment: () => void;
  onAppend: () => void;
  onReview: (approve: boolean) => Promise<void>;
  onAdvance: () => void;
  onCancel: () => void;
};

function ReceiptAmount({ value }: { value: number }) {
  return <>{Number(value).toLocaleString("es-PE", { maximumFractionDigits: 2 })} S/</>;
}

export function OrderDetailContent({ order, evidenceImage, deliveryExpanded, working, canEdit, onEdit, onCopy, onEditTicket, onPrintTicket, onDeliveryToggle, onPrint, onPayment, onAppend, onReview, onAdvance, onCancel }: DetailContentProps) {
  const location = orderLocation(order);
  const action = nextAction(order);
  const evidence = order.payment_evidence;
  const phone = whatsappPhone(order.customer_phone);
  const canAppend = canEdit && appendAllowed(order);
  const source = order.source === "pos" ? "Punto de venta" : order.source === "public_store" ? "Menú digital" : ["agent", "integration", "n8n", "whatsapp_agent", "whatsapp"].includes(order.source) ? "WhatsApp" : order.source;
  return <div className="order-detail-content">
    <section className="order-detail-summary"><div><span>{formatPosDate(order.created_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span><OrderIdentity {...order} /><h3>{order.customer_name || "Cliente sin nombre"}</h3></div><div className="order-detail-top-actions"><button className="button button-secondary" disabled={working} onClick={onPrint}><Printer /> Imprimir pedido</button>{canEdit && order.remaining_amount > 0 && !["closed", "cancelled"].includes(order.status) && !hasOpenPaymentEvidence(order) && <button className="button button-primary" disabled={working} onClick={onPayment}>Cobrar <ReceiptAmount value={order.remaining_amount} /></button>}<OrderActionsMenu floating label="Acciones del pedido" disabled={working} actions={[
      { label: "Editar pedido", icon: <Pencil />, disabled: !canEdit || !isOrderEditable(order), onSelect: onEdit },
      { label: "Copiar pedido", icon: <Clipboard />, onSelect: onCopy },
      { label: "Revisar impresión automática", icon: <Printer />, disabled: !canEdit, onSelect: () => requestOrderPrinting({ orderId: order.id, branchId: order.branch_id, review: true }) },
      { label: "Contactar cliente", icon: <MessageCircle />, disabled: !phone, reason: !phone ? "El pedido no tiene un teléfono válido." : undefined, onSelect: () => { if (phone) window.open(`https://wa.me/${phone}`, "_blank", "noopener,noreferrer"); } },
      { label: "Cancelar pedido", icon: <CircleX />, danger: true, disabled: !canEdit || ["closed", "cancelled", "delivered"].includes(order.status) || hasOpenPaymentEvidence(order), onSelect: onCancel },
    ]} /></div></section>
    <div className="order-detail-tags"><span>{countLabel(order.items.filter(isActiveOrderItem).reduce((sum, item) => sum + item.quantity, 0), "producto", "productos")}</span><span className={`order-channel channel-${order.channel}`}>{formatChannel(order.channel)}</span><span className="order-source">{source}</span><StatusPill value={order.status} />{order.channel === "delivery" && getDeliveryService(order) !== "own" && <span>{deliveryServices[getDeliveryService(order)]}{order.delivery_address?.service_order_id ? ` · ${order.delivery_address.service_order_id}` : ""}</span>}</div>
    {order.channel === "delivery" && <section className="order-detail-delivery"><button onClick={onDeliveryToggle}><MapPin /><span>Datos de envío</span><ChevronDown className={deliveryExpanded ? "open" : ""} /></button>{deliveryExpanded && <div><span><small>Dirección</small><strong>{location.line || "Dirección pendiente"}</strong></span>{location.reference && <span><small>Referencia</small><strong>{location.reference}</strong></span>}{location.mapsUrl && <a href={location.mapsUrl} target="_blank" rel="noreferrer">Abrir ubicación <ExternalLink /></a>}</div>}</section>}
    <OrderCommands order={order} editable={canAppend} busy={working} onEdit={onEditTicket} onPrint={onPrintTicket} />
    {canAppend && <div><button className="button button-secondary" disabled={working} onClick={onAppend}><Plus /> Agregar productos</button></div>}
    {order.notes && <section className="order-detail-note"><strong>Comentario adicional</strong><p>{order.notes}</p></section>}
    {evidence && <section className={`payment-review-card review-${evidence.status}`}><div className="payment-evidence-image">{evidenceImage ? <img src={evidenceImage} alt={`Comprobante ${evidence.provider}`} /> : <span><ShieldCheck /> Cargando comprobante privado...</span>}</div><div className="payment-evidence-data"><div className="counter-block-title"><span>Comprobante {evidence.provider.toUpperCase()}</span><StatusPill value={evidence.status} /></div><dl><div><dt>Monto detectado</dt><dd>{evidence.amount_detected == null ? "Por revisar" : <Money value={evidence.amount_detected} />}</dd></div><div><dt>Número de operación</dt><dd>{evidence.operation_number || "No legible"}</dd></div><div><dt>Código de seguridad</dt><dd className="security-code">{evidence.security_code || "---"}</dd></div><div><dt>Destinatario</dt><dd>{evidence.recipient || "Por revisar"}</dd></div></dl>{evidence.warnings.length > 0 && <p className="evidence-warning">Revisar: {evidence.warnings.join(" · ")}</p>}{["evidence_received", "under_review"].includes(evidence.status) && <div className="review-actions"><button className="button button-success" disabled={working} onClick={() => void onReview(true)}><CheckCircle2 /> Aprobar pago y preparar</button><button className="button button-danger" disabled={working} onClick={() => void onReview(false)}><XCircle /> Rechazar comprobante</button></div>}</div></section>}
    <section className="order-detail-payments"><header><span>Pagos</span>{order.payment_status === "pending" ? <span className="order-pending-payment">Pago pendiente</span> : <StatusPill value={order.payment_status} />}</header>{order.payments.length > 0 && <div className="order-payment-list">{order.payments.map((payment) => <span key={payment.id}><i>{payment.method}</i><strong><ReceiptAmount value={payment.amount} /></strong></span>)}</div>}<div className="order-balance"><span><span>Productos</span><span><ReceiptAmount value={order.subtotal} /></span></span>{order.delivery_fee > 0 && <span><span>Costo de envío</span><span><ReceiptAmount value={order.delivery_fee} /></span></span>}{order.discount > 0 && <span><span>Descuento</span><span>-<ReceiptAmount value={order.discount} /></span></span>}<strong><span>Total</span><span><ReceiptAmount value={order.total} /></span></strong><span><span>Monto cobrado</span><span><ReceiptAmount value={order.paid_amount} /></span></span><span><span>Monto restante</span><span><ReceiptAmount value={order.remaining_amount} /></span></span></div></section>
    {action && canEdit && <section className="order-detail-tools order-detail-tools-actions-only"><button className="button button-primary" disabled={working} onClick={onAdvance}>{action.kind === "kitchen" ? <ChefHat /> : action.kind === "dispatched" ? <Truck /> : <PackageCheck />}{action.label}<ChevronRight /></button></section>}
  </div>;
}
