const DEFAULT_API_BASE = "http://localhost:8000/api/v1";

export const API_BASE = (import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE).replace(/\/$/, "");
export const API_ORIGIN = API_BASE.replace(/\/api\/v1$/, "");

export function isLoopbackApiUrl(value: string): boolean {
  try {
    const hostname = new URL(value, DEFAULT_API_BASE).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function canUseDevAuthentication(input: {
  isDevelopment: boolean;
  token?: string;
  apiBase: string;
}): boolean {
  return Boolean(input.isDevelopment && input.token && isLoopbackApiUrl(input.apiBase));
}

// Development credentials must never travel to Render or another remote API.
export const CAN_USE_DEV_AUTH = canUseDevAuthentication({
  isDevelopment: import.meta.env.DEV,
  token: import.meta.env.VITE_DEV_AUTH_TOKEN,
  apiBase: API_BASE,
});
