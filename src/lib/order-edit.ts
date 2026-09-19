import type { Order, OrderDetail } from "../types";
import { getDeliveryService, type DeliveryService, whatsappPhone } from "./order-presentation";

export type OrderEditDraft = {
  channel: string; service: DeliveryService; name: string; phone: string; notes: string;
  neighborhood: string; street: string; number: string; crossStreets: string; reference: string; fee: string; externalId: string;
};
export function orderEditDraft(order: OrderDetail): OrderEditDraft {
  const address = order.delivery_address || {};
  return {
    channel: order.channel, service: getDeliveryService(order), name: order.customer_name || "", phone: order.customer_phone || "",
    notes: order.notes || "", neighborhood: String(address.neighborhood || address.district || ""), street: String(address.street || address.address || ""),
    number: String(address.number || ""), crossStreets: String(address.cross_streets || ""), reference: String(address.reference || ""),
    fee: String(order.delivery_fee), externalId: String(address.service_order_id || ""),
  };
}
export function orderEditChanges(order: OrderDetail, initial: OrderEditDraft, draft: OrderEditDraft): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (draft.channel !== initial.channel) changes.channel = draft.channel;
  if (draft.name !== initial.name) changes.customer_name = draft.name.trim() || null;
  if (draft.phone !== initial.phone) changes.customer_phone = whatsappPhone(draft.phone) ? `+${whatsappPhone(draft.phone)}` : null;
  if (draft.notes !== initial.notes) changes.notes = draft.notes.trim() || null;
  const addressFields: (keyof OrderEditDraft)[] = ["service", "neighborhood", "street", "number", "crossStreets", "reference", "externalId"];
  if (addressFields.some((key) => draft[key] !== initial[key]) || (draft.channel === "delivery" && initial.channel !== "delivery")) {
    const address = { ...order.delivery_address };
    if (["street", "number", "neighborhood", "crossStreets"].some((key) => draft[key as keyof OrderEditDraft] !== initial[key as keyof OrderEditDraft])) {
      // A new textual destination must not keep coordinates from the old address.
      for (const key of ["latitude", "longitude", "lat", "lng", "place_id", "maps_url", "google_maps_url", "map_url", "url"]) delete address[key];
    }
    changes.delivery_address = { ...address, delivery_service: draft.service, service_order_id: draft.externalId.trim() || null,
      neighborhood: draft.neighborhood.trim(), street: draft.street.trim(), number: draft.number.trim(), cross_streets: draft.crossStreets.trim(),
      address: [draft.street.trim(), draft.number.trim(), draft.neighborhood.trim()].filter(Boolean).join(", "), reference: draft.reference.trim(),
    };
  }
  const fee = draft.channel === "delivery" && draft.service === "own" ? Number(draft.fee) : 0;
  if (fee !== order.delivery_fee) changes.delivery_fee = fee;
  return changes;
}
export function validateOrderEdit(draft: OrderEditDraft, changes: Record<string, unknown>) {
  if ("customer_phone" in changes && draft.phone.trim() && !whatsappPhone(draft.phone)) return "Revisa el número de teléfono e incluye su prefijo de país.";
  const fulfillmentChanged = ["channel", "delivery_address", "delivery_fee"].some((key) => key in changes);
  if (fulfillmentChanged && draft.channel === "delivery" && draft.service === "own") {
    if (!draft.name.trim() || !whatsappPhone(draft.phone) || !draft.street.trim() || !draft.reference.trim()) return "Completa nombre, teléfono, calle y referencias para el domicilio propio.";
    if (!draft.fee.trim() || !Number.isFinite(Number(draft.fee)) || Number(draft.fee) < 0) return "Indica un costo de envío válido, igual o mayor que cero.";
  }
  return null;
}
export function persistedEditMatches(order: Order, changes: Record<string, unknown>, initialVersion: number, total: number) {
  return order.version > initialVersion && Math.abs(order.total - total) < 0.005 && Object.entries(changes).every(([key, value]) => {
    const stored = order[key as keyof Order];
    if (key === "delivery_address" && value && typeof value === "object") return Object.entries(value).every(([field, expected]) => (stored as Record<string, unknown> | null)?.[field] === expected);
    return stored === value;
  });
}
