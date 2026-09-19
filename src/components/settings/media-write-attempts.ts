import { ApiError } from "../../lib/api";
import { settingsIdempotencyKey } from "../../lib/settings";

type MediaTarget = { scopeKey: string; path: string; kind: "logo" | "cover"; expectedVersion: number };
export type MediaUploadAttempt = Readonly<MediaTarget & { method: "POST"; file: File; idempotencyKey: string }>;
export type MediaRemoveAttempt = Readonly<MediaTarget & { method: "DELETE"; body: string; idempotencyKey: string }>;
export type MediaWriteAttempt = MediaUploadAttempt | MediaRemoveAttempt;

function slot(target: MediaTarget, method: string) {
  return JSON.stringify([target.scopeKey, target.path, target.kind, method]);
}

async function contentSignature(file: File) {
  const bytes = typeof file.arrayBuffer === "function" ? await file.arrayBuffer() : await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(new Error("Lectura de imagen cancelada"));
    reader.readAsArrayBuffer(file);
  });
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `${file.type}:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Memory-only intent cache. The caller owns busy/context guards and sends only
 * the returned snapshot. Clear on scope disposal or explicit discard, never on
 * a transport error or every render. This helper does not send or retry requests.
 */
export function createMediaWriteAttempts() {
  const records = new Map<string, { signature: string; attempt: MediaWriteAttempt }>();
  const preparing = new Map<string, symbol>();

  function succeeded(attempt: MediaWriteAttempt) {
    const key = slot(attempt, attempt.method);
    if (records.get(key)?.attempt === attempt) records.delete(key);
  }

  return {
    async prepareUpload(input: MediaTarget & { file: File }): Promise<MediaUploadAttempt> {
      const snapshot = { ...input };
      const key = slot(snapshot, "POST");
      const token = Symbol("media-read");
      preparing.set(key, token);
      const signature = await contentSignature(snapshot.file);
      if (preparing.get(key) !== token) throw new Error("El contexto o la imagen cambiaron antes de preparar el envio.");
      preparing.delete(key);
      const previous = records.get(key);
      // Re-export creates a new File/date; compare bytes, not reference or metadata.
      if (previous?.signature === signature && previous.attempt.method === "POST") return previous.attempt;
      const attempt: MediaUploadAttempt = Object.freeze({ ...snapshot, method: "POST", idempotencyKey: settingsIdempotencyKey(`settings-${snapshot.kind}`) });
      records.set(key, { signature, attempt });
      return attempt;
    },

    prepareRemove(input: MediaTarget): MediaRemoveAttempt {
      const key = slot(input, "DELETE");
      const previous = records.get(key)?.attempt;
      if (previous?.method === "DELETE") return previous;
      const attempt: MediaRemoveAttempt = Object.freeze({ ...input, method: "DELETE", body: JSON.stringify({ expected_version: input.expectedVersion }), idempotencyKey: settingsIdempotencyKey(`remove-${input.kind}`) });
      records.set(key, { signature: "remove", attempt });
      return attempt;
    },

    succeeded,

    failed(attempt: MediaWriteAttempt, error: unknown) {
      // Transport, proxy/5xx and unreadable success responses may hide a commit.
      // Definitive client rejections release the attempt; refresh stale versions.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) succeeded(attempt);
    },

    clear() {
      records.clear();
      preparing.clear();
    },
  };
}
