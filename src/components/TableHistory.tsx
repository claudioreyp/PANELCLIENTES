import { ArrowLeft, CircleX, Printer } from "lucide-react";
import { useDeferredValue, useEffect, useState } from "react";
import { useBranchRealtime, usePolling } from "../lib/hooks";
import { loadOrdersWorkspace } from "../lib/orders";
import { isActiveOrderItem } from "../lib/order-presentation";
import { formatPosDate } from "../lib/pos-dates";
import type { KitchenTicket, OrderDetail, OrderWorkspaceItem } from "../types";
import { OrderCommands } from "./OrderCommands";
import { OrderIdentity } from "./OrderIdentity";
import { OrderListPanel, OrderPaymentBadge, orderPaymentDisplayStatus } from "./OrderListPanel";
import { ErrorState, LoadingState } from "./ui";
import "./table-history.css";

export function TableHistory({ branchId, onBack, onOpen }: { branchId: number; onBack: () => void; onOpen: (order: OrderWorkspaceItem) => void }) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(1);
  const resource = usePolling(() => loadOrdersWorkspace({ branchId, period: "all", view: "table_history", search: deferredSearch, page, pageSize: 12, timezone: "America/Lima" }), [branchId, deferredSearch, page]);
  useBranchRealtime(branchId, () => void resource.refresh());
  useEffect(() => {
    if (resource.data && !resource.error && page > Math.max(1, Math.ceil(resource.data.total / 12))) setPage(Math.max(1, Math.ceil(resource.data.total / 12)));
  }, [resource.data, resource.error, page]);
  return <section className="table-history-workspace" aria-label="Historial de mesas">
    <button type="button" className="table-history-back" onClick={onBack}><ArrowLeft aria-hidden="true" /> Regresar a panel</button>
    {resource.error && <div className="orders-sync-warning" role="alert"><span>{resource.data ? "No se pudo actualizar el historial. Conservamos la última consulta. " : ""}{resource.error}</span><button className="button button-secondary" type="button" onClick={() => void resource.refresh()}>Reintentar</button></div>}
    {!resource.data ? resource.loading ? <LoadingState label="Cargando historial de mesas..." /> : !resource.error && <ErrorState message="No se pudo cargar el historial." onRetry={() => void resource.refresh()} /> : <OrderListPanel
      items={resource.data.items} total={resource.data.total} reviewCount={resource.data.review_count} page={resource.data.page} pageSize={12}
      search={search} loading={resource.loading} allDates tableHistory onPage={setPage}
      onSearch={(value) => { setSearch(value); setPage(1); }} onRefresh={() => void resource.refresh()} onOpen={onOpen}
    />}
  </section>;
}

function ReceiptAmount({ value }: { value: number }) {
  return <span>{Number(value).toLocaleString("es-PE", { maximumFractionDigits: 2 })} S/</span>;
}

export function HistoricalOrderContent({ order, busy, onPrint, onPrintTicket }: { order: OrderDetail; busy: boolean; onPrint: () => void; onPrintTicket: (ticket: KitchenTicket) => void }) {
  const cancelled = order.status === "cancelled";
  const units = order.items.filter(isActiveOrderItem).reduce((sum, item) => sum + item.quantity, 0);
  const source = order.source === "pos" ? "Punto de venta" : ["public_store", "public_menu"].includes(order.source) ? "Menú digital" : ["agent", "integration", "n8n", "whatsapp_agent", "whatsapp"].includes(order.source) ? "WhatsApp" : "Otro origen";
  const methods: Record<string, string> = { cash: "Efectivo", card: "Tarjeta", yape: "Yape", plin: "Plin", transfer: "Transferencia", bank_transfer: "Transferencia" };
  const payments = order.payments.filter((payment) => payment.status === "confirmed");
  return <div className="historical-order-content">
    {cancelled && <div className="history-cancellation" role="note"><CircleX aria-hidden="true" /><div><strong>Este pedido fue cancelado</strong><p>{order.cancellation_reason?.trim() || "Motivo no registrado"}</p></div></div>}
    <div className="history-order-reference"><time dateTime={order.created_at}>{formatPosDate(order.created_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</time><OrderIdentity {...order} /></div>
    <div className="history-order-meta"><span>{units} {units === 1 ? "producto" : "productos"}</span><span className="history-table-label">{order.table_context?.table_name || "Mesa"}</span><span className="history-source-label">{source}</span></div>
    <OrderCommands order={order} editable={false} busy={busy} readOnly onEdit={() => undefined} onPrint={onPrintTicket} />
    <section className="history-payments" aria-label="Pagos de la cuenta"><header><span>Pagos</span><OrderPaymentBadge status={orderPaymentDisplayStatus(order)} /></header>
      {payments.map((payment) => <div key={payment.id} className="history-payment"><div>Pago de <ReceiptAmount value={payment.amount} /> en <span className="history-payment-method">{methods[payment.method] || payment.method}</span>{payment.cash_register_name && <small>{payment.cash_register_name}</small>}</div><time dateTime={payment.received_at || payment.created_at}>{formatPosDate(payment.received_at || payment.created_at, { hour: "numeric", minute: "2-digit" })}</time></div>)}
      {cancelled && order.paid_amount > 0 && <p className="history-payment-note">La cancelación no anula los cobros confirmados que se muestran aquí.</p>}
    </section>
    <dl className="history-totals"><div><dt>Productos</dt><dd><ReceiptAmount value={order.subtotal} /></dd></div>{order.discount > 0 && <div><dt>Descuento</dt><dd>-<ReceiptAmount value={order.discount} /></dd></div>}{order.delivery_fee > 0 && <div><dt>Envío</dt><dd><ReceiptAmount value={order.delivery_fee} /></dd></div>}<div className="history-total"><dt>Total</dt><dd><ReceiptAmount value={order.total} /></dd></div><div className="history-collected"><dt>Monto cobrado</dt><dd><ReceiptAmount value={order.paid_amount} /></dd></div>{!cancelled && order.remaining_amount > 0 && <div><dt>Monto restante</dt><dd><ReceiptAmount value={order.remaining_amount} /></dd></div>}</dl>
    <footer className="history-print"><button className="button button-secondary" type="button" disabled={busy || cancelled} onClick={onPrint}><Printer aria-hidden="true" /> Imprimir cuenta</button></footer>
  </div>;
}
