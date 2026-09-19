import { Building2, MapPin, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { mapPoint, validMapPoint } from "../../lib/google-map";
import { LocationPicker } from "./LocationPicker";
import { BranchMediaCard } from "./BranchMediaCard";
import { createMediaWriteAttempts, type MediaWriteAttempt } from "./media-write-attempts";
import {
  archiveSettingsResource,
  loadGooglePlace,
  searchGooglePlaces,
  settingsErrorMessage,
  settingsIdempotencyKey,
  uploadSettingsMedia,
  type GooglePlaceSuggestion,
} from "../../lib/settings";
import { useTenant } from "../../lib/tenant";
import type { BranchProfileSettings, BusinessSettings } from "../../types/settings";
import {
  SettingsCard,
  SettingsConfirmDialog,
  SettingsFeedback,
  SettingsFormActions,
  SettingsSectionHeader,
  SettingsSkeleton,
} from "./SettingsPrimitives";
import { useDirtyRegistration, useSettingsResource } from "./SettingsState";

function GooglePlaceField({
  branchId,
  value,
  onChange,
  enabled,
}: {
  branchId: number;
  value: string;
  enabled: boolean;
  onChange: (place: { address: string; placeId: string; latitude: number | null; longitude: number | null; mapsUrl: string }) => void;
}) {
  const sessionToken = useRef(settingsIdempotencyKey("places-session"));
  const [touched, setTouched] = useState(false);
  const [suggestions, setSuggestions] = useState<GooglePlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const request = useRef({ active: false, revision: 0 });
  useLayoutEffect(() => {
    const current = { active: enabled, revision: 0 };
    request.current = current;
    return () => { current.active = false; };
  }, [branchId, enabled]);
  useEffect(() => {
    if (!enabled || !touched || value.trim().length < 3) {
      setLoading(false);
      setSuggestions([]);
      setOpen(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void searchGooglePlaces(branchId, value.trim(), sessionToken.current)
        .then((items) => {
          if (!active) return;
          setSuggestions(items);
          setAvailable(true);
          setOpen(Boolean(items.length));
        })
        .catch(() => {
          if (!active) return;
          setSuggestions([]);
          setAvailable(false);
          setOpen(false);
        })
        .finally(() => active && setLoading(false));
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [branchId, touched, value, enabled]);

  async function choose(suggestion: GooglePlaceSuggestion) {
    const current = request.current;
    if (!current.active) return;
    const revision = ++current.revision;
    setSelectionError(null);
    setLoading(true);
    try {
      const place = await loadGooglePlace(branchId, suggestion.place_id, sessionToken.current);
      if (!current.active || revision !== current.revision) return;
      onChange({
        address: place.address || suggestion.text,
        placeId: place.place_id,
        latitude: place.latitude,
        longitude: place.longitude,
        mapsUrl: place.maps_url,
      });
      setTouched(false);
      setSuggestions([]);
      setOpen(false);
      sessionToken.current = settingsIdempotencyKey("places-session");
    } catch {
      if (current.active && revision === current.revision) setSelectionError("No se pudo obtener esta ubicación. Vuelve a seleccionar la sugerencia o usa el mapa.");
    } finally {
      if (current.active && revision === current.revision) setLoading(false);
    }
  }

  return (
    <label>Dirección completa
      <div className="settings-place-field">
        <div className="settings-input-icon"><MapPin /><input value={value} disabled={!enabled} role="combobox" aria-expanded={open} aria-controls="settings-place-suggestions" autoComplete="off" onFocus={() => suggestions.length && setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onChange={(event) => { request.current.revision++; setSelectionError(null); setTouched(true); onChange({ address: event.target.value, placeId: "", latitude: null, longitude: null, mapsUrl: "" }); }} placeholder="Busca la dirección de la sucursal" /></div>
        {open && <div className="settings-place-suggestions" id="settings-place-suggestions" role="listbox">{suggestions.map((suggestion) => <button key={suggestion.place_id} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => void choose(suggestion)}><MapPin /><span>{suggestion.text}</span></button>)}</div>}
      </div>
      <small>{loading ? "Buscando direcciones..." : available === false ? "Google Maps aún no está configurado; puedes escribir la dirección manualmente." : "Selecciona una sugerencia para guardar la ubicación exacta."}</small>
      {selectionError && <small role="alert">{selectionError}</small>}
    </label>
  );
}

export function GeneralSettings() {
  const { context } = useTenant();
  const fallback: BusinessSettings = {
    id: context?.business.id || 0,
    name: context?.business.name || "",
    currency: context?.business.currency || "PEN",
    country_code: "PE",
    timezone: context?.business.timezone || "America/Lima",
    version: 0,
  };
  const resource = useSettingsResource("/settings/business", fallback, "La información de la empresa se actualizó.");
  if (resource.loading) return <><SettingsSectionHeader title="General" /><SettingsSkeleton /></>;
  return (
    <div className="settings-section-stack">
      <SettingsSectionHeader title="General" />
      <SettingsFeedback notice={resource.notice} error={resource.error} success={resource.savedMessage} />
      <SettingsCard title="Datos de empresa">
        <div className="settings-form-grid one-column">
          <label>Nombre de empresa<input value={resource.data.name} onChange={(event) => resource.setData((current) => ({ ...current, name: event.target.value }))} /></label>
        </div>
        <SettingsFormActions dirty={resource.dirty} saving={resource.saving} disabled={!resource.available || !resource.data.name.trim()} onCancel={resource.reset} onSave={() => void resource.save()} />
      </SettingsCard>
      <SettingsCard title="Divisa" description="La moneda que verán tus clientes y tu equipo.">
        <label>Moneda<select value={resource.data.currency} onChange={(event) => resource.setData((current) => ({ ...current, currency: event.target.value }))}><option value="PEN">Sol peruano (PEN S/)</option></select></label>
        <SettingsFormActions dirty={resource.dirty} saving={resource.saving} disabled={!resource.available} onCancel={resource.reset} onSave={() => void resource.save()} />
      </SettingsCard>
      <SettingsCard title="País">
        <div className="settings-readonly-country"><span aria-hidden="true">PE</span><strong>Perú</strong></div>
        <small>El país no se puede modificar desde esta pantalla.</small>
      </SettingsCard>
    </div>
  );
}

export function BranchSettings() {
  const { branch, context, refresh } = useTenant();
  const fallback: BranchProfileSettings = {
    id: branch?.id || 0,
    alias: branch?.name || "",
    address: branch?.address || "",
    maps_url: branch?.maps_url || "",
    google_place_id: "",
    latitude: null,
    longitude: null,
    logo_url: null,
    cover_url: null,
    active: branch?.active ?? true,
    version: 0,
  };
  const path = `/settings/branches/${branch?.id || 0}/profile`;
  const scopeKey = `${context?.business.id || 0}:${branch?.id || 0}`;
  const resource = useSettingsResource(path, fallback, "Los datos de la sucursal se actualizaron.");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [mediaMessage, setMediaMessage] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const mediaContext = useRef({ active: false, busy: false, attempts: createMediaWriteAttempts() });
  useLayoutEffect(() => {
    const current = { active: resource.available, busy: false, attempts: createMediaWriteAttempts() };
    mediaContext.current = current;
    setMediaBusy(false);
    return () => { current.active = false; current.attempts.clear(); };
  }, [path, scopeKey, resource.available]);
  useDirtyRegistration({ dirty: false, saving: mediaBusy || archiveBusy, save: null });

  async function upload(file: File, kind: "logo" | "cover") {
    const current = mediaContext.current;
    if (!current.active || current.busy) return false;
    current.busy = true;
    setMediaMessage(null);
    setMediaError(null);
    setMediaBusy(true);
    let attempt: MediaWriteAttempt | undefined;
    try {
      const upload = await current.attempts.prepareUpload({ scopeKey, path, kind, file, expectedVersion: resource.data.version });
      attempt = upload;
      if (!current.active || current !== mediaContext.current) return false;
      const saved = await uploadSettingsMedia<BranchProfileSettings>(upload.path, upload.file, upload.kind, upload.expectedVersion, upload.idempotencyKey);
      if (!current.active || current !== mediaContext.current) return false;
      current.attempts.clear();
      resource.acceptSavedFields(saved, [kind === "logo" ? "logo_url" : "cover_url"]);
      setMediaMessage(`${kind === "logo" ? "El logotipo" : "La portada"} se actualizó correctamente.`);
      return true;
    } catch (caught) {
      if (attempt) current.attempts.failed(attempt, caught);
      if (current.active) setMediaError(settingsErrorMessage(caught, "No se pudo cargar la imagen."));
      return false;
    } finally {
      current.busy = false;
      if (current.active) setMediaBusy(false);
    }
  }

  async function removeMedia(kind: "logo" | "cover") {
    const current = mediaContext.current;
    if (!current.active || current.busy) return false;
    current.busy = true;
    setMediaBusy(true);
    setMediaError(null);
    setMediaMessage(null);
    const attempt = current.attempts.prepareRemove({ scopeKey, path: `/settings/branches/${branch?.id}/media/${kind}`, kind, expectedVersion: resource.data.version });
    try {
      const saved = await api<BranchProfileSettings>(attempt.path, { method: "DELETE", body: attempt.body, idempotencyKey: attempt.idempotencyKey });
      if (!current.active || current !== mediaContext.current) return false;
      current.attempts.clear();
      resource.acceptSavedFields(saved, [kind === "logo" ? "logo_url" : "cover_url"]);
      setMediaMessage("La imagen se eliminó correctamente.");
      return true;
    } catch (caught) {
      current.attempts.failed(attempt, caught);
      if (current.active) setMediaError(settingsErrorMessage(caught, "No se pudo eliminar la imagen."));
      return false;
    } finally { current.busy = false; if (current.active) setMediaBusy(false); }
  }

  async function archiveBranch() {
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      await archiveSettingsResource(path, resource.data.version);
      setArchiveOpen(false);
      setArchiveMessage("La sucursal se archivó. Su historial se conserva.");
      try {
        await refresh();
      } catch {
        setRefreshNotice("La sucursal se archivó, pero no se pudo actualizar la vista. Vuelve a cargar para ver el estado reciente.");
      }
    } catch (caught) {
      setArchiveError(settingsErrorMessage(caught, "No se pudo archivar la sucursal."));
    } finally {
      setArchiveBusy(false);
    }
  }

  if (!branch || resource.loading) return <><SettingsSectionHeader title="Datos de sucursal" /><SettingsSkeleton rows={4} /></>;
  return (
    <div className="settings-section-stack">
      <SettingsSectionHeader title="Datos de sucursal" />
      <SettingsFeedback notice={resource.notice || refreshNotice} error={resource.error || archiveError || mediaError} success={archiveMessage || resource.savedMessage || mediaMessage} />
      {(resource.error || !resource.available) && <div><button className="button button-secondary" disabled={resource.saving || mediaBusy} onClick={() => void (resource.dirty ? resource.save() : resource.reload())}>Reintentar</button></div>}
      <SettingsCard>
        <div className="settings-form-grid one-column">
          <label>Alias de sucursal<input value={resource.data.alias} onChange={(event) => resource.setData((current) => ({ ...current, alias: event.target.value }))} /><small>Nombre corto que identifica esta sucursal frente a las demás.</small></label>
          <GooglePlaceField branchId={branch.id} enabled={resource.available && !resource.saving} value={resource.data.address} onChange={(place) => resource.setData((current) => ({ ...current, address: place.address, google_place_id: place.placeId, latitude: place.latitude, longitude: place.longitude, maps_url: place.mapsUrl }))} />
          <label>Enlace de Google Maps<input type="url" value={resource.data.maps_url} onChange={(event) => resource.setData((current) => ({ ...current, maps_url: event.target.value }))} placeholder="https://maps.google.com/..." /></label>
          <div className="settings-location-value"><strong>Ubicación en Google Maps</strong><button className="button button-secondary" type="button" disabled={!resource.available || resource.saving} onClick={() => setLocationOpen(true)}><MapPin />{validMapPoint(resource.data) ? "Cambiar ubicación" : "Agregar ubicación"}</button>{validMapPoint(resource.data) && <small>{resource.data.latitude}, {resource.data.longitude}</small>}</div>
        </div>
        <SettingsFormActions dirty={resource.dirty} saving={resource.saving || mediaBusy} disabled={!resource.available || !resource.data.alias.trim()} onCancel={resource.reset} onSave={() => void resource.save()} />
      </SettingsCard>
      <BranchMediaCard title="Logotipo de la tienda" kind="logo" currentUrl={resource.data.logo_url} enabled={resource.available} disabled={!resource.available || resource.saving || mediaBusy} onUpload={upload} onRemove={() => removeMedia("logo")} onDiscard={() => mediaContext.current.attempts.clear()} />
      <BranchMediaCard title="Portada de la tienda" kind="cover" currentUrl={resource.data.cover_url} enabled={resource.available} disabled={!resource.available || resource.saving || mediaBusy} onUpload={upload} onRemove={() => removeMedia("cover")} onDiscard={() => mediaContext.current.attempts.clear()} />
      {locationOpen && <LocationPicker enabled={resource.available} value={validMapPoint(resource.data) ? mapPoint(resource.data.latitude, resource.data.longitude) : null} onCancel={() => setLocationOpen(false)} onSelect={(point) => { resource.setData((current) => ({ ...current, ...point, google_place_id: "" })); setLocationOpen(false); }} />}
      <div className="settings-danger-zone">
        <div><Building2 /><span><strong>Archivar sucursal</strong><small>Conserva pedidos, ventas y auditoría. Se bloqueará si existen operaciones activas.</small></span></div>
        <button className="button button-danger" type="button" disabled={!resource.available} onClick={() => setArchiveOpen(true)}><Trash2 />Archivar sucursal</button>
      </div>
      {archiveOpen && <SettingsConfirmDialog title="Archivar sucursal" detail="Esta sucursal dejará de aceptar pedidos, pero todo su historial permanecerá disponible." confirmLabel="Archivar sucursal" expectedConfirmation={resource.data.alias} danger busy={archiveBusy} onCancel={() => setArchiveOpen(false)} onConfirm={() => void archiveBranch()} />}
    </div>
  );
}
