import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  ImageIcon,
  MapPin,
  Plus,
  RefreshCcw,
  Save,
  Settings2,
  ShoppingBag,
  TrendingUp,
  Truck,
  Upload,
  UserRound,
  WalletCards,
  Warehouse,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api, apiBlob } from "../lib/api";
import { useBranchRealtime, usePolling } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import type { Order, Reservation, RestaurantTable } from "../types";
import { EmptyState, ErrorState, LoadingState, MetricCard, Modal, Money, PageHeader, StatusPill, Toast } from "../components/ui";
import { AvailabilityWorkspace } from "../components/AvailabilityWorkspace";
import { CashWorkspace } from "../components/CashWorkspace";

type ToastState = { message: string; tone: "success" | "error" } | null;
type Courier = { id: number; name: string; phone: string; status: string; active: boolean };
type DeliveryRow = { order: Order; delivery: { id: number; courier_id: number | null; status: string; tracking_code: string; estimated_at?: string | null } | null };

export function DeliveryPage() {
  const { branch } = useTenant();
  const [assigning, setAssigning] = useState<DeliveryRow | null>(null);
  const [courierId, setCourierId] = useState<number | null>(null);
  const [newCourier, setNewCourier] = useState(false);
  const [courierName, setCourierName] = useState("");
  const [courierPhone, setCourierPhone] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const resource = usePolling(async () => {
    if (!branch) throw new Error("Selecciona una sucursal");
    const [orders, couriers] = await Promise.all([
      api<DeliveryRow[]>(`/delivery/orders?branch_id=${branch.id}`),
      api<Courier[]>(`/delivery/couriers?branch_id=${branch.id}`),
    ]);
    return { orders, couriers };
  }, [branch?.id], 10000);
  useBranchRealtime(branch?.id, resource.refresh);

  async function createCourier() {
    if (!branch || !courierName || !courierPhone) return;
    try {
      await api("/delivery/couriers", { method: "POST", body: JSON.stringify({ branch_id: branch.id, name: courierName, phone: courierPhone }) });
      setNewCourier(false); setCourierName(""); setCourierPhone(""); await resource.refresh();
    } catch (caught) { setToast({ message: caught instanceof Error ? caught.message : "No se pudo crear", tone: "error" }); }
  }

  async function assign() {
    if (!assigning) return;
    try {
      await api(`/delivery/orders/${assigning.order.id}/assign`, { method: "POST", body: JSON.stringify({ courier_id: courierId }) });
      setAssigning(null); await resource.refresh(); setToast({ message: "Repartidor asignado.", tone: "success" });
    } catch (caught) { setToast({ message: caught instanceof Error ? caught.message : "No se pudo asignar", tone: "error" }); }
  }

  async function transition(row: DeliveryRow, status: string) {
    try {
      await api(`/delivery/orders/${row.order.id}/transition`, { method: "POST", body: JSON.stringify({ status }) });
      await resource.refresh();
    } catch (caught) { setToast({ message: caught instanceof Error ? caught.message : "No se pudo actualizar", tone: "error" }); }
  }

  if (resource.loading && !resource.data) return <LoadingState />;
  if (resource.error && !resource.data) return <ErrorState message={resource.error} />;
  const data = resource.data!;
  const columns = ["preparing", "ready", "assigned", "dispatched", "delivered"];
  const rowStatus = (row: DeliveryRow) => row.delivery?.status || (row.order.status === "ready" ? "ready" : "preparing");

  return <div className="page-stack delivery-page">
    <PageHeader eyebrow="Última milla" title="Delivery" description="De cocina a la puerta del cliente, con responsable y trazabilidad." actions={<><button className="button button-secondary" onClick={() => setNewCourier(true)}><UserRound /> Nuevo repartidor</button><button className="icon-button" onClick={() => void resource.refresh()}><RefreshCcw /></button></>} />
    <section className="delivery-board">{columns.map((status) => <div className="delivery-column" key={status}><header><span className={`delivery-marker marker-${status}`} /><h2>{status.replace("preparing", "Preparación").replace("ready", "Listo").replace("assigned", "Asignado").replace("dispatched", "En camino").replace("delivered", "Entregado")}</h2><strong>{data.orders.filter((row) => rowStatus(row) === status).length}</strong></header><div>{data.orders.filter((row) => rowStatus(row) === status).map((row) => <article className="delivery-card" key={row.order.id}><div className="delivery-card-top"><strong>#{row.order.number.slice(-6)}</strong><Clock3 /><span>{new Date(row.order.created_at).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</span></div><h3>{row.order.customer_name || "Cliente"}</h3><p>{String(row.order.delivery_address?.address || "Dirección pendiente")}</p><div className="delivery-items">{row.order.items.slice(0, 3).map((item) => <span key={item.id}>{item.quantity}× {item.name}</span>)}</div><div className="delivery-card-footer"><strong><Money value={row.order.total} /></strong>{status === "ready" && <button onClick={() => { setAssigning(row); setCourierId(null); }}>Asignar <ChevronRight /></button>}{status === "assigned" && <button onClick={() => void transition(row, "dispatched")}>Despachar <Truck /></button>}{status === "dispatched" && <button onClick={() => void transition(row, "delivered")}>Entregado <Check /></button>}</div>{row.delivery?.tracking_code && <small>Tracking {row.delivery.tracking_code}</small>}</article>)}</div></div>)}</section>
    {assigning && <Modal title="Asignar repartidor" onClose={() => setAssigning(null)}><div className="form-stack"><p>Pedido #{assigning.order.number} · {assigning.order.customer_name}</p><label>Repartidor<select value={courierId || ""} onChange={(event) => setCourierId(Number(event.target.value) || null)}><option value="">Sin repartidor propio</option>{data.couriers.filter((courier) => courier.active && courier.status === "available").map((courier) => <option key={courier.id} value={courier.id}>{courier.name} · {courier.phone}</option>)}</select></label><button className="button button-primary button-large" onClick={() => void assign()}><Truck /> Confirmar asignación</button></div></Modal>}
    {newCourier && <Modal title="Nuevo repartidor" onClose={() => setNewCourier(false)}><div className="form-stack"><label>Nombre<input value={courierName} onChange={(event) => setCourierName(event.target.value)} /></label><label>Teléfono<input value={courierPhone} onChange={(event) => setCourierPhone(event.target.value)} /></label><button className="button button-primary" onClick={() => void createCourier()}><Plus /> Agregar repartidor</button></div></Modal>}
    {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
  </div>;
}

export function ReservationsPage() {
  const { branch } = useTenant();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [startAt, setStartAt] = useState(`${day}T19:00`);
  const [tableIds, setTableIds] = useState<number[]>([]);
  const [notes, setNotes] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const resource = usePolling(async () => {
    if (!branch) throw new Error("Selecciona una sucursal");
    const start = new Date(`${day}T00:00:00`).toISOString();
    const end = new Date(`${day}T23:59:59`).toISOString();
    const [reservations, tables] = await Promise.all([
      api<Reservation[]>(`/reservations?branch_id=${branch.id}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`),
      api<RestaurantTable[]>(`/tables?branch_id=${branch.id}`),
    ]);
    return { reservations, tables };
  }, [branch?.id, day], 15000);
  useBranchRealtime(branch?.id, resource.refresh);

  async function createReservation() {
    if (!branch || !name || !phone || !startAt) return;
    try {
      await api("/reservations", { method: "POST", idempotencyKey: crypto.randomUUID(), body: JSON.stringify({ branch_id: branch.id, customer_name: name, customer_phone: phone, party_size: partySize, start_at: new Date(startAt).toISOString(), table_ids: tableIds, notes: notes || null }) });
      setCreating(false); setName(""); setPhone(""); setPartySize(2); setTableIds([]); setNotes(""); await resource.refresh(); setToast({ message: "Reserva confirmada.", tone: "success" });
    } catch (caught) { setToast({ message: caught instanceof Error ? caught.message : "No se pudo reservar", tone: "error" }); }
  }

  async function update(reservation: Reservation, status: string) {
    try {
      await api(`/reservations/${reservation.id}`, { method: "PATCH", body: JSON.stringify({ status, expected_version: reservation.version }) });
      await resource.refresh();
    } catch (caught) { setToast({ message: caught instanceof Error ? caught.message : "No se pudo actualizar", tone: "error" }); }
  }

  if (resource.loading && !resource.data) return <LoadingState />;
  if (resource.error && !resource.data) return <ErrorState message={resource.error} />;
  const data = resource.data!;
  return <div className="page-stack reservations-page">
    <PageHeader eyebrow="Agenda del salón" title="Reservas" description="Capacidad, mesas y llegada del cliente sin cruces de horario." actions={<button className="button button-primary" onClick={() => { setStartAt(`${day}T19:00`); setCreating(true); }}><CalendarDays /> Nueva reserva</button>} />
    <section className="reservation-toolbar panel"><label>Fecha<input type="date" value={day} onChange={(event) => setDay(event.target.value)} /></label><div><MetricCard label="Confirmadas" value={data.reservations.filter((item) => item.status === "confirmed").length} /><MetricCard label="Comensales" value={data.reservations.filter((item) => item.status === "confirmed").reduce((sum, item) => sum + item.party_size, 0)} /></div></section>
    <section className="panel reservation-list">{data.reservations.length ? data.reservations.map((reservation) => <article key={reservation.id}><div className="reservation-time"><strong>{new Date(reservation.start_at).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</strong><span>{Math.round((new Date(reservation.end_at).getTime() - new Date(reservation.start_at).getTime()) / 60000)} min</span></div><div className="reservation-person"><span>{reservation.customer_name.slice(0, 1)}</span><div><strong>{reservation.customer_name}</strong><small>{reservation.customer_phone}</small></div></div><div><strong>{reservation.party_size} personas</strong><small>{reservation.table_ids.length ? `${reservation.table_ids.length} mesa(s)` : "Mesa por asignar"}</small></div><StatusPill value={reservation.status} /><div className="row-actions">{reservation.status === "confirmed" && <><button onClick={() => void update(reservation, "seated")}>Llegó</button><button onClick={() => void update(reservation, "no_show")}>No asistió</button></>}{reservation.status === "seated" && <button onClick={() => void update(reservation, "completed")}>Completar</button>}{!["completed", "cancelled"].includes(reservation.status) && <button className="danger-text" onClick={() => void update(reservation, "cancelled")}>Cancelar</button>}</div></article>) : <EmptyState title="Agenda libre" detail="No hay reservas para esta fecha." />}</section>
    {creating && <Modal title="Nueva reserva" onClose={() => setCreating(false)}><div className="form-stack"><div className="form-grid"><label>Cliente<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Teléfono<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label><label>Fecha y hora<input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label><label>Personas<input type="number" min="1" max="100" value={partySize} onChange={(event) => setPartySize(Number(event.target.value))} /></label></div><fieldset><legend>Mesas (opcional)</legend><div className="table-choice-grid">{data.tables.map((table) => <label key={table.id} className={tableIds.includes(table.id) ? "selected" : ""}><input type="checkbox" checked={tableIds.includes(table.id)} onChange={() => setTableIds((current) => current.includes(table.id) ? current.filter((id) => id !== table.id) : [...current, table.id])} /><strong>{table.name}</strong><small>{table.capacity} personas</small></label>)}</div></fieldset><label>Notas<textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><button className="button button-primary button-large" onClick={() => void createReservation()}><CalendarDays /> Confirmar reserva</button></div></Modal>}
    {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
  </div>;
}

type CatalogImportResult = {
  dry_run: boolean;
  rows: number;
  valid_rows: number;
  errors: { row: number; sku?: string | null; error: string }[];
  preview: {
    sku: string;
    name: string;
    category: string;
    price: number;
  }[];
  created?: number;
  updated?: number;
};

export function CatalogImportModal({ branchId, onClose, onImported }: { branchId: number; onClose: () => void; onImported: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CatalogImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(dryRun: boolean) {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await api<CatalogImportResult>(`/catalog/import-csv?branch_id=${branchId}&dry_run=${dryRun}`, {
        method: "POST",
        body,
      });
      setResult(response);
      if (!dryRun) await onImported();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo importar el catálogo");
    } finally {
      setLoading(false);
    }
  }

  function downloadTemplate() {
    const csv = [
      "sku,name,category,price,description,available,preparation_station",
      "PIZ-001,Pizza Pepperoni,Pizzas,32.00,Pizza familiar,true,kitchen",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "plantilla-catalogo-escalar.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <Modal title="Importar catálogo por CSV" onClose={onClose}>
    <div className="form-stack catalog-import">
      <p>Primero validamos el archivo. Nada se guarda hasta que confirmes la importación.</p>
      <button className="button button-ghost" onClick={downloadTemplate}><FileSpreadsheet /> Descargar plantilla</button>
      <label className="file-drop">
        <Upload />
        <strong>{file?.name || "Selecciona un archivo CSV"}</strong>
        <small>UTF-8, máximo 5 MB. SKU, nombre, categoría y precio son obligatorios.</small>
        <input type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.target.files?.[0] || null); setResult(null); setError(null); }} />
      </label>
      {error && <div className="inline-error"><AlertTriangle /> {error}</div>}
      {result && <div className="import-preview">
        <div className="import-summary">
          <MetricCard label="Filas" value={result.rows} />
          <MetricCard label="Válidas" value={result.valid_rows} tone="green" />
          <MetricCard label="Errores" value={result.errors.length} tone={result.errors.length ? "orange" : undefined} />
        </div>
        {result.errors.length > 0 && <div className="import-errors">
          <strong>Corrige estas filas antes de importar</strong>
          {result.errors.map((item) => <span key={`${item.row}-${item.sku}`}>Fila {item.row}{item.sku ? ` · ${item.sku}` : ""}: {item.error}</span>)}
        </div>}
        {result.preview.length > 0 && <div className="data-table-wrap"><table className="data-table"><thead><tr><th>SKU</th><th>Producto</th><th>Categoría</th><th>Precio</th></tr></thead><tbody>{result.preview.map((item) => <tr key={item.sku}><td>{item.sku}</td><td><strong>{item.name}</strong></td><td>{item.category}</td><td><Money value={item.price} /></td></tr>)}</tbody></table></div>}
        {!result.dry_run && <div className="success-callout"><Check /> Se crearon {result.created || 0} productos y se actualizaron {result.updated || 0}.</div>}
      </div>}
      <div className="modal-actions">
        <button className="button button-secondary" disabled={!file || loading} onClick={() => void upload(true)}>{loading ? "Validando..." : "Previsualizar"}</button>
        <button className="button button-primary" disabled={!result?.dry_run || result.errors.length > 0 || loading} onClick={() => void upload(false)}><Upload /> Importar catálogo</button>
      </div>
    </div>
  </Modal>;
}

export function InventoryPage() {
  return <AvailabilityWorkspace />;
}

export function CashPage() {
  return <CashWorkspace />;
}

type DailyReport = { day: string; orders: number; closed_orders: number; gross_sales: number; average_ticket: number; by_channel: Record<string, number>; by_payment_method: Record<string, number>; top_products: { name: string; quantity: number; sales: number }[] };

export function SalesPage() {
  const { branch } = useTenant();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const resource = usePolling(async () => branch ? api<DailyReport>(`/reports/daily?branch_id=${branch.id}&day=${day}`) : Promise.reject(new Error("Selecciona una sucursal")), [branch?.id, day], 30000);
  if (resource.loading && !resource.data) return <LoadingState />;
  if (resource.error && !resource.data) return <ErrorState message={resource.error} />;
  const report = resource.data!;
  const maxChannel = Math.max(1, ...Object.values(report.by_channel));
  return <div className="page-stack sales-page"><PageHeader eyebrow="Rendimiento" title="Ventas del día" description="Resultados por canal, pago y producto sin mezclar sucursales." actions={<label className="date-action">Fecha<input type="date" value={day} onChange={(event) => setDay(event.target.value)} /></label>} /><section className="metrics-grid"><MetricCard label="Venta bruta" value={<Money value={report.gross_sales} />} tone="green" /><MetricCard label="Pedidos cerrados" value={report.closed_orders} hint={`${report.orders} creados`} /><MetricCard label="Ticket promedio" value={<Money value={report.average_ticket} />} /><MetricCard label="Conversión" value={`${report.orders ? Math.round(report.closed_orders / report.orders * 100) : 0}%`} tone="blue" /></section><section className="report-grid"><article className="panel"><div className="panel-heading"><div><span className="eyebrow">Distribución</span><h2>Ventas por canal</h2></div><TrendingUp /></div><div className="bar-list">{Object.entries(report.by_channel).length ? Object.entries(report.by_channel).map(([channel, amount]) => <div key={channel}><span>{channel.replaceAll("_", " ")}</span><div><i style={{ width: `${amount / maxChannel * 100}%` }} /></div><strong><Money value={amount} /></strong></div>) : <EmptyState title="Sin ventas cerradas" detail="Los canales aparecerán cuando cierres pedidos." />}</div></article><article className="panel"><div className="panel-heading"><div><span className="eyebrow">Cobros</span><h2>Formas de pago</h2></div><WalletCards /></div><div className="payment-method-grid">{Object.entries(report.by_payment_method).map(([method, amount]) => <div key={method}><span>{method}</span><strong><Money value={amount} /></strong></div>)}</div></article><article className="panel report-wide"><div className="panel-heading"><div><span className="eyebrow">Carta</span><h2>Productos más vendidos</h2></div><ShoppingBag /></div><table className="data-table"><thead><tr><th>Producto</th><th>Cantidad</th><th>Venta</th></tr></thead><tbody>{report.top_products.map((product, index) => <tr key={product.name}><td><strong><span className="rank">{index + 1}</span>{product.name}</strong></td><td>{product.quantity}</td><td><Money value={product.sales} /></td></tr>)}</tbody></table></article></section></div>;
}

export function SettingsPage() {
  const { branch, context, refresh: refreshTenant } = useTenant();
  const [branchForm, setBranchForm] = useState({
    name: branch?.name || "",
    address: branch?.address || "",
    phone: branch?.phone || "",
    maps_url: branch?.maps_url || "",
    yape_number: branch?.yape_number || "",
    plin_number: branch?.plin_number || "",
    payment_recipient_name: branch?.payment_recipient_name || "",
    accepted_payment_methods: branch?.accepted_payment_methods || ["cash", "card", "yape", "plin"],
    delivery_fee: branch?.delivery_fee || 0,
    delivery_enabled: branch?.delivery_enabled ?? true,
    takeaway_enabled: branch?.takeaway_enabled ?? true,
    agent_context_notes: branch?.agent_context_notes || "",
  });
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [menuCardFile, setMenuCardFile] = useState<File | null>(null);
  const [uploadingMenuCard, setUploadingMenuCard] = useState(false);
  const [menuCardPreview, setMenuCardPreview] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    if (!branch) return;
    setBranchForm({
      name: branch.name,
      address: branch.address || "",
      phone: branch.phone || "",
      maps_url: branch.maps_url || "",
      yape_number: branch.yape_number || "",
      plin_number: branch.plin_number || "",
      payment_recipient_name: branch.payment_recipient_name || "",
      accepted_payment_methods: branch.accepted_payment_methods,
      delivery_fee: branch.delivery_fee,
      delivery_enabled: branch.delivery_enabled,
      takeaway_enabled: branch.takeaway_enabled,
      agent_context_notes: branch.agent_context_notes || "",
    });
  }, [branch]);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    if (!branch?.menu_card_configured) {
      setMenuCardPreview(null);
      return;
    }
    void apiBlob(`/branches/${branch.id}/menu-card`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setMenuCardPreview(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setMenuCardPreview(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [branch?.id, branch?.menu_card_configured]);

  async function saveBranch() {
    if (!branch) return;
    try {
      await api(`/branches/${branch.id}`, { method: "PATCH", body: JSON.stringify(branchForm) });
      await refreshTenant();
      setToast({ message: "Sucursal y medios de pago actualizados.", tone: "success" });
    } catch (caught) {
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo guardar", tone: "error" });
    }
  }

  async function uploadYapeQr() {
    if (!branch || !qrFile) return;
    setUploadingQr(true);
    try {
      const body = new FormData();
      body.append("file", qrFile);
      await api(`/branches/${branch.id}/yape-qr`, { method: "POST", body });
      setQrFile(null);
      await refreshTenant();
      setToast({ message: "QR de Yape guardado de forma privada.", tone: "success" });
    } catch (caught) {
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo subir el QR", tone: "error" });
    } finally {
      setUploadingQr(false);
    }
  }

  async function uploadMenuCard() {
    if (!branch || !menuCardFile) return;
    setUploadingMenuCard(true);
    try {
      const body = new FormData();
      body.append("file", menuCardFile);
      await api(`/branches/${branch.id}/menu-card`, { method: "POST", body });
      setMenuCardFile(null);
      await refreshTenant();
      setToast({ message: "Imagen de la carta guardada de forma privada.", tone: "success" });
    } catch (caught) {
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo subir la carta", tone: "error" });
    } finally {
      setUploadingMenuCard(false);
    }
  }

  function togglePaymentMethod(method: string) {
    setBranchForm((current) => ({
      ...current,
      accepted_payment_methods: current.accepted_payment_methods.includes(method)
        ? current.accepted_payment_methods.filter((item) => item !== method)
        : [...current.accepted_payment_methods, method],
    }));
  }

  if (!branch || !context) return <LoadingState />;
  return <div className="page-stack settings-page">
    <PageHeader
      eyebrow="Administración local"
      title="Configuración"
      description="Sucursal, pagos, carta impresa y contexto autorizado para la atención."
    />
    <section className="settings-grid">
      <article className="panel">
        <div className="panel-heading"><div><span className="eyebrow">Sucursal</span><h2>Datos operativos</h2></div><Settings2 /></div>
        <div className="form-stack">
          <label>Nombre<input value={branchForm.name} onChange={(event) => setBranchForm({ ...branchForm, name: event.target.value })} /></label>
          <label>Dirección<textarea value={branchForm.address} onChange={(event) => setBranchForm({ ...branchForm, address: event.target.value })} /></label>
          <label>Enlace de Google Maps<div className="input-with-icon"><MapPin /><input type="url" value={branchForm.maps_url} onChange={(event) => setBranchForm({ ...branchForm, maps_url: event.target.value })} placeholder="https://maps.google.com/..." /></div></label>
          <label>Teléfono<input value={branchForm.phone} onChange={(event) => setBranchForm({ ...branchForm, phone: event.target.value })} /></label>
          <label>Costo de delivery<input type="number" min="0" step="0.10" value={branchForm.delivery_fee} onChange={(event) => setBranchForm({ ...branchForm, delivery_fee: Number(event.target.value) })} /></label>
          <label className="toggle-row"><input type="checkbox" checked={branchForm.delivery_enabled} onChange={(event) => setBranchForm({ ...branchForm, delivery_enabled: event.target.checked })} /> Delivery propio habilitado</label>
          <label className="toggle-row"><input type="checkbox" checked={branchForm.takeaway_enabled} onChange={(event) => setBranchForm({ ...branchForm, takeaway_enabled: event.target.checked })} /> Recojo en local habilitado</label>
          <button className="button button-primary" onClick={() => void saveBranch()}><Save /> Guardar configuración</button>
        </div>
      </article>

      <article className="panel payment-settings">
        <div className="panel-heading"><div><span className="eyebrow">Cobros</span><h2>Yape y medios de pago</h2></div><WalletCards /></div>
        <div className="form-stack">
          <label>Titular de la cuenta<input value={branchForm.payment_recipient_name} onChange={(event) => setBranchForm({ ...branchForm, payment_recipient_name: event.target.value })} /></label>
          <label>Número de Yape<input value={branchForm.yape_number} onChange={(event) => setBranchForm({ ...branchForm, yape_number: event.target.value })} inputMode="numeric" /></label>
          <label>Número de Plin<input value={branchForm.plin_number} onChange={(event) => setBranchForm({ ...branchForm, plin_number: event.target.value })} inputMode="numeric" /></label>
          <fieldset><legend>Medios aceptados</legend><div className="payment-checks">{[["cash", "Efectivo"], ["card", "Tarjeta"], ["yape", "Yape"], ["plin", "Plin"], ["transfer", "Transferencia"]].map(([value, label]) => <label key={value}><input type="checkbox" checked={branchForm.accepted_payment_methods.includes(value)} onChange={() => togglePaymentMethod(value)} /> {label}</label>)}</div></fieldset>
          <label className="file-drop compact"><Upload /><strong>{qrFile?.name || (branch.yape_qr_configured ? "QR de Yape configurado" : "Subir QR de Yape")}</strong><small>La imagen se almacena de forma privada y el agente solo obtiene una ruta autorizada.</small><input type="file" accept="image/*" onChange={(event) => setQrFile(event.target.files?.[0] || null)} /></label>
          <button className="button button-secondary" disabled={!qrFile || uploadingQr} onClick={() => void uploadYapeQr()}>{uploadingQr ? "Subiendo..." : "Guardar QR de Yape"}</button>
          <button className="button button-primary" onClick={() => void saveBranch()}><Save /> Guardar medios de pago</button>
        </div>
      </article>

      <article className="panel settings-agent-card">
        <div className="panel-heading"><div><span className="eyebrow">Asistente del restaurante</span><h2>Carta e indicaciones</h2></div><ImageIcon /></div>
        <div className="agent-config-grid">
          <div className="menu-card-config">
            <div className={`menu-card-preview ${menuCardPreview ? "has-image" : ""}`}>
              {menuCardPreview ? <img src={menuCardPreview} alt="Carta impresa configurada" /> : <><ImageIcon /><strong>Sin carta impresa</strong><small>Sube una foto clara para que el equipo y las integraciones autorizadas puedan consultarla.</small></>}
            </div>
            <label className="file-drop compact"><Upload /><strong>{menuCardFile?.name || (branch.menu_card_configured ? "Reemplazar imagen de la carta" : "Subir imagen de la carta")}</strong><small>PNG, JPG o WEBP. Máximo 10 MB.</small><input type="file" accept="image/*" onChange={(event) => setMenuCardFile(event.target.files?.[0] || null)} /></label>
            <button className="button button-secondary" disabled={!menuCardFile || uploadingMenuCard} onClick={() => void uploadMenuCard()}>{uploadingMenuCard ? "Subiendo..." : "Guardar carta impresa"}</button>
          </div>
          <div className="agent-context-form">
            <label>Contexto para la atención<textarea rows={12} maxLength={5000} value={branchForm.agent_context_notes} onChange={(event) => setBranchForm({ ...branchForm, agent_context_notes: event.target.value })} placeholder="Ej. Tono de atención, zonas de reparto, referencias del local, políticas de recojo, ingredientes que suelen consultar..." /></label>
            <small>{branchForm.agent_context_notes.length}/5000 caracteres. No incluyas contraseñas, tokens ni datos bancarios privados.</small>
            <div className="agent-context-note"><strong>Cómo se usa</strong><p>Este texto forma parte del contexto autorizado del restaurante. El catálogo estructurado sigue siendo la fuente de precios y disponibilidad.</p></div>
            <button className="button button-primary" onClick={() => void saveBranch()}><Save /> Guardar indicaciones</button>
          </div>
        </div>
      </article>

      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">POS completo</span><h2>Módulos habilitados</h2></div><Warehouse /></div><div className="module-list">{Object.entries(context.business.modules).map(([module, enabled]) => <div key={module}><span className={enabled ? "enabled" : "disabled"}>{enabled ? <Check /> : "—"}</span><strong>{module.toUpperCase()}</strong><small>{enabled ? "Disponible para este negocio" : "Deshabilitado por el administrador"}</small></div>)}</div><div className="security-callout"><strong>Seguridad</strong><p>Las claves privadas, tokens y credenciales del agente nunca se muestran en esta aplicación.</p></div></article>
    </section>
    {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
  </div>;
}
