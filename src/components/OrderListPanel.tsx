import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCcw, Search } from "lucide-react";
import { formatPosDate } from "../lib/pos-dates";
import type { OrderWorkspaceItem } from "../types";
import { EmptyState } from "./ui";
import { OrderIdentity } from "./OrderIdentity";
import "./orders-workspace.css";

export function OrderPaymentBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { void: "Anulado", pending: "Pago pendiente", paid: "Pagado", partial: "Pago parcial", evidence_received: "Comprobante recibido", under_review: "Pendiente de revisión", rejected: "Pago rechazado", refunded: "Reembolsado" };
  return <span className={`order-payment-badge payment-${status}`}><i aria-hidden="true" />{labels[status] || "Por revisar"}</span>;
}

export function orderPaymentDisplayStatus(order: Pick<OrderWorkspaceItem, "status" | "payment_status" | "paid_amount">) {
  return order.status === "cancelled" && order.paid_amount === 0 && !["paid", "partial", "refunded"].includes(order.payment_status) ? "void" : order.payment_status;
}

function OrderMode({ channel }: { channel: string }) {
  const labels: Record<string, string> = { counter: "En el local", takeaway: "Para llevar", delivery: "Domicilio", dine_in: "Mesa", online: "Menú digital", whatsapp: "WhatsApp" };
  return <span className={`order-channel channel-${channel}`}>{labels[channel] || channel}</span>;
}

const amount = (value: number) => `${Number(value).toLocaleString("es-PE", { maximumFractionDigits: 2 })} S/`;
const dateLabel = (value: string) => formatPosDate(value, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function OrderListPanel({ items, total, reviewCount, page, pageSize, day, today, search, loading, canCreate, onPage, onDay, onSearch, onRefresh, onCreate, onOpen, allDates = false, tableHistory = false }: {
  items: OrderWorkspaceItem[]; total: number; reviewCount: number; page: number; pageSize: number;
  day?: string; today?: string; search: string; loading: boolean; canCreate?: boolean; allDates?: boolean; tableHistory?: boolean;
  onPage: (page: number) => void; onDay?: (day: string) => void; onSearch: (search: string) => void;
  onRefresh: () => void; onCreate?: () => void; onOpen: (order: OrderWorkspaceItem) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const range = total ? `${(page - 1) * pageSize + 1} - ${Math.min(page * pageSize, total)} de ${total} ${total === 1 ? "pedido" : "pedidos"}` : "0 pedidos";
  return <div className="order-list-workspace">
    <div className="order-list-actions">
      <label className="search-field orders-search"><Search aria-hidden="true" /><span className="visually-hidden">Buscar pedidos</span><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar por pedido, cliente o teléfono" /></label>
      <button className="icon-button" type="button" aria-label="Actualizar pedidos" title="Actualizar pedidos" onClick={onRefresh}><RefreshCcw aria-hidden="true" /></button>
      {!tableHistory && <button className="button order-list-create" type="button" disabled={!canCreate} onClick={onCreate}><Plus aria-hidden="true" /> Nuevo pedido</button>}
    </div>
    <section className={`orders-toolbar ${allDates ? "orders-all-dates" : ""}`} aria-label="Resumen de pedidos">
      {allDates ? <div className="orders-period-label"><CalendarDays aria-hidden="true" /><span>Todo el historial</span></div> : <label className="orders-date"><CalendarDays aria-hidden="true" /><span>{day === today ? "Hoy" : formatPosDate(`${day}T12:00:00Z`, { day: "numeric", month: "short" })}</span><input aria-label="Fecha" type="date" value={day} onChange={(event) => event.target.value && onDay?.(event.target.value)} /></label>}
      <div className="orders-review-summary"><span>{tableHistory ? "Cuentas finalizadas y canceladas" : `${reviewCount} ${reviewCount === 1 ? "pedido" : "pedidos"} por revisar`}</span></div>
    </section>
    <section className="orders-table-panel" aria-label="Lista de pedidos" aria-busy={loading}>
      {items.length ? <>
        <div className="orders-desktop-table"><table><thead><tr>{["Pedido", "Nombre", "Tipo", "Fecha", "Estado de pago", "Total"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{items.map((order) => <tr key={order.id} className={order.status === "cancelled" ? "order-row-cancelled" : ""} onClick={(event) => {
            if ((event.target as Element).closest("button, a, input, select, textarea")) return;
            event.currentTarget.querySelector<HTMLButtonElement>(".order-row-open")?.focus();
            onOpen(order);
          }}>
            <td><button className="order-row-open" type="button" aria-label={`Abrir pedido ${order.folio ?? "sin folio"} de ${order.customer_name || "cliente sin nombre"}`} onClick={(event) => { event.stopPropagation(); event.currentTarget.focus(); onOpen(order); }}><OrderIdentity {...order} mode="folio" />{order.status === "cancelled" && <small className="order-cancelled-label">Cancelado</small>}</button></td><td className="order-customer-name">{order.customer_name || (tableHistory ? "Sin nombre" : "Cliente de mostrador")}</td><td><OrderMode channel={order.channel} /></td>
            <td><time dateTime={order.created_at}>{dateLabel(order.created_at)}</time></td>
            <td><OrderPaymentBadge status={orderPaymentDisplayStatus(order)} />{order.requires_review && <small className="review-flag">Requiere revisión</small>}</td><td>{amount(order.total)}</td>
          </tr>)}</tbody>
        </table></div>
        <div className="orders-mobile-cards">{items.map((order) => <button type="button" key={order.id} className={order.status === "cancelled" ? "order-row-cancelled" : ""} onClick={(event) => { event.currentTarget.focus(); onOpen(order); }} aria-label={`Abrir pedido ${order.folio ?? "sin folio"} de ${order.customer_name || "cliente sin nombre"}`}>
          <span className="orders-mobile-top"><OrderIdentity {...order} mode="folio" /><span>{amount(order.total)}</span></span>
          <span className="orders-mobile-customer"><b className="order-customer-name">{order.customer_name || (tableHistory ? "Sin nombre" : "Cliente de mostrador")}</b><time dateTime={order.created_at}>{dateLabel(order.created_at)}</time></span>
          <span className="orders-mobile-status"><OrderMode channel={order.channel} /><OrderPaymentBadge status={orderPaymentDisplayStatus(order)} />{order.status === "cancelled" && <small className="order-cancelled-label">Cancelado</small>}</span>
          {order.requires_review && <span className="review-flag">Requiere revisión</span>}
        </button>)}</div>
      </> : <EmptyState title={tableHistory ? "Todavía no hay cuentas finalizadas" : allDates ? "No hay pedidos" : "No hay pedidos para esta fecha"} detail={search ? "Prueba con otra búsqueda o limpia el filtro." : tableHistory ? "Las cuentas cobradas y canceladas de esta sucursal aparecerán aquí." : "Los pedidos nuevos y los creados desde WhatsApp aparecerán aquí."} />}
      <footer className="orders-pagination" aria-label={`Página ${page} de ${pages}`}>
        <button className="icon-button" type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft aria-hidden="true" /></button>
        <span>{range}</span>
        <button className="icon-button" type="button" aria-label="Página siguiente" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight aria-hidden="true" /></button>
      </footer>
    </section>
  </div>;
}
