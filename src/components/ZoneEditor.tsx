import { ChevronLeft, LogOut, TableProperties, Minus, MoveHorizontal, MoveVertical, Plus, Save } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { DialogPortal, useDialogSurface } from "../lib/dialog";
import type { RestaurantTable } from "../types";
import { useDirtyRegistration } from "./settings/SettingsState";
import {
  areaColumns, areaRows, tableCell, tableWidthUnits, tableHeightUnits, widthForUnits,
  heightForUnits, tableIdentifier, tableNameFromIdentifier, editableTableSnapshot,
  tableStatusLabel, useZoneLifetime, COLUMN_STEP, ROW_STEP, CELL_OFFSET,
  BASE_TABLE_WIDTH, BASE_TABLE_HEIGHT, type DiningArea, type Cell, type TableShape,
} from "./zone-layout";
import "./zone-editor.css";

type ZoneEditorProps = {
  area: DiningArea;
  tables: RestaurantTable[];
  onClose: () => void;
  onProgress: (area: DiningArea, tables: RestaurantTable[]) => void;
  onSaved: (area: DiningArea) => void;
  enabled?: boolean;
  settingsLayer?: boolean;
};

export function ZoneEditor({ area, tables, onClose, onProgress, onSaved, enabled = true, settingsLayer = false }: ZoneEditorProps) {
  const titleId = useId();
  const captureLifetime = useZoneLifetime(enabled);
  const [error, setError] = useState<string | null>(null);
  const onError = setError;
  const savingRef = useRef(false);
  const pendingCreates = useRef(new Set<string>());
  const [areaBaseline, setAreaBaseline] = useState(area);
  const [tableBaseline, setTableBaseline] = useState(() => new Map(tables.map((table) => [table.id, table])));
  const [name, setName] = useState(area.name);
  const [columns, setColumns] = useState(areaColumns(area));
  const [rows, setRows] = useState(areaRows(area));
  const [localTables, setLocalTables] = useState<RestaurantTable[]>(tables);
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const nextDraftId = useRef(-1);
  const selectedTable = localTables.find((table) => table.id === selectedTableId) || null;
  const areaDirty = name.trim() !== areaBaseline.name || columns !== areaColumns(areaBaseline) || rows !== areaRows(areaBaseline);
  const tablesDirty = localTables.some((table) => {
    const baseline = tableBaseline.get(table.id);
    return !baseline || editableTableSnapshot(table) !== editableTableSnapshot(baseline);
  });
  const dirty = areaDirty || tablesDirty;
  useDirtyRegistration({ dirty, saving: enabled && saving, save: null });
  useLayoutEffect(() => {
    savingRef.current = false;
    setSaving(false);
  }, [enabled]);
  const locked = saving || !enabled;

  function requestClose() {
    if (!enabled || savingRef.current) return;
    if (dirty && !window.confirm("¿Salir sin guardar los cambios de la zona?")) return;
    onClose();
  }

  useEffect(() => {
    if (!dirty && !saving) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty, saving]);

  const surfaceRef = useDialogSurface(requestClose, { enabled });
  const occupiedCells = useMemo(() => {
    const next = new Set<string>();
    localTables.forEach((table) => {
      const cell = tableCell(table, columns, rows);
      const width = Math.min(tableWidthUnits(table), columns - cell.column);
      const height = Math.min(tableHeightUnits(table), rows - cell.row);
      for (let row = cell.row; row < cell.row + height; row += 1) {
        for (let column = cell.column; column < cell.column + width; column += 1) {
          next.add(`${row}:${column}`);
        }
      }
    });
    return next;
  }, [columns, localTables, rows]);
  const usedColumns = Math.max(2, ...localTables.map((table) => tableCell(table, 12, 10).column + tableWidthUnits(table)));
  const usedRows = Math.max(2, ...localTables.map((table) => tableCell(table, 12, 10).row + tableHeightUnits(table)));

  function addDraftTable(cell: Cell) {
    if (!enabled || savingRef.current) return;
    const usedIdentifiers = new Set(localTables.map((table) => tableIdentifier(table.name).toLocaleLowerCase("es")));
    let identifier = 1;
    while (usedIdentifiers.has(String(identifier))) identifier += 1;
    const id = nextDraftId.current;
    nextDraftId.current -= 1;
    const draft: RestaurantTable = {
      id,
      branch_id: area.branch_id,
      area_id: area.id,
      code: `Z${area.id}-${Date.now().toString(36)}-${Math.abs(id)}`.toUpperCase().slice(0, 40),
      name: `Mesa ${identifier}`,
      capacity: 4,
      position_x: CELL_OFFSET + cell.column * COLUMN_STEP,
      position_y: CELL_OFFSET + cell.row * ROW_STEP,
      width: BASE_TABLE_WIDTH,
      height: BASE_TABLE_HEIGHT,
      shape: "square",
      status: "available",
      version: 1,
    };
    setLocalTables((current) => [...current, draft]);
    setSelectedTableId(id);
  }

  function updateSelectedTable(changes: Partial<RestaurantTable>) {
    if (!enabled || savingRef.current || !selectedTable) return;
    setLocalTables((current) => current.map((table) => table.id === selectedTable.id ? { ...table, ...changes } : table));
  }

  function resizeSelected(axis: "width" | "height", nextUnits: number) {
    if (!enabled || savingRef.current || !selectedTable) return;
    const cell = tableCell(selectedTable, columns, rows);
    const width = axis === "width" ? nextUnits : tableWidthUnits(selectedTable);
    const height = axis === "height" ? nextUnits : tableHeightUnits(selectedTable);
    if (width < 1 || height < 1 || cell.column + width > columns || cell.row + height > rows) return;
    const overlaps = localTables.some((table) => {
      if (table.id === selectedTable.id) return false;
      const other = tableCell(table, columns, rows);
      const otherWidth = tableWidthUnits(table);
      const otherHeight = tableHeightUnits(table);
      return cell.column < other.column + otherWidth
        && cell.column + width > other.column
        && cell.row < other.row + otherHeight
        && cell.row + height > other.row;
    });
    if (overlaps) {
      onError("Ese tamaño ocuparía el espacio de otra mesa. Elige otra dimensión.");
      return;
    }
    updateSelectedTable(axis === "width" ? { width: widthForUnits(width) } : { height: heightForUnits(height) });
  }

  function validateTables() {
    if (!name.trim()) {
      onError("Escribe un nombre para la zona antes de guardar.");
      return false;
    }
    const normalizedNames = localTables.map((table) => table.name.trim().toLocaleLowerCase("es"));
    if (normalizedNames.some((tableName) => !tableName)) {
      onError("Todas las mesas necesitan un identificador antes de guardar.");
      return false;
    }
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      onError("Cada mesa necesita un identificador diferente.");
      return false;
    }
    return true;
  }

  function requestSave() {
    void saveArea();
  }

  async function saveArea() {
    if (!enabled || savingRef.current || !validateTables()) return;
    const isCurrent = captureLifetime();
    if (!isCurrent()) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    let updatedArea = areaBaseline;
    let workingTables: RestaurantTable[] = localTables.map((table) => ({ ...table, area_id: area.id }));
    const nextBaseline = new Map(tableBaseline);
    try {
      if (areaDirty) {
        updatedArea = await api<DiningArea>(`/areas/${area.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: name.trim(),
            columns,
            rows,
            expected_version: areaBaseline.version || 1,
          }),
        });
        if (!isCurrent()) return;
        setAreaBaseline(updatedArea);
        onProgress(updatedArea, []);
      }

      for (const candidate of [...workingTables]) {
        if (!isCurrent()) return;
        let baseline = nextBaseline.get(candidate.id);
        if (!baseline && pendingCreates.current.has(candidate.code)) {
          const persisted = await api<RestaurantTable[]>(`/tables?branch_id=${area.branch_id}`);
          if (!isCurrent()) return;
          baseline = persisted.find((table) => table.code === candidate.code && table.area_id === area.id && table.branch_id === area.branch_id);
          if (baseline) {
            // Keep the confirmed identity even if applying a newer draft to it fails.
            const confirmed = baseline;
            workingTables = workingTables.map((table) => table.id === candidate.id ? { ...table, id: confirmed.id, version: confirmed.version } : table);
            nextBaseline.set(baseline.id, baseline);
            setLocalTables(workingTables);
            setTableBaseline(new Map(nextBaseline));
            if (selectedTableId === candidate.id) setSelectedTableId(baseline.id);
            onProgress(updatedArea, [baseline]);
          }
          pendingCreates.current.delete(candidate.code);
        }
        if (baseline && nextBaseline.has(candidate.id) && candidate.area_id === baseline.area_id && editableTableSnapshot(candidate) === editableTableSnapshot(baseline)) continue;
        const payload = baseline ? {
          area_id: area.id,
          name: candidate.name.trim(),
          capacity: candidate.capacity,
          position_x: candidate.position_x,
          position_y: candidate.position_y,
          width: candidate.width,
          height: candidate.height,
          shape: candidate.shape,
          expected_version: baseline.version,
        } : {
          branch_id: candidate.branch_id,
          area_id: area.id,
          code: candidate.code,
          name: candidate.name.trim(),
          capacity: candidate.capacity,
          position_x: candidate.position_x,
          position_y: candidate.position_y,
          width: candidate.width,
          height: candidate.height,
          shape: candidate.shape,
        };
        if (!baseline) pendingCreates.current.add(candidate.code);
        const saved = baseline && editableTableSnapshot(candidate) === editableTableSnapshot(baseline) ? baseline : await api<RestaurantTable>(baseline ? `/tables/${baseline.id}` : "/tables", {
          method: baseline ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        });
        if (!isCurrent()) return;
        pendingCreates.current.delete(candidate.code);
        workingTables = workingTables.map((table) => table.id === candidate.id || table.id === baseline?.id ? saved : table);
        nextBaseline.delete(candidate.id);
        nextBaseline.set(saved.id, saved);
        if (selectedTableId === candidate.id) setSelectedTableId(saved.id);
        setLocalTables(workingTables);
        setTableBaseline(new Map(nextBaseline));
        onProgress(updatedArea, [saved]);
      }

      onSaved(updatedArea);
    } catch (caught) {
      if (!isCurrent()) return;
      setLocalTables(workingTables);
      setTableBaseline(new Map(nextBaseline));
      onError(caught instanceof Error ? caught.message : "No se pudo guardar la zona.");
    } finally {
      if (isCurrent()) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }

  const selectedCell = selectedTable ? tableCell(selectedTable, columns, rows) : null;
  const selectedWidth = selectedTable ? tableWidthUnits(selectedTable) : 1;
  const selectedHeight = selectedTable ? tableHeightUnits(selectedTable) : 1;
  const gridCells = Array.from({ length: rows * columns }, (_, index) => ({
    row: Math.floor(index / columns),
    column: index % columns,
  }));

  return <>
    <DialogPortal>
      <div className={`zone-editor-backdrop${settingsLayer ? " zone-editor-settings-layer" : ""}`} hidden={!enabled}>
        <section ref={surfaceRef} className="zone-editor" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={saving} tabIndex={-1}>
          <header className="zone-editor-header"><button className="zone-editor-exit" type="button" disabled={locked} onClick={requestClose}><LogOut /> Salir</button><h2 id={titleId}>{name.trim() || area.name}</h2><button className="button button-primary" type="button" disabled={locked || !name.trim()} onClick={requestSave}><Save /> {saving ? "Guardando..." : "Guardar"}</button></header>
        <div className="zone-editor-layout">
          <aside className={`zone-editor-sidebar ${selectedTable ? "editing-table" : "editing-zone"}`}>
            {error && <p className="zone-editor-error" role="alert">{error}</p>}
            {saving && <p className="zone-editor-note" role="status">Espera a que termine el guardado para seguir editando.</p>}
            {selectedTable ? <>
              <button className="zone-table-back" type="button" disabled={locked} onClick={() => enabled && !savingRef.current && setSelectedTableId(null)}><ChevronLeft /><span role="heading" aria-level={3}>Mesa {tableIdentifier(selectedTable.name)}</span></button>
              <label>Identificador de mesa<input data-dialog-initial-focus disabled={locked} value={tableIdentifier(selectedTable.name)} maxLength={80} onChange={(event) => updateSelectedTable({ name: tableNameFromIdentifier(event.target.value) })} /></label>
              <label>Forma<select disabled={locked} value={selectedTable.shape} onChange={(event) => updateSelectedTable({ shape: event.target.value as TableShape })}><option value="square">Cuadrada</option><option value="round">Redonda</option><option value="rectangle">Rectangular</option></select></label>
              <label>Capacidad<input disabled={locked} type="number" min="1" max="50" value={selectedTable.capacity} onChange={(event) => updateSelectedTable({ capacity: Math.max(1, Math.min(50, Number(event.target.value) || 1)) })} /></label>
              <div className="zone-table-dimensions">
                <div role="group" aria-label="Ancho"><span>Ancho</span>{selectedWidth === 1 ? <button className="zone-expand-button" type="button" aria-label="Expandir ancho" disabled={locked || !selectedCell || selectedCell.column + 2 > columns} onClick={() => resizeSelected("width", 2)}><MoveHorizontal /> Expandir</button> : <span className="zone-stepper"><button type="button" aria-label="Reducir ancho" disabled={locked} onClick={() => resizeSelected("width", selectedWidth - 1)}><Minus /></button><output aria-label="Ancho actual">{selectedWidth}</output><button type="button" aria-label="Aumentar ancho" disabled={locked || !selectedCell || selectedCell.column + selectedWidth + 1 > columns} onClick={() => resizeSelected("width", selectedWidth + 1)}><Plus /></button></span>}</div>
                <div role="group" aria-label="Altura"><span>Altura</span>{selectedHeight === 1 ? <button className="zone-expand-button" type="button" aria-label="Expandir altura" disabled={locked || !selectedCell || selectedCell.row + 2 > rows} onClick={() => resizeSelected("height", 2)}><MoveVertical /> Expandir</button> : <span className="zone-stepper"><button type="button" aria-label="Reducir altura" disabled={locked} onClick={() => resizeSelected("height", selectedHeight - 1)}><Minus /></button><output aria-label="Altura actual">{selectedHeight}</output><button type="button" aria-label="Aumentar altura" disabled={locked || !selectedCell || selectedCell.row + selectedHeight + 1 > rows} onClick={() => resizeSelected("height", selectedHeight + 1)}><Plus /></button></span>}</div>
              </div>
              <p className="zone-editor-note">Los cambios se aplicarán al pulsar Guardar.</p>
            </> : <>
              <h3>Zona {name.trim() || area.name}</h3>
              <label>Nombre de zona<input data-dialog-initial-focus disabled={locked} value={name} maxLength={120} onChange={(event) => enabled && !savingRef.current && setName(event.target.value)} /></label>
              <label className="zone-size-control"><span>Columnas</span><span><input aria-label="Columnas" disabled={locked} type="range" min={usedColumns} max="12" value={columns} onChange={(event) => enabled && !savingRef.current && setColumns(Number(event.target.value))} /><output>{columns}</output></span></label>
              <label className="zone-size-control"><span>Filas</span><span><input aria-label="Filas" disabled={locked} type="range" min={usedRows} max="10" value={rows} onChange={(event) => enabled && !savingRef.current && setRows(Number(event.target.value))} /><output>{rows}</output></span></label>
              <p className="zone-editor-note">Pulsa un espacio para agregar una mesa. Pulsa una mesa para ajustar su identificador, forma y tamaño.</p>
            </>}
          </aside>
          <main className="zone-editor-canvas"><div className="zone-grid" style={{
            gridTemplateColumns: `repeat(${columns}, ${BASE_TABLE_WIDTH}px)`,
            gridTemplateRows: `repeat(${rows}, ${BASE_TABLE_HEIGHT}px)`,
            minWidth: columns * COLUMN_STEP - (COLUMN_STEP - BASE_TABLE_WIDTH),
            minHeight: rows * ROW_STEP - (ROW_STEP - BASE_TABLE_HEIGHT),
          }}>
            {gridCells.filter((cell) => !occupiedCells.has(`${cell.row}:${cell.column}`)).map((cell) => <button key={`${cell.row}:${cell.column}`} type="button" disabled={locked} className="zone-grid-add" style={{ gridColumn: cell.column + 1, gridRow: cell.row + 1 }} aria-label={`Agregar mesa en fila ${cell.row + 1}, columna ${cell.column + 1}`} onClick={() => addDraftTable(cell)}><Plus /></button>)}
            {localTables.map((table) => {
              const cell = tableCell(table, columns, rows);
              const width = Math.min(tableWidthUnits(table), columns - cell.column);
              const height = Math.min(tableHeightUnits(table), rows - cell.row);
              return <button key={table.id} type="button" disabled={locked} className={`zone-grid-table shape-${table.shape} table-${table.status} ${table.id === selectedTableId ? "selected" : ""}`} style={{ gridColumn: `${cell.column + 1} / span ${width}`, gridRow: `${cell.row + 1} / span ${height}` }} aria-label={`Editar ${table.name}`} aria-pressed={table.id === selectedTableId} onClick={() => enabled && !savingRef.current && setSelectedTableId(table.id)}><strong>{tableIdentifier(table.name)}</strong><span className="visually-hidden">Capacidad {table.capacity}. {tableStatusLabel(table.status)}.</span></button>;
            })}
          </div></main>
        </div>
        </section>
      </div>
    </DialogPortal>

  </>;
}

export function EmptyZone({ canConfigure, onAdd }: { canConfigure: boolean; onAdd: () => void }) {
  return <div className="tables-floor-empty zone-empty-state">
    <span className="tables-floor-empty-icon" aria-hidden="true"><TableProperties /></span>
    <strong>No hay mesas en esta zona</strong>
    <p>{canConfigure ? "Agrega mesas para empezar a tomar pedidos en esta zona." : "Pide a un administrador que agregue las mesas."}</p>
    {canConfigure && <button className="button button-primary" type="button" onClick={onAdd}><Plus /> Agregar mesas</button>}
  </div>;
}
