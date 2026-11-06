export const ATTENTION_CLOSE_NOTE = "Aviso cerrado desde el POS.";

export type AttentionCloseIntent = { key: string; body: string; close: true };
const prefix = "impulsa.attention-close.v1:";

export function attentionIntentScope(userId: string, businessId: number, branchId: number, attentionId: string) {
  return prefix + JSON.stringify([userId, businessId, branchId, attentionId]);
}

export function readAttentionClose(scope: string | undefined): AttentionCloseIntent | null {
  if (!scope) return null;
  try {
    const raw = localStorage.getItem(scope);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<AttentionCloseIntent>;
    const body = typeof value.body === "string" ? JSON.parse(value.body) : null;
    if (typeof value.key !== "string" || !value.key || value.key.length > 240 || value.close !== true
      || !body || body.status !== "resolved" || body.note !== ATTENTION_CLOSE_NOTE
      || !Number.isInteger(body.expected_version) || body.expected_version < 1) return null;
    return { key: value.key, body: value.body!, close: true };
  } catch { return null; }
}

export function saveAttentionClose(scope: string | undefined, intent: AttentionCloseIntent) {
  if (!scope) return;
  localStorage.setItem(scope, JSON.stringify(intent));
}

export function clearAttentionClose(scope: string | undefined) {
  if (!scope) return;
  try { localStorage.removeItem(scope); } catch { /* A confirmed server result remains authoritative. */ }
}
