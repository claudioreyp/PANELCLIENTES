import { Download } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { apiBlob } from "../../lib/api";

export function QzActivationDownload({ branchId, disabled }: { branchId: number; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(false);
  const allowed = useRef(!disabled);
  const lifetime = useRef({ active: true });
  useLayoutEffect(() => { allowed.current = !disabled; }, [disabled]);
  useLayoutEffect(() => {
    const current = { active: true };
    lifetime.current = current;
    return () => { current.active = false; };
  }, [branchId]);
  async function download() {
    if (disabled || request.current) return;
    const current = lifetime.current;
    request.current = true;
    setBusy(true); setError(null); setNotice(null);
    try {
      const blob = await apiBlob(`/settings/branches/${branchId}/printing/qz/activation`);
      if (!current.active || !allowed.current || lifetime.current !== current) return;
      if (!blob.size || blob.type !== "application/zip") throw new Error("Invalid activation package");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "Escalar-AI-POS-activar-impresion.zip";
      document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice("Paquete descargado. Extrae todos los archivos y sigue LEEME. Después vuelve aquí y actualiza impresoras; la descarga no confirma la activación.");
    } catch {
      if (current.active && lifetime.current === current) setError("No se pudo descargar la activación. Comprueba tu conexión y que la API tenga configurado el certificado propio del POS, y reintenta.");
    } finally {
      request.current = false;
      if (current.active && lifetime.current === current) setBusy(false);
    }
  }
  return <div>
    <button className="button button-secondary" type="button" disabled={disabled || busy} onClick={() => void download()}><Download />{busy ? "Descargando activación..." : "Descargar activación de QZ"}</button>
    <p className="settings-muted">Una sola vez en cada equipo con QZ Tray: registra el certificado público de Escalar AI POS para evitar avisos por pedido. Windows, macOS y Linux. No activa la impresión directamente desde el teléfono.</p>
    {notice && <p className="settings-muted" role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
