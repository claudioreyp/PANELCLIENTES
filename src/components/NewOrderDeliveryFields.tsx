import { MapPin } from "lucide-react";
import { useId, useState } from "react";
import { LocationPicker } from "./settings/LocationPicker";
import { parseManualDeliveryFee, type DeliveryAddressDraft, type OrderDeliveryQuote, type PosDeliveryPolicy } from "../lib/order-delivery";
import "./new-order-delivery.css";

export function NewOrderDeliveryFields({ value, onChange, policy, quote, loading, feeInput, onFeeInput, confirmed, onConfirmFee }: {
  value: DeliveryAddressDraft;
  onChange: (value: DeliveryAddressDraft) => void;
  policy: PosDeliveryPolicy | null;
  quote: OrderDeliveryQuote | null;
  loading: boolean;
  feeInput: string;
  onFeeInput: (value: string) => void;
  confirmed: boolean;
  onConfirmFee: () => void;
}) {
  const feeId = useId();
  const [locationOpen, setLocationOpen] = useState(false);
  const knownNeighborhood = policy?.neighborhoods.includes(value.neighborhood) === true;
  const editableFee = quote?.requires_quote === true || policy?.mode === "quote" || (policy?.mode === "neighborhoods" && !knownNeighborhood);
  const configuredFee = policy?.mode === "fixed" ? policy.fixedFee : policy?.mode === "free" ? 0 : null;
  const shownFee = quote ? quote.fee : configuredFee;
  const update = (patch: Partial<DeliveryAddressDraft>) => onChange({ ...value, ...patch });
  const changeDestination = (patch: Partial<DeliveryAddressDraft>) => update({ ...patch, point: null, mapsUrl: "" });
  return <section className="new-order-section new-order-delivery-fields">
    <div className="new-order-section-heading"><div><h3>Datos de entrega</h3><p>Entrega con el reparto propio del restaurante.</p></div><MapPin /></div>
    {policy?.mode === "neighborhoods" ? <>
      <label>Colonia<select value={knownNeighborhood ? value.neighborhood : ""} onChange={(event) => changeDestination({ neighborhood: event.target.value })}>
        <option value="">Otra colonia o por confirmar</option>
        {policy.neighborhoods.map((name) => <option key={name} value={name}>{name}</option>)}
      </select></label>
      {!knownNeighborhood && <label>Nombre de colonia <span className="optional-label">opcional</span><input value={value.neighborhood} maxLength={120} onChange={(event) => changeDestination({ neighborhood: event.target.value })} placeholder="Escribir colonia o dejar por confirmar" /><small>Una colonia desconocida requiere cotización; no se asumirá envío gratis.</small></label>}
    </> : <label>Colonia <span className="optional-label">opcional</span><input value={value.neighborhood} maxLength={120} onChange={(event) => changeDestination({ neighborhood: event.target.value })} /></label>}
    <div className="new-order-two-columns">
      <label>Calle<input value={value.street} onChange={(event) => changeDestination({ street: event.target.value })} autoComplete="address-line1" required /></label>
      <label>Número <span className="optional-label">casa, depto. o edificio; opcional</span><input value={value.number} onChange={(event) => changeDestination({ number: event.target.value })} autoComplete="address-line2" /></label>
    </div>
    <label>Entre calles <span className="optional-label">opcional</span><input value={value.crossStreets} onChange={(event) => update({ crossStreets: event.target.value })} /></label>
    <label>Referencias<input value={value.reference} onChange={(event) => update({ reference: event.target.value })} placeholder="Ej. puerta negra, frente al parque" required /></label>
    <label>Enlace de Google Maps <span className="optional-label">opcional</span><input type="url" value={value.mapsUrl} onChange={(event) => update({ mapsUrl: event.target.value, point: null })} placeholder="https://maps.google.com/..." /></label>
    <div className="new-order-delivery-location"><button type="button" className="button button-secondary" onClick={() => setLocationOpen(true)}><MapPin />{value.point ? "Cambiar ubicación" : "Agregar ubicación"}</button>{value.point && <small>Ubicación seleccionada: {value.point.latitude}, {value.point.longitude}</small>}</div>
    <div className="new-order-delivery-cost"><label htmlFor={feeId}>Costo de envío</label>{editableFee ? <span className="new-order-delivery-money"><span className="new-order-delivery-currency" aria-hidden="true">S/</span><input id={feeId} type="text" inputMode="decimal" value={feeInput} onChange={(event) => onFeeInput(event.target.value)} placeholder="Por cotizar" aria-describedby="new-order-delivery-fee-help" /></span> : <input id={feeId} readOnly value={shownFee === null ? "Por cotizar" : `S/ ${shownFee.toFixed(2)}`} aria-describedby="new-order-delivery-fee-help" />}</div>
    <p className="field-hint" id="new-order-delivery-fee-help">{loading ? "Consultando la política de delivery..." : editableFee ? "Ingresa un importe de cero o mayor y confírmalo. El servidor debe autorizarlo antes de cobrar." : quote && quote.fee !== null ? "Costo confirmado por la cotización del servidor." : "El costo se verificará con el servidor al continuar."}</p>
    {editableFee && <div className="new-order-delivery-fee-confirm"><button type="button" className="button button-secondary" disabled={!policy || parseManualDeliveryFee(feeInput) === null || confirmed} onClick={onConfirmFee}>{confirmed ? "Importe confirmado" : "Confirmar importe de envío"}</button><small>{confirmed ? "Pendiente de validación del servidor al continuar." : "Escribir el importe no lo confirma."}</small></div>}
    {locationOpen && <LocationPicker value={value.point} onCancel={() => setLocationOpen(false)} onSelect={(point) => { update({ point, mapsUrl: point.maps_url }); setLocationOpen(false); }} />}
  </section>;
}
