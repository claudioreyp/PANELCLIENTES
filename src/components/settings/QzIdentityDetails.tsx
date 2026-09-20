import type { QzPrinters } from "../../lib/qz-tray";
import { QzActivationDownload } from "./QzActivationDownload";

export function QzIdentityDetails({ data, branchId, disabled }: { data: QzPrinters | null; branchId: number; disabled: boolean }) {
  if (data?.mode !== "signed") return null;
  const identity = data.identity;
  const date = identity ? new Date(identity.valid_to) : null;
  const expires = date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("es-PE", { dateStyle: "long", timeZone: "America/Lima" }).format(date) : null;
  return <>
    <p className="settings-muted"><strong>Firma del servidor activa.</strong> La confianza y la autorización de este equipo se comprueban en QZ Tray.</p>
    {identity?.activation === "remember" ? <p className="settings-muted">En el primer uso, comprueba la identidad de Escalar AI en la ventana de QZ Tray, marca «Remember this decision» y pulsa «Allow». No necesitas repetirlo por pedido ni al cambiar de empleado del POS. Otro usuario de Windows, macOS o Linux puede necesitar su propia autorización.</p>
      : identity?.activation === "install-certificate" ? <>
        <p className="settings-muted">Este servidor todavía usa el certificado propio. La verificación oficial de QZ estará disponible cuando se active el certificado emitido por QZ.</p>
        <QzActivationDownload key={branchId} branchId={branchId} disabled={disabled} />
      </> : <p className="settings-muted">Pide al administrador que confirme el tipo de certificado y el procedimiento de autorización antes de continuar.</p>}
    {expires && <p className="settings-muted">Certificado vigente hasta el {expires}.</p>}
    {identity?.expires_soon && <p className="settings-error" role="status">El certificado vence en los próximos 30 días. Contacta al administrador para renovarlo antes de que se interrumpa la impresión.</p>}
    {identity && <details>
      <summary>Datos públicos del certificado</summary>
      <dl className="qz-identity-details">
        <dt>Identidad</dt><dd>{identity.subject}</dd>
        <dt>Emisor</dt><dd>{identity.issuer}</dd>
        <dt>Huella SHA-256</dt><dd>{identity.fingerprint_sha256}</dd>
      </dl>
    </details>}
    <p className="settings-muted">Si aparece «Anonymous», «Untrusted website» o «Invalid signature», no autorices la solicitud. Revisa el certificado con el administrador. Los permisos del navegador son independientes.</p>
  </>;
}
