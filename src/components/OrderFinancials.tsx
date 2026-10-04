import type { OrderDetail } from "../types";
import { checkoutPaymentMethods, paymentMethodLabel, type CheckoutPaymentMethod } from "../lib/order-checkout";
import { parsePosDate, formatPosDate } from "../lib/pos-dates";
import { OrderPaymentBadge, orderPaymentDisplayStatus } from "./OrderListPanel";
import "./order-cancellation.css";

const amount = (value: number) => <>{Number(value).toLocaleString("es-PE", { maximumFractionDigits: 2 })} S/</>;
const methodLabel = (method: string) => method === "bank_transfer" ? "Transferencia bancaria" : checkoutPaymentMethods.includes(method as CheckoutPaymentMethod) ? paymentMethodLabel(method as CheckoutPaymentMethod) : method;

export function OrderFinancials({ order }: { order: OrderDetail }) {
  const cancelled = order.status === "cancelled";
  const refunds = order.refunds ?? [];
  const collected = order.financial_summary?.collected ?? order.paid_amount;
  const refunded = order.financial_summary?.refunded ?? refunds.reduce((sum, refund) => sum + Number(refund.amount), 0);
  const net = order.financial_summary?.net_collected ?? collected - refunded;
  const refundable = order.financial_summary?.refundable ?? Math.max(0, net);
  const timeline = [
    ...order.payments.filter((payment) => payment.status === "confirmed").map((payment) => ({
      key: `payment:${payment.id}`, refund: false, method: payment.method, amount: payment.amount,
      at: payment.received_at || payment.created_at, register: payment.cash_register_name,
    })),
    ...refunds.map((refund) => ({ key: `refund:${refund.id}`, refund: true, method: refund.method, amount: refund.amount, at: refund.created_at, register: refund.register_name })),
  ].sort((left, right) => parsePosDate(left.at).getTime() - parsePosDate(right.at).getTime() || left.key.localeCompare(right.key));
  return <section className="order-detail-payments order-financials" aria-label="Pagos de la cuenta">
    <header><span>Pagos</span><OrderPaymentBadge status={orderPaymentDisplayStatus(order)} /></header>
    <div className="order-financial-timeline">{timeline.map((entry) => <div className={entry.refund ? "order-financial-refund" : ""} key={entry.key}>
      <div><span>{entry.refund ? "Reembolso" : "Pago"} de {amount(entry.amount)} en <strong>{methodLabel(entry.method)}</strong></span>{entry.register && <small>{entry.register}</small>}</div>
      {entry.at && <time dateTime={entry.at}>{formatPosDate(entry.at, { hour: "numeric", minute: "2-digit" })}</time>}
    </div>)}</div>
    {cancelled && refundable > 0 && <p className="order-financial-warning" role="note"><strong>Reembolso no registrado</strong><span>Los cobros confirmados se conservan. Importe pendiente de devolución: {amount(refundable)}.</span></p>}
    <div className="order-balance">
      <span><span>Productos</span><span>{amount(order.subtotal)}</span></span>
      {order.delivery_fee > 0 && <span><span>Costo de envío</span><span>{amount(order.delivery_fee)}</span></span>}
      {order.discount > 0 && <span><span>Descuento</span><span>−{amount(order.discount)}</span></span>}
      <strong><span>{order.delivery_fee_status === "pending_quote" ? "Importe conocido (sin envío)" : "Total"}</span><span>{amount(order.total)}</span></strong>
      <span><span>Monto cobrado</span><span>{amount(collected)}</span></span>
      {refunded > 0 && <><span><span>Monto reembolsado</span><span>{amount(refunded)}</span></span><span><span>Cobrado después de reembolsos</span><span>{amount(net)}</span></span></>}
      {!cancelled && <span><span>{order.delivery_fee_status === "pending_quote" ? "Restante de productos" : "Monto restante"}</span><span>{amount(order.remaining_amount)}</span></span>}
    </div>
  </section>;
}
