import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type AuthState = {
  user: User | { id: string; email: string } | null;
  loading: boolean;
  canUseDevMode: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInDev: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthState["user"]>(null);
  const [loading, setLoading] = useState(true);
  const canUseDevMode = Boolean(import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_TOKEN);

  useEffect(() => {
    let active = true;
    if (localStorage.getItem("impulsa.authMode") === "dev" && canUseDevMode) {
      setUser({ id: "dev-owner", email: "owner@impulsa.local" });
      setLoading(false);
      return () => { active = false; };
    }
    if (!supabase) {
      setLoading(false);
      return () => { active = false; };
    }
    supabase.auth.getUser().then(({ data }) => {
      if (active) {
        setUser(data.user);
        setLoading(false);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setUser(session?.user || null);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [canUseDevMode]);

  async function signIn(email: string, password: string) {
    if (!supabase) throw new Error("Supabase Auth no está configurado en este entorno.");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    localStorage.setItem("impulsa.authMode", "supabase");
  }

  function signInDev() {
    if (!canUseDevMode) return;
    localStorage.setItem("impulsa.authMode", "dev");
    setUser({ id: "dev-owner", email: "owner@impulsa.local" });
  }

  async function signOut() {
    localStorage.removeItem("impulsa.authMode");
    localStorage.removeItem("impulsa.businessId");
    localStorage.removeItem("impulsa.branchId");
    if (supabase) await supabase.auth.signOut();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, canUseDevMode, signIn, signInDev, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
