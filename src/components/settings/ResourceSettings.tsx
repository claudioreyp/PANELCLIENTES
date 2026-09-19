import { MapPinned, Plus, Vault } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { DialogPortal, useDialogSurface } from "../../lib/dialog";
import { archiveSettingsResource, saveSettings, settingsErrorMessage } from "../../lib/settings";
import type { RestaurantTable } from "../../types";
import type { SettingsRegister } from "../../types/settings";
import { ZoneEditor } from "../ZoneEditor";
import { upsertTable, useZoneLifetime, type DiningArea } from "../zone-layout";
import {
  SettingsActionMenu,
  SettingsCard,
  SettingsConfirmDialog,
  SettingsDrawer,
  SettingsFeedback,
  SettingsSectionHeader,
  SettingsSkeleton,
} from "./SettingsPrimitives";
import { useDirtyRegistration, useSettingsDraft, useSettingsQuery } from "./SettingsState";

function ZoneNameDialog({ enabled, busy, error, onClose, onCreate }: {
  enabled: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const titleId = useId();
  useDirtyRegistration({ dirty: Boolean(name), saving: enabled && busy, save: null });
  function requestClose() {
    if (!enabled || busy) return;
    if (name) setConfirmClose(true);
    else onClose();
  }
  const surfaceRef = useDialogSurface(requestClose, { enabled });
  return <DialogPortal>
    <div className="zone-name-backdrop" hidden={!enabled}>
      <section className="zone-name-dialog" ref={surfaceRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId}>Agrega una zona</h2>
        <form onSubmit={(event) => { event.preventDefault(); if (enabled && !busy && name.trim()) onCreate(name.trim()); }}>
          <SettingsFeedback error={error} />
          <label className="settings-field">Nombre de zona<input data-dialog-initial-focus disabled={!enabled || busy} value={name} maxLength={120} onChange={(event) => { if (enabled && !busy) setName(event.target.value); }} placeholder="Ej. Sala principal" /></label>
          <p className="form-help">Al continuar podrás definir el tamaño del espacio y colocar cada mesa.</p>
          <footer><button className="button button-secondary" type="button" disabled={!enabled || busy} onClick={requestClose}>Cancelar</button><button className="button button-primary" type="submit" disabled={!enabled || busy || !name.trim()}>{busy ? "Creando..." : "Continuar"}</button></footer>
        </form>
      </section>
    </div>
    {enabled && confirmClose && <SettingsConfirmDialog title="Tienes cambios sin guardar" detail="Se perderá el nombre de la zona que todavía no has creado." confirmLabel="Descartar cambios" danger onCancel={() => setConfirmClose(false)} onConfirm={onClose} />}
  </DialogPortal>;
}

export function ZonesAndTablesSettings({ branchId }: { branchId: number }) {
  // Settings keeps its previous section mounted while a context change is confirmed.
  const [originBranchId] = useState(branchId);
  const areasQuery = useSettingsQuery<DiningArea[]>(`/areas?branch_id=${originBranchId}`, []);
  const tablesQuery = useSettingsQuery<RestaurantTable[]>(`/tables?branch_id=${originBranchId}`, []);
  const enabled = branchId === originBranchId && areasQuery.available && tablesQuery.available;
  const ready = enabled && !areasQuery.loading && !tablesQuery.loading && !areasQuery.error && !tablesQuery.error;
  const captureLifetime = useZoneLifetime(enabled);
  const [creating, setCreating] = useState(false);
  const [editor, setEditor] = useState<{ area: DiningArea; tables: RestaurantTable[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [areaArchiveTarget, setAreaArchiveTarget] = useState<DiningArea | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  useDirtyRegistration({ dirty: false, saving: enabled && saving, save: null });
  useLayoutEffect(() => {
    savingRef.current = false;
    setSaving(false);
  }, [enabled]);

  function openArea(area: DiningArea) {
    if (!ready || savingRef.current || area.branch_id !== originBranchId) return;
    setError(null);
    setSuccess(null);
    setEditor({ area, tables: tablesQuery.data.filter((table) => table.area_id === area.id && table.branch_id === originBranchId) });
  }

  async function createArea(name: string) {
    if (!ready || savingRef.current || !name.trim()) return;
    const isCurrent = captureLifetime();
    if (!isCurrent()) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveSettings<Record<string, unknown>, DiningArea>("/areas", {
        branch_id: originBranchId,
        name: name.trim(),
        sort_order: areasQuery.data.length,
        columns: 7,
        rows: 5,
      }, "POST");
      if (!isCurrent()) return;
      if (saved.branch_id !== originBranchId) throw new Error("La zona recibida no pertenece a esta sucursal. Actualiza la lista antes de continuar.");
      areasQuery.setData((current) => [...current.filter((area) => area.id !== saved.id), saved]);
      setCreating(false);
      setEditor({ area: saved, tables: [] });
    } catch (caught) {
      if (isCurrent()) setError(settingsErrorMessage(caught, "No se pudo crear la zona."));
    } finally {
      if (isCurrent()) { savingRef.current = false; setSaving(false); }
    }
  }

  async function archiveSelectedArea() {
    if (!areaArchiveTarget || !ready || savingRef.current) return;
    if (tablesQuery.data.some((table) => table.area_id === areaArchiveTarget.id)) {
      setError("Mueve las mesas a otra zona antes de archivarla.");
      setAreaArchiveTarget(null);
      return;
    }
    const isCurrent = captureLifetime();
    if (!isCurrent()) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await archiveSettingsResource(`/areas/${areaArchiveTarget.id}`, areaArchiveTarget.version || 1);
      if (!isCurrent()) return;
      areasQuery.setData((current) => current.filter((area) => area.id !== areaArchiveTarget.id));
      setAreaArchiveTarget(null);
      setSuccess("La zona se archivó y su historial permanece intacto.");
      void areasQuery.reload(true);
    } catch (caught) {
      if (isCurrent()) setError(settingsErrorMessage(caught, "No se pudo archivar la zona."));
    } finally {
      if (isCurrent()) { savingRef.current = false; setSaving(false); }
    }
  }

  const loading = areasQuery.loading || tablesQuery.loading;
  const loadFailed = Boolean(areasQuery.error || tablesQuery.error || (!loading && !enabled));
  return <div className="settings-section-stack settings-zones">
    <SettingsSectionHeader title="Zonas y mesas" description="Organiza las áreas del local y las mesas disponibles para atención."
      action={<button className="button button-primary" type="button" disabled={!ready || saving} onClick={() => { setError(null); setSuccess(null); setCreating(true); }}><Plus />Nueva zona</button>} />
    <SettingsFeedback notice={areasQuery.notice || tablesQuery.notice} error={areasQuery.error || tablesQuery.error || (!creating ? error : null)} success={success} />
    {loadFailed && <button className="button button-secondary" type="button" disabled={loading || saving} onClick={() => { void areasQuery.reload(); void tablesQuery.reload(); }}>Reintentar</button>}
    {loading && !areasQuery.data.length ? <SettingsSkeleton rows={4} /> : <SettingsCard className="settings-list-card">
      <div className="settings-list-heading">Nombre de zona</div>
      {areasQuery.data.map((area) => {
        const count = tablesQuery.data.filter((table) => table.area_id === area.id).length;
        return <div className="settings-resource-row" key={area.id}>
          <button className="settings-resource-copy zone-open-button" type="button" disabled={!ready || saving} onClick={() => openArea(area)} aria-label={`Editar zona ${area.name}`}><MapPinned /><span><strong>{area.name}</strong><small>{tablesQuery.available && !tablesQuery.error ? `${count} ${count === 1 ? "mesa" : "mesas"}` : "Mesas no disponibles"}</small></span></button>
          <SettingsActionMenu onEdit={() => openArea(area)} editDisabled={!ready || saving} onArchive={() => { if (ready && !savingRef.current) setAreaArchiveTarget(area); }}
            archiveDisabled={!ready || saving || count > 0} archiveHelp={count > 0 ? "Mueve las mesas a otra zona antes de archivarla." : !ready ? "Carga las mesas antes de archivar una zona." : undefined} />
        </div>;
      })}
      {!loading && !loadFailed && !areasQuery.data.length && <div className="settings-empty-inline"><MapPinned /><strong>Aún no hay zonas</strong><span>Crea una zona para comenzar a organizar tus mesas.</span></div>}
    </SettingsCard>}
    {creating && <ZoneNameDialog enabled={enabled} busy={saving} error={error} onClose={() => setCreating(false)} onCreate={(name) => void createArea(name)} />}
    {editor && <ZoneEditor key={editor.area.id} area={editor.area} tables={editor.tables} enabled={enabled} settingsLayer
      onClose={() => setEditor(null)}
      onProgress={(area, tables) => {
        if (!enabled) return;
        areasQuery.setData((current) => current.map((item) => item.id === area.id ? area : item));
        tablesQuery.setData((current) => tables.reduce(upsertTable, current));
      }}
      onSaved={(area) => {
        if (!enabled) return;
        setEditor(null);
        setSuccess(`Las mesas quedaron guardadas en ${area.name}.`);
      }} />}
    {enabled && areaArchiveTarget && <SettingsConfirmDialog title="Archivar zona" detail={`${areaArchiveTarget.name} dejará de aparecer para nuevos pedidos. Las ventas y mesas históricas se conservarán.`} confirmLabel="Archivar zona" danger busy={saving} onCancel={() => setAreaArchiveTarget(null)} onConfirm={() => void archiveSelectedArea()} />}
  </div>;
}

type RegisterResponse = SettingsRegister & { branch_id?: number };
type RegisterDraft = { id?: number; name: string; is_default: boolean; version?: number };

export function RegistersSettings({ branchId }: { branchId: number }) {
  const query = useSettingsQuery<RegisterResponse[]>(`/cash/registers?branch_id=${branchId}`, []);
  const { draft, setDraft, openDraft, dirty } = useSettingsDraft<RegisterDraft>();
  const [archiveTarget, setArchiveTarget] = useState<RegisterResponse | null>(null);
  const [saving, setSaving] = useState(false);
  useDirtyRegistration({ dirty: false, saving, save: null });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function persistRegister() {
    if (saving) return;
    if (!draft?.name.trim()) {
      setError("Escribe un nombre para la caja.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (draft.id) {
        await saveSettings(`/cash/registers/${draft.id}`, {
          name: draft.name.trim(),
          is_default: draft.is_default,
          expected_version: draft.version || 1,
        });
      } else {
        await saveSettings("/cash/registers", {
          branch_id: branchId,
          name: draft.name.trim(),
          is_default: draft.is_default,
        }, "POST");
      }
      setDraft(null);
      setSuccess(draft.id ? "La caja se actualizó correctamente." : "La caja se creó correctamente.");
      await query.reload(true);
    } catch (caught) {
      setError(settingsErrorMessage(caught, "No se pudo crear la caja."));
    } finally {
      setSaving(false);
    }
  }

  async function archiveRegister() {
    if (!archiveTarget) return;
    setSaving(true);
    setError(null);
    try {
      await archiveSettingsResource(`/cash/registers/${archiveTarget.id}`, archiveTarget.version);
      setArchiveTarget(null);
      setSuccess("La caja se archivó y sus cortes permanecen disponibles.");
      await query.reload(true);
    } catch (caught) {
      setError(settingsErrorMessage(caught, "No se pudo archivar la caja."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-section-stack">
      <SettingsSectionHeader
        title="Cajas"
        description="Crea y organiza las cajas donde se registran cortes, entradas y retiros de efectivo."
        action={<button className="button button-primary" type="button" onClick={() => { openDraft({ name: "", is_default: query.data.length === 0 }); setError(null); }}><Plus />Nueva caja</button>}
      />
      <SettingsFeedback notice={query.notice} error={query.error} success={success} />
      {query.loading ? <SettingsSkeleton rows={3} /> : (
        <SettingsCard className="settings-list-card">
          <div className="settings-list-heading">Nombre</div>
          {query.data.map((register) => <div className="settings-resource-row" key={register.id}>
            <div className="settings-resource-copy"><Vault /><span><strong>{register.name}</strong><small>{register.is_default ? "Caja predeterminada" : register.active ? "Activa" : "Archivada"}</small></span></div>
            <SettingsActionMenu
              archiveDisabled={query.data.length <= 1 || register.is_default || register.has_open_session}
              archiveHelp={query.data.length <= 1 ? "Necesitas al menos una caja." : register.is_default ? "Selecciona otra caja predeterminada antes de archivarla." : register.has_open_session ? "Cierra el período abierto antes de archivarla." : undefined}
              onEdit={() => { setError(null); openDraft({ id: register.id, name: register.name, is_default: register.is_default, version: register.version }); }}
              onArchive={() => setArchiveTarget(register)}
            />
          </div>)}
          {!query.data.length && <div className="settings-empty-inline"><Vault /><strong>Aún no hay cajas</strong><span>Crea la primera caja de esta sucursal.</span></div>}
        </SettingsCard>
      )}
      {draft && <SettingsDrawer title={draft.id ? "Editar caja" : "Nueva caja"} dirty={dirty} busy={saving} onClose={() => setDraft(null)} footer={(requestClose) => <><button className="button button-secondary" type="button" disabled={saving} onClick={requestClose}>Cancelar</button><button className="button button-primary" type="button" disabled={saving || !dirty} onClick={() => void persistRegister()}>{saving ? "Guardando..." : draft.id ? "Guardar cambios" : "Crear caja"}</button></>}>
        <SettingsFeedback error={error} />
        <label className="settings-field">Nombre de la caja<input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej. Caja principal" /></label>
        <label className="settings-check-row"><input type="checkbox" checked={draft.is_default} disabled={Boolean(draft.id && draft.is_default)} onChange={(event) => setDraft({ ...draft, is_default: event.target.checked })} /><span><strong>Caja predeterminada</strong><small>Los pagos sin una caja seleccionada se asignarán aquí.</small></span></label>
      </SettingsDrawer>}
      {archiveTarget && <SettingsConfirmDialog title="Archivar caja" detail={`${archiveTarget.name} dejará de aceptar movimientos nuevos. Sus cortes y movimientos históricos se conservarán.`} confirmLabel="Archivar caja" danger busy={saving} onCancel={() => setArchiveTarget(null)} onConfirm={() => void archiveRegister()} />}
    </div>
  );
}
