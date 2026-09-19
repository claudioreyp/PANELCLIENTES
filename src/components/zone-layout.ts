import { useLayoutEffect, useRef } from "react";
import type { RestaurantTable } from "../types";

export type DiningArea = {
  id: number;
  branch_id: number;
  name: string;
  sort_order: number;
  columns?: number;
  rows?: number;
  version?: number;
};

export type Cell = { row: number; column: number };
export type TableShape = "square" | "round" | "rectangle";

export const COLUMN_STEP = 128;
export const ROW_STEP = 104;
export const CELL_OFFSET = 28;
export const BASE_TABLE_WIDTH = 92;
export const BASE_TABLE_HEIGHT = 76;

export function areaColumns(area: DiningArea) {
  return Math.max(2, Number(area.columns || 7));
}

export function areaRows(area: DiningArea) {
  return Math.max(2, Number(area.rows || 5));
}

export function tableStatusLabel(status: RestaurantTable["status"]) {
  return {
    available: "Libre",
    reserved: "Reservada",
    occupied: "Ocupada",
    cleaning: "Por limpiar",
  }[status];
}

export function tableCell(table: RestaurantTable, columns: number, rows: number): Cell {
  return {
    column: Math.max(0, Math.min(columns - 1, Math.round((table.position_x - CELL_OFFSET) / COLUMN_STEP))),
    row: Math.max(0, Math.min(rows - 1, Math.round((table.position_y - CELL_OFFSET) / ROW_STEP))),
  };
}

export function tableWidthUnits(table: RestaurantTable) {
  return Math.max(1, Math.round((table.width - BASE_TABLE_WIDTH) / COLUMN_STEP) + 1);
}

export function tableHeightUnits(table: RestaurantTable) {
  return Math.max(1, Math.round((table.height - BASE_TABLE_HEIGHT) / ROW_STEP) + 1);
}

export function widthForUnits(units: number) {
  return BASE_TABLE_WIDTH + Math.max(0, units - 1) * COLUMN_STEP;
}

export function heightForUnits(units: number) {
  return BASE_TABLE_HEIGHT + Math.max(0, units - 1) * ROW_STEP;
}

export function tableIdentifier(name: string) {
  return name.replace(/^Mesa\s+/i, "").trim() || name.trim();
}

export function tableNameFromIdentifier(identifier: string) {
  const value = identifier.trim();
  if (!value) return "";
  return /^Mesa\s+/i.test(value) ? value : `Mesa ${value}`;
}

export function editableTableSnapshot(table: RestaurantTable) {
  return JSON.stringify({
    name: table.name,
    capacity: table.capacity,
    position_x: table.position_x,
    position_y: table.position_y,
    width: table.width,
    height: table.height,
    shape: table.shape,
  });
}

export function upsertTable(tables: RestaurantTable[], next: RestaurantTable) {
  return tables.some((table) => table.id === next.id)
    ? tables.map((table) => table.id === next.id ? next : table)
    : [...tables, next];
}

export function useSurfaceLifetime() {
  const active = useRef(true);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  return active;
}

// Capture one committed context, so disabling and re-enabling cannot revive late responses.
export function useZoneLifetime(enabled: boolean) {
  const lifetime = useRef({ active: enabled });
  useLayoutEffect(() => {
    const current = { active: enabled };
    lifetime.current = current;
    return () => { current.active = false; };
  }, [enabled]);
  return () => {
    const current = lifetime.current;
    return () => current.active && lifetime.current === current;
  };
}
