import { ArrowRight, CalendarClock, ChefHat, CircleDollarSign, Clock3, ShoppingBag, Sparkles, TableProperties, Truck } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { usePolling } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import type { Order, Reservation, RestaurantTable } from "../types";
import { EmptyState, ErrorState, LoadingState, MetricCard, Money, PageHeader, StatusPill } from "../components/ui";

type Report = {
  orders: number;
  closed_orders: number;
  gross_sales: number;
  average_ticket: number;
  by_channel: Record<string, number>;
  by_payment_method: Record<string, number>;
  top_products: { name: string; quantity: number; sales: number }[];
};

type DashboardData = {
  report: Report;
  orders: Order[];
  tables: RestaurantTable[];
  reservations: Reservation[];
};

const statusSteps = ["confirmed", "sent_to_kitchen", "preparing", "ready"];

export function DashboardPage() {
  const { branch, context } = useTenant();
  const resource = usePolling<DashboardData>(async () => {
    if (!branch) throw new Error("Selecciona una sucursal");
    const [report, orders, tables, reservations] = await Promise.all([
      api<Report>(`/reports/daily?branch_id=${branch.id}`),
      api<Order[]>(`/orders?branch_id=${branch.id}&limit=8`),
      api<RestaurantTable[]>(`/tables?branch_id=${branch.id}`),
      api<Reservation[]>(`/reservations?branch_id=${branch.id}`),
    ]);
    return { report, orders, tables, reservations };
  }, [branch?.id], 20000);

  if (resource.loading && !resource.data) return <LoadingState />;
  if (resource.error && !resource.data) return <ErrorState message={resource.error} onRetry={() => void resource.refresh()} />;
  const data = resource.data!;
  const activeOrders = data.orders.filter((order) => !["closed", "cancelled"].includes(order.status));
  const occupied = data.tables.filter((table) => table.status === "occupied").length;
  const upcoming = data.reservations.filter((reservation) => ["confirmed", "seated"].includes(reservation.status)).slice(0, 4);

  return (
    <div className="page-stack dashboard-page">
      <PageHeader
        eyebrow={`Hoy · ${branch?.name}`}
        title={`Buen servicio, ${context?.business.name}`}
        description="La operación del día, resumida para decidir rápido."
        actions={<Link className="button button-primary" to="/pos">Nuevo pedido <ArrowRight /></Link>}
      />
      <section className="metrics-grid">
        <MetricCard label="Venta cerrada" value={<Money value={data.report.gross_sales} />} hint={`${data.report.closed_orders} pedidos cobrados`} tone="green" />
        <MetricCard label="Ticket promedio" value={<Money value={data.report.average_ticket} />} hint="Solo ventas cerradas" />
        <MetricCard label="Pedidos activos" value={activeOrders.length} hint={`${data.report.orders} creados hoy`} tone="orange" />
        <MetricCard label="Mesas ocupadas" value={`${occupied}/${data.tables.length}`} hint="Estado del salón" tone="blue" />
      </section>
      <section className="dashboard-grid">
        <article className="panel panel-large">
          <div className="panel-heading"><div><span className="eyebrow">Pulso de servicio</span><h2>Pedidos en marcha</h2></div><Link to="/pedidos">Ver todos</Link></div>
          {activeOrders.length ? (
            <div className="order-activity-list">
              {activeOrders.slice(0, 6).map((order) => (
                <div className="order-activity" key={order.id}>
                  <div className="order-avatar">#{order.number.slice(-4)}</div>
                  <div className="order-activity-main"><strong>{order.customer_name || (order.table_id ? `Mesa ${order.table_id}` : "Mostrador")}</strong><span>{order.items.map((item) => `${item.quantity}× ${item.name}`).join(" · ")}</span></div>
                  <StatusPill value={order.status} />
                  <strong><Money value={order.total} /></strong>
                </div>
              ))}
            </div>
          ) : <EmptyState title="Servicio tranquilo" detail="Los pedidos nuevos aparecerán aquí en tiempo real." />}
        </article>
        <article className="panel attention-panel">
          <div className="panel-heading"><div><span className="eyebrow">Ahora</span><h2>Atención operativa</h2></div><Sparkles /></div>
          <div className="attention-list">
            <Link to="/cocina"><ChefHat /><div><strong>{activeOrders.filter((item) => statusSteps.includes(item.status)).length} en cocina</strong><span>Revisar tiempos de preparación</span></div><ArrowRight /></Link>
            <Link to="/delivery"><Truck /><div><strong>{activeOrders.filter((item) => item.channel === "delivery").length} delivery</strong><span>Pedidos por asignar o entregar</span></div><ArrowRight /></Link>
            <Link to="/reservas"><CalendarClock /><div><strong>{upcoming.length} reservas</strong><span>Próximas llegadas confirmadas</span></div><ArrowRight /></Link>
          </div>
        </article>
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">Salón</span><h2>Estado de mesas</h2></div><TableProperties /></div>
          <div className="table-summary">
            {(["available", "reserved", "occupied", "cleaning"] as const).map((status) => (
              <div key={status}><span className={`table-dot table-${status}`} /><strong>{data.tables.filter((table) => table.status === status).length}</strong><small>{status.replace("available", "libres").replace("reserved", "reservadas").replace("occupied", "ocupadas").replace("cleaning", "limpieza")}</small></div>
            ))}
          </div>
          <Link className="text-link" to="/mesas">Abrir plano del salón <ArrowRight /></Link>
        </article>
        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">Próximamente</span><h2>Reservas</h2></div><Clock3 /></div>
          {upcoming.length ? <div className="compact-list">{upcoming.map((reservation) => <div key={reservation.id}><span>{new Date(reservation.start_at).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</span><div><strong>{reservation.customer_name}</strong><small>{reservation.party_size} personas</small></div><StatusPill value={reservation.status} /></div>)}</div> : <EmptyState title="Sin próximas reservas" detail="La agenda está libre por ahora." />}
        </article>
      </section>
      <section className="quick-actions">
        <Link to="/pos"><ShoppingBag /><span><strong>Abrir pedido</strong><small>Salón, llevar o delivery</small></span></Link>
        <Link to="/caja"><CircleDollarSign /><span><strong>Revisar caja</strong><small>Apertura, movimientos y cierre</small></span></Link>
      </section>
    </div>
  );
}
