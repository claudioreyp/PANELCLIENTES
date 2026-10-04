import { ChefHat, ChevronDown, ChevronRight, CircleX, Clipboard, Pencil, ExternalLink, MapPin, MessageCircle, PackageCheck, Plus, Printer, Truck } from "lucide-react";
import type { KitchenTicket, OrderDetail, PaymentEvidence } from "../types";
import { appendAllowed, countLabel, formatChannel, hasOpenPaymentEvidence, nextAction, orderLocation } from "../lib/order-detail-model";
import { agentAdditionLabel, deliveryServices, getDeliveryService, isActiveOrderItem, isOrderEditable, whatsappPhone } from "../lib/order-presentation";
import { formatPosDate } from "../lib/pos-dates";
import { requestOrderPrinting } from "../lib/print-events";
import { OrderIdentity } from "./OrderIdentity";
import { OrderActionsMenu } from "./OrderActionsMenu";
import { OrderCommands } from "./OrderCommands";
import { StatusPill } from "./ui";

import { OrderEvidenceHistory } from "./OrderEvidenceHistory";
import { OrderDeliveryFee } from "./OrderDeliveryFee";
import { OrderFinancials } from "./OrderFinancials";

type DetailContentProps = {
  canEdit: boolean;
  onEdit: () => void;
  onCopy: () => void;
  onEditTicket: (ticket: KitchenTicket) => void;
  onPrintTicket: (ticket: KitchenTicket) => void;
  order: OrderDetail;
  evidenceImage?: string | null;
  onRefresh?: () => Promise<void>;
  deliveryExpanded: boolean;
  working: boolean;
  onDeliveryToggle: () => void;
  onPrint: () => void;
  onPayment: () => void;
  onReleaseTable?: () => void;
  onAppend: () => void;
  onReview: (approve: boolean, evidence?: PaymentEvidence) => Promise<void>;
  onAdvance: () => void;
  onCancel: () => void;
};

function ReceiptAmount({ value }: { value: number }) {
  return <>{Number(value).toLocaleString("es-PE", { maximumFractionDigits: 2 })} S/</>;
}

export function OrderDetailContent({ order, onRefresh, deliveryExpanded, working, canEdit, onEdit, onCopy, onEditTicket, onPrintTicket, onDeliveryToggle, onPrint, onPayment, onReleaseTable, onAppend, onReview, onAdvance, onCancel }: DetailContentProps) {
  const location = orderLocation(order);
  const action = nextAction(order);
  const phone = whatsappPhone(order.customer_phone);
  const canAppend = canEdit && appendAllowed(order);
  const canReleaseTable = canEdit && onReleaseTable && order.channel === "dine_in" && Boolean(order.table_id) && !order.table_released_at && order.remaining_amount === 0 && order.items.some(isActiveOrderItem) && order.status !== "cancelled" && !hasOpenPaymentEvidence(order);
  const additionLabel = agentAdditionLabel(order.recent_agent_addition);
  const source = order.source === "pos" ? "Punto de venta" : order.source === "public_store" ? "Menú digital" : ["agent", "integration", "n8n", "whatsapp_agent", "whatsapp"].includes(order.source) ? "WhatsApp" : order.source;
  return <div className="order-detail-content">
    {order.status === "cancelled" && <section className="order-cancellation-notice" role="note"><CircleX aria-hidden="true" /><div><strong>Este pedido fue cancelado</strong><p>{order.cancellation_reason?.trim() || "Motivo no registrado"}</p></div></section>}
    <section className="order-detail-summary"><div><span>{formatPosDate(order.created_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span><OrderIdentity {...order} /><h3>{order.customer_name || "Cliente sin nombre"}</h3></div><div className="order-detail-top-actions"><button className="button button-secondary" disabled={working} onClick={onPrint}><Printer /> Imprimir pedido</button>{canEdit && order.remaining_amount > 0 && !["closed", "cancelled"].includes(order.status) && !hasOpenPaymentEvidence(order) && <button className="button button-primary" disabled={working} onClick={onPayment}>Cobrar <ReceiptAmount value={order.remaining_amount} /></button>}{canReleaseTable && <button className="button button-primary" disabled={working} onClick={onReleaseTable}>Liberar mesa</button>}<OrderActionsMenu floating label="Acciones del pedido" disabled={working} actions={[
      { label: "Editar pedido", icon: <Pencil />, disabled: !canEdit || !isOrderEditable(order), onSelect: onEdit },
      { label: "Copiar pedido", icon: <Clipboard />, onSelect: onCopy },
      { label: "Revisar impresión automática", icon: <Printer />, disabled: !canEdit, onSelect: () => requestOrderPrinting({ orderId: order.id, branchId: order.branch_id, review: true }) },
      { label: "Contactar cliente", icon: <MessageCircle />, disabled: !phone, reason: !phone ? "El pedido no tiene un teléfono válido." : undefined, onSelect: () => { if (phone) window.open(`https://wa.me/${phone}`, "_blank", "noopener,noreferrer"); } },
      { label: "Cancelar pedido", icon: <CircleX />, danger: true, disabled: !canEdit || ["closed", "cancelled", "delivered"].includes(order.status) || hasOpenPaymentEvidence(order), onSelect: onCancel },
    ]} /></div></section>
    {!additionLabel && order.recent_modification?.source === "agent" && <section className="order-agent-change-notice" aria-label="Cambio realizado por el agente"><Pencil aria-hidden="true" /><div><strong>El agente modificó este pedido</strong><time dateTime={order.recent_modification.at}>{formatPosDate(order.recent_modification.at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</time><p>{order.recent_modification.summary || "Se actualizaron los datos del pedido."}</p><small>Revisa los datos del pedido antes de continuar.</small></div></section>}
    {additionLabel && order.recent_agent_addition && <section className="order-agent-change-notice order-agent-addition-notice" aria-label="Productos agregados por el agente"><Plus aria-hidden="true" /><div><strong>{additionLabel}</strong><time dateTime={order.recent_agent_addition.at}>{formatPosDate(order.recent_agent_addition.at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</time><p>{order.recent_agent_addition.summary || `${countLabel(order.recent_agent_addition.item_count, "producto agregado", "productos agregados")}.`}</p></div></section>}
    <div className="order-detail-tags"><span>{countLabel(order.items.filter(isActiveOrderItem).reduce((sum, item) => sum + item.quantity, 0), "producto", "productos")}</span><span className={`order-channel channel-${order.channel}`}>{formatChannel(order.channel)}</span><span className="order-source">{source}</span><StatusPill value={order.status} />{order.channel === "delivery" && getDeliveryService(order) !== "own" && <span>{deliveryServices[getDeliveryService(order)]}{order.delivery_address?.service_order_id ? ` · ${order.delivery_address.service_order_id}` : ""}</span>}</div>
    {order.channel === "delivery" && <section className="order-detail-delivery"><button onClick={onDeliveryToggle}><MapPin /><span>Datos de envío</span><ChevronDown className={deliveryExpanded ? "open" : ""} /></button>{deliveryExpanded && <div><span><small>Dirección</small><strong>{location.line || "Dirección pendiente"}</strong></span>{location.reference && <span><small>Referencia</small><strong>{location.reference}</strong></span>}{location.mapsUrl && <a href={location.mapsUrl} target="_blank" rel="noreferrer">Abrir ubicación <ExternalLink /></a>}</div>}</section>}
    <OrderCommands order={order} editable={canAppend} busy={working} onEdit={onEditTicket} onPrint={onPrintTicket} />
    {canAppend && <div><button className="button button-secondary" disabled={working} onClick={onAppend}><Plus /> Agregar productos</button></div>}
    {order.notes && <section className="order-detail-note"><strong>Comentario adicional</strong><p>{order.notes}</p></section>}
    <OrderEvidenceHistory order={order} working={working} onReview={onReview} />
    <OrderFinancials order={order} />
    {onRefresh && <OrderDeliveryFee order={order} onSaved={onRefresh} />}
    {action && canEdit && <section className="order-detail-tools order-detail-tools-actions-only"><button className="button button-primary" disabled={working} onClick={onAdvance}>{action.kind === "kitchen" ? <ChefHat /> : action.kind === "dispatched" ? <Truck /> : <PackageCheck />}{action.label}<ChevronRight /></button></section>}
  </div>;
}
