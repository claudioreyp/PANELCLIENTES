import { supabase } from "./supabase";

export const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function selectedScope() {
  return {
    businessId: localStorage.getItem("impulsa.businessId") || import.meta.env.VITE_DEV_BUSINESS_ID,
    branchId: localStorage.getItem("impulsa.branchId") || import.meta.env.VITE_DEV_BRANCH_ID,
  };
}

export async function authHeaders(): Promise<Record<string, string>> {
  const scope = selectedScope();
  const headers: Record<string, string> = {};
  const mode = localStorage.getItem("impulsa.authMode");
  if (mode === "dev" && import.meta.env.VITE_DEV_AUTH_TOKEN) {
    headers["X-Dev-Auth"] = import.meta.env.VITE_DEV_AUTH_TOKEN;
    headers["X-Dev-User"] = "dev-owner";
    headers["X-Dev-Role"] = localStorage.getItem("impulsa.devRole") || "owner";
  } else if (supabase) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  if (scope.businessId) headers["X-Business-Id"] = scope.businessId;
  if (scope.branchId) headers["X-Branch-Id"] = scope.branchId;
  return headers;
}

export async function api<T>(path: string, options: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const authentication = await authHeaders();
  Object.entries(authentication).forEach(([key, value]) => headers.set(key, value));
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof body === "object" && body && "detail" in body ? String(body.detail) : `Error HTTP ${response.status}`;
    throw new ApiError(message, response.status, body);
  }
  return body as T;
}

export async function apiBlob(path: string): Promise<Blob> {
  const headers = new Headers(await authHeaders());
  const response = await fetch(`${API_BASE}${path}`, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(body || `Error HTTP ${response.status}`, response.status, body);
  }
  return response.blob();
}

export function publicApi<T>(path: string, options: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  return fetch(`${API_BASE}${path}`, { ...options, headers }).then(async (response) => {
    const body = await response.json();
    if (!response.ok) throw new ApiError(body.detail || `Error HTTP ${response.status}`, response.status, body);
    return body as T;
  });
}
