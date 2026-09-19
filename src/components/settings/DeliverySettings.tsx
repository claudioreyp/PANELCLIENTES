import { MapPin, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTenant } from "../../lib/tenant";
import { validMapPoint } from "../../lib/google-map";
import type { DeliveryMode, DeliveryPolicy, DeliverySettings } from "../../types/settings";
import { SettingsCard, SettingsFeedback, SettingsFormActions, SettingsSectionHeader, SettingsSkeleton, SettingsSwitch } from "./SettingsPrimitives";
import { useSettingsResource } from "./SettingsState";
import { LocationPicker } from "./LocationPicker";
import "./delivery-settings.css";

const modes: { value: DeliveryMode; label: string; detail: string }[] = [
  { value: "free", label: "Sin costo", detail: "" },
  { value: "fixed", label: "Precio fijo", detail: "" },
  { value: "neighborhoods", label: "Por colonias", detail: "Si el cliente indica otra colonia, el envío quedará por cotizar." },
  { value: "radius", label: "Por distancia", detail: "Introduce tus precios por tramo de distancia de ruta." },
  { value: "quote", label: "Por cotizar", detail: "El precio de envío no será calculado automáticamente." },
];
const emptyPolicy: DeliveryPolicy = { neighborhoods: [], origin: null, outside_band_mode: "reject" };
const validAmount = (value: number) => Number.isFinite(value) && value >= 0;

export function deliveryError(data: DeliverySettings) {
  if (data.mode === "fixed" && !validAmount(data.fixed_fee)) return "El precio de envío debe ser un importe válido, sin valores negativos.";
  if (data.mode === "neighborhoods") {
    const rows = data.delivery_policy?.neighborhoods || [];
    if (!rows.length || rows.some((row) => !row.name.trim() || !validAmount(row.fee))) return "Indica el nombre y un costo válido para cada colonia.";
    if (new Set(rows.map((row) => row.name.trim().toLocaleLowerCase())).size !== rows.length) return "Los nombres de las colonias no pueden repetirse.";
  }
  if (data.mode === "radius") {
    if (!data.radii.length) return "Agrega al menos un nivel de entrega.";
    const sorted = [...data.radii].sort((a, b) => a.from_km - b.from_km);
    for (let index = 0; index < sorted.length; index++) {
      const row = sorted[index];
      if (!validAmount(row.from_km) || !Number.isFinite(row.to_km) || row.to_km <= row.from_km || !validAmount(row.fee)) return "Cada nivel necesita una distancia final mayor que la inicial y un costo válido.";
      if (index > 0 && row.from_km < sorted[index - 1].to_km) return "Los niveles de distancia no pueden superponerse.";
    }
  }
  if (data.mode === "distance" && (!Number.isFinite(data.max_distance_km) || data.max_distance_km <= 0 || !validAmount(data.base_fee) || !validAmount(data.per_km_fee))) return "Revisa el alcance y los importes de la tarifa por kilómetro.";
  if (data.minimum_enabled && (!Number.isFinite(data.minimum_amount) || data.minimum_amount <= 0)) return "La compra mínima debe ser mayor que cero.";
  if (data.free_over_enabled && data.mode !== "free" && (!Number.isFinite(data.free_over_amount) || data.free_over_amount <= 0)) return "El monto para envío gratis debe ser mayor que cero.";
  return null;
}

function MoneyInput({ label, value, onChange, help }: { label: string; value: number; onChange: (value: number) => void; help?: string }) {
  return <label>{label}<div className="settings-money-input"><span aria-hidden="true">S/</span><input aria-label={label} type="number" min="0" step="0.10" value={value} onChange={(event) => onChange(Number(event.target.value))} /></div>{help && <small>{help}</small>}</label>;
}

export function DeliverySettingsSection() {
  const { branch } = useTenant();
  const fallback: DeliverySettings = { version: 0, mode: branch?.delivery_fee ? "fixed" : "free", fixed_fee: branch?.delivery_fee || 0, base_fee: 0, per_km_fee: 0, max_distance_km: 10, free_over_enabled: false, free_over_amount: 0, minimum_enabled: false, minimum_amount: 0, radii: [], google_routes_configured: false };
  const resource = useSettingsResource(`/settings/branches/${branch?.id || 0}/delivery`, fallback, "Los costos de envío se actualizaron.");
  const [locationOpen, setLocationOpen] = useState(false);
  const data = resource.data;
  const policy = data.delivery_policy || emptyPolicy;
  const origin = policy.origin || data.branch_origin || null;
  const setPolicy = (next: Partial<DeliveryPolicy>) => resource.setData((current) => ({ ...current, delivery_policy: { ...(current.delivery_policy || emptyPolicy), ...next } }));
  const compatible = data.delivery_policy_supported || (data.mode !== "neighborhoods" && !data.delivery_policy);
  const validation = deliveryError(data);
  const changeMode = (mode: DeliveryMode) => resource.setData((current) => ({ ...current, mode,
    ...(mode === "radius" && !current.radii.length ? { radii: [{ from_km: 0, to_km: 1.1, fee: 0 }], delivery_policy: { ...(current.delivery_policy || emptyPolicy), outside_band_mode: "quote" } } : {}),
    ...(mode === "neighborhoods" && !current.delivery_policy?.neighborhoods.length ? { delivery_policy: { ...(current.delivery_policy || emptyPolicy), neighborhoods: [{ name: "", fee: 0 }] } } : {}),
  }));
  if (resource.loading) return <><SettingsSectionHeader title="Costos de envío" /><SettingsSkeleton rows={4} /></>;
  return <div className="settings-section-stack settings-delivery">
    <SettingsSectionHeader title="Costos de envío" />
    <SettingsFeedback notice={resource.notice} error={resource.error || (!compatible ? "Esta API necesita actualizarse para guardar las nuevas opciones de envío. Tus datos no se han modificado." : validation)} success={resource.savedMessage} />
    {(resource.error || !resource.available) && <div><button className="button button-secondary" disabled={resource.saving || (resource.dirty && Boolean(validation))} onClick={() => void (resource.dirty ? resource.save() : resource.reload())}>Reintentar</button></div>}
    <SettingsCard><fieldset disabled={!resource.available || resource.saving} className="delivery-fields">
      <label>Tipo de costo de envío<select aria-label="Tipo de costo de envío" value={data.mode} onChange={(event) => changeMode(event.target.value as DeliveryMode)}>{modes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}{data.mode === "distance" && <option value="distance">Por kilómetro (tarifa anterior)</option>}</select>{modes.find((mode) => mode.value === data.mode)?.detail && <small>{modes.find((mode) => mode.value === data.mode)?.detail}</small>}</label>
      {data.mode === "fixed" && <MoneyInput label="Precio fijo de envío" value={data.fixed_fee} onChange={(fixed_fee) => resource.setData((current) => ({ ...current, fixed_fee }))} />}
      {data.mode === "neighborhoods" && <div className="delivery-neighborhoods">{policy.neighborhoods.map((row, index) => <div className="delivery-rate-row neighborhood" key={index}><label>Nombre<input aria-label={`Nombre de colonia ${index + 1}`} maxLength={120} value={row.name} onChange={(event) => setPolicy({ neighborhoods: policy.neighborhoods.map((item, n) => n === index ? { ...item, name: event.target.value } : item) })} /></label><MoneyInput label={`Costo de envío ${index + 1}`} value={row.fee} onChange={(fee) => setPolicy({ neighborhoods: policy.neighborhoods.map((item, n) => n === index ? { ...item, fee } : item) })} /><button className="icon-button danger" aria-label={`Eliminar colonia ${index + 1}`} type="button" onClick={() => setPolicy({ neighborhoods: policy.neighborhoods.filter((_, n) => n !== index) })}><Trash2 /></button></div>)}<button className="button button-quiet delivery-add" type="button" onClick={() => setPolicy({ neighborhoods: [...policy.neighborhoods, { name: "", fee: 0 }] })}><Plus />Agregar otra colonia</button></div>}
      {(data.mode === "radius" || data.mode === "distance") && <div className="settings-location-value"><strong>Ubicación</strong><span>Punto donde saldrán los envíos.</span><button className="button button-secondary" type="button" onClick={() => setLocationOpen(true)}><MapPin />{validMapPoint(origin) ? "Cambiar ubicación" : "Agregar ubicación"}</button>{validMapPoint(origin) && <small>{origin.latitude}, {origin.longitude}{!policy.origin && " · Ubicación de la sucursal"}</small>}{!data.google_routes_configured && <small>El cálculo de rutas requiere que Google Routes esté configurado en el servidor.</small>}</div>}
      {data.mode === "distance" && <div className="delivery-legacy"><p>Se conserva tu tarifa anterior. Selecciona «Por distancia» para configurar niveles, sin convertirla automáticamente.</p><MoneyInput label="Monto base" value={data.base_fee} onChange={(base_fee) => resource.setData((current) => ({ ...current, base_fee }))} /><MoneyInput label="Precio por kilómetro" value={data.per_km_fee} onChange={(per_km_fee) => resource.setData((current) => ({ ...current, per_km_fee }))} /><label>Alcance máximo<div className="settings-unit-input"><input type="number" min="0.1" step="0.1" value={data.max_distance_km} onChange={(event) => resource.setData((current) => ({ ...current, max_distance_km: Number(event.target.value) }))} /><span>km</span></div></label></div>}
      {data.mode === "radius" && <div className="delivery-levels">{data.radii.map((row, index) => <div className="delivery-rate-row" key={row.id || index}><label>Desde<div className="settings-unit-input"><input aria-label={`Desde nivel ${index + 1}`} type="number" value={row.from_km} readOnly /><span>km</span></div></label><label>Hasta<div className="settings-unit-input"><input aria-label={`Hasta nivel ${index + 1}`} type="number" min={row.from_km + .1} step="0.1" value={row.to_km} onChange={(event) => { const end = Number(event.target.value); resource.setData((current) => ({ ...current, radii: current.radii.map((item, n) => n === index ? { ...item, to_km: end } : n === index + 1 ? { ...item, from_km: end } : item) })); }} /><span>km</span></div></label><MoneyInput label={`Costo de nivel ${index + 1}`} value={row.fee} onChange={(fee) => resource.setData((current) => ({ ...current, radii: current.radii.map((item, n) => n === index ? { ...item, fee } : item) }))} /><button className="icon-button danger" type="button" aria-label={`Eliminar nivel ${index + 1}`} onClick={() => resource.setData((current) => ({ ...current, radii: current.radii.filter((_, n) => n !== index).map((item, n) => n === index ? { ...item, from_km: row.from_km } : item) }))}><Trash2 /></button></div>)}<div className="delivery-rate-row delivery-final"><label>Desde<input readOnly value={data.radii.at(-1)?.to_km || 0} /></label><label>Hasta<input readOnly value="Sin límite" /></label><label>Costo de envío<select value={policy.outside_band_mode} onChange={(event) => setPolicy({ outside_band_mode: event.target.value as "reject" | "quote" })}><option value="quote">Por definir</option><option value="reject">Fuera de cobertura</option></select></label></div><button className="button button-quiet delivery-add" type="button" onClick={() => resource.setData((current) => { const start = current.radii.at(-1)?.to_km || 0; return { ...current, radii: [...current.radii, { from_km: start, to_km: Number((start + 1).toFixed(1)), fee: 0 }] }; })}><Plus />Agregar otro nivel</button><small>El límite compartido pertenece al nivel anterior. No se dejan huecos al agregar niveles.</small></div>}
      {data.mode !== "free" && <div className="delivery-threshold"><SettingsSwitch checked={data.free_over_enabled} onChange={(free_over_enabled) => resource.setData((current) => ({ ...current, free_over_enabled }))} label="Envío gratis si se alcanza una compra mínima" />{data.free_over_enabled && <div className="delivery-threshold-field"><MoneyInput label="Monto para envío gratis" value={data.free_over_amount} onChange={(free_over_amount) => resource.setData((current) => ({ ...current, free_over_amount }))} help="Valor de compra mínimo para que tus clientes obtengan envío gratis." /></div>}</div>}
      <div className="delivery-threshold"><SettingsSwitch checked={data.minimum_enabled} onChange={(minimum_enabled) => resource.setData((current) => ({ ...current, minimum_enabled }))} label="Se requiere una compra mínima para habilitar envíos" />{data.minimum_enabled && <div className="delivery-threshold-field"><MoneyInput label="Compra mínima" value={data.minimum_amount} onChange={(minimum_amount) => resource.setData((current) => ({ ...current, minimum_amount }))} help="Valor de compra mínimo para que tus clientes puedan hacer pedidos a domicilio." /></div>}</div>
    </fieldset><SettingsFormActions dirty={resource.dirty} saving={resource.saving} disabled={!resource.available || !compatible || Boolean(validation)} onCancel={resource.reset} onSave={() => void resource.save()} /></SettingsCard>
    {locationOpen && <LocationPicker enabled={resource.available} value={validMapPoint(origin) ? origin : null} onCancel={() => setLocationOpen(false)} onSelect={(point) => { setPolicy({ origin: point }); setLocationOpen(false); }} />}
  </div>;
}
