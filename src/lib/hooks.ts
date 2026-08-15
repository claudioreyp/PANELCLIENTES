import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";

export function usePolling<T>(loader: () => Promise<T>, dependencies: unknown[], intervalMs = 15000) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const dependencyKey = JSON.stringify(dependencies);

  const refresh = useCallback(async () => {
    const current = ++request.current;
    try {
      const next = await loaderRef.current();
      if (current === request.current) {
        setData(next);
        setError(null);
      }
    } catch (caught) {
      if (current === request.current) setError(caught instanceof Error ? caught.message : "No se pudo cargar la información");
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => {
      window.clearInterval(timer);
      request.current += 1;
    };
  }, [dependencyKey, intervalMs, refresh]);

  return { data, loading, error, refresh, setData };
}

export function useBranchRealtime(branchId: number | undefined, onEvent: () => void) {
  const callback = useRef(onEvent);
  callback.current = onEvent;
  useEffect(() => {
    if (!branchId) return;
    let websocket: WebSocket | null = null;
    let retry: number | undefined;
    let stopped = false;

    async function connect() {
      const apiBase = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1").replace(/\/api\/v1\/?$/, "");
      const wsBase = apiBase.replace(/^http/, "ws");
      const params = new URLSearchParams();
      if (localStorage.getItem("impulsa.authMode") === "dev" && import.meta.env.VITE_DEV_AUTH_TOKEN) {
        params.set("dev_auth", import.meta.env.VITE_DEV_AUTH_TOKEN);
        params.set("user_id", "dev-owner");
      } else {
        const session = await supabase?.auth.getSession();
        if (session?.data.session?.access_token) params.set("access_token", session.data.session.access_token);
      }
      if (stopped) return;
      websocket = new WebSocket(`${wsBase}/api/v1/ws/branches/${branchId}?${params}`);
      websocket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as { event?: string };
          if (event.event !== "connected") callback.current();
        } catch {
          callback.current();
        }
      };
      websocket.onclose = () => {
        if (!stopped) retry = window.setTimeout(connect, 4000);
      };
    }
    void connect();
    return () => {
      stopped = true;
      if (retry) window.clearTimeout(retry);
      websocket?.close();
    };
  }, [branchId]);
}
