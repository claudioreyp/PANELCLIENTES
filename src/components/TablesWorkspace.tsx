import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  LayoutPanelTop,
  Move,
  Plus,
  Save,
  Settings2,
  TableProperties,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { api } from "../lib/api";
import { useBranchRealtime } from "../lib/hooks";
import { useQuery } from "../lib/query-session";
import { useTenant } from "../lib/tenant";
import { useTableZoneSession } from "../lib/table-zone-session";
import type { RestaurantTable } from "../types";
import { ErrorState, LoadingState, Modal, Toast } from "./ui";

import { areaColumns, areaRows, tableStatusLabel, upsertTable, useSurfaceLifetime, COLUMN_STEP, ROW_STEP, type DiningArea } from "./zone-layout";
import { ZoneEditor, EmptyZone } from "./ZoneEditor";

export type { DiningArea } from "./zone-layout";

type ToastState = { message: string; tone: "success" | "error" } | null;
type TablesWorkspaceProps = {
  onStartOrder?: (table: RestaurantTable) => void | Promise<void>;
  onOpenOrder?: (orderId: number, table: RestaurantTable) => void | Promise<void>;
};

export function TablesWorkspace(props: TablesWorkspaceProps) {
  const { branch, context } = useTenant();
  return <BranchTablesWorkspace key={`${context?.business?.id ?? "no-business"}:${branch?.id ?? "no-branch"}`} {...props} />;
}

function BranchTablesWorkspace({ onStartOrder, onOpenOrder }: TablesWorkspaceProps) {
  const { branch, context } = useTenant();
  const zoneSession = useTableZoneSession();
  const businessId = context?.business?.id;
  const active = useSurfaceLifetime();
  const [areaId, setAreaId] = useState<number | null>(() => (
    businessId != null && branch ? zoneSession?.read(businessId, branch.id) ?? null : null
  ));
  const [creatingArea, setCreatingArea] = useState(false);
  const [newAreaName, setNewAreaName] = useState("");
  const [creatingAreaBusy, setCreatingAreaBusy] = useState(false);
  const [editingArea, setEditingArea] = useState<DiningArea | null>(null);
  const [selected, setSelected] = useState<RestaurantTable | null>(null);
  const [operatingTableId, setOperatingTableId] = useState<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [movingTableId, setMovingTableId] = useState<number | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const drag = useRef<{ id: number; version: number; startX: number; startY: number; originX: number; originY: number; positionX: number; positionY: number } | null>(null);

  const resource = useQuery(["tables", branch?.id], async () => {
    if (!branch) throw new Error("Selecciona una sucursal");
    const [areas, tables] = await Promise.all([
      api<DiningArea[]>(`/areas?branch_id=${branch.id}`),
      api<RestaurantTable[]>(`/tables?branch_id=${branch.id}`),
    ]);
    return { areas, tables };
  }, 15000);
  useBranchRealtime(branch?.id, resource.refresh);

  useEffect(() => {
    // An empty in-flight or failed response says nothing about whether a zone still exists.
    if (resource.loading || resource.error || !resource.data) return;
    const nextAreaId = resource.data.areas.some((area) => area.id === areaId)
      ? areaId
      : resource.data.areas[0]?.id ?? null;
    if (nextAreaId !== areaId) setAreaId(nextAreaId);
    if (businessId != null && branch) {
      zoneSession?.select(businessId, branch.id, nextAreaId);
    }
  }, [areaId, branch, businessId, resource.data, resource.error, resource.loading, zoneSession]);

  function selectArea(nextAreaId: number) {
    setAreaId(nextAreaId);
    if (businessId != null && branch) zoneSession?.select(businessId, branch.id, nextAreaId);
  }

  const currentArea = resource.data?.areas.find((area) => area.id === areaId) || null;
  const visibleTables = resource.data?.tables.filter((table) => table.area_id === areaId) || [];
  const tableSummary = useMemo(() => {
    const tables = resource.data?.tables || [];
    return {
      available: tables.filter((table) => table.status === "available").length,
      occupied: tables.filter((table) => table.status === "occupied" || table.active_order_id != null).length,
      reserved: tables.filter((table) => table.status === "reserved").length,
      cleaning: tables.filter((table) => table.status === "cleaning").length,
    };
  }, [resource.data?.tables]);
  const canConfigure = !context?.role || ["superadmin", "owner", "manager"].includes(context.role);
  const openOrderByTable = useMemo(() => {
    const entries = (resource.data?.tables || [])
      .filter((table) => table.active_order_id != null)
      .map((table) => [table.id, table.active_order_id as number] as const);
    return new Map(entries);
  }, [resource.data?.tables]);

  if (resource.loading && !resource.data) return <LoadingState label="Preparando el panel de mesas..." />;
  if (resource.error && !resource.data) return <ErrorState message={resource.error} onRetry={() => void resource.refresh()} />;

  async function createArea() {
    if (!branch || !canConfigure || !newAreaName.trim()) return;
    setCreatingAreaBusy(true);
    try {
      const area = await api<DiningArea>("/areas", {
        method: "POST",
        body: JSON.stringify({
          branch_id: branch.id,
          name: newAreaName.trim(),
          sort_order: resource.data?.areas.length || 0,
          columns: 7,
          rows: 5,
        }),
      });
      if (!active.current) return;
      resource.setData((current) => current ? { ...current, areas: [...current.areas, area] } : current);
      selectArea(area.id);
      setCreatingArea(false);
      setNewAreaName("");
      setEditingArea(area);
    } catch (caught) {
      if (!active.current) return;
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo crear la zona.", tone: "error" });
    } finally {
      if (active.current) setCreatingAreaBusy(false);
    }
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>, table: RestaurantTable) {
    if (!editMode || movingTableId !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: table.id,
      version: table.version,
      startX: event.clientX,
      startY: event.clientY,
      originX: table.position_x,
      originY: table.position_y,
      positionX: table.position_x,
      positionY: table.position_y,
    };
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!drag.current || !resource.data || !currentArea) return;
    const maxX = Math.max(0, areaColumns(currentArea) * COLUMN_STEP - 100);
    const maxY = Math.max(0, areaRows(currentArea) * ROW_STEP - 80);
    const positionX = Math.max(0, Math.min(maxX, Math.round((drag.current.originX + event.clientX - drag.current.startX) / 8) * 8));
    const positionY = Math.max(0, Math.min(maxY, Math.round((drag.current.originY + event.clientY - drag.current.startY) / 8) * 8));
    drag.current.positionX = positionX;
    drag.current.positionY = positionY;
    resource.setData({
      ...resource.data,
      tables: resource.data.tables.map((table) => table.id === drag.current?.id ? { ...table, position_x: positionX, position_y: positionY } : table),
    });
  }

  async function pointerUp() {
    const movement = drag.current;
    drag.current = null;
    if (!movement || (movement.positionX === movement.originX && movement.positionY === movement.originY)) return;
    setMovingTableId(movement.id);
    try {
      const updated = await api<RestaurantTable>(`/tables/${movement.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          position_x: movement.positionX,
          position_y: movement.positionY,
          expected_version: movement.version,
        }),
      });
      if (!active.current) return;
      resource.setData((current) => current ? { ...current, tables: upsertTable(current.tables, updated) } : current);
    } catch (caught) {
      if (!active.current) return;
      setToast({ message: caught instanceof Error ? caught.message : "No se guardó la posición de la mesa.", tone: "error" });
      void resource.refresh();
    } finally {
      if (active.current) setMovingTableId(null);
    }
  }

  function cancelMovement() {
    const movement = drag.current;
    drag.current = null;
    if (!movement) return;
    resource.setData((current) => current ? { ...current, tables: current.tables.map((table) => table.id === movement.id ? { ...table, position_x: movement.originX, position_y: movement.originY } : table) } : current);
  }

  async function keyboardMove(event: KeyboardEvent<HTMLButtonElement>, table: RestaurantTable) {
    if (!editMode || !currentArea || !resource.data || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    if (movingTableId !== null) return;
    const distance = event.shiftKey ? 32 : 8;
    const deltaX = event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0;
    const deltaY = event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0;
    const maxX = Math.max(0, areaColumns(currentArea) * COLUMN_STEP - 100);
    const maxY = Math.max(0, areaRows(currentArea) * ROW_STEP - 80);
    const positionX = Math.max(0, Math.min(maxX, table.position_x + deltaX));
    const positionY = Math.max(0, Math.min(maxY, table.position_y + deltaY));
    if (positionX === table.position_x && positionY === table.position_y) return;
    resource.setData({
      ...resource.data,
      tables: resource.data.tables.map((item) => item.id === table.id ? { ...item, position_x: positionX, position_y: positionY } : item),
    });
    setMovingTableId(table.id);
    try {
      const updated = await api<RestaurantTable>(`/tables/${table.id}`, {
        method: "PATCH",
        body: JSON.stringify({ position_x: positionX, position_y: positionY, expected_version: table.version }),
      });
      if (!active.current) return;
      resource.setData((current) => current ? { ...current, tables: upsertTable(current.tables, updated) } : current);
    } catch (caught) {
      if (!active.current) return;
      setToast({ message: caught instanceof Error ? caught.message : "No se guardó la posición de la mesa.", tone: "error" });
      void resource.refresh();
    } finally {
      if (active.current) setMovingTableId(null);
    }
  }

  function areaTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']") || []);
    const currentIndex = tabs.indexOf(event.currentTarget);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  }

  async function markAvailable(table: RestaurantTable) {
    try {
      const updated = await api<RestaurantTable>(`/tables/${table.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "available", expected_version: table.version }),
      });
      if (!active.current) return;
      resource.setData((current) => current ? { ...current, tables: upsertTable(current.tables, updated) } : current);
      setSelected(null);
      setToast({ message: `${table.name} quedó disponible.`, tone: "success" });
    } catch (caught) {
      if (!active.current) return;
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo liberar la mesa.", tone: "error" });
    }
  }

  async function startOrder(table: RestaurantTable) {
    if (!onStartOrder) {
      setToast({ message: "Abre esta mesa desde el Panel de mesas dentro de Pedidos.", tone: "error" });
      return;
    }
    setOperatingTableId(table.id);
    setSelected(null);
    try {
      await onStartOrder(table);
    } catch (caught) {
      if (!active.current) return;
      setSelected(table);
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo abrir la mesa.", tone: "error" });
    } finally {
      if (active.current) setOperatingTableId(null);
    }
  }

  async function openOrder(table: RestaurantTable) {
    const orderId = openOrderByTable.get(table.id);
    if (!orderId) {
      setToast({ message: "La mesa figura ocupada, pero no encontramos una cuenta abierta. Actualiza el panel antes de continuar.", tone: "error" });
      return;
    }
    if (!onOpenOrder) return;
    setOperatingTableId(table.id);
    setSelected(null);
    try {
      await onOpenOrder(orderId, table);
    } catch (caught) {
      if (!active.current) return;
      setSelected(table);
      setToast({ message: caught instanceof Error ? caught.message : "No se pudo abrir la cuenta de la mesa.", tone: "error" });
    } finally {
      if (active.current) setOperatingTableId(null);
    }
  }

  function selectTable(table: RestaurantTable) {
    if (editMode || operatingTableId !== null) return;
    if (onOpenOrder && (table.status === "occupied" || table.active_order_id != null)) {
      void openOrder(table);
      return;
    }
    setSelected(table);
  }

  const floorWidth = currentArea ? Math.max(720, areaColumns(currentArea) * COLUMN_STEP + 40) : 720;
  const floorHeight = currentArea ? Math.max(440, areaRows(currentArea) * ROW_STEP + 40) : 440;

  return <section className="tables-workspace" aria-label="Panel de mesas">
    {resource.error && resource.data && <div className="orders-sync-warning" role="alert">No se pudo actualizar. Se muestra la última consulta. {resource.error}<button className="button button-secondary" onClick={() => void resource.refresh()}>Reintentar</button></div>}
    {!resource.data?.areas.length ? <div className="tables-setup-empty">
      <span className="tables-setup-icon"><LayoutPanelTop /></span>
      <h2>Gestiona los pedidos de las mesas</h2>
      <p>{canConfigure ? "Levanta comandas y cobra cuentas directamente desde este panel." : "Un administrador debe configurar las zonas y mesas antes de comenzar."}</p>
      {canConfigure && <button className="tables-setup-action" type="button" onClick={() => setCreatingArea(true)}>Configurar zonas y mesas <ChevronRight /></button>}
    </div> : <>
      <section className="tables-summary-strip" aria-label="Resumen de mesas">
        <div className="tables-summary-date"><CalendarDays /><span><strong>Hoy</strong><small>{new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short" }).format(new Date())}</small></span></div>
        <div><strong>{tableSummary.available}</strong><span>{tableSummary.available === 1 ? "mesa libre" : "mesas libres"}</span></div>
        <div><strong>{tableSummary.occupied}</strong><span>{tableSummary.occupied === 1 ? "mesa activa" : "mesas activas"}</span></div>
        <div><strong>{tableSummary.reserved}</strong><span>{tableSummary.reserved === 1 ? "mesa reservada" : "mesas reservadas"}</span></div>
        <div><strong>{tableSummary.cleaning}</strong><span>{tableSummary.cleaning === 1 ? "mesa por limpiar" : "mesas por limpiar"}</span></div>
      </section>

      <section className="tables-zone-panel">
        <header className="tables-workspace-toolbar">
          <div className="table-area-tabs" role="tablist" aria-label="Zonas del restaurante">
            {resource.data.areas.map((area) => <button key={area.id} type="button" role="tab" id={`area-tab-${area.id}`} aria-controls={`area-panel-${area.id}`} aria-selected={area.id === areaId} tabIndex={area.id === areaId ? 0 : -1} className={area.id === areaId ? "active" : ""} onClick={() => { selectArea(area.id); setEditMode(false); }} onKeyDown={areaTabKeyDown}>{area.name}</button>)}
          </div>
          {canConfigure && <div className="tables-workspace-actions">
            {!!visibleTables.length && <button className={`button ${editMode ? "button-primary" : "button-secondary"}`} type="button" onClick={() => setEditMode((current) => !current)}>{editMode ? <Save /> : <Move />}{editMode ? "Terminar movimiento" : "Mover mesas"}</button>}
            {currentArea && !!visibleTables.length && <button className="button button-secondary" type="button" onClick={() => setEditingArea(currentArea)}><Settings2 /> Editar sala</button>}
            <button className="button button-secondary" type="button" onClick={() => setCreatingArea(true)}><Plus /> Nueva zona</button>
          </div>}
        </header>

        {currentArea && <>
          {!visibleTables.length ? <div id={`area-panel-${currentArea.id}`} role="tabpanel" aria-labelledby={`area-tab-${currentArea.id}`} className="zone-empty-panel"><EmptyZone canConfigure={canConfigure} onAdd={() => setEditingArea(currentArea)} /></div> : <>
          <div id={`area-panel-${currentArea.id}`} role="tabpanel" aria-labelledby={`area-tab-${currentArea.id}`} className={`tables-operational-floor ${editMode ? "editing" : ""} ${!visibleTables.length ? "empty" : ""}`} aria-label={`Plano de ${currentArea.name}`}>
            <div className="tables-floor-canvas" style={{ width: visibleTables.length ? floorWidth : "100%", height: visibleTables.length ? floorHeight : 510 }}>
              {visibleTables.map((table) => <button
                key={table.id}
                type="button"
                className={`operational-table floor-${table.shape} table-${table.status}`}
                style={{ transform: `translate(${table.position_x}px, ${table.position_y}px)`, width: table.width, height: table.height }}
                aria-label={`${table.name}, ${tableStatusLabel(table.status)}, capacidad ${table.capacity}`}
                aria-busy={operatingTableId === table.id}
                onClick={() => selectTable(table)}
                onPointerDown={(event) => pointerDown(event, table)}
                onPointerMove={pointerMove}
                onPointerUp={() => void pointerUp()}
                onPointerCancel={cancelMovement}
                onKeyDown={(event) => void keyboardMove(event, table)}
              ><strong>{table.name}</strong><span><Users /> {table.capacity}</span><small>{tableStatusLabel(table.status)}</small>{editMode && <Move />}</button>)}

            </div>
          </div>
          <div className={`tables-mobile-list ${!visibleTables.length ? "empty" : ""}`}>{visibleTables.length ? visibleTables.map((table) => <button key={table.id} type="button" className={`table-mobile-card table-${table.status}`} aria-busy={operatingTableId === table.id} onClick={() => selectTable(table)}><span><strong>{table.name}</strong><small>{tableStatusLabel(table.status)}</small></span><span><Users /> {table.capacity}</span></button>) : null}</div>
        </>}
        </>}
      </section>
    </>}

    {canConfigure && creatingArea && <Modal title="Agrega una zona" onClose={() => !creatingAreaBusy && setCreatingArea(false)}><form className="form-stack" onSubmit={(event) => { event.preventDefault(); void createArea(); }}><label>Nombre de zona<input data-dialog-initial-focus value={newAreaName} maxLength={120} onChange={(event) => setNewAreaName(event.target.value)} placeholder="Ej. Sala principal" /></label><p className="form-help">Al continuar podrás definir el tamaño del espacio y colocar cada mesa.</p><div className="modal-form-actions"><button className="button button-secondary" type="button" disabled={creatingAreaBusy} onClick={() => setCreatingArea(false)}>Cancelar</button><button className="button button-primary" type="submit" disabled={creatingAreaBusy || !newAreaName.trim()}>{creatingAreaBusy ? "Creando..." : "Continuar"}</button></div></form></Modal>}

    {canConfigure && editingArea && <ZoneEditor
      key={editingArea.id}
      area={editingArea}
      tables={resource.data?.tables.filter((table) => table.area_id === editingArea.id) || []}
      onClose={() => setEditingArea(null)}
      onProgress={(area, tables) => {
        if (!active.current) return;
        const savedIds = new Set(tables.map((table) => table.id));
        resource.setData((current) => current ? {
          areas: current.areas.map((item) => item.id === area.id ? area : item),
          tables: current.tables.filter((table) => !savedIds.has(table.id)).concat(tables),
        } : current);
      }}
      onSaved={(area) => {
        if (!active.current) return;
        selectArea(area.id);
        setEditingArea(null);
        setToast({ message: `Las mesas quedaron guardadas en ${area.name}.`, tone: "success" });
      }}
    />}

    {selected && <Modal title={selected.status === "available" ? `${selected.name} disponible` : selected.name} onClose={() => operatingTableId === null && setSelected(null)}><div className="table-account-dialog table-open-dialog"><div className={`table-account-preview table-${selected.status}`}><TableProperties /><strong>{selected.name}</strong><span><Users /> {selected.capacity} personas</span></div>{selected.status === "available" && <><p>Abre la mesa para empezar a agregar productos.</p><button className="button button-primary button-large" type="button" disabled={operatingTableId !== null} onClick={() => void startOrder(selected)}>{operatingTableId === selected.id ? "Abriendo mesa..." : "Abrir mesa"}</button></>}{selected.status === "reserved" && <><p>Esta mesa está reservada. Ábrela cuando el cliente haya llegado.</p><button className="button button-primary button-large" type="button" disabled={operatingTableId !== null} onClick={() => void startOrder(selected)}>{operatingTableId === selected.id ? "Abriendo mesa..." : "Abrir mesa reservada"}</button></>}{selected.status === "occupied" && <button className="button button-primary button-large" type="button" disabled={operatingTableId !== null} onClick={() => void openOrder(selected)}>{operatingTableId === selected.id ? "Abriendo cuenta..." : "Ver cuenta abierta"}</button>}{selected.status === "cleaning" && <button className="button button-primary button-large" type="button" disabled={operatingTableId !== null} onClick={() => void markAvailable(selected)}><CheckCircle2 /> Marcar mesa libre</button>}</div></Modal>}
    {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
  </section>;
}
