import { api, ApiError } from "./api";
import type { QzConnectionState } from "../types/settings";
import { measureThermalDocument } from "./thermal-measure";

type Resolver<T> = (resolve: (value: T) => void, reject: (error: Error) => void) => void;
export type QzRuntime = {
  api?: { setSha256Type: (hasher: (request: string) => Promise<string>) => void };
  websocket: {
    isActive: () => boolean;
    connect: (options?: { retries: number; keepAlive: number }) => Promise<void>;
    disconnect: () => Promise<void>;
  };
  printers: { find: () => Promise<string[] | string>; details?: () => Promise<unknown> };
  configs: { create: (name: string, options: Record<string, unknown>) => unknown };
  print: (config: unknown, data: Record<string, unknown>[]) => Promise<void>;
  security: {
    setCertificatePromise: (factory: Resolver<string | null>, options: { rejectOnFailure: boolean }) => void;
    setSignaturePromise: (factory: (payload: string) => Resolver<string>) => void;
    setSignatureAlgorithm: (algorithm: string) => void;
  };
};

type ConnectionSettings = { mode: "signed" | "manual-approval"; certificate: string | null };
export type QzPrinterDetail = { name: string; driver: string | null };
export type QzPrinters = { printers: string[]; details: QzPrinterDetail[]; mode: ConnectionSettings["mode"] };
export const ESCPOS_FEED_CUT = "0A1D564100";

export function printerCompatibilityError(printer: QzPrinterDetail | undefined, language: "pixel" | "escpos" = "pixel") {
  if (language === "pixel" && printer?.driver && /generic\s*\/\s*text only|gen[eé]rico\s*\/\s*s[oó]lo texto/i.test(printer.driver)) {
    return `${printer.name} usa ${printer.driver}, un controlador solo de texto. No se enviará impresión gráfica porque puede salir en blanco. Guarda Térmica ESC/POS en Configuración > Impresión de esta sucursal y solicita una nueva impresión.`;
  }
  return null;
}
export class QzError extends Error {
  constructor(public state: QzConnectionState, message: string) { super(message); }
}

let runtime: QzRuntime | null = null;
let loading: Promise<QzRuntime> | null = null;
let queue: Promise<unknown> = Promise.resolve();
let connectedCertificate: string | null | undefined;
type SigningOperation = { active: boolean; requests: Map<string, string> };

async function loadRuntime() {
  if (runtime) return runtime;
  // Keep compatibility with hosts which already provide the official connector.
  const provided = (window as Window & { qz?: QzRuntime }).qz;
  if (provided) return (runtime = provided);
  loading ??= import("qz-tray").then((module) => (runtime = module.default)).catch(() => {
    loading = null;
    throw new QzError("error", "No se pudo cargar el conector de impresión. Revisa la conexión y reintenta.");
  });
  return loading;
}

export async function qzFailure(error: unknown): Promise<QzError> {
  if (error instanceof QzError) return error;
  if (error instanceof ApiError) {
    return new QzError("error", error.status === 403
      ? "No tienes permiso para configurar impresoras en esta sucursal."
      : "No se pudo verificar la configuración de QZ en la API. Reintenta o revisa el certificado y la firma del servidor.");
  }
  const message = error instanceof Error ? error.message : String(error);
  let denied = /denied|blocked|permission|not allowed|rechaz|deneg/i.test(message);
  try {
    const permission = await navigator.permissions?.query({ name: "local-network-access" as PermissionName });
    denied ||= permission?.state === "denied";
  } catch { /* Older browsers do not expose the local-network permission. */ }
  if (denied) return new QzError("denied", "El acceso fue bloqueado. Permite el acceso a apps de este dispositivo en los permisos del sitio y revisa QZ Tray > Site Manager. Después pulsa Reintentar.");
  if (/websocket|unable to establish|connection.*closed|not connected/i.test(message)) {
    return new QzError("not-open", "Abre QZ Tray en este equipo. Si ya está abierto, revisa el permiso del navegador y el certificado local de QZ Tray.");
  }
  return new QzError("error", "No se pudieron consultar las impresoras. Revisa la autorización de QZ Tray y vuelve a intentarlo.");
}

async function closeConnection() {
  if (runtime?.websocket.isActive()) await runtime.websocket.disconnect().catch(() => undefined);
  connectedCertificate = undefined;
}

function interrupted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let cleanup = () => {};
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Conexión cancelada", "AbortError"));
    const timer = window.setTimeout(() => reject(new QzError("error", "La autorización tardó demasiado. Revisa la ventana de QZ Tray y pulsa Reintentar.")), 60_000);
    cleanup = () => { window.clearTimeout(timer); signal.removeEventListener("abort", abort); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    work.then(resolve, reject);
  }).finally(() => cleanup());
}

function enqueue<T>(work: (operation: SigningOperation) => Promise<T>): Promise<T> {
  const task = queue.then(async () => {
    const operation: SigningOperation = { active: true, requests: new Map() };
    try { return await work(operation); }
    finally { operation.active = false; operation.requests.clear(); }
  });
  queue = task.catch(() => undefined);
  return task;
}

async function connect(branchId: number, signal: AbortSignal, onState: (state: QzConnectionState) => void, operation: SigningOperation, orderId?: number) {
      signal.throwIfAborted();
      onState("loading");
      const config = await api<ConnectionSettings>(orderId ? `/orders/${orderId}/printing/qz` : `/settings/branches/${branchId}/printing/qz`, { signal });
      signal.throwIfAborted();
      if (!config || !["signed", "manual-approval"].includes(config.mode) || (config.mode === "signed" && (typeof config.certificate !== "string" || !config.certificate.trim())) || (config.mode === "manual-approval" && config.certificate !== null)) {
        throw new QzError("error", "La API no es compatible con la conexión de impresoras. Actualiza el servicio y reintenta.");
      }
      const qz = await loadRuntime();
      signal.throwIfAborted();
      // The certificate is sent only during the handshake. Reusing an anonymous
      // socket after enabling signing would keep QZ asking for approval.
      if (qz.websocket.isActive() && connectedCertificate !== config.certificate) {
        await closeConnection();
        if (qz.websocket.isActive()) throw new QzError("error", "No se pudo renovar la identidad de QZ Tray. Cierra y abre QZ Tray antes de reintentar.");
      }
      signal.throwIfAborted();
      const assertCurrent = () => {
        signal.throwIfAborted();
        if (!operation.active) throw new QzError("error", "La solicitud de firma de QZ Tray ya no esta activa.");
      };
      if (config.mode === "signed" && (!qz.api?.setSha256Type || !crypto.subtle)) {
        throw new QzError("error", "El conector no permite verificar solicitudes firmadas. Actualiza QZ Tray y usa una conexion segura.");
      }
      if (qz.api?.setSha256Type && crypto.subtle) {
        // QZ 2.2.6 signs the digest, not JSON. Keep the exact preimage only for
        // this queued operation so the API can authorize the signed command.
        qz.api.setSha256Type(async (request) => {
          assertCurrent();
          if (typeof request !== "string" || !request || (config.mode === "signed" && request.length > 200_000)) {
            throw new QzError("error", "La solicitud de QZ Tray no es valida para firmar.");
          }
          const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(request));
          assertCurrent();
          const hash = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
          if (config.mode === "signed") {
            if (operation.requests.size >= 16) throw new QzError("error", "Hay demasiadas solicitudes de firma pendientes.");
            operation.requests.set(hash, request);
          }
          return hash;
        });
      }
      qz.security.setSignatureAlgorithm("SHA512");
      qz.security.setCertificatePromise((resolve) => resolve(config.certificate), { rejectOnFailure: true });
      qz.security.setSignaturePromise((payload) => (resolve, reject) => {
        try { assertCurrent(); } catch (error) { reject(error as Error); return; }
        if (config.mode === "manual-approval") { resolve(""); return; }
        const request = operation.requests.get(payload);
        operation.requests.delete(payload);
        if (!request) { reject(new QzError("error", "No se pudo verificar el contenido de la solicitud de QZ Tray.")); return; }
        void api<{ signature: string }>(`/settings/printing/qz/sign?branch_id=${branchId}`, {
          method: "POST", body: JSON.stringify({ payload, request }), signal,
          idempotencyKey: `qz-sign-${crypto.randomUUID()}`,
        }).then((response) => {
          if (typeof response?.signature !== "string" || !response.signature || response.signature.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(response.signature)) {
            throw new QzError("error", "La API no devolvió una firma válida. No se enviará una solicitud anónima a QZ Tray.");
          }
          assertCurrent();
          resolve(response.signature);
        }).catch(reject);
      });
      try {
        onState("permission");
        if (!qz.websocket.isActive()) await interrupted(qz.websocket.connect({ retries: 0, keepAlive: 30 }), signal);
        signal.throwIfAborted();
        connectedCertificate = config.certificate;
        onState("connecting");
        return { qz, mode: config.mode };
      } catch (error) {
        await closeConnection();
        throw error;
      }
}

async function findPrinters(qz: QzRuntime, signal: AbortSignal) {
  if (qz.printers.details) {
    const found = await interrupted(qz.printers.details(), signal);
    signal.throwIfAborted();
    const details: QzPrinterDetail[] = [];
    for (const item of Array.isArray(found) ? found : [found]) {
      if (!item || typeof item !== "object" || !("name" in item) || typeof item.name !== "string" || !item.name.trim()) continue;
      if (details.some((printer) => printer.name === item.name)) continue;
      details.push({ name: item.name, driver: "driver" in item && typeof item.driver === "string" ? item.driver : null });
    }
    return { printers: details.map((printer) => printer.name), details };
  }
  // Legacy hosts expose names only; never infer a driver from the printer name.
  const found = await interrupted(qz.printers.find(), signal);
  signal.throwIfAborted();
  const printers = [...new Set((Array.isArray(found) ? found : [found]).filter((name) => typeof name === "string" && name.trim()))];
  return { printers, details: printers.map((name) => ({ name, driver: null })) };
}

export const qzBridge = {
  isActive: () => Boolean(runtime?.websocket.isActive()),
  printers(branchId: number, signal: AbortSignal, onState: (state: QzConnectionState) => void): Promise<QzPrinters> {
    // QZ has one socket and global signing callbacks, shared by all views.
    return enqueue(async (operation) => {
      const { qz, mode } = await connect(branchId, signal, onState, operation);
      try { return { ...await findPrinters(qz, signal), mode }; }
      catch (error) { await closeConnection(); throw error; }
    });
  },
  dispatch(options: {
    branchId: number; orderId?: number; printerName: string; paperWidth: 58 | 80;
    copies: number; html: string; jobName: string; signal: AbortSignal;
    printLanguage?: "pixel" | "escpos";
    beforeSend: () => Promise<void>; onSending: () => void;
  }) {
    return enqueue(async (operation) => {
      const { signal } = options;
      const { qz } = await connect(options.branchId, signal, () => {}, operation, options.orderId);
      const { printers, details } = await findPrinters(qz, signal);
      if (!printers.includes(options.printerName)) throw new QzError("error", `La impresora ${options.printerName} no está disponible. No se enviará el trabajo a otra impresora.`);
      const incompatible = printerCompatibilityError(details.find((printer) => printer.name === options.printerName), options.printLanguage);
      if (incompatible) throw new QzError("error", incompatible);
      const raw = options.printLanguage === "escpos";
      // QZ raw HTML expects raster dots, while pixel HTML follows config units.
      // Fit the complete layout inside conservative 48/72 mm thermal print heads.
      const rasterWidth = options.paperWidth === 58 ? 384 : 576;
      const measurement = raw ? await measureThermalDocument(options.html, options.paperWidth, signal) : null;
      const config = qz.configs.create(options.printerName, {
        copies: options.copies, units: "mm", size: { width: options.paperWidth, height: null },
        margins: 0, scaleContent: false, colorType: "blackwhite", jobName: options.jobName,
        ...(raw ? { density: rasterWidth / options.paperWidth, encoding: "UTF-8" } : {}),
      });
      signal.throwIfAborted();
      await options.beforeSend();
      signal.throwIfAborted();
      options.onSending();
      // Rejection after invoking print is uncertain: the spooler may already
      // have accepted the document. The dispatcher must not replay it blindly.
      const data = raw ? [
        { type: "raw", format: "command", flavor: "hex", data: "1B40" },
        { type: "raw", format: "html", flavor: "plain", data: options.html, options: { language: "ESCPOS", pageWidth: rasterWidth, pageHeight: measurement!.pageHeightDots, dotDensity: "double" } },
        { type: "raw", format: "command", flavor: "hex", data: ESCPOS_FEED_CUT },
      ] : [{ type: "pixel", format: "html", flavor: "plain", data: options.html, options: { pageWidth: options.paperWidth } }];
      await interrupted(qz.print(config, data), signal);
    });
  },
  disconnect() {
    return enqueue(closeConnection);
  },
};
