import { supabase } from "./supabase";
import { API_BASE, API_ORIGIN, CAN_USE_DEV_AUTH } from "./runtime";
import { deviceCsrf } from "./device-access";
import { requestOrderPrinting } from "./print-events";
import { friendlyAuthError, isAuthServiceUnavailable } from "./auth-errors";

export { API_BASE, API_ORIGIN } from "./runtime";

export class ApiError extends Error {
  status: number;
  details: unknown;
  code?: string;

  constructor(message: string, status: number, details?: unknown, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

type ApiErrorDescriptor = { message: string; code?: string };

function errorDescriptor(body: unknown, status: number): ApiErrorDescriptor {
  let code: string | undefined;
  let message = `Error HTTP ${status}`;
  if (typeof body === "string" && body.trim()) {
    message = body;
  } else if (body && typeof body === "object") {
    const payload = body as Record<string, unknown>;
    if (typeof payload.code === "string") code = payload.code;
    const detail = payload.detail;
    if (typeof detail === "string") {
      message = detail;
    } else if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      const detailPayload = detail as Record<string, unknown>;
      if (typeof detailPayload.code === "string") code = detailPayload.code;
      if (typeof detailPayload.message === "string") message = detailPayload.message;
    } else if (typeof payload.message === "string") {
      message = payload.message;
    }
  }
  return { message, code };
}

function humanizeApiError(body: unknown, status: number): ApiErrorDescriptor {
  const descriptor = errorDescriptor(body, status);
  const normalizedCode = descriptor.code?.trim().toUpperCase();
  if (status === 401) return { message: "Tu sesión expiró. Vuelve a ingresar", code: normalizedCode };
  if (normalizedCode === "CATEGORY_LAST_VISIBLE_PRODUCTS") {
    return {
      code: normalizedCode,
      message: "No puedes borrar esta categoría porque contiene los últimos productos visibles del restaurante.",
    };
  }
  if (normalizedCode === "CATALOG_RESOURCE_NOT_FOUND") {
    return {
      code: normalizedCode,
      message: "Ese elemento del menú ya no está disponible. Actualiza el menú e inténtalo otra vez.",
    };
  }
  if (normalizedCode === "API_CONTRACT_UNSUPPORTED") {
    return {
      code: normalizedCode,
      message: "La API del POS todavía no incluye esta operación. Actualiza el servicio de la API antes de intentarlo otra vez.",
    };
  }
  if (status !== 404) return { message: descriptor.message, code: normalizedCode };
  const message = descriptor.message;
  const normalized = message.trim().toLocaleLowerCase("es-PE");
  if (normalized === "not found") {
    return {
      code: "API_CONTRACT_UNSUPPORTED",
      message: "La API del POS todavía no incluye esta operación. Actualiza el servicio de la API antes de intentarlo otra vez.",
    };
  }
  if (normalized.includes("product image")) return { message: "La imagen de este producto ya no está disponible.", code: normalizedCode };
  if (normalized.includes("product")) return { message: "No encontramos ese producto. Actualiza el menú e inténtalo otra vez.", code: normalizedCode };
  if (normalized.includes("category") || normalized.includes("categoría")) return { message: "No encontramos esa categoría. Actualiza el menú e inténtalo otra vez.", code: normalizedCode };
  if (normalized.includes("modifier") || normalized.includes("personalización")) return { message: "No encontramos esa personalización. Actualiza el menú e inténtalo otra vez.", code: normalizedCode };
  if (normalized.includes("variant") || normalized.includes("variante")) return { message: "No encontramos esa variante. Actualiza el menú e inténtalo otra vez.", code: normalizedCode };
  return { message, code: normalizedCode };
}

function selectedScope() {
  const mode = localStorage.getItem("impulsa.authMode");
  const isDevMode = mode === "dev" && CAN_USE_DEV_AUTH;
  return {
    businessId: localStorage.getItem("impulsa.businessId") || (isDevMode ? import.meta.env.VITE_DEV_BUSINESS_ID : undefined),
    branchId: localStorage.getItem("impulsa.branchId") || (isDevMode ? import.meta.env.VITE_DEV_BRANCH_ID : undefined),
  };
}

export async function authHeaders(): Promise<Record<string, string>> {
  const scope = selectedScope();
  const headers: Record<string, string> = {};
  const mode = localStorage.getItem("impulsa.authMode");
  if (mode === "device") {
    headers["X-CSRF-Token"] = deviceCsrf();
  } else if (mode === "dev" && CAN_USE_DEV_AUTH && import.meta.env.VITE_DEV_AUTH_TOKEN) {
    headers["X-Dev-Auth"] = import.meta.env.VITE_DEV_AUTH_TOKEN;
    headers["X-Dev-User"] = "dev-owner";
    headers["X-Dev-Role"] = localStorage.getItem("impulsa.devRole") || "owner";
  } else if (supabase) {
    try {
      const current = await supabase.auth.getSession();
      if (isAuthServiceUnavailable(current.error)) throw current.error;
      let { data } = current;
      if (!data.session?.access_token) {
        const refreshed = await supabase.auth.refreshSession();
        if (isAuthServiceUnavailable(refreshed.error)) throw refreshed.error;
        data = refreshed.data;
      }
      if (!data.session?.access_token) {
        throw new ApiError("Tu sesión expiró. Vuelve a ingresar", 401);
      }
      headers.Authorization = `Bearer ${data.session.access_token}`;
    } catch (caught) {
      // A provider outage is not an expired session and must not trigger logout.
      if (isAuthServiceUnavailable(caught)) {
        throw new ApiError(friendlyAuthError(caught), 503, undefined, "AUTH_UNAVAILABLE");
      }
      throw caught;
    }
  } else {
    throw new ApiError("Tu sesión expiró. Vuelve a ingresar", 401);
  }
  if (scope.businessId) headers["X-Business-Id"] = scope.businessId;
  if (scope.branchId) headers["X-Branch-Id"] = scope.branchId;
  return headers;
}

export function isUnauthorizedError(value: unknown): value is { status: number } {
  return Boolean(
    value
    && typeof value === "object"
    && "status" in value
    && Number((value as { status?: unknown }).status) === 401,
  );
}

const READ_RETRY_DELAYS_MS = [250, 750, 1500, 3000] as const;

function transportRequestPath(input: RequestInfo | URL): string {
  const raw = input instanceof Request ? input.url : String(input);
  try {
    const url = new URL(raw, API_BASE);
    return url.pathname;
  } catch {
    return "(ruta no disponible)";
  }
}

function transportError(
  caught: unknown,
  input: RequestInfo | URL,
  method: string,
  attempts: number,
): ApiError {
  const aborted = caught instanceof DOMException && caught.name === "AbortError";
  const message = aborted
    ? "El servidor tardó demasiado en responder. Inténtalo nuevamente."
    : "No pudimos conectar con el servidor del POS. Espera unos segundos e inténtalo nuevamente.";
  return new ApiError(message, 0, {
    kind: "transport",
    method,
    path: transportRequestPath(input),
    attempts,
  }, aborted ? "REQUEST_ABORTED" : "NETWORK_UNREACHABLE");
}

export function isTransportError(value: unknown): value is ApiError {
  return value instanceof ApiError
    && value.status === 0
    && (value.code === "NETWORK_UNREACHABLE" || value.code === "REQUEST_ABORTED");
}

async function request(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  const retryDelays = method === "GET" || method === "HEAD" ? READ_RETRY_DELAYS_MS : [];

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetch(input, { ...init, ...(localStorage.getItem("impulsa.authMode") === "device" ? { credentials: "include" as const } : {}) });
    } catch (caught) {
      const aborted = caught instanceof DOMException && caught.name === "AbortError";
      if (aborted || attempt >= retryDelays.length) {
        throw transportError(caught, input, method, attempt + 1);
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
    }
  }
}

export async function api<T>(path: string, options: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const authentication = await authHeaders();
  Object.entries(authentication).forEach(([key, value]) => headers.set(key, value));
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  const method = (options.method || "GET").toUpperCase();
  const cache = options.cache ?? (method === "GET" || method === "HEAD" ? "no-store" : undefined);
  const response = await request(`${API_BASE}${path}`, { ...options, cache, headers });
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    const error = humanizeApiError(body, response.status);
    if (path !== "/context" && (response.status === 401 || (method === "GET" && response.status === 403))) window.dispatchEvent(new Event("pos:access-invalidated"));
    throw new ApiError(error.message, response.status, body, error.code);
  }
  const automaticPrintMutation = /^\/orders\/\d+\/(?:confirm-and-send|table-checkout\/start)$/.test(path)
    || /^\/orders\/\d+\/item-batches$/.test(path) && Array.isArray(body?.tickets) && body.tickets.length > 0
    || /^\/orders\/\d+\/item-revisions$/.test(path) && Array.isArray(body?.created_ticket_ids) && body.created_ticket_ids.length > 0;
  if (method === "POST" && automaticPrintMutation && body?.order?.id && body?.order?.branch_id) {
    requestOrderPrinting({ orderId: body.order.id, branchId: body.order.branch_id, version: body.order.version });
  }
  if (!["GET", "HEAD"].includes(method) && /^\/(orders|tables|areas|kitchen|products|categories|catalog|modifier-groups)(\/|\?|$)/.test(path) && !path.includes("/printing")) {
    window.dispatchEvent(new Event("pos:queries-changed"));
  }
  return body as T;
}

export async function apiBlob(path: string): Promise<Blob> {
  const headers = new Headers(await authHeaders());
  const response = await request(`${API_BASE}${path}`, { headers });
  if (!response.ok) {
    const body = await response.text();
    const error = humanizeApiError(body || `Error HTTP ${response.status}`, response.status);
    throw new ApiError(error.message, response.status, body, error.code);
  }
  return response.blob();
}

export async function publicApi<T>(path: string, options: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (
    options.body
    && (typeof FormData === "undefined" || !(options.body instanceof FormData))
    && !headers.has("Content-Type")
  ) headers.set("Content-Type", "application/json");
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  const response = await request(`${API_BASE}${path}`, { ...options, headers });
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    const error = humanizeApiError(body, response.status);
    throw new ApiError(error.message, response.status, body, error.code);
  }
  return body as T;
}

export function publicAssetUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  return `${API_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function privateImage(path: string): Promise<Blob> {
  const response = await request(`${API_ORIGIN}${path}`, { headers: await authHeaders(), cache: "no-store" });
  if (!response.ok) throw new ApiError("No se pudo cargar la imagen. Reintenta.", response.status);
  return response.blob();
}
