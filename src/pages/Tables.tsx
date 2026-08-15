import { CheckCircle2, Grid2X2Plus, Move, Plus, Save, Users } from "lucide-react";
import { useRef, useState, type PointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { usePolling } from "../lib/hooks";
import { useTenant } from "../lib/tenant";
import type { RestaurantTable } from "../types";
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader, StatusPill, Toast } from "../components/ui";

type Area = { id: number; name: string; sort_order: number };

export function TablesPage() {
  const { branch } = useTenant();
  const navigate = useNavigate();
  const [areaId, setAreaId] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState<RestaurantTable | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCapacity, setNewCapacity] = useState(4);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const drag = useRef<{ id: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  const resource = usePolling(async () => {
    if (!branch) throw new Error("Selecciona una sucursal");
    const [areas, tables] = await Promise.all([
      api<Area[]>(`/areas?branch_id=${branch.id}`),
      api<RestaurantTable[]>(`/tables?branch_id=${branch.id}`),
    ]);
    if (!areaId && areas[0]) setAreaId(areas[0].id);
    return { areas, tables };
  }, [branch?.id], 15000);

  if (resource.loading && !resource.data) return <LoadingState />;
  if (resource.error && !resource.data) return <ErrorState message={resource.error} onRetry={() => void resource.refresh()} />;
  const data = resource.data!;
  const visible = data.tables.filter((table) => !areaId || table.area_id === areaId);

  function pointerDown(event: PointerEvent<HTMLButtonElement>, table: RestaurantTable) {
    if (!editMode) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: table.id, startX: event.clientX, startY: event.clientY, originX: table.position_x, originY: table.position_y };
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!drag.current || !resource.data) return;
    const x = Math.max(0, Math.round((drag.current.originX + event.clientX - drag.current.startX) / 10) * 10);
    const y = Math.max(0, Math.round((drag.current.originY + event.clientY - drag.current.startY) / 10) * 10);
    resource.setData({ ...resource.data, tables: resource.data.tables.map((table) => table.id === drag.current?.id ? { ...table, position_x: x, position_y: y } : table) });
  }

  async function pointerUp(table: RestaurantTable) {
    if (!drag.current || !resource.data) return;
    const moved = resource.data.tables.find((item) => item.id === drag.current?.id);
    drag.current = null;
    if (!moved) return;
    try {
      await api(`/tables/${table.id}`, { method: "PATCH", body: JSON.stringify({ position_x: moved.position_x, position_y: moved.position_y, expected_version: table.version }) });
      void resource.refresh();
    } catch (caught) {
      setToast({ message: caught instanceof Error ? caught.message : "No se guardó la posición", tone: "error" });
      void resource.refresh();
    }
  }

  async function createTable() {
    if (!branch || !newName.trim()) return;
    try {
      await api("/tables", { method: "POST", body: JSON.stringify({ branch_id: branch.id, area_id: areaId, code: newName.trim().toUpperCase().replace(/\s+/g, "-"), name: newName.trim(), capacity: newCapacity, position_x: 40, position_y: 40 }) });
      setCreating(false); setNewName(""); setNewCapacity(4); await resource.refresh();
      setToast({ message: "Mesa creada en el plano.", tone: "success" });
    } catch (caught) { setToast({ message: caught instanceof Error ? caught.message : "No se pudo crear", tone: "error" }); }
  }

  async function markAvailable(table: RestaurantTable) {
    try {
      await api(`/tables/${table.id}`, { method: "PATCH", body: JSON.stringify({ status: "available", expected_version: table.version }) });
      setSelected(null); await resource.refresh();
    } catch (caught) { setToast({ message: caught instanceof Error ? caught.message : "No se pudo actualizar", tone: "error" }); }
  }

  return (
    <div className="page-stack tables-page">
      <PageHeader eyebrow="Servicio de salón" title="Mapa de mesas" description="Abre cuentas y mantén el salón sincronizado con caja y cocina." actions={<><button className={`button ${editMode ? "button-primary" : "button-secondary"}`} onClick={() => setEditMode(!editMode)}>{editMode ? <Save /> : <Move />}{editMode ? "Terminar edición" : "Editar plano"}</button><button className="button button-primary" onClick={() => setCreating(true)}><Plus /> Nueva mesa</button></>} />
      <div className="area-tabs">{data.areas.map((area) => <button key={area.id} className={areaId === area.id ? "active" : ""} onClick={() => setAreaId(area.id)}>{area.name}</button>)}</div>
      <section className={`floor-plan panel ${editMode ? "editing" : ""}`}>
        <div className="floor-grid" />
        {visible.map((table) => <button
          key={table.id}
          className={`floor-table floor-${table.shape} table-${table.status}`}
          style={{ transform: `translate(${table.position_x}px, ${table.position_y}px)`, width: table.width, height: table.height }}
          onClick={() => !editMode && setSelected(table)}
          onPointerDown={(event) => pointerDown(event, table)}
          onPointerMove={pointerMove}
          onPointerUp={() => void pointerUp(table)}
        ><strong>{table.name}</strong><span><Users /> {table.capacity}</span><small>{table.status.replace("available", "libre").replace("reserved", "reservada").replace("occupied", "ocupada").replace("cleaning", "limpieza")}</small>{editMode && <Move className="drag-handle" />}</button>)}
        {!visible.length && <EmptyState title="Aún no hay mesas" detail="Crea una mesa para empezar a dibujar este salón." />}
        {editMode && <div className="edit-hint"><Move /> Arrastra las mesas. Cada movimiento se guarda al soltar.</div>}
      </section>
      <div className="table-legend">{(["available", "reserved", "occupied", "cleaning"] as const).map((status) => <span key={status}><i className={`table-dot table-${status}`} />{status.replace("available", "Libre").replace("reserved", "Reservada").replace("occupied", "Ocupada").replace("cleaning", "Limpieza")}</span>)}</div>
      {selected && <Modal title={selected.name} onClose={() => setSelected(null)}><div className="table-detail"><div className={`table-preview table-${selected.status}`}><strong>{selected.name}</strong><Users /> {selected.capacity} personas</div><StatusPill value={selected.status} />{selected.status === "available" && <button className="button button-primary button-large" onClick={() => navigate(`/pos?table=${selected.id}`)}><Grid2X2Plus /> Abrir mesa y tomar pedido</button>}{selected.status === "occupied" && <button className="button button-secondary button-large" onClick={() => navigate(`/pedidos?table=${selected.id}`)}>Ver cuenta abierta</button>}{selected.status === "cleaning" && <button className="button button-primary button-large" onClick={() => void markAvailable(selected)}><CheckCircle2 /> Marcar mesa libre</button>}</div></Modal>}
      {creating && <Modal title="Nueva mesa" onClose={() => setCreating(false)}><div className="form-stack"><label>Nombre<input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Ej. Mesa 12" /></label><label>Capacidad<input type="number" min="1" max="30" value={newCapacity} onChange={(event) => setNewCapacity(Number(event.target.value))} /></label><button className="button button-primary button-large" onClick={() => void createTable()}><Plus /> Crear mesa</button></div></Modal>}
      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
