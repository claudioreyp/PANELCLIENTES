import { ChevronRight, Pencil, Printer, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { activeCommandItems, commandModifiedAt, modificationLabel, isActiveOrderItem, savedOrderLines, type BreakdownLine } from "../lib/order-presentation";
import { formatPosDate } from "../lib/pos-dates";
import type { KitchenTicket, OrderDetail, OrderItem } from "../types";
import { OrderActionsMenu } from "./OrderActionsMenu";
import { OrderBreakdown } from "./OrderBreakdown";
import { StatusPill } from "./ui";

export function commandBreakdown(ticket: Pick<KitchenTicket, "items">, storedItems: OrderItem[] = []): BreakdownLine[] {
  return ticket.items.map((item, index) => {
    const stored = storedItems.find((line) => line.id === item.item_id && line.quantity === item.quantity);
    return {
      key: `${item.item_id}:${index}`, name: item.name, variant: item.variant_name, quantity: item.quantity,
      gross: item.line_total ?? stored?.line_total, discount: item.promotion_discount ?? stored?.promotion_discount,
      notes: item.notes, status: item.action === "cancelled" ? "cancelled" : stored?.status || item.status,
      cancellationReason: item.cancellation_reason || stored?.cancellation_reason,
      modifiers: (item.modifiers || []).map((modifier) => ({ ...modifier, price_delta: modifier.price_delta || 0 })),
      removedModifiers: (item.removed_modifiers || []).map((modifier) => ({ ...modifier, price_delta: modifier.price_delta || 0 })),
      previous: item.previous_name && (item.previous_name !== item.name || item.previous_quantity !== item.quantity || (item.previous_variant_name != null && item.previous_variant_name !== item.variant_name)) ? { name: item.previous_name, variant: item.previous_variant_name, quantity: item.previous_quantity ?? item.quantity } : undefined,
      comboComponents: item.combo_components,
    };
  });
}
export function OrderCommands({ order, editable, busy, onEdit, onPrint, readOnly = false }: { order: OrderDetail; editable: boolean; busy: boolean; onEdit: (ticket: KitchenTicket) => void; onPrint: (ticket: KitchenTicket) => void; readOnly?: boolean }) {
  const [expanded, setExpanded] = useState<number[]>([]);
  const assigned = new Set(order.kitchen_tickets.flatMap((ticket) => ticket.items.map((item) => item.item_id)));
  const unassigned = order.items.filter((item) => isActiveOrderItem(item) && !assigned.has(item.id));
  return <section className="order-commands" aria-label="Comandas del pedido">
    {order.kitchen_tickets.map((ticket, index) => {
      const number = ticket.sequence ?? index + 1;
      const open = expanded.includes(ticket.id);
      const hasActiveItems = activeCommandItems(order, ticket).length > 0;
      const commandId = `order-${order.id}-command-${ticket.id}`;
      const author = ticket.created_by_name ? `Por ${ticket.created_by_name}` : ["agent", "integration", "n8n", "whatsapp_agent", "whatsapp"].includes(order.source) ? "WhatsApp" : ["public_store", "public_menu"].includes(order.source) ? "Menú digital" : "Punto de venta";
      const modifiedAt = commandModifiedAt(ticket);
      return <article key={ticket.id} className="order-command">
        <div className="order-command-heading"><button type="button" className="order-command-expand" aria-expanded={open} aria-controls={commandId} onClick={() => setExpanded((current) => open ? current.filter((id) => id !== ticket.id) : [...current, ticket.id])}><ChevronRight className={open ? "open" : ""} /><span><strong>Comanda #{number}</strong><small>{formatPosDate(ticket.created_at, { hour: "numeric", minute: "2-digit" })} · {author}</small></span></button>{!readOnly && <StatusPill value={ticket.status} />}<OrderActionsMenu floating label={`Acciones de la comanda ${number}`} disabled={busy} actions={[...(!readOnly ? [{ label: "Editar productos", icon: <Pencil />, disabled: !editable || !hasActiveItems, onSelect: () => onEdit(ticket) }] : []), { label: "Imprimir comanda", icon: <Printer />, onSelect: () => onPrint(ticket) }]} /></div>
        {open && <div id={commandId} className="order-command-items">{modifiedAt && <p className="command-card-modified"><TriangleAlert aria-hidden="true" />{modificationLabel(modifiedAt)}</p>}<OrderBreakdown lines={commandBreakdown(ticket, order.items)} prepared={["ready", "served"].includes(ticket.status)} />{!ticket.items.length && <p>Esta comanda no contiene productos.</p>}</div>}
      </article>;
    })}
    {unassigned.length > 0 && <div className="order-unassigned-products"><p className="order-unsent-warning">Estos productos todavía no se enviaron a cocina.</p><OrderBreakdown lines={savedOrderLines(unassigned)} /></div>}
  </section>;
}
