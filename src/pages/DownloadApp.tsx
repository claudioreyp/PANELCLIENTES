import { Check, Download, LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { appInstallation, installationInstructions } from "../lib/app-installation";
import { useAppInstallation } from "../lib/use-app-installation";
import "./download-app.css";

export function DownloadAppPage() {
  const { status, canPrompt } = useAppInstallation();
  const heading = useRef<HTMLHeadingElement>(null);
  const guide = installationInstructions({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, secure: window.isSecureContext });
  const installed = status === "installed";
  const pending = status === "prompting";

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Descargar aplicación · Escalar AI POS";
    heading.current?.focus();
    return () => { document.title = previousTitle; };
  }, []);

  return (
    <section className="download-app" aria-labelledby="download-app-title">
      <header className="download-app-heading"><h1 id="download-app-title" ref={heading} tabIndex={-1}>Descargar aplicación</h1></header>
      <section className="install-app-card" aria-labelledby="install-app-heading">
        <header><h2 id="install-app-heading">Aplicación de Escalar AI POS</h2></header>
        <div className="install-app-body">
          <div aria-live="polite" aria-atomic="true">
            {installed && <div className="install-app-success"><Check aria-hidden="true" /><div><h3>Instalación completada</h3><p>Escalar AI POS está instalada o abierta como aplicación. Puedes usarla en su propia ventana.</p></div></div>}
            {pending && <p role="status">Confirma la instalación en el navegador.</p>}
            {status === "accepted" && <p role="status">Confirma la instalación en el navegador. Esperamos su confirmación para mostrarla como completada.</p>}
            {status === "dismissed" && <p role="status">Cancelaste la instalación. Tu sesión sigue abierta. Puedes volver a instalar desde el menú del navegador o cuando se habilite el botón.</p>}
            {status === "error" && <p role="alert">No se pudo abrir la instalación. Usa el menú del navegador o vuelve a intentarlo cuando se habilite el botón.</p>}
          </div>
          {!installed && <>
            <p className="install-app-description">Abre tu POS en su propia ventana y accede desde las aplicaciones de tu dispositivo.</p>
            {canPrompt && <p>Haz clic en el botón y selecciona «Instalar» en el navegador.</p>}
            <button className="button button-primary install-app-action" disabled={!canPrompt} aria-busy={pending} onClick={() => void appInstallation.install()}>
              {pending ? <LoaderCircle className="spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
              {pending ? "Solicitando instalación..." : "Instalar Escalar AI POS"}
            </button>
            {!canPrompt && !pending && <section className="install-app-guide" aria-labelledby="install-guide-title"><h3 id="install-guide-title">{guide.title}</h3><ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol></section>}
          </>}
          <p className="install-app-note">Necesitas conexión para usar el POS. Instalar la app no cambia tus permisos ni vincula este dispositivo con un PIN. QZ Tray se instala por separado para imprimir.</p>
        </div>
      </section>
    </section>
  );
}
