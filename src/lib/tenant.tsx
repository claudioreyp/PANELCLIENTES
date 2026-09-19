import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, isUnauthorizedError } from "./api";
import { useAuth } from "./auth";
import { TableZoneSessionProvider } from "./table-zone-session";
import { QuerySessionProvider } from "./query-session";
import type { Branch, RestaurantContext } from "../types";

type TenantState = {
  context: RestaurantContext | null;
  branch: Branch | null;
  loading: boolean;
  error: string | null;
  selectBranch: (branchId: number) => void;
  refresh: () => Promise<void>;
};

const TenantContext = createContext<TenantState | null>(null);
const CONNECTION_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

function isConnectionError(value: unknown) {
  return Boolean(
    value
    && typeof value === "object"
    && "status" in value
    && Number((value as { status?: unknown }).status) === 0,
  );
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const userId = user?.id;
  const requestVersion = useRef(0);
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  const [context, setContext] = useState<RestaurantContext | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionRetryAttempt, setConnectionRetryAttempt] = useState(0);

  const loadContext = useCallback(async () => {
    if (!userId) return;
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const next = await api<RestaurantContext>("/context");
      if (version !== requestVersion.current) return;
      setContext(next);
      localStorage.setItem("impulsa.businessId", String(next.business.id));
      const stored = Number(localStorage.getItem("impulsa.branchId"));
      const selected = next.branches.find((item) => item.id === stored) || next.branches[0] || null;
      setBranch(selected);
      if (selected) localStorage.setItem("impulsa.branchId", String(selected.id));
      setError(null);
      setConnectionRetryAttempt(0);
    } catch (caught) {
      if (version !== requestVersion.current) return;
      if (isUnauthorizedError(caught)) {
        setContext(null);
        setBranch(null);
        setError(null);
        setConnectionRetryAttempt(0);
        await signOutRef.current();
        return;
      }
      setConnectionRetryAttempt((current) => (
        isConnectionError(caught)
          ? Math.min(current + 1, CONNECTION_RETRY_DELAYS_MS.length + 1)
          : 0
      ));
      setError(caught instanceof Error ? caught.message : "No se pudo cargar el restaurante");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [userId]);

  const refresh = useCallback(async () => {
    setConnectionRetryAttempt(0);
    await loadContext();
  }, [loadContext]);

  useEffect(() => {
    const requests = requestVersion;
    if (userId) void refresh();
    else {
      setContext(null);
      setBranch(null);
      setLoading(false);
      setConnectionRetryAttempt(0);
    }
    return () => { requests.current++; };
  }, [userId, refresh]);

  useEffect(() => {
    const checkAccess = () => { void refresh(); };
    window.addEventListener("pos:access-invalidated", checkAccess);
    return () => window.removeEventListener("pos:access-invalidated", checkAccess);
  }, [refresh]);

  useEffect(() => {
    if (!user || !error || connectionRetryAttempt < 1 || connectionRetryAttempt > CONNECTION_RETRY_DELAYS_MS.length) {
      return undefined;
    }
    const timer = window.setTimeout(
      () => void loadContext(),
      CONNECTION_RETRY_DELAYS_MS[connectionRetryAttempt - 1],
    );
    return () => window.clearTimeout(timer);
  }, [connectionRetryAttempt, error, loadContext, user]);

  function selectBranch(branchId: number) {
    const selected = context?.branches.find((item) => item.id === branchId) || null;
    setBranch(selected);
    if (selected) localStorage.setItem("impulsa.branchId", String(selected.id));
  }

  return (
    <TenantContext.Provider value={{ context, branch, loading, error, selectBranch, refresh }}>
      {user ? <TableZoneSessionProvider key={user.id}><QuerySessionProvider key={JSON.stringify([user.id, context?.business.id, branch?.id, context?.role, context?.roles])}>{children}</QuerySessionProvider></TableZoneSessionProvider> : children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const value = useContext(TenantContext);
  if (!value) throw new Error("useTenant must be used inside TenantProvider");
  return value;
}
