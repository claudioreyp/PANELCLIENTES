import { useState, type FormEvent } from "react";
import { ArrowRight, ChefHat, LockKeyhole, Sparkles } from "lucide-react";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  const { signIn, signInDev, canUseDevMode } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-story">
        <div className="login-brand"><ChefHat /><span>Escalar AI POS</span></div>
        <div className="login-copy">
          <span className="eyebrow light"><Sparkles size={14} /> Operación conectada</span>
          <h1>Del pedido a cocina, sin perder el ritmo.</h1>
          <p>Mesas, comandas, stock, caja, reservas y delivery en una sola operación diseñada para restaurantes peruanos.</p>
        </div>
        <div className="login-signal"><span /><div><strong>Sistema listo para operar</strong><small>Datos aislados por negocio y sucursal</small></div></div>
      </section>
      <section className="login-panel">
        <form onSubmit={submit} className="login-form">
          <span className="eyebrow">Acceso de equipo</span>
          <h2>Bienvenido de vuelta</h2>
          <p>Introduce el usuario y la contraseña que Escalar AI creó para tu restaurante.</p>
          <label>Usuario<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="usuario@restaurante.pe" required autoComplete="username" /></label>
          <label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="button button-primary button-large" disabled={loading}>{loading ? "Ingresando..." : "Entrar"}<ArrowRight /></button>
          {canUseDevMode && <button type="button" className="button button-ghost" onClick={signInDev}><LockKeyhole /> Entrar al entorno local</button>}
          <small className="security-note">Tu contraseña se valida de forma segura con Supabase Auth y no se guarda en el POS.</small>
        </form>
      </section>
    </main>
  );
}
