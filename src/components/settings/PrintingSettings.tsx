import { AlertTriangle, CheckCircle2, Download, Headphones, LoaderCircle, Printer, RefreshCw, Ticket, WifiOff } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useQzPrinters } from "../../lib/use-qz-printers";
import { printerCompatibilityError } from "../../lib/qz-tray";
import { loadSettings } from "../../lib/settings";
import { PrintingDiagnostics } from "./PrintingDiagnostics";
import { QzActivationDownload } from "./QzActivationDownload";
import { PrintingConfigurationDialog, PrintingTemplateEditor } from "./PrintingEditors";
import type { PrintSettings, QzConnectionState, TicketField } from "../../types/settings";
import {
  SettingsCard,
  SettingsFeedback,
  SettingsSectionHeader,
  SettingsSkeleton,
  SettingsSwitch,
} from "./SettingsPrimitives";
import { useDirtyRegistration, useSettingsEnabled, useSettingsResource } from "./SettingsState";
import "./printing-settings.css";

const defaultCustomerFields: TicketField[] = [
  { key: "business", label: "Nombre del negocio", enabled: true },
  { key: "branch", label: "Sucursal y dirección", enabled: true },
  { key: "customer", label: "Datos del cliente", enabled: true },
  { key: "payment", label: "Método de pago", enabled: true },
  { key: "notes", label: "Notas del pedido", enabled: true },
];

const defaultKitchenFields: TicketField[] = [
  { key: "order", label: "Número y hora del pedido", enabled: true },
  { key: "service", label: "Modalidad y mesa", enabled: true },
  { key: "items", label: "Productos y modificadores", enabled: true },
  { key: "notes", label: "Notas de cocina", enabled: true },
];

const fallbackPrinting: PrintSettings = {
  version: 0,
  advanced_printing: false,
  operating_system: "unknown",
  printer_name: "",
  paper_width_mm: 80,
  copies: 1,
  auto_print_kitchen: true,
  manual_customer_receipt: true,
  customer_ticket_fields: defaultCustomerFields,
  kitchen_ticket_fields: defaultKitchenFields,
};

const qzCopy: Record<QzConnectionState, { title: string; detail: string }> = {
  idle: { title: "QZ Tray aún no está conectado", detail: "Conecta este dispositivo para detectar impresoras locales." },
  loading: { title: "Cargando el conector seguro", detail: "Estamos preparando la comunicación local con QZ Tray." },
  permission: { title: "Autoriza este dispositivo", detail: "Acepta el permiso del navegador o de QZ Tray para continuar." },
  connecting: { title: "Conectando con QZ Tray", detail: "Mantén QZ Tray abierto mientras verificamos la conexión." },
  connected: { title: "QZ Tray conectado", detail: "Las impresoras de este equipo están disponibles para seleccionar." },
  "not-installed": { title: "Instala y abre QZ Tray", detail: "El conector ya está incluido en el POS; también necesitas la aplicación QZ Tray en este equipo." },
  "not-open": { title: "QZ Tray no se encuentra abierto", detail: "Abre QZ Tray desde tu equipo y vuelve a intentarlo." },
  error: { title: "No se pudo conectar con QZ Tray", detail: "Revisa el permiso, el certificado y la conexión local antes de reintentar." },
  denied: { title: "Falta autorizar el acceso", detail: "Permite el acceso en el navegador y QZ Tray, y pulsa Reintentar." },
};

function QzStatus({ state, detail }: { state: QzConnectionState; detail?: string | null }) {
  const copy = qzCopy[state];
  const busy = ["connecting", "loading", "permission"].includes(state);
  const Icon = state === "connected" ? CheckCircle2 : busy ? LoaderCircle : state === "not-open" ? WifiOff : AlertTriangle;
  return (
    <div className={`settings-qz-status is-${state}`} role={state === "error" || state === "denied" ? "alert" : "status"} aria-live="polite">
      <Icon className={busy ? "spin" : ""} />
      <div><strong>{copy.title}</strong><p>{detail || copy.detail}</p></div>
    </div>
  );
}

export function PrintingSettings({ branchId, businessName, branchName }: { branchId: number; businessName?: string; branchName?: string }) {
  const path = `/settings/branches/${branchId}/printing`;
  const resource = useSettingsResource(path, fallbackPrinting, "La configuración de impresión se guardó.");
  const enabled = useSettingsEnabled();
  const [detecting, setDetecting] = useState(true);
  const qz = useQzPrinters(branchId, resource.available && enabled && detecting);
  const qzState = qz.state;
  const localPrinters = qz.data?.printers || [];
  const [surface, setSurface] = useState<"configure" | "customer" | "kitchen" | null>(null);
  const [mainPatch, setMainPatch] = useState<Partial<PrintSettings> | null>(null);
  const [checking, setChecking] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const request = useRef(false);
  const lifetime = useRef({ active: true });
  useLayoutEffect(() => {
    const current = { active: enabled }; lifetime.current = current;
    return () => { current.active = false; };
  }, [branchId, enabled]);
  const display = { ...resource.data, ...mainPatch };
  const qzBusy = qz.busy;
  const missingPrinter = Boolean(resource.data.printer_name && !localPrinters.includes(resource.data.printer_name));
  const incompatible = printerCompatibilityError(qz.data?.details?.find((printer) => printer.name === resource.data.printer_name), resource.data.print_language);
  const busy = resource.saving || checking;
  const locked = !enabled || !resource.available || resource.loading || busy || Boolean(mainPatch);
  const cannotPrint = locked || Boolean(surface) || !resource.data.advanced_printing || resource.dirty || !resource.data.printer_name || missingPrinter || qzState !== "connected" || Boolean(incompatible);
  useDirtyRegistration({ dirty: Boolean(mainPatch), saving: busy, save: null });
  function connectQz() { setDetecting(true); qz.retry(); }
  function openSurface(next: "configure" | "customer" | "kitchen", button: HTMLButtonElement) {
    if (locked || surface) return;
    opener.current = button;
    setLocalError(null);
    setSurface(next);
  }
  function closeSurface() {
    const target = opener.current;
    const current = lifetime.current;
    setSurface(null);
    // Inert can blur the opener before the portal's passive focus effect runs.
    window.setTimeout(() => {
      if (current.active && current === lifetime.current && target?.isConnected && !target.closest("[inert], [hidden]")) target.focus();
    });
  }
  async function verifyMain(patch: Partial<PrintSettings>, current = lifetime.current) {
    setChecking(true);
    try {
      const result = await loadSettings(path, resource.data);
      if (!current.active || lifetime.current !== current) return;
      if (!result.available) throw new Error("No se pudo verificar la configuración.");
      const matches = Object.entries(patch).every(([key, value]) => JSON.stringify(result.data[key as keyof PrintSettings]) === JSON.stringify(value));
      await resource.reload();
      if (!current.active || lifetime.current !== current) return;
      setMainPatch(null);
      setLocalError(matches ? null : "El cambio no está confirmado. Se conservan los ajustes guardados; vuelve a intentarlo.");
    } catch {
      if (current.active && lifetime.current === current) setLocalError("No pudimos verificar el resultado. Verifica el guardado antes de cambiar otro ajuste; no repetiremos la escritura.");
    } finally { if (current.active && lifetime.current === current) setChecking(false); }
  }
  async function saveMain(patch: Partial<PrintSettings>) {
    if (locked || surface || request.current) return;
    const next = { ...resource.data, ...patch };
    const compatibility = printerCompatibilityError(qz.data?.details?.find((printer) => printer.name === next.printer_name), next.print_language);
    if (patch.printer_name && compatibility) { setLocalError(compatibility); return; }
    const current = lifetime.current;
    request.current = true; setMainPatch(patch); setLocalError(null);
    try {
      const saved = await resource.savePatch(patch);
      if (!current.active || lifetime.current !== current) return;
      if (saved) setMainPatch(null);
      else await verifyMain(patch, current);
    } finally { request.current = false; }
  }
  async function saveDraft(patch: Partial<PrintSettings>) {
    if (!enabled || !resource.available || busy || mainPatch || request.current) return false;
    const current = lifetime.current;
    request.current = true;
    try { return await resource.savePatch(patch) && current.active && lifetime.current === current; }
    finally { request.current = false; }
  }
  function validateConfiguration(settings: PrintSettings) {
    if (!settings.advanced_printing) return null;
    if (!settings.printer_name || missingPrinter || qzState !== "connected") return "Conecta la impresora seleccionada antes de guardar su configuración.";
    return printerCompatibilityError(qz.data?.details?.find((printer) => printer.name === settings.printer_name), settings.print_language);
  }
  const platform = navigator.userAgent;
  const operatingSystem = /Android|iPhone|iPad|iPod/i.test(platform) ? "Dispositivo móvil" : /Windows/i.test(platform) ? "Windows" : /Macintosh|Mac OS/i.test(platform) ? "macOS" : /Linux/i.test(platform) ? "Linux" : "No identificado";

  return (
    <>
    <div className="settings-section-stack printing-settings" inert={Boolean(surface) || !enabled || undefined}>
      <SettingsSectionHeader title="Impresión" />
      <SettingsFeedback notice={resource.notice} error={localError || resource.error} success={mainPatch ? null : resource.savedMessage} />
      {busy && <p className="settings-muted" role="status">{checking ? "Verificando guardado..." : "Guardando configuración..."}</p>}
      {mainPatch && !busy && <button className="button button-secondary" type="button" disabled={!enabled} onClick={() => void verifyMain(mainPatch)}>Verificar guardado</button>}
      {resource.loading && !resource.available ? <SettingsSkeleton rows={5} /> : <>
        <SettingsCard title="Configuración de impresión">
          <div className="printing-primary-fields">
              <SettingsSwitch
                label="Impresión avanzada"
                description="Imprime tickets y comandas desde este equipo. Los cambios se guardan automáticamente."
                checked={display.advanced_printing}
                disabled={locked}
                onChange={(checked) => void saveMain({ advanced_printing: checked })}
              />
              {display.advanced_printing && <>
              <label>Sistema operativo<input readOnly value={operatingSystem} /></label>
              <div className="printing-printer-row"><label>Impresora<select aria-label="Impresora" disabled={locked || qzState !== "connected"} value={display.printer_name} onChange={(event) => void saveMain({ printer_name: event.target.value })}><option value="">Selecciona una impresora</option>{missingPrinter && <option value={resource.data.printer_name} disabled>{resource.data.printer_name} (no detectada)</option>}{localPrinters.map((printer) => <option key={printer} value={printer}>{printer}</option>)}</select></label><button className="button button-secondary" type="button" disabled={locked} onClick={(event) => openSurface("configure", event.currentTarget)}>Configurar impresión</button></div>
              </>}
              <QzStatus state={qzState} detail={qz.detail} />
              {qz.data?.mode === "manual-approval" && <p className="settings-muted" role="status"><strong>Autorización por trabajo.</strong> La impresora está conectada sin firma del servidor. QZ Tray seguirá mostrando avisos aunque guardes la impresora. Revisa «Conexión y prueba de impresión» para configurar la confianza una sola vez.</p>}
              {qzState === "connected" && !localPrinters.length && <p className="settings-muted" role="status">No se encontraron impresoras. Instala la impresora en este sistema operativo y pulsa Actualizar impresoras.</p>}
              {qzState === "connected" && missingPrinter && <p className="settings-muted" role="status">La impresora guardada no está disponible en este equipo. No se sustituirá por otra automáticamente.</p>}
              <SettingsFeedback error={incompatible} />
          </div>
          <details className="printing-disclosure">
            <summary>Conexión y prueba de impresión</summary>
            <div className="printing-connection-tools">
              <div className="settings-inline-actions settings-qz-actions">
                <button className="button button-secondary" type="button" disabled={qzBusy || locked} onClick={connectQz}><RefreshCw />{qzState === "connected" ? "Actualizar impresoras" : "Reintentar"}</button>
                {qzState !== "connected" && <a className="button button-secondary" href="https://qz.io/download/" target="_blank" rel="noreferrer"><Download />Instalar QZ Tray</a>}
                {qzState !== "connected" && <a className="button button-secondary" href="qz:launch">Abrir QZ Tray</a>}
                {detecting && qzState !== "connected" && <button className="button button-secondary" type="button" onClick={() => setDetecting(false)}>Detener conexión</button>}
              </div>
              {qzState !== "connected" && <p className="settings-muted">El navegador y QZ Tray tienen permisos independientes. Autoriza únicamente este POS. Reintentaremos mientras abres QZ Tray; un permiso bloqueado requiere tu intervención.</p>}
              {qz.data?.mode === "manual-approval" && <p className="settings-muted">Para imprimir sin avisos, el administrador debe configurar un certificado de confianza y su firma en la API. No autorices permanentemente solicitudes anónimas ni desactives la seguridad de QZ Tray.</p>}
              {qz.data?.mode === "signed" && <p className="settings-muted"><strong>Firma del servidor activa.</strong> Para usar el certificado propio en otro equipo, descarga y ejecuta la activación de QZ. Si utilizas un certificado comercial reconocido, puedes marcar «Remember this decision» y pulsar «Allow» una vez. Si aparece «Anonymous» o «Untrusted website», revisa la activación antes de autorizar. La firma no confirma por sí sola la confianza de este equipo.</p>}
              <QzActivationDownload key={branchId} branchId={branchId} disabled={locked} />
            </div>
            <PrintingDiagnostics key={`${branchId}:${JSON.stringify(resource.data)}`} branchId={branchId} businessName={businessName} branchName={branchName} settings={resource.data} printers={qz.data} disabled={cannotPrint} onReload={() => void resource.reload()} />
          </details>
        </SettingsCard>
        <SettingsCard title="Personalización de ticket" description="Elige los datos de los próximos tickets enviados por QZ Tray. Los documentos ya preparados conservan su formato original.">
          <div className="settings-ticket-list">
            <div><span><Ticket /><span><strong>Ticket para cliente</strong><small>Texto y contenido del recibo.</small></span></span><button className="button button-secondary" type="button" disabled={locked} onClick={(event) => openSurface("customer", event.currentTarget)}>Personalizar cliente</button></div>
            <div><span><Printer /><span><strong>Ticket para cocina/barra</strong><small>Formato de la comanda de preparación.</small></span></span><button className="button button-secondary" type="button" disabled={locked} onClick={(event) => openSurface("kitchen", event.currentTarget)}>Personalizar cocina</button></div>
          </div>
        </SettingsCard>

        <SettingsCard title="Soporte técnico">
          <p className="settings-support-copy">Las impresoras se detectan en este equipo, no en el servidor. Si no aparece una, instálala en Windows, macOS o Linux, abre QZ Tray y actualiza la lista. En móvil utiliza un equipo con QZ Tray instalado.</p>
          <button className="button button-secondary" type="button" disabled aria-describedby="printing-support-pending"><Headphones />Contactar soporte</button><p id="printing-support-pending" className="settings-muted">Próximamente.</p>
        </SettingsCard>
      </>}

    </div>
    {surface === "configure" && <PrintingConfigurationDialog settings={resource.data} busy={busy} enabled={enabled} error={resource.error} onSave={saveDraft} onClose={closeSurface} validate={validateConfiguration} />}
    {(surface === "customer" || surface === "kitchen") && <PrintingTemplateEditor settings={resource.data} kind={surface} businessName={businessName} branchName={branchName} busy={busy} enabled={enabled} error={resource.error} onSave={saveDraft} onClose={closeSurface} />}
    </>
  );
}
