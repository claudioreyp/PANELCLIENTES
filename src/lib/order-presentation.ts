import type { Catalog, KitchenTicket, Order, OrderDetail, OrderItem, OrderModifierSnapshot, ProductServiceChannel } from "../types";
import { parsePosDate } from "./pos-dates";
import type { OrderCartLine, OrderDraftChannel } from "./order-builder";
import { calculatePromotions } from "./promotions";

export const deliveryServices = { own: "Domicilio propio", uber_eats: "Uber Eats", rappi: "Rappi", didi_food: "DiDi Food" } as const;
export type DeliveryService = keyof typeof deliveryServices;
export const orderChannels: Record<string, string> = { counter: "Para comer aquí", takeaway: "Para llevar", delivery: "Domicilio", dine_in: "Mesa", online: "Menú digital", whatsapp: "WhatsApp" };
export function orderServiceChannel(order: Pick<Order, "channel" | "source">): ProductServiceChannel {
  const digital = ["agent", "integration", "n8n", "online", "public_store", "whatsapp", "whatsapp_agent"].includes(order.source.trim().toLowerCase());
  if (order.channel === "delivery") return digital ? "digital_delivery" : "pos_delivery";
  if (["takeaway", "pickup"].includes(order.channel)) return digital ? "digital_takeaway" : "pos_takeaway";
  if (["dine_in", "table"].includes(order.channel)) return digital ? "digital_tables" : "pos_tables";
  if (["online", "whatsapp"].includes(order.channel)) return "digital_takeaway";
  return digital ? "digital_tables" : "pos_counter";
}
export const isActiveOrderItem = (item: OrderItem) => !["cancelled", "superseded"].includes(item.status);
export const CANCEL_ALL_ITEMS_MESSAGE = 'Para cancelar todos los productos, usa “Cancelar pedido” en el menú de tres puntos';
export function orderIdentityText(order: { folio?: number | null; number?: string }) {
  return [order.folio != null ? `#${order.folio}` : null, order.number ? `#${order.number}` : null].filter(Boolean).join(" · ");
}

export function activeCommandItems(order: OrderDetail, ticket: KitchenTicket) {
  const byId = new Map(order.items.map((item) => [item.id, item]));
  const tickets = [...order.kitchen_tickets].sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0) || b.created_at.localeCompare(a.created_at) || b.id - a.id);
  return order.items.filter(isActiveOrderItem).filter((item) => {
    // Prefer the ticket containing the current replacement, then walk legacy ancestry.
    let candidate: OrderItem | undefined = item;
    const visited = new Set<number>();
    while (candidate && !visited.has(candidate.id)) {
      visited.add(candidate.id);
      const id = candidate.id;
      const owner = tickets.find((command) => command.items.some((snapshot) => snapshot.item_id === id));
      if (owner) return owner.id === ticket.id;
      candidate = candidate.replaces_item_id == null ? undefined : byId.get(candidate.replaces_item_id);
    }
    return false;
  });
}

export function commandModifiedAt(ticket: KitchenTicket): string | null {
  if (typeof ticket.context?.modified_at === "string") return ticket.context.modified_at;
  const modified = ticket.items.map((item) => item.modified_at).filter((value): value is string => Boolean(value));
  if (modified.length) return modified.sort((a, b) => parsePosDate(b).getTime() - parsePosDate(a).getTime())[0];
  return ["modification", "cancellation", "revision"].includes(ticket.kind || "") ? ticket.created_at : null;
}

export function modificationLabel(modifiedAt: string, now = Date.now()) {
  const elapsed = Math.max(0, Math.floor((now - parsePosDate(modifiedAt).getTime()) / 60000));
  if (!Number.isFinite(elapsed)) return "Comanda modificada";
  return elapsed < 1 ? "Modificado justo ahora" : `Modificado hace ${elapsed} min`;
}
export const isOrderEditable = (order: OrderDetail) => order.edit_policy?.can_edit ?? (!order.table_id && !["closed", "cancelled", "delivered"].includes(order.status));
export function fulfillmentLocked(order: OrderDetail) {
  return order.edit_policy?.fulfillment_locked ?? (order.paid_amount > 0 || ["paid", "partial", "under_review", "evidence_received"].includes(order.payment_status) || ["under_review", "evidence_received"].includes(order.payment_evidence?.status || "") || order.status === "dispatched");
}
export function getDeliveryService(order: Order): DeliveryService {
  const service = String(order.delivery_address?.delivery_service || "own");
  return service in deliveryServices ? service as DeliveryService : "own";
}
export function whatsappPhone(value: string | null | undefined) {
  let digits = (value || "").replace(/[^0-9]/g, "");
  if (/^9\d{8}$/.test(digits)) digits = `51${digits}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}
const textMoney = (value: number) => `${Number(value).toLocaleString("es-PE", { maximumFractionDigits: 2 })} S/`;
export function orderClipboardText(order: Order) {
  return [`Nombre: ${order.customer_name || "Cliente sin nombre"}`, "", orderChannels[order.channel] || order.channel, "", `Productos: ${textMoney(order.subtotal)}`, ...(order.discount > 0 ? [`Descuento: -${textMoney(order.discount)}`] : []), ...(order.delivery_fee > 0 ? [`Costo de envío: ${textMoney(order.delivery_fee)}`] : []), `Total: ${textMoney(order.total)}`].join("\n");
}

export type BreakdownLine = {
  key: string | number; name: string; variant?: string | null; quantity: number;
  gross?: number; discount?: number; notes?: string | null; modifiers: OrderModifierSnapshot[];
  status?: string; cancellationReason?: string | null;
  removedModifiers?: OrderModifierSnapshot[];
  previous?: { name: string; variant?: string | null; quantity: number };
  comboComponents?: { product_id: number; name: string; quantity: number }[];
};
export function savedOrderLines(items: OrderItem[]): BreakdownLine[] {
  return items.map((item) => ({ key: item.id, name: item.name, variant: item.variant_name, quantity: item.quantity, gross: item.line_total, discount: item.promotion_discount, notes: item.notes, modifiers: item.modifiers, status: item.status, cancellationReason: item.cancellation_reason }));
}
export function draftOrderPresentation(cart: OrderCartLine[], catalog: Catalog, channel: OrderDraftChannel) {
  const channelMap: Record<OrderDraftChannel, ProductServiceChannel> = { counter: "pos_counter", takeaway: "pos_takeaway", delivery: "pos_delivery", dine_in: "pos_tables" };
  const pricing = calculatePromotions(cart.map((line) => ({ ...line, categoryId: catalog.products.find((product) => product.id === line.productId)?.category_id ?? null })), catalog.promotions || [], channelMap[channel]);
  const lines: BreakdownLine[] = cart.map((line, index) => ({
    key: line.key, name: line.name, variant: line.variantName, quantity: line.quantity,
    gross: line.unitPrice * line.quantity, discount: pricing.lineDiscounts[index], notes: line.notes,
    modifiers: line.modifiers.map((modifier) => {
      const group = catalog.products.find((product) => product.id === line.productId)?.modifier_groups.find((candidate) => candidate.modifiers.some((option) => option.id === modifier.modifier_id));
      return { ...modifier, group_id: group?.id, group_name: group?.name };
    }),
  }));
  return { lines, pricing };
}
export function groupOrderModifiers(modifiers: OrderModifierSnapshot[], quantity: number) {
  const groups = new Map<string, { key: string; name: string; options: { key: string; name: string; quantity: number; amount: number }[] }>();
  for (const modifier of modifiers) {
    const groupKey = String(modifier.group_id ?? modifier.group_name ?? "legacy");
    if (!groups.has(groupKey)) groups.set(groupKey, { key: groupKey, name: modifier.group_name || "Personalizaciones", options: [] });
    const group = groups.get(groupKey)!;
    const key = `${modifier.modifier_id ?? modifier.name}:${modifier.name}:${modifier.price_delta}`;
    const existing = group.options.find((option) => option.key === key);
    const units = modifier.removed_quantity ?? quantity;
    const amount = Number(modifier.price_delta || 0) * units;
    if (existing) { existing.quantity += units; existing.amount += amount; }
    else group.options.push({ key, name: modifier.name, quantity: units, amount });
  }
  return [...groups.values()];
}
