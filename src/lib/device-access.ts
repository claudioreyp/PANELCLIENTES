import { API_BASE } from "./runtime";

export type DeviceSession = { linked: boolean; branch_id?: number; business_id?: number; branch_name?: string; csrf_token?: string; user: { id: string; name: string; roles: string[] } | null };
let csrf = "";
export class DeviceAccessError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export function deviceCsrf() { return csrf; }

export async function deviceRequest<T>(path: string, body?: unknown, key?: string): Promise<T> {
  const response = await fetch(`${API_BASE}/auth/devices/${path}`, {
    credentials: "include", cache: "no-store", method: body === undefined ? "GET" : "POST",
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(csrf ? { "X-CSRF-Token": csrf } : {}), ...(key ? { "Idempotency-Key": key } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new DeviceAccessError(typeof result?.detail === "string" ? result.detail : "No se pudo completar el acceso. Reintenta o actualiza la API.", response.status);
  return result as T;
}

export async function getDeviceSession() {
  const result = await deviceRequest<DeviceSession>("session");
  csrf = result.csrf_token || "";
  return result;
}
