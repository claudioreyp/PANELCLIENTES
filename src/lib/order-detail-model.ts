import type { Order, OrderDetail } from "../types";
import { isActiveOrderItem } from "./order-presentation";

export function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function hasOpenPaymentEvidence(order: OrderDetail) {
  const evidence = order.payment_evidences || (order.payment_evidence ? [order.payment_evidence] : []);
  return evidence.some((item) => ["evidence_received", "under_review"].includes(item.status))
    || ["evidence_received", "under_review"].includes(order.payment_status);
}

export function activePaymentRequests(order: OrderDetail) {
  return (order.payment_requests || []).filter(request => !["superseded", "waived", "cancelled", "declined"].includes(request.status));
}

export function pendingDeliveryPayment(order: OrderDetail) {
  const requests = activePaymentRequests(order).filter(request => request.purpose === "delivery");
  return requests.length === 1 && requests[0].status !== "paid" && !requests[0].payment_id ? requests[0] : undefined;
}

type OrderNextAction = { label: string; kind: string; disabledReason?: string; requiresCourierCollection?: boolean };

export function nextAction(order: OrderDetail): OrderNextAction | null {
  let action: OrderNextAction | null = null;
  if (["draft", "pending_confirmation", "confirmed"].includes(order.status) && order.items.some(isActiveOrderItem)) action = { label: "Enviar a cocina", kind: "kitchen" };
  if (order.status === "ready" && order.channel === "delivery") action = { label: "Despachar delivery", kind: "dispatched" };
  if (order.status === "ready" && ["agent", "n8n", "whatsapp", "whatsapp_agent"].includes(order.source)) {
    if (order.channel === "takeaway") action = { label: "Marcar recogido", kind: "delivered" };
    if (order.channel === "counter") action = { label: "Marcar servido", kind: "delivered" };
  }
  if (order.status === "dispatched") action = { label: "Marcar entregado", kind: "delivered" };
  if (!action) return null;
  const evidence = order.payment_evidences || (order.payment_evidence ? [order.payment_evidence] : []);
  const openEvidence = evidence.filter(item => ["evidence_received", "under_review"].includes(item.status));
  const requests = activePaymentRequests(order);
  const blockedReceipt = openEvidence.some(item => action.kind !== "dispatched" || !requests.some(request => request.id === item.payment_request_id && request.purpose === "delivery"));
  if (blockedReceipt || (!openEvidence.length && ["evidence_received", "under_review"].includes(order.payment_status))) return { ...action, disabledReason: "Revisa los comprobantes pendientes antes de continuar." };
  if (action.kind === "kitchen") return action;
  if (requests.some(request => request.purpose === "addition" && ["pending", "under_review", "awaiting_base_review", "requires_review"].includes(request.status))) return { ...action, disabledReason: "Resuelve los productos adicionales pendientes antes de continuar." };
  if (order.delivery_fee_status === "pending_quote") return { ...action, disabledReason: "Confirma el costo de envío antes de continuar." };
  if (order.channel !== "delivery") return action;
  if (requests.filter(request => request.purpose === "delivery").length > 1) return { ...action, disabledReason: "Revisa las solicitudes de cobro del envío antes de continuar." };
  if (requests.some(request => request.purpose === "delivery" && request.method === "unselected")) return { ...action, disabledReason: "Define cómo se cobrará el envío antes de continuar." };
  if (["agent", "n8n", "whatsapp", "whatsapp_agent"].includes(order.source) && order.payment_method === "yape" && !evidence.some(item => !item.payment_request_id && item.status === "paid")) return { ...action, disabledReason: "Aprueba el pago de los productos antes de continuar." };
  if (action.kind === "delivered" && requests.some(request => request.purpose === "delivery" && request.method === "yape" && request.status !== "paid")) return { ...action, requiresCourierCollection: true };
  return action;
}

export function orderLocation(order: Order) {
  const address = order.delivery_address || {};
  const urlKeys = ["maps_url", "google_maps_url", "map_url", "url"];
  const url = urlKeys.map((key) => address[key]).find((value) => typeof value === "string") as string | undefined;
  const latitude = address.latitude ?? address.lat;
  const longitude = address.longitude ?? address.lng;
  const mapsUrl = url || (latitude && longitude ? `https://www.google.com/maps?q=${latitude},${longitude}` : null);
  const line = [address.address, address.street, address.number, address.district]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(" · ");
  const reference = String(address.reference || address.notes || "");
  return { mapsUrl, line, reference };
}

export function formatChannel(channel: string) {
  const labels: Record<string, string> = {
    whatsapp: "WhatsApp",
    delivery: "Domicilio",
    takeaway: "Para llevar",
    counter: "Para comer aquí",
    dine_in: "Mesa",
    online: "Menú digital",
  };
  return labels[channel] || channel.replaceAll("_", " ");
}

export function appendAllowed(order: OrderDetail) {
  const allowedStatus = ["draft", "pending_confirmation", "confirmed", "sent_to_kitchen", "preparing", "ready"].includes(order.status);
  return allowedStatus
    && !order.checkout_started_at
    && !order.table_released_at
    && order.paid_amount <= 0
    && !hasOpenPaymentEvidence(order);
}
