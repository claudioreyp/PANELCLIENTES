import { Copy, Laptop, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api, ApiError } from "../../lib/api";
import { DialogPortal, useDialogSurface } from "../../lib/dialog";
import { settingsIdempotencyKey } from "../../lib/settings";
import type { PosDevice } from "../../types/settings";
import { SettingsCard, SettingsConfirmDialog, SettingsFeedback } from "./SettingsPrimitives";
import { useDirtyRegistration, useSettingsEnabled } from "./SettingsState";
import "./device-settings.css";

type Device = { id: number; name: string; version: number; paired: boolean; active: boolean };
type Pairing = { device: Device; url: string; expires_at: string };

function PairingDialog({ branchId, enabled, onClose, onPaired }: { branchId: number; enabled: boolean; onClose: () => void; onPaired: () => void }) {
  const [link, setLink] = useState<Pairing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState("");
  const [copy, setCopy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [poll, setPoll] = useState(0);
  const [paired, setPaired] = useState(false);
  const [generation, setGeneration] = useState(0);
  const initialRequest = useRef<Promise<Pairing> | null>(null);
  const key = useRef(settingsIdempotencyKey("device-link"));
  const cancelKey = useRef(settingsIdempotencyKey("device-link-cancel"));
  const lifetime = useRef({ active: true });
  const operation = useRef(false);
  const callback = useRef(onPaired); callback.current = onPaired;
  const ref = useDialogSurface(() => { if (!busy) void close(); }, { enabled });
  useLayoutEffect(() => { const current = { active: enabled }; lifetime.current = current; return () => { current.active = false; }; }, [branchId, enabled]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const expired = Boolean(link && now >= Date.parse(link.expires_at));
  useDirtyRegistration({ dirty: false, saving: busy, save: null });

  async function create() {
    if (!enabled || operation.current) return;
    const current = lifetime.current; operation.current = true; setBusy(true); setError(null);
    try {
      const result = await api<Pairing>("/settings/devices/pairing-links", { method: "POST", body: JSON.stringify({ branch_id: branchId }), idempotencyKey: key.current });
      if (current.active && current === lifetime.current) setLink(result);
    } catch (cause) { if (current.active) setError(cause instanceof Error ? cause.message : "No se pudo crear el enlace"); }
    finally { operation.current = false; if (current.active) setBusy(false); }
  }
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setBusy(true); setError(null);
    initialRequest.current ||= api<Pairing>("/settings/devices/pairing-links", { method: "POST", body: JSON.stringify({ branch_id: branchId }), idempotencyKey: key.current });
    void initialRequest.current.then((result) => { if (active) setLink(result); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "No se pudo crear el enlace"); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [branchId, enabled, generation]);
  useEffect(() => {
    if (!link || !enabled) return;
    let active = true;
    setQr("");
    void QRCode.toDataURL(link.url, { width: 320, margin: 4, errorCorrectionLevel: "M" }).then((url) => { if (active) setQr(url); }).catch(() => { if (active) setError("No se pudo generar el QR. Puedes copiar el enlace o reintentar."); });
    return () => { active = false; };
  }, [link, enabled, poll]);
  useEffect(() => {
    if (!link || !enabled || paired || expired) return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const device = await api<Device>(`/settings/devices/${link.device.id}`);
        if (!active) return;
        if (device.paired) { setPaired(true); setError(null); callback.current(); return; }
        if (!device.active) { setError("El enlace fue cancelado. Genera uno nuevo."); return; }
        timer = setTimeout(() => void check(), 3000);
      } catch { if (active) setError("No se pudo consultar la activación. Conservamos el enlace; pulsa Reintentar estado."); }
    };
    void check();
    return () => { active = false; clearTimeout(timer); };
  }, [link, enabled, paired, expired, poll]);
  async function cancelLink() {
    if (!link || paired) return;
    const current = lifetime.current;
    try {
      await api(`/settings/devices/${link.device.id}/pairing-link`, { method: "DELETE", body: JSON.stringify({ expected_version: link.device.version }), idempotencyKey: cancelKey.current });
    } catch (cause) {
      if (!(cause instanceof ApiError) || cause.status !== 409) throw cause;
      const device = await api<Device>(`/settings/devices/${link.device.id}`);
      if (!device.paired) throw cause;
      if (current.active && current === lifetime.current) { setPaired(true); callback.current(); }
      throw new Error("El dispositivo ya se vinculó. Pulsa Cerrar para continuar.");
    }
  }
  async function close(regenerate = false) {
    if (operation.current || !enabled) return;
    const current = lifetime.current; operation.current = true; setBusy(true); setError(null);
    try {
      await cancelLink();
      if (!current.active) return;
      if (regenerate) { setLink(null); setQr(""); key.current = settingsIdempotencyKey("device-link"); cancelKey.current = settingsIdempotencyKey("device-link-cancel"); initialRequest.current = null; setGeneration((value) => value + 1); }
      else onClose();
    } catch (cause) { if (current.active) { setError(cause instanceof Error ? cause.message : "No se pudo cancelar. Reintenta."); setPoll((value) => value + 1); } }
    finally { operation.current = false; if (current.active) setBusy(false); }
  }
  return <DialogPortal><div className="settings-confirm-backdrop" hidden={!enabled}><section ref={ref} className="settings-confirm-dialog device-pair-dialog" role="dialog" aria-modal="true" aria-labelledby="pairing-title" tabIndex={-1}>
    <header><h2 id="pairing-title">Vincular dispositivo</h2><button className="icon-button" aria-label="Cerrar vinculación" disabled={busy} onClick={() => void close()}><X /></button></header>
    <p>Escanea el código con el dispositivo que deseas vincular o abre el enlace en él.</p>
    <SettingsFeedback error={error} />
    {!link ? <button className="button button-primary" disabled={busy} onClick={() => void create()}>{busy ? "Generando enlace..." : error ? "Reintentar" : "Generar código QR"}</button> : <>
      {!paired && !expired && <><div className="device-link"><input readOnly aria-label="Enlace de vinculación" value={link.url} /><button className="button button-secondary" onClick={() => void navigator.clipboard.writeText(link.url).then(() => setCopy(true)).catch(() => setError("No se pudo copiar. Selecciona el enlace para copiarlo manualmente."))}><Copy />{copy ? "Copiado" : "Copiar"}</button></div>{qr && <img className="device-qr" src={qr} alt="Código QR para vincular dispositivo" />}</>}
      <p role="status">{paired ? "Dispositivo vinculado. Ya puede ingresar con su PIN." : expired ? "El enlace venció. Genera uno nuevo para continuar." : `Esperando activación. Vence en ${Math.min(10, Math.max(1, Math.ceil((Date.parse(link.expires_at) - now) / 60000)))} min.`}</p>
      {error && <button className="button button-secondary" disabled={busy} onClick={() => { setError(null); setPoll(poll + 1); }}><RefreshCw />Reintentar estado</button>}
      <footer><button className="button button-secondary" disabled={busy} onClick={() => void close()}>{paired ? "Cerrar" : "Cancelar"}</button>{!paired && <button className="button button-primary" disabled={busy} onClick={() => void close(true)}>Generar otro enlace</button>}</footer>
    </>}
  </section></div></DialogPortal>;
}

export function DeviceSettings({ branchId, devices, canManage, onChange }: { branchId: number; devices: PosDevice[]; canManage: boolean; onChange: () => void }) {
  const enabled = useSettingsEnabled();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<PosDevice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoked, setRevoked] = useState<number[]>([]);
  const key = useRef("");
  const lifetime = useRef({ active: true });
  useLayoutEffect(() => { const current = { active: enabled }; lifetime.current = current; return () => { current.active = false; }; }, [enabled, branchId]);
  useDirtyRegistration({ dirty: false, saving: busy, save: null });
  const visibleDevices = devices.filter((device) => !revoked.includes(device.id));
  async function revoke() {
    if (!target || busy || !enabled) return;
    const current = lifetime.current; setBusy(true); setError(null);
    try {
      await api(`/settings/devices/${target.id}`, { method: "DELETE", body: JSON.stringify({ expected_version: target.version }), idempotencyKey: key.current });
      if (current.active) { setRevoked((ids) => [...ids, target.id]); setTarget(null); onChange(); }
    } catch (cause) { if (current.active) setError(cause instanceof Error ? cause.message : "No se pudo desvincular. Reintenta."); }
    finally { if (current.active) setBusy(false); }
  }
  return <SettingsCard title="Dispositivos con acceso por PIN" description="Vincula un dispositivo a esta sucursal para que cada miembro pueda ingresar con su PIN.">
    <SettingsFeedback error={error} />
    {visibleDevices.length ? <div className="settings-device-list">{visibleDevices.map((device) => <div key={device.id}><Laptop /><span><strong>{device.name}</strong><small>{device.status === "active" ? "Vinculado" : "Pendiente de activación"}</small></span><button className="icon-button" aria-label={`Desvincular ${device.name}`} disabled={busy || !canManage || !enabled} onClick={() => { key.current = settingsIdempotencyKey("device-revoke"); setTarget(device); }}><Trash2 /></button></div>)}</div> : <div className="settings-device-empty"><span><Laptop /></span><strong>Aún no hay dispositivos vinculados en esta sucursal</strong></div>}
    <button className="button button-secondary settings-centered-action" disabled={!canManage || !enabled} onClick={() => setOpen(true)}>Vincular dispositivo</button>
    {open && <PairingDialog branchId={branchId} enabled={enabled} onPaired={onChange} onClose={() => { setOpen(false); onChange(); }} />}
    {target && <SettingsConfirmDialog title="Desvincular dispositivo" detail="Este dispositivo perderá el acceso, incluida la sesión del miembro actual." confirmLabel={error ? "Reintentar" : "Desvincular"} danger busy={busy} onCancel={() => setTarget(null)} onConfirm={() => void revoke()} />}
  </SettingsCard>;
}
