import { useEffect, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { loadSettings, printingTemplate } from "../../lib/settings";
import { qzBridge, type QzPrinters } from "../../lib/qz-tray";
import { renderThermalDocument } from "../../lib/thermal-print";
import { createThermalPrintSample } from "../../lib/thermal-print-sample";
import type { PrintSettings } from "../../types/settings";
import { SettingsFeedback } from "./SettingsPrimitives";

export function PrintingDiagnostics({ branchId, businessName, branchName, settings, disabled, printers, onReload }: {
  branchId: number; businessName?: string; branchName?: string; settings: PrintSettings;
  disabled: boolean; printers: QzPrinters | null; onReload: () => void;
}) {
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    let current = true;
    // Read back the saved version, not a draft or another branch's QZ connection.
    void loadSettings(`/settings/branches/${branchId}/printing`, settings).then((result) => {
      if (!current) return;
      if (!result.available || JSON.stringify(result.data) !== JSON.stringify(settings)) {
        setError("La configuración guardada cambió o no se pudo verificar. Recarga esta sección antes de imprimir la prueba.");
      } else setVerified(true);
    }, () => {
      if (current) setError("No se pudo verificar el guardado en la API. Recarga esta sección; no hace falta volver a guardar.");
    });
    return () => { current = false; controller.current?.abort(); };
  }, [branchId, settings]);

  async function printTest(short: boolean) {
    if (busy || disabled || !verified || controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true); setError(null);
    let accepted = 0;
    let sending = false;
    try {
      for (const kitchen of short ? [false] : [false, true]) {
        request.signal.throwIfAborted();
        sending = false;
        setProgress(kitchen ? "Enviando comanda de prueba..." : "Enviando ticket de prueba...");
        const sample = createThermalPrintSample({ businessName, branchName, paperWidth: settings.paper_width_mm, kitchen, short,
          template: printingTemplate(settings, kitchen ? "kitchen" : "customer") });
        await qzBridge.dispatch({ branchId, printerName: settings.printer_name, paperWidth: settings.paper_width_mm,
          copies: 1, printLanguage: settings.print_language, html: renderThermalDocument(sample),
          jobName: kitchen ? "PRUEBA - Comanda" : "PRUEBA - Ticket", signal: request.signal,
          beforeSend: async () => {}, onSending: () => { sending = true; } });
        accepted += 1;
      }
      if (!request.signal.aborted) setProgress(`${accepted} ${accepted === 1 ? "documento enviado" : "documentos enviados"} a QZ Tray. Comprueba en el papel que el texto sea visible, los importes correctos y que haya un corte después de cada documento.`);
    } catch (caught) {
      if (!request.signal.aborted) {
        setProgress(null);
        setError(sending
          ? `QZ no confirmó el resultado. ${accepted} documento(s) aceptados antes del fallo. Revisa el papel antes de solicitar otra prueba; no reenviaremos automáticamente.`
          : `${caught instanceof Error ? caught.message : "No se pudo enviar la prueba."}${accepted ? ` ${accepted} documento(s) ya enviados; revisa el papel antes de repetir.` : ""}`);
      }
    } finally {
      if (!request.signal.aborted) { setBusy(false); controller.current = null; }
    }
  }

  const driver = printers?.details?.find((printer) => printer.name === settings.printer_name)?.driver;
  return <section className="printing-diagnostics" aria-label="Prueba de impresión">
    <h4>Prueba de impresión</h4>
    <p>Comprueba primero el texto y el corte con una prueba corta. Después imprime un ticket y una comanda, separados. No se crean pedidos ni cobros.</p>
    <p className="settings-support-copy"><strong>{businessName || "Negocio actual"} / {branchName || `Sucursal ${branchId}`}</strong><br />
      {settings.printer_name || "Sin impresora"} · {settings.print_language === "escpos" ? "ESC/POS" : "Gráfico (HTML)"} · {settings.paper_width_mm} mm · 1 copia de prueba
      {driver && <><br />Controlador: {driver}</>}
    </p>
    <SettingsFeedback error={error} />
    <p className="settings-muted" role="status">{progress || (verified ? `Configuración verificada en la API · Sucursal ${branchId} · Versión ${settings.version}` : "Verificando configuración guardada...")}</p>
    <div className="settings-inline-actions">
      {error && !verified && <button type="button" className="button button-secondary" onClick={onReload}>Verificar de nuevo</button>}
      <button type="button" className="button button-secondary" disabled={disabled || !verified || busy} onClick={() => void printTest(true)}>Imprimir prueba corta</button>
      <button type="button" className="button button-secondary" disabled={disabled || !verified || busy} onClick={() => void printTest(false)}><Printer />Imprimir prueba</button>
    </div>
    {disabled && <p className="settings-muted">Guarda los cambios y conecta la impresora compatible para habilitar la prueba.</p>}
  </section>;
}
