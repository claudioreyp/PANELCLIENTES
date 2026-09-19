import { ArrowLeft, ChefHat, Delete, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { DeviceAccessError, deviceRequest, getDeviceSession, type DeviceSession } from "../lib/device-access";
import { settingsIdempotencyKey } from "../lib/settings";
import "./device-access.css";

function Brand() { return <div className="device-access-brand"><ChefHat aria-hidden="true" /><strong>Escalar AI POS</strong></div>; }

export function ActivateDevicePage() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") || "");
  const [branch, setBranch] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const key = useRef(settingsIdempotencyKey("activate-device"));
  const submitted = useRef<{ token: string; name: string } | null>(null);
  const navigate = useNavigate();
  const lifetime = useRef({ active: true });
  useEffect(() => {
    const current = { active: true }; lifetime.current = current;
    window.history.replaceState(window.history.state, "", window.location.pathname);
    void deviceRequest<{ branch_name: string }>("preview", { token }).then((data) => { if (current.active) { setBranch(data.branch_name); setError(null); } }).catch((cause) => { if (current.active) setError(cause instanceof Error ? cause.message : "No se pudo abrir el enlace"); });
    return () => { current.active = false; };
  }, [token, retry]);
  async function activate() {
    if (busy || !name.trim()) return;
    const current = lifetime.current; setBusy(true); setError(null);
    const body = submitted.current || { token, name: name.trim() }; submitted.current = body;
    try {
      await deviceRequest("activate", body, key.current);
      if (current.active) { localStorage.setItem("impulsa.authMode", "device"); navigate("/acceso-pin", { replace: true }); }
    } catch (cause) {
      if (current.active) {
        if (cause instanceof DeviceAccessError && cause.status === 422) {
          submitted.current = null; key.current = settingsIdempotencyKey("activate-device");
        }
        setError(cause instanceof Error ? cause.message : "No se pudo activar. Reintenta.");
      }
    }
    finally { if (current.active) setBusy(false); }
  }
  return <main className="device-access"><section className="device-access-card"><Brand /><h1>Activar acceso por PIN</h1>
    <p>{branch ? `Este dispositivo quedará vinculado a ${branch}.` : "Comprobando el enlace de vinculación..."}</p>
    {error && <p role="alert" className="device-access-error">{error}</p>}
    {!branch && error && <button className="button button-secondary" onClick={() => setRetry(retry + 1)}>Reintentar</button>}
    <form onSubmit={(event) => { event.preventDefault(); void activate(); }}><label>Nombre del dispositivo<input autoComplete="off" maxLength={180} value={name} disabled={busy || Boolean(submitted.current)} onChange={(event) => setName(event.target.value)} /></label><p className="device-access-help">Por ejemplo: Computadora de caja o Tablet de meseros.</p><button className="button button-primary" disabled={!branch || name.trim().length < 2 || busy}>{busy ? "Activando..." : error && submitted.current ? "Reintentar activación" : "Activar"}</button></form>
    <Link to="/login">Iniciar sesión con correo electrónico</Link>
  </section></main>;
}

export function DevicePinPage() {
  const [session, setSession] = useState<DeviceSession | null>(null);
  const [members, setMembers] = useState<{ id: number; name: string }[]>([]);
  const [selected, setSelected] = useState<{ id: number; name: string } | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const pad = useRef<HTMLDivElement>(null);
  const memberButtons = useRef(new Map<number, HTMLButtonElement>());
  const previousMember = useRef<number | null>(null);
  const lifetime = useRef({ active: true });
  const attempt = useRef<{ member_id: number; pin: string; key: string } | null>(null);
  const { signInDevice } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    const current = { active: true }; lifetime.current = current; setLoading(true); setError(null);
    void getDeviceSession().then(async (result) => {
      const items = result.linked ? await deviceRequest<{ items: { id: number; name: string }[] }>("members") : { items: [] };
      if (current.active) { setSession(result); setMembers(items.items); }
    }).catch((cause) => { if (current.active) setError(cause instanceof Error ? cause.message : "No se pudo cargar el acceso"); }).finally(() => { if (current.active) setLoading(false); });
    return () => { current.active = false; attempt.current = null; };
  }, [retry]);
  useEffect(() => {
    if (selected) pad.current?.focus();
    else if (previousMember.current) memberButtons.current.get(previousMember.current)?.focus();
  }, [selected]);
  function changePin(next: string) { if (!busy) { setPin(next.slice(0, 4)); attempt.current = null; setError(null); } }
  function back() { if (busy) return; previousMember.current = selected?.id || null; setSelected(null); setPin(""); attempt.current = null; setError(null); }
  async function login() {
    if (busy || !selected || pin.length !== 4) return;
    const current = lifetime.current; setBusy(true); setError(null);
    const request = attempt.current || { member_id: selected.id, pin, key: settingsIdempotencyKey("pin-login") }; attempt.current = request;
    try {
      await deviceRequest("login", { member_id: request.member_id, pin: request.pin }, request.key);
      if (!current.active) return;
      await signInDevice(); setPin(""); attempt.current = null; navigate("/", { replace: true });
    } catch (cause) { if (current.active) setError(cause instanceof Error ? cause.message : "No se pudo ingresar. Reintenta."); }
    finally { if (current.active) setBusy(false); }
  }
  return <main className="device-access"><section className="device-access-card"><Brand />
    {session?.linked && <div className="device-branch-label">{session.branch_name}</div>}
    <h1>{selected ? "Ingresa tu PIN de miembro" : "Selecciona tu nombre"}</h1>
    {loading && <p role="status">Preparando el acceso...</p>}
    {!loading && !session?.linked && <p>Este navegador no está vinculado. Abre un enlace de vinculación válido o ingresa con tu correo.</p>}
    {!loading && session?.linked && !members.length && <p>No hay miembros con PIN habilitados en esta sucursal. Solicita al administrador que configure su acceso.</p>}
    {error && <p role="alert" className="device-access-error">{error}</p>}
    {!selected && !loading && session?.linked && <div className="device-member-list">{members.map((member) => <button className="button button-secondary" key={member.id} ref={(element) => { if (element) memberButtons.current.set(member.id, element); else memberButtons.current.delete(member.id); }} onClick={() => setSelected(member)}>{member.name}</button>)}</div>}
    {selected && <><button className="button button-ghost" disabled={busy} onClick={back}><ArrowLeft />{selected.name}</button>
      <div className="device-pin-pad" ref={pad} tabIndex={0} role="group" aria-label="Teclado PIN de cuatro dígitos" onKeyDown={(event) => {
        if (/^\d$/.test(event.key)) { event.preventDefault(); changePin(pin + event.key); }
        else if (event.key === "Backspace") { event.preventDefault(); changePin(pin.slice(0, -1)); }
        else if (event.key === "Escape") { event.preventDefault(); back(); }
        else if (event.key === "Enter" && event.target === event.currentTarget) { event.preventDefault(); void login(); }
      }}>
        <div className="device-pin-dots" role="status" aria-label={`${pin.length} de 4 dígitos ingresados`}>{[0, 1, 2, 3].map((i) => <span key={i} className={i < pin.length ? "is-filled" : ""} />)}</div>
        <div className="device-keypad">{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => <button type="button" key={digit} disabled={busy || pin.length === 4} onClick={() => changePin(pin + digit)}>{digit}</button>)}<button type="button" aria-label="Limpiar PIN" disabled={busy} onClick={() => changePin("")}><X /></button><button type="button" disabled={busy || pin.length === 4} onClick={() => changePin(pin + "0")}>0</button><button type="button" aria-label="Borrar último dígito" disabled={busy} onClick={() => changePin(pin.slice(0, -1))}><Delete /></button></div>
      </div><button className="button button-primary" disabled={busy || pin.length !== 4} onClick={() => void login()}>{busy ? "Ingresando..." : error ? "Reintentar ingreso" : "Ingresar"}</button>
    </>}
    {error && !selected && <button className="button button-secondary" onClick={() => setRetry(retry + 1)}>Reintentar</button>}
    <Link to="/login">Iniciar sesión con correo electrónico</Link>
  </section></main>;
}
