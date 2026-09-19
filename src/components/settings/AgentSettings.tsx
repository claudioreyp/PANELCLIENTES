import { ArrowDown, ArrowUp, Plus, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError, privateImage } from "../../lib/api";
import { DialogPortal, useDialogSurface } from "../../lib/dialog";
import { settingsIdempotencyKey } from "../../lib/settings";
import { useTenant } from "../../lib/tenant";
import { ImageCropper } from "../ImageCropper";
import { SettingsCard, SettingsConfirmDialog, SettingsFeedback, SettingsSectionHeader, SettingsSkeleton } from "./SettingsPrimitives";
import { useDirtyRegistration, useSettingsEnabled, useSettingsQuery } from "./SettingsState";
import "./agent-settings.css";

type Profile = { branch_id: number; version: number; name: string | null; images: { id: string; url: string }[]; yape_qr_url: string | null; yape_number: string | null; payment_recipient_name: string | null };
type PaymentDraft = { yape_number: string; payment_recipient_name: string };
type Selection = { file: File; target: string; yape: boolean };
type Attempt = { path: string; method: string; body: string | FormData; key: string; name?: boolean; payment?: boolean };

export function AgentImage({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setUrl(""); setFailed(false);
    void privateImage(path).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path, retry]);
  if (failed) return <button type="button" className="button button-secondary" onClick={() => setRetry(retry + 1)}>Reintentar imagen</button>;
  return url ? <img src={url} alt={alt} onError={() => setFailed(true)} /> : <span role="status">Cargando imagen...</span>;
}

function ImageEditor({ selection, busy, error, onClose, onSave, enabled }: {
  selection: Selection; busy: boolean; error: string | null; enabled: boolean; onClose: () => void; onSave: (file: Blob) => Promise<boolean>;
}) {
  const ref = useDialogSurface<HTMLDivElement>(() => { if (!busy) onClose(); }, { enabled });
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!selection.yape) return;
    const url = URL.createObjectURL(selection.file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [selection]);
  return <DialogPortal><div ref={ref} hidden={!enabled}>
    {selection.yape ? <div className="settings-confirm-backdrop"><section className="settings-confirm-dialog agent-qr-preview" role="dialog" aria-modal="true" aria-label="QR de Yape" tabIndex={-1}>
      <h2>QR de Yape</h2><p>Se guardará la imagen completa, sin recortar el código.</p>{preview && <img src={preview} alt="Vista previa del QR de Yape" />}
      <SettingsFeedback error={error} /><footer><button className="button button-secondary" disabled={busy} onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={busy} onClick={() => void onSave(selection.file)}>{busy ? "Guardando..." : error ? "Reintentar" : "Guardar"}</button></footer>
    </section></div> : <ImageCropper file={selection.file} aspectRatio="original" title="Recortar imagen del menú" saveLabel={error ? "Reintentar" : "Guardar"} backdropClassName="agent-cropper" busy={busy} disabled={!enabled} error={error} onCancel={onClose} onSave={async (blob, previewUrl) => { try { return await onSave(blob); } finally { URL.revokeObjectURL(previewUrl); } }} />}
  </div></DialogPortal>;
}

export function AgentSettings() {
  const { branch } = useTenant();
  return <BranchAgentSettings key={branch?.id || 0} branchId={branch?.id || 0} />;
}

function BranchAgentSettings({ branchId }: { branchId: number }) {
  const path = `/settings/branches/${branchId}/agent`;
  const resource = useSettingsQuery<Profile>(path, { branch_id: branchId, version: 0, name: null, images: [], yape_qr_url: null, yape_number: null, payment_recipient_name: null });
  const enabled = useSettingsEnabled();
  const [name, setName] = useState<string | null>(null);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [remove, setRemove] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Attempt | null>(null);
  const attempt = useRef<Attempt | null>(null);
  const inFlight = useRef(false);
  const lifetime = useRef({ active: true });
  const input = useRef<HTMLInputElement>(null);
  const target = useRef({ target: "images", yape: false });
  useLayoutEffect(() => {
    const current = { active: enabled }; lifetime.current = current;
    return () => { current.active = false; };
  }, [path, enabled]);
  const dirty = name !== null && name !== (resource.data.name || "");
  const payment = paymentDraft ?? { yape_number: resource.data.yape_number || "", payment_recipient_name: resource.data.payment_recipient_name || "" };
  const paymentDirty = payment.yape_number !== (resource.data.yape_number || "") || payment.payment_recipient_name !== (resource.data.payment_recipient_name || "");
  const locked = saving || !enabled || !resource.available || Boolean(pending);

  async function perform(next: Attempt): Promise<boolean> {
    if (!enabled || inFlight.current) return false;
    const current = lifetime.current;
    inFlight.current = true; setSaving(true); setError(null); setNotice(null);
    attempt.current = next;
    try {
      const saved = await api<Profile>(next.path, { method: next.method, body: next.body, idempotencyKey: next.key });
      if (!current.active || current !== lifetime.current) return false;
      resource.setData(saved); setPending(null); attempt.current = null;
      if (next.name) setName(null);
      if (next.payment) setPaymentDraft(null);
      setSelection(null); setRemove(null); setNotice("Los cambios se guardaron correctamente.");
      return true;
    } catch (cause) {
      if (current.active && current === lifetime.current) {
        if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
          setPending(null); attempt.current = null;
          if (cause.status === 409) void resource.reload();
        } else setPending(next);
        setError(cause instanceof Error ? cause.message : "No se pudo guardar. Reintenta.");
      }
      return false;
    } finally { inFlight.current = false; if (current.active && current === lifetime.current) setSaving(false); }
  }
  function change(method: string, suffix: string, body: object | FormData, nameChange = false, paymentChange = false) {
    return perform({ path: `${path}${suffix}`, method, body: body instanceof FormData ? body : JSON.stringify(body), key: settingsIdempotencyKey("agent"), name: nameChange, payment: paymentChange });
  }
  const saveName = () => pending ? perform(pending) : change("PATCH", "", { name: (name ?? resource.data.name ?? "").trim() || null, expected_version: resource.data.version }, true);
  const paymentPayload = { yape_number: payment.yape_number.trim() || null, payment_recipient_name: payment.payment_recipient_name.trim() || null };
  const savePayment = () => pending ? perform(pending) : change("PATCH", "", { ...paymentPayload, expected_version: resource.data.version }, false, true);
  const saveAll = () => change("PATCH", "", {
    ...(dirty ? { name: (name ?? "").trim() || null } : {}), ...(paymentDirty ? paymentPayload : {}), expected_version: resource.data.version,
  }, dirty, paymentDirty);
  const latestSave = useRef(saveAll); latestSave.current = saveAll;
  const saveRegisteredDraft = useCallback(() => latestSave.current(), []);
  useDirtyRegistration({ dirty: dirty || paymentDirty || Boolean(selection) || Boolean(pending), saving, save: selection || pending ? null : saveRegisteredDraft });
  function chooseFile(suffix: string, yape = false) { target.current = { target: suffix, yape }; input.current?.click(); }
  async function upload(blob: Blob) {
    if (attempt.current) return perform(attempt.current);
    if (!selection) return false;
    const form = new FormData(); form.set("expected_version", String(resource.data.version)); form.set("file", blob, selection.yape ? selection.file.name : "menu.webp");
    return change("POST", `/${selection.target}`, form);
  }
  function move(index: number, direction: number) {
    const order = resource.data.images.map((image) => image.id);
    [order[index], order[index + direction]] = [order[index + direction], order[index]];
    void change("PATCH", "", { image_order: order, expected_version: resource.data.version });
  }
  return <div className="settings-section-stack agent-settings">
    <SettingsSectionHeader title="Perfil del agente" description="Configura los datos disponibles para la atención por WhatsApp, sin modificar el agente conectado." />
    <SettingsFeedback error={error || resource.error} notice={resource.notice} success={notice} />
    {resource.loading && <SettingsSkeleton />}
    {!resource.available && !resource.loading && <button className="button button-secondary" onClick={() => void resource.reload()}>Reintentar</button>}
    {pending && !selection && <button className="button button-secondary" disabled={saving || !enabled} onClick={() => void perform(pending)}>Reintentar guardado</button>}
    <SettingsCard title="Nombre del agente">
      <label>Nombre (opcional)<input maxLength={80} disabled={locked} value={name ?? resource.data.name ?? ""} onChange={(event) => setName(event.target.value)} placeholder="Sin nombre personalizado" /></label>
      <p className="settings-muted">Este nombre queda disponible en la API. No cambia por sí solo la forma de responder del agente.</p>
      <footer className="settings-form-actions"><button className="button button-secondary" disabled={!dirty || locked} onClick={() => setName(null)}>Cancelar</button><button className="button button-primary" disabled={!dirty || locked} onClick={() => void saveName()}>Guardar</button></footer>
    </SettingsCard>
    <SettingsCard title="Imágenes del menú" description="La primera imagen es la principal. Puedes agregar hasta 10 imágenes y ajustar cada una antes de guardarla.">
      <ol className="agent-gallery">{resource.data.images.map((image, index) => <li key={image.id}>
        <h4>{index === 0 ? "Imagen principal" : `Imagen ${index + 1}`}</h4><div className="agent-gallery-preview"><AgentImage path={image.url} alt={`Menú, imagen ${index + 1}`} /></div>
        <div className="agent-image-actions"><button className="button button-secondary" disabled={locked} onClick={() => chooseFile(`images/${image.id}`)}><Upload />Reemplazar</button>
          <button className="icon-button" aria-label={`Subir imagen ${index + 1}`} disabled={locked || index === 0} onClick={() => move(index, -1)}><ArrowUp /></button>
          <button className="icon-button" aria-label={`Bajar imagen ${index + 1}`} disabled={locked || index === resource.data.images.length - 1} onClick={() => move(index, 1)}><ArrowDown /></button>
          <button className="icon-button" aria-label={`Eliminar imagen ${index + 1}`} disabled={locked} onClick={() => setRemove(`images/${image.id}`)}><Trash2 /></button></div>
      </li>)}</ol>
      {!resource.data.images.length && <p className="settings-inline-empty">Aún no hay imágenes del menú.</p>}
      <button className="button button-secondary" disabled={locked || resource.data.images.length >= 10} onClick={() => chooseFile("images")}><Plus />{resource.data.images.length ? "Añadir otra imagen" : "Cargar imagen del menú"}</button>
    </SettingsCard>
    <SettingsCard title="QR de Yape" description="Utiliza una imagen nítida y conserva el código completo, incluidos sus márgenes.">
      <div className="agent-payment-fields">
        <label>Número de Yape<input type="tel" maxLength={40} disabled={locked} value={payment.yape_number} onChange={(event) => setPaymentDraft({ ...payment, yape_number: event.target.value })} /></label>
        <label>Nombre del titular<input maxLength={180} disabled={locked} value={payment.payment_recipient_name} onChange={(event) => setPaymentDraft({ ...payment, payment_recipient_name: event.target.value })} /></label>
      </div>
      <p className="settings-muted">Datos opcionales que recibirá la integración de esta sucursal. No habilitan Yape como método de pago.</p>
      <div className="agent-payment-actions"><button className="button button-secondary" disabled={!paymentDirty || locked} onClick={() => setPaymentDraft(null)}>Cancelar datos de Yape</button><button className="button button-primary" disabled={!paymentDirty || locked} onClick={() => void savePayment()}>Guardar datos de Yape</button></div>
      {resource.data.yape_qr_url ? <div className="agent-yape-preview"><AgentImage path={resource.data.yape_qr_url} alt="QR de Yape guardado" /></div> : <p>No hay un QR de Yape configurado.</p>}
      <div className="agent-image-actions"><button className="button button-secondary" disabled={locked} onClick={() => chooseFile("yape-qr", true)}><Upload />{resource.data.yape_qr_url ? "Reemplazar QR" : "Subir QR de Yape"}</button>{resource.data.yape_qr_url && <button className="button button-ghost" disabled={locked} onClick={() => setRemove("yape-qr")}><Trash2 />Borrar QR</button>}</div>
    </SettingsCard>
    <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="Archivo del agente" onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (!file) return;
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024 || !file.size) { setError("Elige una imagen PNG, JPG o WEBP de hasta 8 MB."); return; }
      setError(null); setSelection({ file, ...target.current });
    }} />
    {selection && <ImageEditor selection={selection} busy={saving} error={error} enabled={enabled} onClose={() => { if (!pending) setSelection(null); else setError("Reintenta el guardado para confirmar su resultado antes de cerrar."); }} onSave={upload} />}
    {remove && <SettingsConfirmDialog title="Eliminar imagen" detail="Se eliminará después de confirmar el cambio. Si es la principal, la siguiente ocupará su lugar." confirmLabel={pending ? "Reintentar" : "Eliminar"} danger busy={saving} onCancel={() => { if (!pending) setRemove(null); }} onConfirm={() => { void (pending ? perform(pending) : change("DELETE", `/${remove}`, { expected_version: resource.data.version })); }} />}
  </div>;
}
