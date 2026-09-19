import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type SetStateAction } from "react";
import { QueryCache } from "./query-cache";

const QueryContext = createContext<QueryCache | null>(null);
export const QUERY_CHANGED = "pos:queries-changed";
export const useQuerySession = () => useContext(QueryContext);

export function QuerySessionProvider({ children }: { children: ReactNode }) {
  const [cache] = useState(() => new QueryCache());
  useEffect(() => {
    const invalidate = () => cache.invalidate();
    window.addEventListener(QUERY_CHANGED, invalidate);
    return () => { window.removeEventListener(QUERY_CHANGED, invalidate); };
  }, [cache]);
  // Deferred disposal tolerates React StrictMode's effect replay, not scope changes.
  useEffect(() => {
    const lifecycle = { active: true };
    cacheLifetimes.set(cache, lifecycle);
    return () => {
      lifecycle.active = false;
      setTimeout(() => { if (cacheLifetimes.get(cache) === lifecycle) cache.dispose(); }, 0);
    };
  }, [cache]);
  return <QueryContext.Provider value={cache}>{children}</QueryContext.Provider>;
}
const cacheLifetimes = new WeakMap<QueryCache, { active: boolean }>();

export function useQuery<T>(keyParts: unknown[], loader: () => Promise<T>, intervalMs = 15000, enabled = true) {
  const shared = useContext(QueryContext);
  const [local] = useState(() => new QueryCache());
  const cache = shared || local;
  const key = JSON.stringify(keyParts);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const refresh = useCallback(() => cache.fetch(key, () => loaderRef.current()), [cache, key]);
  const subscribe = useCallback((notify: () => void) => cache.subscribe(key, notify, () => { if (enabled) void refresh(); }), [cache, key, refresh, enabled]);
  const getSnapshot = useCallback(() => cache.entry<T>(key).snapshot, [cache, key]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    if (!enabled) return;
    void cache.fetch(key, () => loaderRef.current(), 1000);
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [cache, key, refresh, intervalMs, enabled]);
  const setData = useCallback((next: SetStateAction<T | null>) => cache.set<T>(key, next), [cache, key]);
  return { ...snapshot, refresh, setData };
}
