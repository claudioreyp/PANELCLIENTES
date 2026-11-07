import { MapPin } from "lucide-react";
import { useId, useState } from "react";
import { LocationPicker } from "./settings/LocationPicker";
import type { DeliveryAddressDraft } from "../lib/order-delivery";
import "./new-order-delivery.css";

export function NewOrderDeliveryFields({ value, onChange, feeInput, onFeeInput }: {
  value: DeliveryAddressDraft;
  onChange: (value: DeliveryAddressDraft) => void;
  feeInput: string;
  onFeeInput: (value: string) => void;
}) {
  const feeId = useId();
  const feeHelpId = `${feeId}-help`;
  const [locationOpen, setLocationOpen] = useState(false);
  const update = (patch: Partial<DeliveryAddressDraft>) => onChange({ ...value, ...patch });
  const changeDestination = (patch: Partial<DeliveryAddressDraft>) => update({ ...patch, point: null, mapsUrl: "" });
  return <section className="new-order-section new-order-delivery-fields">
    <div className="new-order-section-heading"><div><h3>Datos de entrega</h3><p>Puedes completarlos ahora o coordinar la entrega después.</p></div><MapPin /></div>
    <label>Colonia <span className="optional-label">opcional</span><input value={value.neighborhood} maxLength={120} onChange={(event) => changeDestination({ neighborhood: event.target.value })} /></label>
    <div className="new-order-two-columns">
      <label>Calle <span className="optional-label">opcional</span><input value={value.street} onChange={(event) => changeDestination({ street: event.target.value })} autoComplete="address-line1" /></label>
      <label>Número <span className="optional-label">casa, depto. o edificio; opcional</span><input value={value.number} onChange={(event) => changeDestination({ number: event.target.value })} autoComplete="address-line2" /></label>
    </div>
    <label>Entre calles <span className="optional-label">opcional</span><input value={value.crossStreets} onChange={(event) => update({ crossStreets: event.target.value })} /></label>
    <label>Referencias <span className="optional-label">opcional</span><input value={value.reference} onChange={(event) => update({ reference: event.target.value })} placeholder="Ej. puerta negra, frente al parque" /></label>
    <label>Enlace de Google Maps <span className="optional-label">opcional</span><input type="url" value={value.mapsUrl} onChange={(event) => update({ mapsUrl: event.target.value, point: null })} placeholder="https://maps.google.com/..." /></label>
    <div className="new-order-delivery-location"><button type="button" className="button button-secondary" onClick={() => setLocationOpen(true)}><MapPin />{value.point ? "Cambiar ubicación" : "Agregar ubicación"}</button>{value.point && <small>Ubicación seleccionada: {value.point.latitude}, {value.point.longitude}</small>}</div>
    <div className="new-order-delivery-cost"><label htmlFor={feeId}>Costo de envío <span className="optional-label">opcional</span></label><span className="new-order-delivery-money"><span className="new-order-delivery-currency" aria-hidden="true">S/</span><input id={feeId} type="text" inputMode="decimal" value={feeInput} onChange={(event) => onFeeInput(event.target.value)} placeholder="Por cotizar" aria-describedby={feeHelpId} /></span></div>
    <p className="field-hint" id={feeHelpId}>Déjalo vacío para cotizar después y guardar sin cobrar. Ingresa 0 si el envío es gratis.</p>
    {locationOpen && <LocationPicker value={value.point} onCancel={() => setLocationOpen(false)} onSelect={(point) => { update({ point, mapsUrl: point.maps_url }); setLocationOpen(false); }} />}
  </section>;
}
