import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { CAN_USE_DEV_AUTH } from "./runtime";
import { deviceRequest, getDeviceSession } from "./device-access";
import { friendlyAuthError } from "./auth-errors";

export { friendlyAuthError } from "./auth-errors";

type AuthState = {
  user: User | { id: string; email: string } | null;
  loading: boolean;
  canUseDevMode: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInDev: () => void;
  signInDevice: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthState["user"]>(null);
  const [loading, setLoading] = useState(true);
  const canUseDevMode = CAN_USE_DEV_AUTH;

  useEffect(() => {
    let active = true;
    const persistedMode = localStorage.getItem("impulsa.authMode");
    if (persistedMode === "device") {
      void getDeviceSession().then((session) => {
        if (active && session.user) {
          setUser({ id: session.user.id, email: session.user.name });
          localStorage.setItem("impulsa.businessId", String(session.business_id));
          localStorage.setItem("impulsa.branchId", String(session.branch_id));
        }
      }).finally(() => { if (active) setLoading(false); }).catch(() => {});
      return () => { active = false; };
    }
    if (persistedMode === "dev" && !canUseDevMode) {
      localStorage.removeItem("impulsa.authMode");
      localStorage.removeItem("impulsa.businessId");
      localStorage.removeItem("impulsa.branchId");
      localStorage.removeItem("impulsa.devRole");
    }
    if (persistedMode === "dev" && canUseDevMode) {
      setUser({ id: "dev-owner", email: "owner@impulsa.local" });
      setLoading(false);
      return () => { active = false; };
    }
    if (!supabase) {
      setLoading(false);
      return () => { active = false; };
    }
    void supabase.auth.getSession()
      .then(({ data }) => {
        if (!active || localStorage.getItem("impulsa.authMode") === "device") return;
        setUser(data.session?.user || null);
        if (data.session?.access_token) localStorage.setItem("impulsa.authMode", "supabase");
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active || localStorage.getItem("impulsa.authMode") === "device") return;
      setUser(session?.user || null);
      if (session?.access_token) localStorage.setItem("impulsa.authMode", "supabase");
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [canUseDevMode]);

  async function signIn(email: string, password: string) {
    if (!supabase) throw new Error("Supabase Auth no está configurado en este entorno.");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password }).catch((caught: unknown) => {
      throw new Error(friendlyAuthError(caught));
    });
    if (error) {
      throw new Error(friendlyAuthError(error));
    }
    if (!data.session?.access_token || !data.user) {
      throw new Error("No pudimos completar el acceso. Inténtalo nuevamente.");
    }
    setUser(data.user);
    localStorage.setItem("impulsa.authMode", "supabase");
    localStorage.removeItem("impulsa.businessId");
    localStorage.removeItem("impulsa.branchId");
    localStorage.removeItem("impulsa.devRole");
  }

  function signInDev() {
    if (!canUseDevMode) return;
    localStorage.setItem("impulsa.authMode", "dev");
    setUser({ id: "dev-owner", email: "owner@impulsa.local" });
  }

  async function signInDevice() {
    const session = await getDeviceSession();
    if (!session.user || !session.linked) throw new Error("No se pudo confirmar la sesión por PIN");
    localStorage.setItem("impulsa.authMode", "device");
    localStorage.setItem("impulsa.businessId", String(session.business_id));
    localStorage.setItem("impulsa.branchId", String(session.branch_id));
    localStorage.removeItem("impulsa.devRole");
    setUser({ id: session.user.id, email: session.user.name });
  }

  async function signOut() {
    if (localStorage.getItem("impulsa.authMode") === "device") {
      const session = await getDeviceSession();
      if (session.linked) await deviceRequest("logout", {});
      setUser(null);
      return;
    }
    localStorage.removeItem("impulsa.authMode");
    localStorage.removeItem("impulsa.businessId");
    localStorage.removeItem("impulsa.branchId");
    localStorage.removeItem("impulsa.devRole");
    if (supabase) await supabase.auth.signOut();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, canUseDevMode, signIn, signInDev, signInDevice, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
