import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
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

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [context, setContext] = useState<RestaurantContext | null>(null);
  const [branch, setBranch] = useState<Branch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const next = await api<RestaurantContext>("/context");
      setContext(next);
      localStorage.setItem("impulsa.businessId", String(next.business.id));
      const stored = Number(localStorage.getItem("impulsa.branchId"));
      const selected = next.branches.find((item) => item.id === stored) || next.branches[0] || null;
      setBranch(selected);
      if (selected) localStorage.setItem("impulsa.branchId", String(selected.id));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo cargar el restaurante");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) void refresh();
    else {
      setContext(null);
      setBranch(null);
      setLoading(false);
    }
  }, [user, refresh]);

  function selectBranch(branchId: number) {
    const selected = context?.branches.find((item) => item.id === branchId) || null;
    setBranch(selected);
    if (selected) localStorage.setItem("impulsa.branchId", String(selected.id));
  }

  return (
    <TenantContext.Provider value={{ context, branch, loading, error, selectBranch, refresh }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  const value = useContext(TenantContext);
  if (!value) throw new Error("useTenant must be used inside TenantProvider");
  return value;
}
