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

export function nextAction(order: OrderDetail) {
  if (hasOpenPaymentEvidence(order)) return null;
  if (["draft", "pending_confirmation", "confirmed"].includes(order.status) && order.items.some(isActiveOrderItem)) return { label: "Enviar a cocina", kind: "kitchen" };
  if (order.status === "sent_to_kitchen") return null;
  if (order.status === "preparing") return null;
  const pendingRequests = (order.payment_requests || []).some((request) =>
    request.purpose === "addition" ? ["pending", "under_review"].includes(request.status)
      : request.method === "unselected" || (request.method === "yape" && request.status !== "paid"));
  if (pendingRequests || order.delivery_fee_status === "pending_quote") return null;
  if (order.status === "ready" && order.channel === "delivery") return { label: "Despachar delivery", kind: "dispatched" };
  if (order.status === "ready" && ["agent", "n8n", "whatsapp", "whatsapp_agent"].includes(order.source)) {
    if (order.channel === "takeaway") return { label: "Marcar recogido", kind: "delivered" };
    if (order.channel === "counter") return { label: "Marcar servido", kind: "delivered" };
  }
  if (order.status === "dispatched") return { label: "Marcar entregado", kind: "delivered" };
  return null;
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
