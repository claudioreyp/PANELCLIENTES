import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { subscribeBranch, defaultRealtimeScope } from "./branch-realtime";
import { useQuerySession } from "./query-session";

export function usePolling<T>(loader: () => Promise<T>, dependencies: unknown[], intervalMs = 15000) {
  const [data, setDataState] = useState<T | null>(null);
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
        setDataState(next);
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

  const setData = useCallback((next: SetStateAction<T | null>) => {
    // A local mutation is newer than any fetch already in flight. Invalidating
    // those requests prevents an old response from hiding a just-saved record.
    request.current += 1;
    setDataState(next);
    setError(null);
  }, []);

  return { data, loading, error, refresh, setData };
}

export function useBranchRealtime(branchId: number | undefined, onEvent: () => void) {
  const callback = useRef(onEvent);
  callback.current = onEvent;
  const cache = useQuerySession();
  useEffect(() => {
    if (!branchId) return;
    return subscribeBranch(cache || defaultRealtimeScope, branchId, () => callback.current());
  }, [branchId, cache]);
}
