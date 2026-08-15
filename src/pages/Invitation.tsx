import { CheckCircle2, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

type AcceptedInvitation = {
  status: "accepted";
  business_id: number;
  branch_id: number | null;
  role: string;
};

export function InvitationPage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const { user, loading: authLoading } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<AcceptedInvitation | null>(null);

  async function accept(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!token) return setError("El enlace no contiene una invitación válida.");
    if (password.length < 8) return setError("La contraseña debe tener al menos 8 caracteres.");
    if (password !== confirmPassword) return setError("Las contraseñas no coinciden.");
    if (!user) return setError("La sesión de invitación expiró. Solicita una invitación nueva.");
    setSubmitting(true);
    try {
      if (supabase) {
        const { error: passwordError } = await supabase.auth.updateUser({ password });
        if (passwordError) throw passwordError;
      }
      const result = await api<AcceptedInvitation>("/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      localStorage.setItem("impulsa.businessId", String(result.business_id));
      if (result.branch_id) localStorage.setItem("impulsa.branchId", String(result.branch_id));
      setAccepted(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo aceptar la invitación.");
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading) {
    return <main className="invite-page"><section className="invite-card invite-loading"><LoaderCircle className="spin" /><p>Validando tu invitación...</p></section></main>;
  }

  if (accepted) {
    return (
      <main className="invite-page">
        <section className="invite-card invite-success">
          <CheckCircle2 />
          <span className="eyebrow">Acceso habilitado</span>
          <h1>Ya eres parte del equipo.</h1>
          <p>Tu cuenta quedó vinculada con el rol <strong>{accepted.role}</strong>. Desde ahora usarás esta contraseña para entrar al POS.</p>
          <Link className="button button-primary button-large" to="/">Entrar al restaurante</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="invite-page">
      <section className="invite-card">
        <div className="invite-icon"><ShieldCheck /></div>
        <span className="eyebrow">Invitación segura</span>
        <h1>Activa tu acceso a Impulsa.</h1>
        <p>Confirma tu cuenta y crea una contraseña. El enlace solo puede utilizarse una vez y vence automáticamente.</p>
        {!token && <div className="form-error">Este enlace está incompleto. Pide al administrador que genere una invitación nueva.</div>}
        {!user && <div className="form-error">No encontramos una sesión válida de Supabase. Vuelve a abrir el enlace original del correo.</div>}
        <form className="form-stack" onSubmit={accept}>
          <label>Nueva contraseña<input type="password" minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <label>Repetir contraseña<input type="password" minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="button button-primary button-large" disabled={submitting || !token || !user}>
            {submitting ? <><LoaderCircle className="spin" /> Activando...</> : <><KeyRound /> Activar mi cuenta</>}
          </button>
        </form>
        <small>Impulsa nunca envía ni muestra contraseñas del equipo.</small>
      </section>
    </main>
  );
}
