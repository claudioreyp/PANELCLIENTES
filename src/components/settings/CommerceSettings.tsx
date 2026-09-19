import { AlertTriangle, Check, MessageSquareText } from "lucide-react";
import { useTenant } from "../../lib/tenant";
import type {
  DeliveryTimeSettings,
  PaymentMethod,
  PaymentMethodSettings,
  ServiceSettings,
  WhatsAppSettings,
} from "../../types/settings";
import {
  SettingsCard,
  SettingsFeedback,
  SettingsFormActions,
  SettingsSectionHeader,
  SettingsSkeleton,
  SettingsSwitch,
} from "./SettingsPrimitives";
import { useSettingsQuery, useSettingsResource } from "./SettingsState";

const paymentMethods: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Efectivo" },
  { value: "card", label: "Pago con tarjeta" },
  { value: "transfer", label: "Transferencia" },
  { value: "yape", label: "Yape" },
  { value: "plin", label: "Plin" },
];

export function ServiceOptionsSettings() {
  const { branch } = useTenant();
  const fallback: ServiceSettings = {
    version: 0,
    pos_tables: true,
    pos_counter: true,
    pos_takeaway: branch?.takeaway_enabled ?? true,
    pos_delivery: branch?.delivery_enabled ?? true,
    digital_tables: false,
    digital_takeaway: branch?.takeaway_enabled ?? true,
    digital_delivery: branch?.delivery_enabled ?? true,
  };
  const resource = useSettingsResource(`/settings/branches/${branch?.id || 0}/services`, fallback, "Las opciones de servicio se actualizaron.");
  if (resource.loading) return <><SettingsSectionHeader title="Opciones de servicio" /><SettingsSkeleton /></>;
  const set = (key: keyof ServiceSettings, value: boolean) => resource.setData((current) => ({ ...current, [key]: value }));
  return (
    <div className="settings-section-stack">
      <SettingsSectionHeader title="Opciones de servicio" description="Elige qué modalidades están disponibles para tu equipo y para los clientes." />
      <SettingsFeedback notice={resource.notice} error={resource.error} success={resource.savedMessage} />
      <SettingsCard>
        <div className="settings-option-group"><h3>Punto de venta</h3><p>Pedidos tomados por tu personal desde Pedidos o Mesas.</p>
          <SettingsSwitch checked={resource.data.pos_tables} onChange={(value) => set("pos_tables", value)} label="Mesas" />
          <SettingsSwitch checked={resource.data.pos_counter} onChange={(value) => set("pos_counter", value)} label="En el local (sin mesa asignada)" />
          <SettingsSwitch checked={resource.data.pos_takeaway} onChange={(value) => set("pos_takeaway", value)} label="Para llevar" />
          <SettingsSwitch checked={resource.data.pos_delivery} onChange={(value) => set("pos_delivery", value)} label="Domicilio" />
        </div>
        <div className="settings-option-group"><h3>Menú digital</h3><p>Pedidos que realizan directamente tus clientes.</p>
          <SettingsSwitch checked={resource.data.digital_tables} onChange={(value) => set("digital_tables", value)} label="Mesas" />
          <SettingsSwitch checked={resource.data.digital_takeaway} onChange={(value) => set("digital_takeaway", value)} label="Para recoger" />
          <SettingsSwitch checked={resource.data.digital_delivery} onChange={(value) => set("digital_delivery", value)} label="Domicilio" />
        </div>
        <SettingsFormActions dirty={resource.dirty} saving={resource.saving} disabled={!resource.available} onCancel={resource.reset} onSave={() => void resource.save()} />
      </SettingsCard>
    </div>
  );
}

export { DeliverySettingsSection } from "./DeliverySettings";

function MethodGroup({ title, values, onChange }: { title: string; values: PaymentMethod[]; onChange: (values: PaymentMethod[]) => void }) {
  return <fieldset className="settings-method-group"><legend>{title}</legend>{paymentMethods.map((method) => <label key={method.value}><input type="checkbox" checked={values.includes(method.value)} onChange={() => onChange(values.includes(method.value) ? values.filter((value) => value !== method.value) : [...values, method.value])} />{method.label}</label>)}</fieldset>;
}

export function PaymentMethodsSettings() {
  const { branch } = useTenant();
  const legacy = (branch?.accepted_payment_methods || ["cash"]) as PaymentMethod[];
  const fallback: PaymentMethodSettings = { version: 0, delivery: legacy, pickup: legacy, counter: legacy };
  const resource = useSettingsResource(`/settings/branches/${branch?.id || 0}/payment-methods`, fallback, "Los métodos de pago se actualizaron.");
  if (resource.loading) return <><SettingsSectionHeader title="Métodos de pago" /><SettingsSkeleton /></>;
  const noMethods = !resource.data.delivery.length || !resource.data.pickup.length || !resource.data.counter.length;
  return <div className="settings-section-stack"><SettingsSectionHeader title="Métodos de pago" /><SettingsFeedback notice={resource.notice} error={resource.error || (noMethods ? "Cada modalidad necesita al menos un método de pago." : null)} success={resource.savedMessage} /><SettingsCard title="Métodos de pago para los clientes" description="Elige los métodos disponibles según la modalidad del pedido."><div className="settings-method-grid"><MethodGroup title="Domicilio" values={resource.data.delivery} onChange={(delivery) => resource.setData((current) => ({ ...current, delivery }))} /><MethodGroup title="Para recoger" values={resource.data.pickup} onChange={(pickup) => resource.setData((current) => ({ ...current, pickup }))} /><MethodGroup title="En el local" values={resource.data.counter} onChange={(counter) => resource.setData((current) => ({ ...current, counter }))} /></div><SettingsFormActions dirty={resource.dirty} saving={resource.saving} disabled={!resource.available || noMethods} onCancel={resource.reset} onSave={() => void resource.save()} /></SettingsCard></div>;
}

export function DeliveryTimesSettings() {
  const { branch } = useTenant();
  const fallback: DeliveryTimeSettings = { version: 0, delivery_min_minutes: 25, delivery_max_minutes: 45, pickup_minutes: 15 };
  const resource = useSettingsResource(`/settings/branches/${branch?.id || 0}/times`, fallback, "Los tiempos de entrega se actualizaron.");
  const invalid = resource.data.delivery_min_minutes < 1 || resource.data.delivery_max_minutes < resource.data.delivery_min_minutes || resource.data.pickup_minutes < 1;
  if (resource.loading) return <><SettingsSectionHeader title="Tiempos de entrega" /><SettingsSkeleton /></>;
  return <div className="settings-section-stack"><SettingsSectionHeader title="Tiempos de entrega" /><SettingsFeedback notice={resource.notice} error={resource.error || (invalid ? "Revisa los tiempos: el máximo debe ser igual o mayor al mínimo." : null)} success={resource.savedMessage} /><SettingsCard><div className="settings-time-form"><h3>Tiempo para pedidos a domicilio</h3><div className="settings-form-grid"><label>Mínimo<div className="settings-unit-input"><input type="number" min="1" value={resource.data.delivery_min_minutes} onChange={(event) => resource.setData((current) => ({ ...current, delivery_min_minutes: Number(event.target.value) }))} /><span>min</span></div></label><label>Máximo<div className="settings-unit-input"><input type="number" min="1" value={resource.data.delivery_max_minutes} onChange={(event) => resource.setData((current) => ({ ...current, delivery_max_minutes: Number(event.target.value) }))} /><span>min</span></div></label></div><small>Desde que el cliente confirma su pedido.</small><h3>Tiempo para pedidos para recoger</h3><label><span className="sr-only">Minutos para recoger</span><div className="settings-unit-input"><input type="number" min="1" value={resource.data.pickup_minutes} onChange={(event) => resource.setData((current) => ({ ...current, pickup_minutes: Number(event.target.value) }))} /><span>min</span></div></label></div><SettingsFormActions dirty={resource.dirty} saving={resource.saving} disabled={!resource.available || invalid} onCancel={resource.reset} onSave={() => void resource.save()} /></SettingsCard></div>;
}

export function WhatsAppSettingsSection() {
  const { branch } = useTenant();
  const fallback: WhatsAppSettings = { number: null, status: "unknown", provider: "unknown", last_synced_at: null };
  const query = useSettingsQuery(`/settings/branches/${branch?.id || 0}/whatsapp`, fallback);
  if (query.loading) return <><SettingsSectionHeader title="WhatsApp vinculado" /><SettingsSkeleton rows={2} /></>;
  const linked = query.data.status === "linked";
  return <div className="settings-section-stack"><SettingsSectionHeader title="WhatsApp vinculado" /><SettingsFeedback notice={query.notice} error={query.error} /><SettingsCard><div className="settings-whatsapp-row"><span className={linked ? "linked" : "unknown"}><MessageSquareText /></span><div><strong>Número de WhatsApp para recibir pedidos</strong><p>{query.data.number || "No hay un número confirmado por la API"}</p><small>{linked ? "Vinculación activa mediante la configuración administrativa." : "El estado de WhatsApp no está disponible o requiere vinculación."}</small></div><span className={`settings-status-chip ${linked ? "success" : "neutral"}`}>{linked ? <><Check />Vinculado</> : <><AlertTriangle />Sin confirmar</>}</span></div><div className="settings-readonly-note"><strong>Solo lectura</strong><p>Para proteger el canal de atención, el número se cambia desde el proceso administrativo de integraciones. Esta pantalla nunca modifica n8n ni el gateway QR.</p></div></SettingsCard></div>;
}
