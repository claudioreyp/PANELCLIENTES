import { ArrowLeft, Eye, SlidersHorizontal, X } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { DialogPortal, useDialogSurface } from "../../lib/dialog";
import { printingTemplate } from "../../lib/settings";
import { renderThermalBody, thermalPrintCss } from "../../lib/thermal-print";
import { createThermalPrintSample } from "../../lib/thermal-print-sample";
import type { PrintSettings } from "../../types/settings";
import { SettingsConfirmDialog, SettingsFeedback, SettingsSwitch } from "./SettingsPrimitives";
import { useDirtyRegistration } from "./SettingsState";

type EditorProps = {
  settings: PrintSettings;
  busy: boolean;
  enabled: boolean;
  error: string | null;
  onSave: (patch: Partial<PrintSettings>) => Promise<boolean>;
  onClose: () => void;
};

function changedFields(baseline: Partial<PrintSettings>, draft: Partial<PrintSettings>): Partial<PrintSettings> {
  return Object.fromEntries(Object.entries(draft).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(baseline[key as keyof PrintSettings])));
}

function PrintingSurface({ title, fullScreen = false, dirty, busy, enabled, invalid, onSave, onClose, children }: {
  title: string; fullScreen?: boolean; dirty: boolean; busy: boolean; enabled: boolean; invalid?: boolean;
  onSave: () => Promise<boolean>; onClose: () => void; children: ReactNode;
}) {
  const titleId = useId();
  const [confirm, setConfirm] = useState(false);
  const savingRef = useRef(false);
  function requestClose() {
    if (busy || savingRef.current || !enabled) return;
    if (dirty) setConfirm(true);
    else onClose();
  }
  const ref = useDialogSurface(requestClose, { enabled });
  useDirtyRegistration({ dirty, saving: busy, save: null });
  async function save() {
    if (busy || savingRef.current || !enabled || invalid || !dirty) return;
    savingRef.current = true;
    try { if (await onSave()) onClose(); } finally { savingRef.current = false; }
  }
  return <DialogPortal>
    <div className={`printing-overlay ${fullScreen ? "is-fullscreen" : ""}`} hidden={!enabled} onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <section ref={ref} className={fullScreen ? "printing-editor" : "printing-config-dialog"} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="printing-surface-header">
          {fullScreen && <button className="button button-secondary" type="button" data-dialog-initial-focus disabled={busy} onClick={requestClose}><ArrowLeft />Salir</button>}
          <h2 id={titleId}>{title}</h2>
          {fullScreen ? <button className="button button-primary" type="button" disabled={busy || !dirty || invalid} onClick={() => void save()}>{busy ? "Guardando..." : "Guardar"}</button>
            : <button className="icon-button" type="button" data-dialog-initial-focus aria-label="Cerrar configuración de impresora" disabled={busy} onClick={requestClose}><X /></button>}
        </header>
        <div className="printing-surface-body" inert={busy || undefined}>{children}</div>
        {!fullScreen && <footer className="printing-surface-footer"><button className="button button-secondary" type="button" disabled={busy} onClick={requestClose}>Cancelar</button><button className="button button-primary" type="button" disabled={busy || !dirty || invalid} onClick={() => void save()}>{busy ? "Guardando..." : "Guardar"}</button></footer>}
      </section>
    </div>
    {confirm && enabled && <SettingsConfirmDialog title="Tienes cambios sin guardar" detail="Puedes seguir editando o descartar este borrador. Los ajustes guardados no cambian." confirmLabel="Descartar cambios" danger busy={busy} onCancel={() => setConfirm(false)} onConfirm={onClose} />}
  </DialogPortal>;
}

export function PrintingConfigurationDialog({ settings, busy, enabled, error, onSave, onClose, validate }: EditorProps & { validate: (settings: PrintSettings) => string | null }) {
  const [baseline] = useState(() => ({ paper_width_mm: settings.paper_width_mm, copies: settings.copies, print_language: settings.print_language || "pixel", automatic_printing: settings.automatic_printing ?? true, auto_print_kitchen: settings.auto_print_kitchen, manual_customer_receipt: settings.manual_customer_receipt } satisfies Partial<PrintSettings>));
  const [draft, setDraft] = useState(baseline);
  const patch = changedFields(baseline, draft);
  const validation = validate({ ...settings, ...draft });
  const invalidCopies = !Number.isInteger(draft.copies) || draft.copies < 1 || draft.copies > 5;
  const copies = invalidCopies ? settings.copies : draft.copies;
  const printLabel = `Imprimir ${copies} ${copies === 1 ? "vez" : "veces"}`;
  return <PrintingSurface title="Configurar impresora" dirty={Object.keys(patch).length > 0} busy={busy} enabled={enabled} invalid={invalidCopies || Boolean(validation)} onSave={() => onSave(patch)} onClose={onClose}>
    <div className="printing-config-fields">
      <p className="printing-config-identity"><strong>Impresora:</strong> {settings.printer_name || "Sin impresora seleccionada"}</p>
      <SettingsFeedback error={error || validation} />
      <label>Ancho de papel<select aria-label="Ancho de papel" value={draft.paper_width_mm} onChange={(event) => setDraft({ ...draft, paper_width_mm: Number(event.target.value) as 58 | 80 })}><option value="58">58 mm</option><option value="80">80 mm</option></select></label>
      <SettingsSwitch label="Impresión automática" description="Al apagarla se conservan las preferencias de cada documento." checked={draft.automatic_printing} onChange={(automatic_printing) => setDraft({ ...draft, automatic_printing })} />
      <fieldset className="printing-document-options" disabled={!draft.automatic_printing}>
        <legend>Impresión por documento</legend>
        <label>Ticket para cliente<select aria-label="Ticket para cliente" value={draft.manual_customer_receipt ? "off" : "on"} onChange={(event) => setDraft({ ...draft, manual_customer_receipt: event.target.value === "off" })}><option value="off">No imprimir</option><option value="on">{printLabel}</option></select><small>Al crear un pedido fuera de mesas o al cerrar efectivamente una cuenta de mesa.</small></label>
        <label>Ticket para cocina/barra<select aria-label="Ticket para cocina/barra" value={draft.auto_print_kitchen ? "on" : "off"} onChange={(event) => setDraft({ ...draft, auto_print_kitchen: event.target.value === "on" })}><option value="off">No imprimir</option><option value="on">{printLabel}</option></select><small>Al confirmar el envío a cocina, incluidos los productos agregados.</small></label>
      </fieldset>
      <details className="printing-disclosure"><summary>Opciones avanzadas</summary><div className="printing-advanced-fields">
        <label>Tipo de impresora<select aria-label="Tipo de impresora" value={draft.print_language} onChange={(event) => setDraft({ ...draft, print_language: event.target.value as "pixel" | "escpos" })}><option value="pixel">Controlador gráfico (HTML)</option><option value="escpos">Térmica ESC/POS (controlador genérico)</option></select></label>
        <p>Usa ESC/POS para una térmica compatible con Generic / Text Only. No cambiamos el controlador del equipo.</p>
        <label>Copias por trabajo<input type="number" min={1} max={5} step={1} value={Number.isNaN(draft.copies) ? "" : draft.copies} onChange={(event) => setDraft({ ...draft, copies: event.target.value === "" ? NaN : Number(event.target.value) })} /></label>
        {invalidCopies && <p role="alert">Elige entre 1 y 5 copias enteras.</p>}
        <p>La cantidad se aplica a ambos documentos, también a las impresiones manuales que usen esta configuración.</p>
      </div></details>
    </div>
  </PrintingSurface>;
}

export function PrintingTemplateEditor({ settings, kind, busy, enabled, error, onSave, onClose, businessName, branchName }: EditorProps & {
  kind: "customer" | "kitchen"; businessName?: string; branchName?: string;
}) {
  const customer = kind === "customer";
  const [baseline] = useState<Partial<PrintSettings>>(() => customer ? {
    customer_ticket_font_size: settings.customer_ticket_font_size ?? "normal",
    customer_ticket_fields: settings.customer_ticket_fields,
    customer_ticket_header_enabled: settings.customer_ticket_header_enabled ?? false,
    customer_ticket_header_text: settings.customer_ticket_header_text ?? "",
    customer_ticket_footer_enabled: settings.customer_ticket_footer_enabled ?? false,
    customer_ticket_footer_text: settings.customer_ticket_footer_text ?? "",
  } : { kitchen_ticket_font_size: settings.kitchen_ticket_font_size ?? "normal", kitchen_ticket_fields: settings.kitchen_ticket_fields });
  const [draft, setDraft] = useState(baseline);
  const [preview, setPreview] = useState(false);
  const patch = changedFields(baseline, draft);
  const fontKey = customer ? "customer_ticket_font_size" : "kitchen_ticket_font_size";
  const fieldsKey = customer ? "customer_ticket_fields" : "kitchen_ticket_fields";
  const helpId = useId();
  const headerLength = draft.customer_ticket_header_text?.length ?? 0;
  const footerLength = draft.customer_ticket_footer_text?.length ?? 0;
  const invalidText = customer && (headerLength > 500 || footerLength > 500);
  const sample = createThermalPrintSample({ businessName, branchName, kitchen: !customer, paperWidth: settings.paper_width_mm, template: printingTemplate({ ...settings, ...draft }, kind) });
  return <PrintingSurface fullScreen title={customer ? "Ticket para cliente" : "Ticket para cocina/barra"} dirty={Object.keys(patch).length > 0} busy={busy} enabled={enabled} invalid={invalidText} onSave={() => onSave(patch)} onClose={onClose}>
    {(error || invalidText) && <div className="printing-editor-feedback"><SettingsFeedback error={invalidText ? "El encabezado y el pie de página admiten hasta 500 caracteres cada uno. Reduce el texto antes de guardar." : error} /></div>}
    <div className="printing-compact-tabs" aria-label="Vista del editor"><button className={`button ${preview ? "button-secondary" : "button-primary"}`} type="button" aria-pressed={!preview} onClick={() => setPreview(false)}><SlidersHorizontal />Editar</button><button className={`button ${preview ? "button-primary" : "button-secondary"}`} type="button" aria-pressed={preview} onClick={() => setPreview(true)}><Eye />Vista previa</button></div>
    <div className={`printing-editor-layout ${preview ? "shows-preview" : ""}`}>
      <div className="printing-editor-controls">
        <label>Tamaño de letra<select aria-label="Tamaño de letra" value={draft[fontKey]} onChange={(event) => setDraft({ ...draft, [fontKey]: event.target.value as "small" | "normal" | "large" })}><option value="small">Chica</option><option value="normal">Normal</option><option value="large">Grande</option></select></label>
        {customer && <>
          <div className="printing-text-option"><label className="printing-checkbox"><input type="checkbox" checked={draft.customer_ticket_header_enabled} onChange={(event) => setDraft({ ...draft, customer_ticket_header_enabled: event.target.checked })} />Encabezado personalizado</label>{draft.customer_ticket_header_enabled && <label>Texto del encabezado<textarea aria-label="Texto del encabezado" rows={4} maxLength={500} aria-invalid={headerLength > 500 || undefined} aria-describedby={`${helpId}-header`} value={draft.customer_ticket_header_text} onChange={(event) => setDraft({ ...draft, customer_ticket_header_text: event.target.value })} /><small id={`${helpId}-header`}>Texto plano, debajo del nombre del negocio. {headerLength}/500 caracteres.</small></label>}</div>
          <div className="printing-text-option"><label className="printing-checkbox"><input type="checkbox" checked={draft.customer_ticket_footer_enabled} onChange={(event) => setDraft({ ...draft, customer_ticket_footer_enabled: event.target.checked })} />Pie de página personalizado</label>{draft.customer_ticket_footer_enabled && <label>Texto del pie de página<textarea aria-label="Texto del pie de página" rows={4} maxLength={500} aria-invalid={footerLength > 500 || undefined} aria-describedby={`${helpId}-footer`} value={draft.customer_ticket_footer_text} onChange={(event) => setDraft({ ...draft, customer_ticket_footer_text: event.target.value })} /><small id={`${helpId}-footer`}>Texto plano, al final del ticket. {footerLength}/500 caracteres.</small></label>}</div>
        </>}
        <details className="printing-disclosure"><summary>Campos avanzados del ticket</summary><div className="settings-switch-list">
          <p>Los productos y sus importes siempre se incluyen. Los documentos anteriores conservan su plantilla.</p>
          {draft[fieldsKey]?.map((field) => <SettingsSwitch key={field.key} label={field.label} checked={field.key === "items" || field.enabled} disabled={field.key === "items"} onChange={(checked) => setDraft({ ...draft, [fieldsKey]: draft[fieldsKey]?.map((item) => item.key === field.key ? { ...item, enabled: checked } : item) })} />)}
        </div></details>
      </div>
      <section className="printing-preview-pane" aria-label="Vista previa del ticket">
        <header><h3>Vista previa</h3><span>{settings.paper_width_mm} mm</span></header>
        <p>Datos de ejemplo. No se imprime ni se registra un pedido.</p>
        <div className="printing-live-preview">
          <style>{thermalPrintCss.replaceAll(".thermal-document", ".printing-live-preview .thermal-document")}</style>
          {/* The shared renderer escapes every user-provided text value. */}
          <div dangerouslySetInnerHTML={{ __html: renderThermalBody(sample) }} />
        </div>
      </section>
    </div>
  </PrintingSurface>;
}
