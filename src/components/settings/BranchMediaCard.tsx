import { Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { publicAssetUrl } from "../../lib/api";
import { DialogPortal, useDialogSurface } from "../../lib/dialog";
import { ImageCropper } from "../ImageCropper";
import { SettingsCard, SettingsConfirmDialog, SettingsFeedback } from "./SettingsPrimitives";
import { useDirtyRegistration } from "./SettingsState";
import "./branch-media-card.css";

type MediaKind = "logo" | "cover";

export type BranchMediaCardProps = {
  title: string;
  kind: MediaKind;
  currentUrl: string | null;
  disabled: boolean;
  enabled?: boolean;
  onUpload: (file: File, kind: MediaKind) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
  onDiscard?: () => void;
};

// Matches BRANCH_MEDIA_MAX_BYTES in the branch settings API, not the catalog limit.
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
const MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp"];
type CropDraft = { file: File; kind: MediaKind; upload: BranchMediaCardProps["onUpload"] };

function BranchCropDialog({ draft, enabled, busy, error, onCancel, onSave, onBusyChange }: {
  draft: CropDraft;
  enabled: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (blob: Blob, previewUrl: string) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const surfaceRef = useDialogSurface<HTMLDivElement>(() => { if (enabled && !busy) onCancel(); }, { enabled });
  return <DialogPortal><div ref={surfaceRef} tabIndex={-1} hidden={!enabled} inert={!enabled || undefined}>
    <ImageCropper file={draft.file} aspectRatio={draft.kind === "logo" ? 1 : 16 / 9}
      title="Recortar imagen" saveLabel="Guardar" backdropClassName="branch-media-cropper"
      disabled={!enabled} error={error} onCancel={onCancel} onSave={onSave} onBusyChange={onBusyChange} />
  </div></DialogPortal>;
}

export function BranchMediaCard({ title, kind, currentUrl, disabled, enabled = true, onUpload, onRemove, onDiscard }: BranchMediaCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const restoreUploadFocus = useRef(false);
  const mountedRef = useRef(false);
  const busyRef = useRef(false);
  const uploadRef = useRef(false);
  const previewUrls = useRef(new Set<string>());
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const lifetimeRef = useRef<object | null>(null);
  const [draft, setDraft] = useState<CropDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cropError, setCropError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"discard" | "remove" | null>(null);
  const locked = !enabled || disabled || busy;

  useLayoutEffect(() => {
    lifetimeRef.current = {};
    if (!enabled) restoreUploadFocus.current = false;
    return () => { lifetimeRef.current = null; };
  }, [enabled]);

  useEffect(() => {
    if (draft || locked || !restoreUploadFocus.current) return;
    // Settings removes its saving/inert guard after the crop dialog unmounts.
    // Restore once that commit finishes, without taking focus from another dialog.
    const timer = window.setTimeout(() => {
      restoreUploadFocus.current = false;
      const button = uploadButtonRef.current;
      const activeDialog = document.activeElement?.closest('[role="dialog"], [role="alertdialog"]');
      if (!button || button.disabled || button.closest("[inert], [hidden]")) return;
      if (activeDialog && !activeDialog.contains(button)) return;
      button.focus();
    });
    return () => window.clearTimeout(timer);
  }, [draft, locked]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    const urls = previewUrls.current;
    return () => {
      mountedRef.current = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);
  useDirtyRegistration({ dirty: draft !== null, saving: enabled && busy, save: null });

  function changeBusy(next: boolean) {
    busyRef.current = next;
    setBusy(next);
  }

  function requestDiscard() {
    if (enabledRef.current && !busyRef.current) setConfirmation("discard");
  }

  async function saveCrop(blob: Blob, previewUrl: string) {
    const lifetime = lifetimeRef.current;
    previewUrls.current.add(previewUrl);
    try {
      if (!draft || !enabledRef.current || uploadRef.current) return;
      if (!MEDIA_TYPES.includes(blob.type) || !blob.size || blob.size > MAX_MEDIA_BYTES) {
        setCropError("El recorte no tiene un formato o tama\u00f1o v\u00e1lido. Usa PNG, JPG o WEBP de hasta 8 MB.");
        return;
      }
      uploadRef.current = true;
      setCropError(null);
      const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/png" ? "png" : "webp";
      const file = new File([blob], `${draft.kind}.${extension}`, { type: blob.type });
      // Bind the mutation to the draft's original branch callback, never a later context.
      const saved = await draft.upload(file, draft.kind);
      if (!mountedRef.current || lifetime !== lifetimeRef.current) return;
      if (saved) {
        restoreUploadFocus.current = true;
        changeBusy(false);
        setDraft(null);
      } else {
        setCropError("No se pudo guardar la imagen. Conservamos tu recorte; pulsa Guardar para reintentar.");
      }
    } catch {
      if (mountedRef.current && lifetime === lifetimeRef.current) setCropError("No se pudo guardar la imagen. Conservamos tu recorte; pulsa Guardar para reintentar.");
    } finally {
      uploadRef.current = false;
      if (previewUrls.current.delete(previewUrl)) URL.revokeObjectURL(previewUrl);
    }
  }

  async function remove() {
    if (!enabledRef.current || disabledRef.current || busyRef.current) return;
    const lifetime = lifetimeRef.current;
    changeBusy(true);
    setError(null);
    try {
      const removed = await onRemove();
      if (!mountedRef.current || lifetime !== lifetimeRef.current) return;
      if (!removed) setError("No se pudo quitar la imagen. Vuelve a intentarlo.");
    } catch {
      if (mountedRef.current && lifetime === lifetimeRef.current) setError("No se pudo quitar la imagen. Vuelve a intentarlo.");
    } finally {
      if (mountedRef.current) {
        changeBusy(false);
        setConfirmation(null);
      }
    }
  }

  return <SettingsCard className="settings-media-card branch-media-card">
    <div className="settings-media-row">
      <div className={`settings-media-preview ${kind}`}>{currentUrl ? <img src={publicAssetUrl(currentUrl)} alt={title} /> : <ImageIcon aria-hidden="true" />}</div>
      <div><strong>{title}</strong><small>{kind === "logo" ? "Recorte cuadrado (1:1)." : "Recorte horizontal (16:9)."} PNG, JPG o WEBP, hasta 8 MB.</small></div>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" aria-label={`Elegir imagen: ${title}`} hidden disabled={locked || draft !== null} onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (!file || !enabledRef.current || disabledRef.current || busyRef.current || draft) return;
        setError(null);
        if (!MEDIA_TYPES.includes(file.type)) {
          setError("Elige una imagen PNG, JPG o WEBP.");
          return;
        }
        if (!file.size || file.size > MAX_MEDIA_BYTES) {
          setError("La imagen debe tener contenido y pesar como m\u00e1ximo 8 MB.");
          return;
        }
        uploadButtonRef.current?.focus();
        setCropError(null);
        setDraft({ file, kind, upload: onUpload });
      }} />
      <div className="branch-media-actions">
        <button ref={uploadButtonRef} className="button button-secondary" type="button" disabled={locked} onClick={() => inputRef.current?.click()}><Upload />Cargar imagen</button>
        {currentUrl && <button className="button button-secondary" type="button" disabled={locked || draft !== null} onClick={() => { setError(null); setConfirmation("remove"); }}><Trash2 />Quitar imagen</button>}
      </div>
    </div>
    <SettingsFeedback error={error} />
    {draft && <BranchCropDialog draft={draft} enabled={enabled} busy={busy} error={cropError} onCancel={requestDiscard} onSave={saveCrop} onBusyChange={changeBusy} />}
    {confirmation && enabled && <SettingsConfirmDialog
      title={confirmation === "discard" ? "Descartar recorte" : "Quitar imagen"}
      detail={confirmation === "discard" ? "Se perder\u00e1 este recorte sin guardar. La imagen actual no cambiar\u00e1." : `Se quitar\u00e1 la imagen de ${title}. Puedes cargar otra despu\u00e9s.`}
      confirmLabel={confirmation === "discard" ? "Descartar recorte" : "Quitar imagen"}
      danger busy={busy || (confirmation === "remove" && disabled)} onCancel={() => setConfirmation(null)} onConfirm={() => {
        if (!enabled || busyRef.current || (confirmation === "remove" && disabled)) return;
        if (confirmation === "remove") void remove();
        else { onDiscard?.(); restoreUploadFocus.current = true; setConfirmation(null); setCropError(null); setDraft(null); }
      }} />}
  </SettingsCard>;
}
