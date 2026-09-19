import { supabase } from "./supabase";
import { API_ORIGIN, CAN_USE_DEV_AUTH } from "./runtime";
import { QueryCache } from "./query-cache";

type Connection = { listeners: Set<() => void>; stop: () => void; closeTimer?: ReturnType<typeof setTimeout> };
const scopes = new WeakMap<object, Map<number, Connection>>();
export const defaultRealtimeScope = {};

export function subscribeBranch(scope: object, branchId: number, callback: () => void) {
  let connections = scopes.get(scope);
  if (!connections) { connections = new Map(); scopes.set(scope, connections); }
  let connection = connections.get(branchId);
  if (!connection) {
    let websocket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let generation = 0;
    const listeners = new Set<() => void>();
    async function connect() {
      const current = ++generation;
      try {
        const params = new URLSearchParams();
        if (localStorage.getItem("impulsa.authMode") === "dev" && CAN_USE_DEV_AUTH) {
          params.set("dev_auth", import.meta.env.VITE_DEV_AUTH_TOKEN || "");
          params.set("user_id", "dev-owner");
          params.set("role", localStorage.getItem("impulsa.devRole") || "owner");
        } else if (localStorage.getItem("impulsa.authMode") !== "device") {
          const session = await supabase?.auth.getSession();
          if (session?.data.session?.access_token) params.set("access_token", session.data.session.access_token);
        }
        if (stopped || current !== generation) return;
        websocket = new WebSocket(`${API_ORIGIN.replace(/^http/, "ws")}/api/v1/ws/branches/${branchId}?${params}`);
        websocket.onmessage = (message) => {
          if (stopped || current !== generation) return;
          let event: string | undefined;
          try { event = JSON.parse(message.data).event; } catch { /* Revalidate malformed notifications safely. */ }
          if (event !== "connected") {
            if (scope instanceof QueryCache) scope.invalidate();
            listeners.forEach((listener) => listener());
          }
        };
        websocket.onclose = (event) => {
          if (stopped || current !== generation) return;
          if (event.code === 1008) window.dispatchEvent(new Event("pos:access-invalidated"));
          retry = setTimeout(() => void connect(), 4000);
        };
      } catch { if (!stopped && current === generation) retry = setTimeout(() => void connect(), 4000); }
    }
    const subscription = supabase?.auth.onAuthStateChange((event) => {
      if (event !== "TOKEN_REFRESHED") return;
      generation++;
      clearTimeout(retry);
      websocket?.close();
      void connect();
    });
    connection = { listeners, stop: () => {
      stopped = true; generation++; clearTimeout(retry);
      subscription?.data.subscription.unsubscribe(); websocket?.close();
    } };
    connections.set(branchId, connection);
    void connect();
  }
  const entry = connection;
  const registry = connections;
  clearTimeout(entry.closeTimer);
  entry.listeners.add(callback);
  return () => {
    entry.listeners.delete(callback);
    if (!entry.listeners.size) entry.closeTimer = setTimeout(() => {
      if (!entry.listeners.size) { entry.stop(); registry.delete(branchId); }
    }, 0);
  };
}
