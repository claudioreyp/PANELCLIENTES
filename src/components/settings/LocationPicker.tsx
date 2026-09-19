import { LocateFixed, MapPin, ExternalLink, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { DialogPortal, useDialogSurface } from "../../lib/dialog";
import { loadGoogleMaps, mapPoint, validMapPoint, type MapInstance, type MapPoint } from "../../lib/google-map";
import { useDirtyRegistration } from "./SettingsState";
import "./location-picker.css";

export function LocationPicker({ value, enabled = true, onCancel, onSelect }: {
  value: MapPoint | null; enabled?: boolean; onCancel: () => void; onSelect: (point: MapPoint) => void;
}) {
  const titleId = useId();
  const [initialValue] = useState(value);
  const surfaceRef = useDialogSurface(onCancel, { enabled });
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const [point, setPoint] = useState<MapPoint | null>(validMapPoint(value) ? value : null);
  const [error, setError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [reload, setReload] = useState(0);
  const [manual, setManual] = useState({ latitude: value ? String(value.latitude) : "", longitude: value ? String(value.longitude) : "" });
  const lifetime = useRef({ active: false });
  const selectedPoint = useRef(point);
  selectedPoint.current = point;
  useDirtyRegistration({ dirty: JSON.stringify(point) !== JSON.stringify(initialValue), saving: false, save: null });

  useEffect(() => {
    const current = { active: enabled };
    lifetime.current = current;
    if (!enabled) return () => { current.active = false; };
    let listener: { remove(): void } | undefined;
    setReady(false);
    setError(null);
    setLocating(false);
    const authenticationFailed = () => { if (current.active) { setReady(false); setError("Google Maps no autorizó este sitio. Revisa la clave y sus restricciones."); } };
    window.addEventListener("pos-google-maps-error", authenticationFailed);
    void loadGoogleMaps().then(({ Map }) => {
      if (!current.active || !mapElement.current) return;
      const center = selectedPoint.current || { latitude: -12.0464, longitude: -77.0428 };
      const map = new Map(mapElement.current, { center: { lat: center.latitude, lng: center.longitude }, zoom: selectedPoint.current ? 17 : 12, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, gestureHandling: "greedy", keyboardShortcuts: true });
      mapRef.current = map;
      listener = map.addListener("center_changed", () => {
        const next = map.getCenter();
        if (!current.active || !next) return;
        const latitude = Number(next.lat().toFixed(6));
        const longitude = Number(next.lng().toFixed(6));
        // Google can notify the initial center asynchronously; it is not a choice.
        if (!selectedPoint.current && latitude === center.latitude && longitude === center.longitude) return;
        setPoint(mapPoint(latitude, longitude));
      });
      setReady(true);
    }).catch((caught) => { if (current.active) setError(caught instanceof Error ? caught.message : "No se pudo cargar el mapa."); });
    return () => { current.active = false; listener?.remove(); mapRef.current = null; window.removeEventListener("pos-google-maps-error", authenticationFailed); };
  }, [enabled, reload, initialValue]);

  function choose(next: MapPoint) {
    if (!enabled || !validMapPoint(next)) return;
    setPoint(next);
    setManual({ latitude: String(next.latitude), longitude: String(next.longitude) });
    setLocationError(null);
    mapRef.current?.setCenter({ lat: next.latitude, lng: next.longitude });
    mapRef.current?.setZoom(17);
  }
  function geolocate() {
    if (!enabled || locating) return;
    if (!navigator.geolocation) { setLocationError("Este navegador no ofrece ubicación actual. Selecciona el punto manualmente."); return; }
    const current = lifetime.current;
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition((position) => {
      if (!current.active) return;
      choose(mapPoint(Number(position.coords.latitude.toFixed(6)), Number(position.coords.longitude.toFixed(6))));
      setLocating(false);
    }, () => { if (current.active) { setLocating(false); setLocationError("No se pudo obtener tu ubicación. Revisa el permiso del navegador o selecciona el punto manualmente."); } }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }
  const manualPoint = manual.latitude.trim() && manual.longitude.trim() ? mapPoint(Number(manual.latitude), Number(manual.longitude)) : null;
  return <DialogPortal><div className="settings-location-backdrop" hidden={!enabled}><section className="settings-location-dialog" ref={surfaceRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
    <header><h2 id={titleId}>Agregar ubicación</h2><button type="button" className="icon-button" aria-label="Cerrar ubicación" onClick={onCancel}><X /></button></header>
    <div className="settings-location-body">
      <p>Arrastra el mapa para colocar el punto exacto. La selección se aplicará al formulario antes de guardar.</p>
      <div className="settings-location-map" hidden={Boolean(error)}>
        <div ref={mapElement} className="settings-location-map-canvas" aria-label="Mapa de Google para seleccionar ubicación" />
        {ready ? <MapPin className="settings-location-pin" aria-hidden="true" /> : <span className="settings-location-loading" role="status">Cargando Google Maps...</span>}
      </div>
      {error && <div role="alert" className="settings-location-error"><p>{error}</p><button type="button" className="button button-secondary" onClick={() => setReload((n) => n + 1)}>Reintentar</button></div>}
      <div className="settings-location-tools"><button className="button button-secondary" type="button" disabled={locating} onClick={geolocate}><LocateFixed />{locating ? "Buscando ubicación..." : "Llevar a ubicación actual"}</button><a className="audit-navigation-link" href={point?.maps_url || "https://www.google.com/maps"} target="_blank" rel="noreferrer">Abrir Google Maps<ExternalLink /></a></div>
      {locationError && <p role="alert" className="settings-location-error">{locationError}</p>}
      <p className="settings-location-selection" role="status">{point ? `Punto seleccionado: ${point.latitude}, ${point.longitude}` : "Selecciona una ubicación para continuar. El mapa inicial no se guarda automáticamente."}</p>
      <details open={Boolean(error)}><summary>Ingresar coordenadas</summary><div className="settings-location-coordinates"><label>Latitud<input type="number" step="any" min="-90" max="90" value={manual.latitude} onChange={(event) => setManual({ ...manual, latitude: event.target.value })} /></label><label>Longitud<input type="number" step="any" min="-180" max="180" value={manual.longitude} onChange={(event) => setManual({ ...manual, longitude: event.target.value })} /></label><button className="button button-secondary" type="button" disabled={!validMapPoint(manualPoint)} onClick={() => { if (validMapPoint(manualPoint)) choose(manualPoint); }}>Usar coordenadas</button></div></details>
    </div>
    <footer><button type="button" className="button button-secondary" onClick={onCancel}>Cancelar</button><button type="button" className="button button-primary" disabled={!point || !enabled} onClick={() => { if (point && enabled) onSelect(point); }}>Agregar ubicación</button></footer>
  </section></div></DialogPortal>;
}
