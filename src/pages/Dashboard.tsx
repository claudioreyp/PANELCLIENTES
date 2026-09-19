import { Info, RefreshCcw } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { normalizeCatalogPayload } from "../lib/catalog";
import { catalogAvailabilityItems } from "../lib/availability";
import { datePreset, dashboardMoney, limaToday, shortDay, type DashboardReport, type DateRange } from "../lib/dashboard";
import { useBranchRealtime, usePolling } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import type { Catalog } from "../types";
import { DashboardDatePicker } from "../components/DashboardDatePicker";
import { BarChart, ChartEmpty, DistributionChart, LineChart } from "../components/DashboardCharts";
import "./dashboard.css";

export function DashboardPage() {
  const { branch } = useTenant();
  return <DashboardBranch key={branch?.id || "none"} />;
}

function DashboardCard({ title, detail, children, className = "" }: { title: string; detail?: string; children: ReactNode; className?: string }) {
  const descriptionId = useId();
  const [showDetail, setShowDetail] = useState(false);
  return <section className={`dashboard-card ${className}`} aria-label={title}>
    <header className="dashboard-card-heading">
      <h2>{title}</h2>
      {detail && <div className="dashboard-help">
        <button type="button" aria-label={`Información: ${title}`} aria-expanded={showDetail} aria-controls={descriptionId}
          onClick={() => setShowDetail(!showDetail)} onBlur={() => setShowDetail(false)}
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setShowDetail(false); } }}><Info aria-hidden="true" /></button>
        <p id={descriptionId} hidden={!showDetail} className="dashboard-help-content">{detail}</p>
      </div>}
    </header>
    {children}
  </section>;
}

function DashboardBranch() {
  const { branch, context } = useTenant();
  const today = limaToday();
  const [range, setRange] = useState<DateRange>(() => datePreset("Hoy", today));
  const activeRange = range.preset ? datePreset(range.preset, today) : range;
  const canReport = [...(context?.roles || []), context?.role || ""].some((role) => ["superadmin", "owner", "manager", "cashier"].includes(role));
  const catalogResource = usePolling(async () => {
    if (!branch) throw new Error("Selecciona una sucursal");
    return normalizeCatalogPayload(await api<Catalog>(`/catalog?branch_id=${branch.id}`));
  }, [branch?.id], 20000);
  useBranchRealtime(branch?.id, catalogResource.refresh);
  const unavailable = catalogResource.data ? catalogAvailabilityItems(catalogResource.data).filter((item) => !item.available) : [];
  return <div className="dashboard-page">
    <header className="dashboard-page-heading"><h1>Inicio</h1></header>
    <div className="dashboard-content">
      <div className="dashboard-toolbar"><DashboardDatePicker value={activeRange} today={today} onChange={setRange} /><button className="dashboard-button" type="button" aria-label="Actualizar disponibilidad" onClick={() => void catalogResource.refresh()}><RefreshCcw /></button></div>
      <div className="dashboard-grid dashboard-stock">
        {[{ name: "Productos agotados", modifier: false }, { name: "Personalizaciones agotadas", modifier: true }].map((panel) => {
          const items = unavailable.filter((item) => (item.kind === "modifier") === panel.modifier);
          return <DashboardCard key={panel.name} title={panel.name} detail="Disponibilidad actual">
            {catalogResource.error ? <InlineRetry message="No se pudo actualizar la disponibilidad." onRetry={catalogResource.refresh} /> : null}
            {!catalogResource.data ? <ChartEmpty>{catalogResource.loading ? "Cargando disponibilidad…" : "Disponibilidad no disponible"}</ChartEmpty> : items.length ? <ul className="dashboard-stock-list">{items.map((item) => <li key={item.key}><Link to="/disponibilidad"><strong>{item.name}</strong><small>{item.subtitle}</small></Link></li>)}</ul> : <ChartEmpty />}
            <Link className="dashboard-card-link" to="/disponibilidad">Ver disponibilidad</Link>
          </DashboardCard>;
        })}
      </div>
      {canReport && branch && <DashboardAnalytics key={`${branch.id}:${activeRange.from}:${activeRange.to}`} branchId={branch.id} range={activeRange} />}
    </div>
  </div>;
}

function InlineRetry({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) {
  return <div className="dashboard-inline-error" role="alert"><span>{message}</span><button type="button" className="dashboard-button" onClick={() => void onRetry()}>Reintentar</button></div>;
}

function DashboardAnalytics({ branchId, range }: { branchId: number; range: DateRange }) {
  const resource = usePolling(() => api<DashboardReport>(`/reports/dashboard?branch_id=${branchId}&date_from=${range.from}&date_to=${range.to}`), [branchId, range.from, range.to], 20000);
  useBranchRealtime(branchId, resource.refresh);
  const report = resource.data;
  if (!report) return <div aria-busy={resource.loading}>{resource.error ? <InlineRetry message="No se pudo cargar el resumen del período." onRetry={resource.refresh} /> : <div className="dashboard-grid dashboard-loading">{["Total de ventas", "Pedidos", "Envíos", "Ticket promedio"].map((title) => <DashboardCard key={title} title={title}><ChartEmpty>Cargando resumen…</ChartEmpty></DashboardCard>)}</div>}</div>;
  const points = (key: "sales" | "orders" | "shipping") => report.series.map((point) => ({ label: report.granularity === "hour" ? point.key : shortDay(point.key), value: Number(point[key]) }));
  const paymentLabels: Record<string, string> = { cash: "Efectivo", card: "Tarjeta", yape: "Yape", plin: "Plin", transfer: "Transferencia" };
  return <>
    {resource.error && <InlineRetry message="No se pudo actualizar el resumen. Se conservan los últimos datos del período." onRetry={resource.refresh} />}
    <div className="dashboard-grid dashboard-analytics">
      <DashboardCard title="Total de ventas" detail="Pedidos confirmados, después de descuentos y sin envío. Incluye pagos pendientes."><strong className="dashboard-metric">{dashboardMoney(report.sales)}</strong>{report.orders ? <LineChart label="Ventas por período" points={points("sales")} /> : <ChartEmpty />}</DashboardCard>
      <DashboardCard title="Pedidos"><strong className="dashboard-metric">{report.orders}</strong>{report.orders ? <LineChart label="Pedidos por período" points={points("orders")} monetary={false} /> : <ChartEmpty />}</DashboardCard>
      <DashboardCard title="Envíos"><strong className="dashboard-metric">{dashboardMoney(report.shipping)}</strong>{report.orders ? <LineChart label="Envíos por período" points={points("shipping")} /> : <ChartEmpty />}</DashboardCard>
      <DashboardCard title="Ticket promedio"><div className="dashboard-average">{dashboardMoney(report.average_ticket, true)}</div></DashboardCard>
      <DashboardCard title="Ventas promedio por día de semana" className="dashboard-weekdays">{range.from === range.to ? <ChartEmpty>Disponible solo para rangos de varios días</ChartEmpty> : report.orders ? <BarChart values={report.weekdays.map((item) => ({ name: item.name, value: item.sales === null ? null : Number(item.sales) }))} /> : <ChartEmpty />}</DashboardCard>
      <DashboardCard title="Ventas por canal de venta">{report.orders ? <BarChart values={report.channels.map((item) => ({ name: item.name, value: Number(item.sales) }))} /> : <ChartEmpty />}</DashboardCard>
      <DashboardCard title="Pedidos por canal de venta">{report.orders ? <BarChart monetary={false} values={report.channels.map((item) => ({ name: item.name, value: item.orders }))} /> : <ChartEmpty />}</DashboardCard>
      <DashboardCard title="Métodos de pago más usados" detail="Cobros confirmados por fecha de pago; no equivalen a las ventas del período."><DistributionChart values={report.payment_methods.map((item) => ({ name: paymentLabels[item.name] || item.name, value: Number(item.amount) }))} /></DashboardCard>
      <DashboardCard title="Total de ventas por opción de servicio"><DistributionChart values={report.services.map((item) => ({ name: item.name, value: Number(item.sales) }))} /></DashboardCard>
      {[{ title: "Productos con más ventas", items: report.top_products }, { title: "Productos menos vendidos", items: report.bottom_products }].map(({ title, items }) => <DashboardCard key={title} title={title} detail="Por unidades vendidas en el período.">{items.length ? <ul className="dashboard-ranking">{items.map((item, index) => <li key={`${item.name}:${index}`}><span>{item.name}</span><small>{Number(item.quantity)} ({dashboardMoney(item.sales)})</small></li>)}</ul> : <ChartEmpty />}</DashboardCard>)}
    </div>
  </>;
}
