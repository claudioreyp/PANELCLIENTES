import { api } from "./api";
import { isSettingsUnavailable, loadSettings } from "./settings";
import type { MapPoint } from "./google-map";

export type DeliveryAddressDraft = {
  street: string;
  number: string;
  crossStreets: string;
  neighborhood: string;
  reference: string;
  mapsUrl: string;
  point: MapPoint | null;
};

export const emptyDeliveryAddress: DeliveryAddressDraft = {
  street: "", number: "", crossStreets: "", neighborhood: "", reference: "", mapsUrl: "", point: null,
};

export function serializeDeliveryAddress(draft: DeliveryAddressDraft) {
  const street = draft.street.trim();
  const number = draft.number.trim();
  const neighborhood = draft.neighborhood.trim();
  const crossStreets = draft.crossStreets.trim();
  return {
    address: [[street, number].filter(Boolean).join(" "), neighborhood, crossStreets ? `Entre ${crossStreets}` : ""].filter(Boolean).join(", "),
    street,
    number: number || null,
    cross_streets: crossStreets || null,
    neighborhood: neighborhood || null,
    reference: draft.reference.trim() || null,
    maps_url: draft.mapsUrl.trim() || null,
    ...(draft.point ? { latitude: draft.point.latitude, longitude: draft.point.longitude } : {}),
  };
}

export type PosDeliveryPolicy = {
  version: number;
  mode: string;
  fixedFee: number | null;
  neighborhoods: string[];
};

export type OrderDeliveryQuote = {
  id: string;
  fee: number | null;
  requires_quote: boolean;
  configuration_version: number;
  expires_at: string;
  fee_status: string;
};

const unavailable = "La API no admite cotizaciones de delivery para el POS. Actualiza el servicio antes de continuar; no se usará una tarifa fija de respaldo.";
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const validFee = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function parseManualDeliveryFee(value: string): number | null {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) return null;
  const amount = Number(value.trim().replace(",", "."));
  return validFee(amount) && amount <= 9999999999.99 ? amount : null;
}

export async function loadPosDeliveryPolicy(branchId: number): Promise<PosDeliveryPolicy> {
  const result = await loadSettings<Record<string, unknown>>(`/settings/branches/${branchId}/delivery`, {});
  const data = result.data;
  if (!result.available || data.pos_quotes_supported !== true || !Number.isInteger(data.version) || Number(data.version) < 1) throw new Error(unavailable);
  if (typeof data.mode !== "string" || !["free", "fixed", "radius", "distance", "quote", "neighborhoods"].includes(data.mode)) throw new Error(unavailable);
  const policy = isRecord(data.delivery_policy) ? data.delivery_policy : {};
  if (data.mode === "fixed" && !validFee(data.fixed_delivery_fee)) throw new Error("La configuración no tiene un costo fijo válido. Actualiza la configuración de delivery.");
  return {
    version: Number(data.version), mode: data.mode,
    fixedFee: validFee(data.fixed_delivery_fee) ? data.fixed_delivery_fee : null,
    neighborhoods: Array.isArray(policy.neighborhoods) ? policy.neighborhoods.filter(isRecord).flatMap((item) => typeof item.name === "string" && item.name.trim() ? [item.name] : []) : [],
  };
}

export function quoteIsCurrent(quote: OrderDeliveryQuote, version: number, now = Date.now()) {
  return quote.configuration_version === version && Date.parse(quote.expires_at) > now;
}

export function parseOrderDeliveryQuote(value: unknown, version: number): OrderDeliveryQuote {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()
    || value.configuration_version !== version || typeof value.expires_at !== "string"
    || !Number.isFinite(Date.parse(value.expires_at)) || typeof value.fee_status !== "string"
    || !((value.requires_quote === true && value.fee === null) || (value.requires_quote === false && validFee(value.fee)))) {
    throw new Error("La API devolvió una cotización de delivery incompatible. No se puede confirmar el importe.");
  }
  return value as OrderDeliveryQuote;
}

export type DeliveryQuoteRequest = {
  subtotal: number;
  destination: ReturnType<typeof serializeDeliveryAddress>;
  expected_configuration_version: number;
  confirmed_fee?: number;
};

export type DeliveryQuoteAttempt = { key: string; quote?: OrderDeliveryQuote; pending?: Promise<OrderDeliveryQuote> };

// Attempts live only with this draft. A transport retry reuses the exact body/key;
// expired successful responses must get a new key rather than replay forever.
export async function requestOrderDeliveryQuote(branchId: number, payload: DeliveryQuoteRequest, attempts: Map<string, DeliveryQuoteAttempt>) {
  const body = JSON.stringify(payload);
  const signature = `${branchId}:${body}`;
  let attempt = attempts.get(signature);
  if (attempt?.quote && !quoteIsCurrent(attempt.quote, payload.expected_configuration_version)) {
    attempts.delete(signature);
    attempt = undefined;
  }
  if (!attempt) { attempt = { key: crypto.randomUUID() }; attempts.set(signature, attempt); }
  if (attempt.quote) return attempt.quote;
  if (attempt.pending) return attempt.pending;
  const current = attempt;
  current.pending = (async () => {
    try {
      const result = await api<unknown>(`/settings/branches/${branchId}/delivery/quotes`, { method: "POST", idempotencyKey: current.key, body });
      const quote = parseOrderDeliveryQuote(result, payload.expected_configuration_version);
      if (!quoteIsCurrent(quote, payload.expected_configuration_version)) {
        attempts.delete(signature);
        throw new Error("La cotización venció. Vuelve a continuar para obtener un costo actualizado.");
      }
      current.quote = quote;
      return quote;
    } catch (error) {
      if (isSettingsUnavailable(error)) throw new Error(unavailable);
      throw error;
    } finally { current.pending = undefined; }
  })();
  return current.pending;
}
