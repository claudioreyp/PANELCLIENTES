export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallStatus = "unavailable" | "available" | "prompting" | "accepted" | "dismissed" | "error" | "installed";
export type InstallSnapshot = Readonly<{ status: InstallStatus; canPrompt: boolean }>;
const INITIAL: InstallSnapshot = { status: "unavailable", canPrompt: false };
const STANDALONE_QUERY = "(display-mode: standalone)";

// A page-lifetime store captures early events without depending on authentication or routing.
export function createAppInstallation(target: Window) {
  let snapshot = INITIAL;
  let deferred: InstallPromptEvent | null = null;
  let requesting = false;
  let confirmed = false;
  let standalone = false;
  let generation = 0;
  let cleanup: (() => void) | undefined;
  const listeners = new Set<() => void>();

  function publish(status: InstallStatus) {
    snapshot = { status, canPrompt: Boolean(deferred) && !requesting && status !== "installed" };
    listeners.forEach((listener) => listener());
  }

  function start() {
    if (cleanup) return;
    const media = target.matchMedia?.(STANDALONE_QUERY);
    const refreshMode = () => {
      standalone = Boolean(media?.matches || (target.navigator as Navigator & { standalone?: boolean }).standalone);
      if (standalone || confirmed) publish("installed");
      else if (snapshot.status === "installed") publish(deferred ? "available" : "unavailable");
    };
    const capture = (event: Event) => {
      const candidate = event as InstallPromptEvent;
      if (typeof candidate.prompt !== "function" || !candidate.userChoice) return;
      event.preventDefault();
      if (confirmed || standalone) return;
      deferred = candidate;
      if (!requesting) publish("available");
    };
    const installed = () => {
      confirmed = true;
      deferred = null;
      publish("installed");
    };
    target.addEventListener("beforeinstallprompt", capture);
    target.addEventListener("appinstalled", installed);
    target.addEventListener("pageshow", refreshMode);
    media?.addEventListener("change", refreshMode);
    refreshMode();
    cleanup = () => {
      target.removeEventListener("beforeinstallprompt", capture);
      target.removeEventListener("appinstalled", installed);
      target.removeEventListener("pageshow", refreshMode);
      media?.removeEventListener("change", refreshMode);
    };
  }

  async function install() {
    if (!deferred || requesting || snapshot.status === "installed") return;
    const event = deferred;
    const attempt = generation;
    deferred = null;
    requesting = true;
    publish("prompting");
    try {
      // Must run synchronously in the click handler to preserve browser user activation.
      await event.prompt();
      const choice = await event.userChoice;
      if (attempt === generation && !confirmed && !standalone) {
        publish(choice.outcome === "accepted" ? "accepted" : "dismissed");
      }
    } catch {
      if (attempt === generation && !confirmed && !standalone) publish("error");
    } finally {
      if (attempt === generation) {
        requesting = false;
        publish(snapshot.status);
      }
    }
  }

  return {
    start,
    install,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => INITIAL,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose: () => {
      cleanup?.();
      cleanup = undefined;
      generation += 1;
      deferred = null;
      requesting = false;
      confirmed = false;
      standalone = false;
      publish("unavailable");
    },
  };
}

export const appInstallation = createAppInstallation(window);
if (import.meta.hot) import.meta.hot.dispose(() => appInstallation.dispose());

export function installationInstructions(environment: { userAgent: string; maxTouchPoints: number; secure: boolean }) {
  if (!environment.secure) return {
    title: "Abre el POS con una conexión segura",
    steps: ["La instalación requiere una dirección HTTPS. En este equipo también puedes usar localhost o 127.0.0.1.", "Pide la dirección segura del POS y ábrela en tu navegador habitual."],
  };
  const ua = environment.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && environment.maxTouchPoints > 1)) return {
    title: "Instalar en iPhone o iPad",
    steps: ["Abre esta misma dirección en Safari y pulsa Compartir.", "Elige Añadir a pantalla de inicio. Activa Abrir como app web si aparece y pulsa Añadir."],
  };
  if (/Edg\//i.test(ua)) return {
    title: "Instalar desde Microsoft Edge",
    steps: ["Abre el menú de tres puntos de Edge y busca Aplicaciones o Instalar este sitio como una aplicación.", "También puedes usar el icono de instalación de la barra de direcciones, si aparece. Confirma Instalar."],
  };
  if (/Android/i.test(ua) && /Chrome|EdgA/i.test(ua)) return {
    title: "Instalar en Android",
    steps: ["Abre el menú del navegador y elige Instalar aplicación o Añadir a pantalla de inicio.", "Confirma la instalación. Si estás dentro de otra aplicación, abre primero esta dirección en Chrome o Edge."],
  };
  if (/Chrome|Chromium/i.test(ua)) return {
    title: "Instalar desde Google Chrome",
    steps: ["Abre el menú de tres puntos de Chrome y busca Transmitir, guardar y compartir, y luego Instalar página como aplicación.", "También puedes usar el icono de instalación de la barra de direcciones, si aparece. Confirma Instalar."],
  };
  if (/Macintosh/i.test(ua) && /Safari/i.test(ua)) return {
    title: "Añadir al Dock en Safari",
    steps: ["En una versión compatible de Safari para Mac, abre Archivo y elige Añadir al Dock.", "Confirma Añadir. Si no ves esa opción, abre esta dirección en Edge o Chrome."],
  };
  return {
    title: "Instalar desde tu navegador",
    steps: ["Si estás en un navegador integrado, abre esta misma dirección en Edge o Chrome; en iPhone o iPad, usa Safari.", "Busca la opción de instalar en el menú del navegador. Su disponibilidad depende del dispositivo y del navegador."],
  };
}
