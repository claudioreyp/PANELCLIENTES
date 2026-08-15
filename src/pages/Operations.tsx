import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileSpreadsheet,
  MapPin,
  PackagePlus,
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
import { api } from "../lib/api";
import { useBranchRealtime, usePolling } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import type { Catalog, InventoryItem, Order, Reservation, RestaurantTable } from "../types";
import { EmptyState, ErrorState, LoadingState, MetricCard, Modal, Money, PageHeader, StatusPill, Toast } from "../components/ui";

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
    stock_quantity?: number | null;
  }[];
  created?: number;
  updated?: number;
};

function CatalogImportModal({ branchId, onClose, onImported }: { branchId: number; onClose: () => void; onImported: () => Promise<void> }) {
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
      "sku,name,category,price,description,available,preparation_station,stock_quantity,stock_unit,minimum_stock,recipe_quantity",
      "PIZ-001,Pizza Pepperoni,Pizzas,32.00,Pizza familiar,true,kitchen,20,unit,3,1",
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
        {result.preview.length > 0 && <div className="data-table-wrap"><table className="data-table"><thead><tr><th>SKU</th><th>Producto</th><th>Categoría</th><th>Precio</th><th>Stock</th></tr></thead><tbody>{result.preview.map((item) => <tr key={item.sku}><td>{item.sku}</td><td><strong>{item.name}</strong></td><td>{item.category}</td><td><Money value={item.price} /></td><td>{item.stock_quantity ?? "Sin control"}</td></tr>)}</tbody></table></div>}
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
  const { branch } = useTenant();
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);
  const [delta, setDelta] = useState(0);
  const [movementType, setMovementType] = useState("adjustment");
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [form, setForm] = useState({ sku: "", name: "", unit: "unit", quantity: 0, minimum_stock: 0, unit_cost: 0 });
  const [toast, setToast] = useState<ToastState>(null);
  const resource = usePolling(async () => branch ? api<InventoryItem[]>(`/inventory?branch_id=${branch.id}`) : Promise.reject(new Error("Selecciona una sucursal")), [branch?.id], 20000);
  useBranchRealtime(branch?.id, resource.refresh);

  async function adjust() {
    if (!adjusting || !delta) return;
    try {
      await api(`/inventory/${adjusting.id}/adjust`, { method: "POST", body: JSON.stringify({ movement_type: movementType, quantity_delta: delta, note: note || null, expected_version: adjusting.version }) });
      setAdjusting(null); setDelta(0); setNote(""); await resource.refresh(); setToast({ message: "Movimiento de stock registrado.", tone: "success" });
    } catch (caught) { setToast({ message: caught instanceof Error ? caught.message : "No se pudo ajustar", tone: "error" }); }
  }
  async function createItem() {
    if (!branch || !form.name || !form.sku) return;
    try {
      await api("/inventory", { method: "POST", body: JSON.stringify({ ...form, branch_id: branch.id }) });
      setCreating(false); setForm({ sku: "", name: "", unit: "unit", quantity: 0, minimum_stock: 0, unit_cost: 0 }); await resource.refresh();
    } catch (caught) { setToast({ message: caught instanceof Error ? caught.message : "No se pudo crear", tone: "error" }); }
  }
  if (resource.loading && !resource.data) return <LoadingState />;
  if (resource.error && !resource.data) return <ErrorState message={resource.error} />;
  const items = resource.data || [];
  const low = items.filter((item) => item.low_stock);
  return <div className="page-stack inventory-page"><PageHeader eyebrow="Insumos y recetas" title="Inventario" description="Cada confirmación de pedido descuenta insumos según receta." actions={<><button className="button button-secondary" onClick={() => setImporting(true)}><FileSpreadsheet /> Importar carta</button><button className="button button-primary" onClick={() => setCreating(true)}><PackagePlus /> Nuevo insumo</button></>} /><section className="metrics-grid"><MetricCard label="Insumos activos" value={items.length} /><MetricCard label="Stock bajo" value={low.length} tone={low.length ? "orange" : "green"} hint="Igual o menor al mínimo" /><MetricCard label="Valor estimado" value={<Money value={items.reduce((sum, item) => sum + item.quantity * item.unit_cost, 0)} />} /></section>{low.length > 0 && <div className="warning-banner"><AlertTriangle /><div><strong>{low.length} insumo(s) necesitan atención</strong><span>{low.map((item) => item.name).join(", ")}</span></div></div>}<section className="panel data-table-wrap"><table className="data-table"><thead><tr><th>Insumo</th><th>SKU</th><th>Stock actual</th><th>Mínimo</th><th>Costo unitario</th><th>Estado</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.unit}</small></td><td>{item.sku}</td><td><strong>{item.quantity} {item.unit}</strong></td><td>{item.minimum_stock} {item.unit}</td><td><Money value={item.unit_cost} /></td><td><StatusPill value={item.low_stock ? "low_stock" : "healthy"} /></td><td><button className="button button-ghost" onClick={() => { setAdjusting(item); setDelta(0); }}>Ajustar</button></td></tr>)}</tbody></table></section>{adjusting && <Modal title={`Ajustar ${adjusting.name}`} onClose={() => setAdjusting(null)}><div className="form-stack"><p>Stock actual: <strong>{adjusting.quantity} {adjusting.unit}</strong></p><label>Tipo<select value={movementType} onChange={(event) => setMovementType(event.target.value)}><option value="purchase">Compra / ingreso</option><option value="adjustment">Ajuste</option><option value="waste">Merma</option></select></label><label>Variación<input type="number" step="0.001" value={delta} onChange={(event) => setDelta(Number(event.target.value))} /><small>Usa negativo para salida o merma.</small></label><label>Motivo<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="button button-primary" onClick={() => void adjust()}><Save /> Registrar movimiento</button></div></Modal>}{creating && <Modal title="Nuevo insumo" onClose={() => setCreating(false)}><div className="form-stack form-grid">{Object.entries(form).map(([key, value]) => <label key={key}>{key.replaceAll("_", " ")}<input type={typeof value === "number" ? "number" : "text"} step="0.001" value={value} onChange={(event) => setForm((current) => ({ ...current, [key]: typeof value === "number" ? Number(event.target.value) : event.target.value }))} /></label>)}<button className="button button-primary button-large" onClick={() => void createItem()}><Plus /> Crear insumo</button></div></Modal>}{importing && branch && <CatalogImportModal branchId={branch.id} onClose={() => setImporting(false)} onImported={async () => { await resource.refresh(); setToast({ message: "Catálogo e inventario importados correctamente.", tone: "success" }); }} />}{toast && <Toast {...toast} onDismiss={() => setToast(null)} />}</div>;
}

type Register = { id: number; name: string; active: boolean };
type CashSession = { id: number; register_id: number; status: string; opening_amount: number; expected_amount: number; declared_amount?: number | null; difference?: number | null; opened_at: string };

export function CashPage() {
  const { branch } = useTenant();
  const [opening, setOpening] = useState(false);
  const [registerId, setRegisterId] = useState<number | null>(null);
  const [openingAmount, setOpeningAmount] = useState(0);
  const [movementOpen, setMovementOpen] = useState(false);
  const [movementType, setMovementType] = useState("income");
  const [movementAmount, setMovementAmount] = useState(0);
  const [movementNote, setMovementNote] = useState("");
  const [closing, setClosing] = useState(false);
  const [declared, setDeclared] = useState(0);
  const [toast, setToast] = useState<ToastState>(null);
  const resource = usePolling(async () => {
    if (!branch) throw new Error("Selecciona una sucursal");
    const [registers, sessions] = await Promise.all([api<Register[]>(`/cash/registers?branch_id=${branch.id}`), api<CashSession[]>(`/cash/sessions?branch_id=${branch.id}`)]);
    return { registers, sessions };
  }, [branch?.id], 12000);
  const current = resource.data?.sessions.find((session) => session.status === "open") || null;

  async function openSession() {
    if (!registerId) return;
    try { await api("/cash/sessions/open", { method: "POST", body: JSON.stringify({ register_id: registerId, opening_amount: openingAmount }) }); setOpening(false); await resource.refresh(); } catch (caught) { setToast({ message: caught instanceof Error ? caught.message : "No se pudo abrir", tone: "error" }); }
  }
  async function movement() {
    if (!current || movementAmount <= 0) return;
    try { await api(`/cash/sessions/${current.id}/movements`, { method: "POST", body: JSON.stringify({ movement_type: movementType, amount: movementAmount, note: movementNote || null }) }); setMovementOpen(false); setMovementAmount(0); setMovementNote(""); await resource.refresh(); } catch (caught) { setToast({ message: caught instanceof Error ? caught.message : "No se pudo registrar", tone: "error" }); }
  }
  async function closeSession() {
    if (!current) return;
    try { const result = await api<{ difference: number }>(`/cash/sessions/${current.id}/close`, { method: "POST", body: JSON.stringify({ declared_amount: declared }) }); setClosing(false); await resource.refresh(); setToast({ message: `Caja cerrada. Diferencia: S/ ${result.difference.toFixed(2)}`, tone: result.difference === 0 ? "success" : "error" }); } catch (caught) { setToast({ message: caught instanceof Error ? caught.message : "No se pudo cerrar", tone: "error" }); }
  }
  if (resource.loading && !resource.data) return <LoadingState />;
  if (resource.error && !resource.data) return <ErrorState message={resource.error} />;
  return <div className="page-stack cash-page"><PageHeader eyebrow="Control de turno" title="Caja" description="Apertura, movimientos y cierre declarado con diferencia visible." actions={!current ? <button className="button button-primary" onClick={() => { setRegisterId(resource.data?.registers[0]?.id || null); setOpening(true); }}><WalletCards /> Abrir caja</button> : <><button className="button button-secondary" onClick={() => setMovementOpen(true)}><Plus /> Movimiento</button><button className="button button-primary" onClick={() => { setDeclared(current.expected_amount); setClosing(true); }}><Banknote /> Cerrar caja</button></>} />{current ? <section className="cash-hero"><div><span className="eyebrow light">Turno abierto</span><h2>{resource.data?.registers.find((item) => item.id === current.register_id)?.name}</h2><p>Desde {new Date(current.opened_at).toLocaleString("es-PE")}</p></div><div><span>Efectivo esperado</span><strong><Money value={current.expected_amount} /></strong><small>Incluye apertura y movimientos en efectivo</small></div></section> : <section className="empty-cash"><CircleDollarSign /><h2>No hay una caja abierta</h2><p>Abre un turno antes de registrar cobros en efectivo.</p></section>}<section className="metrics-grid"><MetricCard label="Saldo inicial" value={<Money value={current?.opening_amount || 0} />} /><MetricCard label="Esperado ahora" value={<Money value={current?.expected_amount || 0} />} tone="green" /><MetricCard label="Turnos anteriores" value={(resource.data?.sessions.length || 0) - (current ? 1 : 0)} /></section><section className="panel data-table-wrap"><table className="data-table"><thead><tr><th>Turno</th><th>Estado</th><th>Apertura</th><th>Esperado</th><th>Declarado</th><th>Diferencia</th></tr></thead><tbody>{resource.data?.sessions.map((session) => <tr key={session.id}><td><strong>#{session.id}</strong><small>{new Date(session.opened_at).toLocaleDateString("es-PE")}</small></td><td><StatusPill value={session.status} /></td><td><Money value={session.opening_amount} /></td><td><Money value={session.expected_amount} /></td><td>{session.declared_amount == null ? "—" : <Money value={session.declared_amount} />}</td><td>{session.difference == null ? "—" : <Money value={session.difference} />}</td></tr>)}</tbody></table></section>{opening && <Modal title="Abrir caja" onClose={() => setOpening(false)}><div className="form-stack"><label>Caja<select value={registerId || ""} onChange={(event) => setRegisterId(Number(event.target.value))}>{resource.data?.registers.map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}</select></label><label>Saldo inicial<input type="number" min="0" step="0.01" value={openingAmount} onChange={(event) => setOpeningAmount(Number(event.target.value))} /></label><button className="button button-primary" onClick={() => void openSession()}>Abrir turno</button></div></Modal>}{movementOpen && <Modal title="Movimiento de caja" onClose={() => setMovementOpen(false)}><div className="form-stack"><label>Tipo<select value={movementType} onChange={(event) => setMovementType(event.target.value)}><option value="income">Ingreso</option><option value="withdrawal">Retiro</option><option value="expense">Gasto</option></select></label><label>Monto<input type="number" min="0.01" value={movementAmount} onChange={(event) => setMovementAmount(Number(event.target.value))} /></label><label>Motivo<textarea value={movementNote} onChange={(event) => setMovementNote(event.target.value)} /></label><button className="button button-primary" onClick={() => void movement()}>Registrar</button></div></Modal>}{closing && current && <Modal title="Cerrar caja" onClose={() => setClosing(false)}><div className="form-stack"><div className="reconciliation"><span>Esperado</span><strong><Money value={current.expected_amount} /></strong></div><label>Efectivo declarado<input type="number" min="0" step="0.01" value={declared} onChange={(event) => setDeclared(Number(event.target.value))} /></label><div className="reconciliation"><span>Diferencia calculada</span><strong><Money value={declared - current.expected_amount} /></strong></div><button className="button button-primary" onClick={() => void closeSession()}>Confirmar cierre</button></div></Modal>}{toast && <Toast {...toast} onDismiss={() => setToast(null)} />}</div>;
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
  });
  const [categoryName, setCategoryName] = useState("");
  const [productForm, setProductForm] = useState({ category_id: "", sku: "", name: "", description: "", price: 0, preparation_station: "kitchen" });
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const catalog = usePolling(async () => branch ? api<Catalog>(`/catalog?branch_id=${branch.id}`) : Promise.reject(new Error("Selecciona una sucursal")), [branch?.id], 30000);

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
    });
  }, [branch]);

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

  function togglePaymentMethod(method: string) {
    setBranchForm((current) => ({
      ...current,
      accepted_payment_methods: current.accepted_payment_methods.includes(method)
        ? current.accepted_payment_methods.filter((item) => item !== method)
        : [...current.accepted_payment_methods, method],
    }));
  }

  async function createCategory() { if (!branch || !categoryName) return; try { await api("/catalog/categories", { method: "POST", body: JSON.stringify({ branch_id: branch.id, name: categoryName }) }); setCategoryName(""); await catalog.refresh(); } catch (caught) { setToast({ message: caught instanceof Error ? caught.message : "No se pudo crear", tone: "error" }); } }
  async function createProduct() { if (!branch || !productForm.name || !productForm.sku || !productForm.category_id) return; try { await api("/catalog/products", { method: "POST", body: JSON.stringify({ ...productForm, branch_id: branch.id, category_id: Number(productForm.category_id) }) }); setProductForm({ category_id: "", sku: "", name: "", description: "", price: 0, preparation_station: "kitchen" }); await catalog.refresh(); setToast({ message: "Producto agregado a la carta.", tone: "success" }); } catch (caught) { setToast({ message: caught instanceof Error ? caught.message : "No se pudo crear", tone: "error" }); } }
  if (!branch || !context) return <LoadingState />;
  return <div className="page-stack settings-page">
    <PageHeader eyebrow="Administración local" title="Configuración" description="Sucursal, pagos, catálogo y módulos disponibles para este negocio." />
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
          <label className="file-drop compact"><Upload /><strong>{qrFile?.name || (branch.yape_qr_storage_path ? "QR de Yape configurado" : "Subir QR de Yape")}</strong><small>La imagen se almacena de forma privada y el agente solo obtiene una ruta autorizada.</small><input type="file" accept="image/*" onChange={(event) => setQrFile(event.target.files?.[0] || null)} /></label>
          <button className="button button-secondary" disabled={!qrFile || uploadingQr} onClick={() => void uploadYapeQr()}>{uploadingQr ? "Subiendo..." : "Guardar QR de Yape"}</button>
          <button className="button button-primary" onClick={() => void saveBranch()}><Save /> Guardar medios de pago</button>
        </div>
      </article>

      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">Plan {context.business.plan}</span><h2>Módulos habilitados</h2></div><Warehouse /></div><div className="module-list">{Object.entries(context.business.modules).map(([module, enabled]) => <div key={module}><span className={enabled ? "enabled" : "disabled"}>{enabled ? <Check /> : "—"}</span><strong>{module.toUpperCase()}</strong><small>{enabled ? "Disponible para este negocio" : "Deshabilitado por el administrador"}</small></div>)}</div><div className="security-callout"><strong>Seguridad</strong><p>Las claves privadas, tokens y credenciales del agente nunca se muestran en esta aplicación.</p></div></article>
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">Carta</span><h2>Nueva categoría</h2></div><Plus /></div><div className="inline-form"><input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Ej. Bebidas" /><button className="button button-primary" onClick={() => void createCategory()}>Crear</button></div><div className="category-chip-list">{catalog.data?.categories.map((category) => <span key={category.id} style={{ borderColor: category.color }}>{category.name}</span>)}</div></article>
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">Carta</span><h2>Nuevo producto</h2></div><PackagePlus /></div><div className="form-grid form-stack"><label>Categoría<select value={productForm.category_id} onChange={(event) => setProductForm({ ...productForm, category_id: event.target.value })}><option value="">Seleccionar</option>{catalog.data?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>SKU<input value={productForm.sku} onChange={(event) => setProductForm({ ...productForm, sku: event.target.value })} /></label><label>Nombre<input value={productForm.name} onChange={(event) => setProductForm({ ...productForm, name: event.target.value })} /></label><label>Precio<input type="number" min="0" step="0.01" value={productForm.price} onChange={(event) => setProductForm({ ...productForm, price: Number(event.target.value) })} /></label><label>Estación<select value={productForm.preparation_station} onChange={(event) => setProductForm({ ...productForm, preparation_station: event.target.value })}><option value="kitchen">Cocina</option><option value="bar">Barra</option><option value="cold">Fríos</option></select></label><label className="full-field">Descripción<textarea value={productForm.description} onChange={(event) => setProductForm({ ...productForm, description: event.target.value })} /></label><button className="button button-primary full-field" onClick={() => void createProduct()}><Plus /> Agregar producto</button></div></article>
    </section>
    {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
  </div>;
}
