import { ArrowUpRight, Filter, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../../lib/api";
import { useBranchRealtime } from "../../lib/hooks";
import { positiveRouteId } from "../../lib/audit-navigation";
import { formatPosDate } from "../../lib/pos-dates";
import { auditActorName } from "../../lib/settings";
import { useTenant } from "../../lib/tenant";
import type { PagedSettings, SecurityAuditDetail, SecurityAuditEntry, SecurityAuditField } from "../../types/settings";
import { ErrorState, LoadingState, Modal } from "../ui";
import { SettingsCard, SettingsFeedback, SettingsPagination, SettingsSectionHeader, SettingsSkeleton, SettingsTable } from "./SettingsPrimitives";
import { useSettingsEnabled, useSettingsQuery, type SettingsQuery } from "./SettingsState";
import "./security-audit.css";

const categories = [
  ["order_cancellation", "Pedidos cancelados"],
  ["item_cancellation", "Platos cancelados"],
  ["amount_reduction", "Reducciones de importe"],
  ["cash_withdrawal", "Retiros de efectivo"],
  ["cash_discrepancy", "Cortes con diferencias"],
  ["refund_method_change", "Reembolsos con otro método"],
];

const actionLabels: Record<string, string> = {
  "order.cancelled": "canceló un pedido",
  "order.items_revised": "modificó productos de un pedido",
  "cash.movement_created": "registró un movimiento de efectivo",
};

function displaySummary(entry: SecurityAuditEntry) {
  return entry.summary || actionLabels[entry.action] || "registró una acción";
}

function useAuditRefresh(branchId: number, query: SettingsQuery<PagedSettings<SecurityAuditEntry>>, path: string) {
  const enabled = useSettingsEnabled();
  const latest = useRef(query);
  latest.current = query;
  const lifetime = useRef<{ active: boolean; pending: boolean; running: boolean; timer: number | null } | null>(null);
  const refresh = useCallback(() => {
    const current = lifetime.current;
    if (!current?.active || !enabled || document.visibilityState === "hidden") return;
    current.pending = true;
    if (current.timer !== null || current.running || latest.current.loading) return;
    current.timer = window.setTimeout(() => {
      current.timer = null;
      if (!current.active || lifetime.current !== current || document.visibilityState === "hidden") return;
      if (latest.current.loading) return;
      current.pending = false;
      current.running = true;
      void latest.current.reload().finally(() => {
        current.running = false;
        if (current.active && current.pending) refresh();
      });
    }, 100);
  }, [enabled]);
  useBranchRealtime(enabled ? branchId : undefined, refresh);
  useEffect(() => {
    const current = { active: enabled, pending: false, running: false, timer: null as number | null };
    lifetime.current = current;
    const visibility = () => { if (document.visibilityState !== "hidden") refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      current.active = false;
      if (current.timer !== null) window.clearTimeout(current.timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled, path, refresh, query.reload]);
  useEffect(() => {
    if (!query.loading && lifetime.current?.pending) refresh();
  }, [query.loading, refresh]);
}

function AuditFields({ fields }: { fields: SecurityAuditField[] }) {
  return fields.length > 0 && <dl className="security-audit-fields">{fields.map((field, index) => <div key={`${field.label}:${index}`}><dt>{field.label}</dt><dd>{field.value ?? (field.label.toLowerCase().includes("motivo") ? "Motivo no registrado" : "Dato no registrado")}</dd></div>)}</dl>;
}

function targetPath(detail: SecurityAuditDetail, branchId: number) {
  const target = detail.target;
  if (!target || target.branch_id !== branchId) return null;
  if (target.kind === "order" && positiveRouteId(String(target.order_id))) return `/pedidos?order_id=${target.order_id}`;
  if (target.kind === "cash_movement" && positiveRouteId(String(target.register_id)) && positiveRouteId(String(target.movement_id))) {
    return `/caja?tab=movements&register_id=${target.register_id}&movement_id=${target.movement_id}`;
  }
  if (target.kind === "cash_cut" && positiveRouteId(String(target.register_id)) && positiveRouteId(String(target.cut_id))) {
    return `/caja?register_id=${target.register_id}&cut_id=${target.cut_id}`;
  }
  return null;
}

function AuditDetail({ id, branchId, returnTo, onClose }: { id: number; branchId: number; returnTo: string; onClose: () => void }) {
  const enabled = useSettingsEnabled();
  const [data, setData] = useState<SecurityAuditDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    if (!enabled) { setData(null); setLoading(false); return; }
    setLoading(true);
    setError(null);
    api<SecurityAuditDetail>(`/settings/audit/${id}?branch_id=${branchId}`).then((detail) => {
      if (!current) return;
      if (detail.id !== id || detail.branch_id !== branchId || !Array.isArray(detail.fields) || !Array.isArray(detail.sections)) throw new Error("No se puede consultar esta acción en la sucursal actual.");
      setData(detail);
    }).catch((caught) => {
      if (current) {
        if (caught instanceof ApiError && [401, 403].includes(caught.status)) setData(null);
        setError(caught instanceof Error ? caught.message : "No se pudo consultar la acción.");
      }
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [id, branchId, reload, enabled]);
  const path = data && targetPath(data, branchId);
  if (!enabled) return null;
  return <Modal title="Detalle de la acción" className="security-audit-detail" onClose={onClose}>
    {error && <div role="alert" className="security-audit-feedback">{data && <span>Conservamos el último detalle confirmado.</span>}<ErrorState message={error} onRetry={() => setReload((value) => value + 1)} /></div>}
    {!data && loading && <LoadingState label="Consultando la acción..." />}
    {data && <>
      <div className="security-audit-heading"><time dateTime={data.occurred_at}>{formatPosDate(data.occurred_at, { dateStyle: "medium", timeStyle: "short" })}</time><p><strong>{auditActorName(data.actor_name)}</strong> {data.summary}</p></div>
      {path && <Link className="audit-navigation-link" to={path} state={{ auditReturnTo: returnTo, auditBranchId: branchId }}>{data.target?.label}<ArrowUpRight aria-hidden="true" /></Link>}
      <AuditFields fields={data.fields} />
      {data.sections.map((section, index) => <section className="security-audit-section" key={`${section.title}:${index}`}><h3>{section.title}</h3><AuditFields fields={section.fields} /></section>)}
      {!data.fields.length && !data.sections.length && <p>Esta acción no tiene más datos registrados.</p>}
    </>}
  </Modal>;
}

export function SecurityAuditSettings() {
  const { branch } = useTenant();
  return <BranchSecurityAudit key={branch?.id ?? "none"} branchId={branch?.id ?? 0} />;
}

function BranchSecurityAudit({ branchId }: { branchId: number }) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const belongsHere = !params.has("audit_branch_id") || params.get("audit_branch_id") === String(branchId);
  const filters = {
    from: belongsHere ? params.get("from") || "" : "",
    to: belongsHere ? params.get("to") || "" : "",
    category: belongsHere && categories.some(([value]) => value === params.get("category")) ? params.get("category")! : "",
    action: belongsHere ? params.get("action") || "" : "",
  };
  const page = belongsHere ? positiveRouteId(params.get("page")) || 1 : 1;
  const [draft, setDraft] = useState(filters);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const rowRefs = useRef(new Map<number, HTMLButtonElement>());
  const restored = useRef<string | null>(null);
  const queryParams = new URLSearchParams({ branch_id: String(branchId), page: String(page), page_size: "10", critical_only: "true" });
  for (const [key, value] of Object.entries(filters)) if (value) queryParams.set(key, value);
  const path = `/settings/audit?${queryParams}`;
  const query = useSettingsQuery<PagedSettings<SecurityAuditEntry>>(path, { items: [], page, page_size: 10, total: 0 }, { keepPreviousData: true });
  useAuditRefresh(branchId, query, path);
  const restoreId = belongsHere ? positiveRouteId(params.get("focus_event")) : null;
  useEffect(() => {
    if (!query.loading && restoreId && restored.current !== location.key && rowRefs.current.has(restoreId)) {
      rowRefs.current.get(restoreId)?.focus();
      restored.current = location.key;
    }
  }, [query.loading, restoreId, location.key]);

  function updateQuery(next: typeof filters, nextPage: number) {
    const search = new URLSearchParams({ audit_branch_id: String(branchId), page: String(nextPage) });
    for (const [key, value] of Object.entries(next)) if (value) search.set(key, value);
    setParams(search, { replace: true, state: location.state });
  }

  const returnParams = new URLSearchParams(queryParams);
  returnParams.delete("branch_id");
  returnParams.delete("page_size");
  returnParams.delete("critical_only");
  returnParams.set("audit_branch_id", String(branchId));
  if (selectedId) returnParams.set("focus_event", String(selectedId));
  const hasError = query.error || query.notice;
  return <div className="settings-section-stack settings-security-audit">
    <SettingsSectionHeader title="Historial de seguridad" description="Consulta cancelaciones, reducciones de importe, retiros, cortes con diferencias y reembolsos con otro método." action={<button className="button button-secondary" type="button" disabled={query.loading} onClick={() => { if (page !== 1) updateQuery(filters, 1); else void query.reload(); }}><RefreshCw />Actualizar historial</button>} />
    {hasError && <div className="security-audit-feedback">{query.available && query.data.items.length > 0 && <p>Se muestra el último historial confirmado. Reintenta para consultar los cambios recientes.</p>}<SettingsFeedback error={query.error} notice={query.notice} /><button className="button button-secondary" type="button" onClick={() => void query.reload()}>Reintentar</button></div>}
    <SettingsCard>
      <form className="security-audit-filters" onSubmit={(event) => { event.preventDefault(); if (draft.from && draft.to && draft.from > draft.to) { setFilterError("La fecha inicial no puede ser posterior a la final."); return; } setFilterError(null); updateQuery(draft, 1); }}>
        <label>Desde<input type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
        <label>Hasta<input type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
        <label>Acción<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value, action: "" })}><option value="">Todas las acciones críticas</option>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="button button-secondary" type="submit"><Filter />Filtros</button>
      </form>
      {filterError && <SettingsFeedback error={filterError} />}
      {query.loading && !query.data.items.length ? <SettingsSkeleton /> : query.data.items.length ? <>
        <SettingsTable label="Historial de seguridad"><thead><tr><th>Acción</th><th>Fecha</th></tr></thead><tbody>{query.data.items.map((entry) => <tr className="security-audit-row" key={entry.id} onClick={() => { rowRefs.current.get(entry.id)?.focus(); setSelectedId(entry.id); }}>
          <td data-label="Acción"><button type="button" ref={(node) => { if (node) rowRefs.current.set(entry.id, node); else rowRefs.current.delete(entry.id); }} onClick={(event) => { event.stopPropagation(); event.currentTarget.focus(); setSelectedId(entry.id); }}><strong>{entry.actor_name}</strong> {displaySummary(entry)}</button></td>
          <td data-label="Fecha"><time dateTime={entry.occurred_at}>{formatPosDate(entry.occurred_at, { dateStyle: "medium", timeStyle: "short" })}</time></td>
        </tr>)}</tbody></SettingsTable>
        <SettingsPagination page={query.data.page || page} pageSize={10} total={query.data.total} onPage={(next) => updateQuery(filters, next)} noun="acciones" />
      </> : !hasError && <div className="security-audit-empty"><strong>Sin acciones críticas para mostrar</strong><p>No hay acciones críticas que coincidan con estos filtros.</p></div>}
    </SettingsCard>
    {selectedId && <AuditDetail key={selectedId} id={selectedId} branchId={branchId} returnTo={`/configuracion/seguridad?${returnParams}`} onClose={() => setSelectedId(null)} />}
  </div>;
}
