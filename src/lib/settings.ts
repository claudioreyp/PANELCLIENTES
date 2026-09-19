import { api, ApiError } from "./api";
import type { ThermalPrintTemplate } from "./thermal-print";
import type {
  BranchProfileSettings,
  DeliveryMode,
  DeliverySettings,
  PaymentMethod,
  PaymentMethodSettings,
  PosDevice,
  PrintSettings,
  ScheduleSettings,
  SecurityAuditEntry,
  ServiceSchedule,
  SettingsLoadResult,
  MemberSaveResult,
} from "../types/settings";

const SETTINGS_UNAVAILABLE = "Esta opción necesita la API de Configuración Integral. Puedes revisar los datos actuales, pero no se guardarán cambios hasta actualizar el servicio.";

export function settingsIdempotencyKey(prefix = "settings") {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function isSettingsUnavailable(error: unknown) {
  return error instanceof ApiError && (
    error.status === 404
    || error.status === 405
    || error.status === 501
    || error.code === "API_CONTRACT_UNSUPPORTED"
  );
}

export function settingsErrorMessage(error: unknown, fallback: string) {
  if (isSettingsUnavailable(error)) return SETTINGS_UNAVAILABLE;
  return error instanceof Error ? error.message : fallback;
}

export function memberInvitationFeedback(result: MemberSaveResult, requested: boolean) {
  const status = result.invitation?.delivery_status;
  if (status === "sent") return { success: "La invitación se envió por correo.", notice: null };
  if (status === "failed") return { success: null, notice: "El miembro está guardado, pero no se pudo enviar la invitación. El acceso por correo no está confirmado." };
  if (status === "not_configured") return { success: null, notice: "El miembro está guardado, pero el envío de invitaciones no está configurado. El acceso por correo no está confirmado." };
  return { success: null, notice: requested ? "El miembro está guardado. La API no confirmó el envío de una invitación; no se ha confirmado el acceso por correo." : null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeProfile(payload: Record<string, unknown>, fallback: unknown) {
  const base = isRecord(fallback) ? fallback : {};
  return {
    ...base,
    ...payload,
    alias: typeof payload.name === "string"
      ? payload.name
      : typeof payload.alias === "string"
        ? payload.alias
        : String(base.alias || ""),
  } satisfies Partial<BranchProfileSettings>;
}

function normalizeDelivery(payload: Record<string, unknown>, fallback: unknown) {
  const base = isRecord(fallback) ? fallback : {};
  const canonicalMode = String(payload.delivery_mode || payload.mode || base.mode || "free");
  const bands = Array.isArray(payload.bands)
    ? payload.bands
    : Array.isArray(payload.radii)
      ? payload.radii
      : [];
  const freeThreshold = payload.free_delivery_threshold;
  const minimumOrder = payload.minimum_order_amount;
  return {
    ...base,
    ...payload,
    mode: (canonicalMode === "bands" ? "radius" : canonicalMode) as DeliveryMode,
    fixed_fee: numberValue(payload.fixed_delivery_fee ?? payload.fixed_fee, numberValue(base.fixed_fee)),
    base_fee: numberValue(payload.distance_base_fee ?? payload.base_fee, numberValue(base.base_fee)),
    per_km_fee: numberValue(payload.distance_fee_per_km ?? payload.per_km_fee, numberValue(base.per_km_fee)),
    max_distance_km: numberValue(payload.distance_max_km ?? payload.max_distance_km, numberValue(base.max_distance_km, 10)),
    free_over_enabled: freeThreshold !== null && freeThreshold !== undefined
      ? numberValue(freeThreshold) > 0
      : Boolean(payload.free_over_enabled ?? base.free_over_enabled),
    free_over_amount: freeThreshold !== null && freeThreshold !== undefined
      ? numberValue(freeThreshold)
      : numberValue(payload.free_over_amount, numberValue(base.free_over_amount)),
    minimum_enabled: minimumOrder !== null && minimumOrder !== undefined
      ? numberValue(minimumOrder) > 0
      : Boolean(payload.minimum_enabled ?? base.minimum_enabled),
    minimum_amount: minimumOrder !== null && minimumOrder !== undefined
      ? numberValue(minimumOrder)
      : numberValue(payload.minimum_amount, numberValue(base.minimum_amount)),
    radii: bands.filter(isRecord).map((band) => ({
      id: typeof band.id === "number" ? band.id : undefined,
      from_km: numberValue(band.minimum_km ?? band.from_km),
      to_km: numberValue(band.maximum_km ?? band.to_km),
      fee: numberValue(band.fee),
    })),
    google_routes_configured: Boolean(payload.google_routes_configured ?? base.google_routes_configured),
    delivery_policy_supported: payload.delivery_policy_supported === true,
  } satisfies Partial<DeliverySettings>;
}

function paymentMethods(value: unknown, fallback: unknown): PaymentMethod[] {
  return Array.isArray(value) ? value.map(String) as PaymentMethod[] : Array.isArray(fallback) ? fallback as PaymentMethod[] : [];
}

function normalizePaymentMethods(payload: Record<string, unknown>, fallback: unknown) {
  const base = isRecord(fallback) ? fallback : {};
  const methods = isRecord(payload.payment_methods) ? payload.payment_methods : payload;
  return {
    ...base,
    version: numberValue(payload.version, numberValue(base.version)),
    delivery: paymentMethods(methods.delivery, base.delivery),
    pickup: paymentMethods(methods.takeaway ?? methods.pickup, base.pickup),
    counter: paymentMethods(methods.counter, base.counter),
  } satisfies Partial<PaymentMethodSettings>;
}

function normalizePrinting(payload: Record<string, unknown>, fallback: unknown) {
  const base = isRecord(fallback) ? fallback : {};
  const printer = isRecord(payload.printer_config) ? payload.printer_config : {};
  const customer = isRecord(payload.customer_ticket_template) ? payload.customer_ticket_template : {};
  const kitchen = isRecord(payload.kitchen_ticket_template) ? payload.kitchen_ticket_template : {};
  return {
    ...base,
    advanced_printing: Boolean(payload.advanced_printing ?? base.advanced_printing),
    automatic_printing: printer.automatic_printing !== false,
    operating_system: String(printer.operating_system ?? base.operating_system ?? "unknown"),
    printer_name: String(printer.printer_name ?? base.printer_name ?? ""),
    print_language: printer.print_language === "escpos" ? "escpos" : "pixel",
    paper_width_mm: numberValue(printer.paper_width_mm, numberValue(base.paper_width_mm, 80)),
    copies: numberValue(printer.copies, numberValue(base.copies, 1)),
    auto_print_kitchen: Boolean(printer.auto_print_kitchen ?? base.auto_print_kitchen),
    manual_customer_receipt: Boolean(printer.manual_customer_receipt ?? base.manual_customer_receipt),
    customer_ticket_fields: Array.isArray(customer.fields) ? customer.fields : base.customer_ticket_fields,
    kitchen_ticket_fields: Array.isArray(kitchen.fields) ? kitchen.fields : base.kitchen_ticket_fields,
    customer_ticket_font_size: printFontSize(customer.font_size),
    kitchen_ticket_font_size: printFontSize(kitchen.font_size),
    customer_ticket_header_enabled: customer.header_enabled === true,
    customer_ticket_header_text: typeof customer.header_text === "string" ? customer.header_text : "",
    customer_ticket_footer_enabled: customer.footer_enabled === true,
    customer_ticket_footer_text: typeof customer.footer_text === "string" ? customer.footer_text : "",
    version: numberValue(payload.version, numberValue(base.version)),
  } as Partial<PrintSettings>;
}

function printFontSize(value: unknown): "small" | "normal" | "large" {
  return value === "small" || value === "large" ? value : "normal";
}

export function printingTemplate(settings: PrintSettings, kind: "customer" | "kitchen"): ThermalPrintTemplate {
  if (kind === "kitchen") return {
    fields: settings.kitchen_ticket_fields,
    font_size: settings.kitchen_ticket_font_size ?? "normal",
  };
  return {
    fields: settings.customer_ticket_fields,
    font_size: settings.customer_ticket_font_size ?? "normal",
    header_enabled: settings.customer_ticket_header_enabled === true,
    header_text: settings.customer_ticket_header_text ?? "",
    footer_enabled: settings.customer_ticket_footer_enabled === true,
    footer_text: settings.customer_ticket_footer_text ?? "",
  };
}

function normalizeSchedule(value: unknown): ServiceSchedule | null {
  if (!isRecord(value)) return null;
  return {
    id: numberValue(value.id),
    name: String(value.name || ""),
    is_primary: value.kind === "primary" || value.is_primary === true,
    active: value.active !== false,
    shifts: Array.isArray(value.shifts) ? value.shifts.filter(isRecord).map((shift) => ({
      id: typeof shift.id === "number" ? shift.id : undefined,
      weekday: numberValue(shift.day_of_week ?? shift.weekday),
      starts_at: String(shift.starts_at || "09:00").slice(0, 5),
      ends_at: String(shift.ends_at || "17:00").slice(0, 5),
    })) : [],
    product_ids: Array.isArray(value.product_ids) ? value.product_ids.map(Number) : [],
    promotion_ids: Array.isArray(value.promotion_ids) ? value.promotion_ids.map(Number) : [],
    version: numberValue(value.version),
  };
}

function normalizeScheduleCollection(items: unknown[]): ScheduleSettings {
  const schedules = items.map(normalizeSchedule).filter((item): item is ServiceSchedule => Boolean(item));
  return { version: Math.max(0, ...schedules.map((item) => item.version)), schedules };
}

function normalizeAuditEntry(value: unknown): SecurityAuditEntry | null {
  if (!isRecord(value)) return null;
  const details = isRecord(value.payload) && typeof value.payload.message === "string" ? value.payload.message : null;
  return {
    id: numberValue(value.id),
    action: String(value.action || "acción registrada"),
    actor_name: String(value.actor_display_name || value.actor_name || value.actor_id || "Sistema"),
    occurred_at: String(value.created_at || value.occurred_at || new Date(0).toISOString()),
    branch_name: typeof value.branch_name === "string" ? value.branch_name : null,
    branch_id: typeof value.branch_id === "number" ? value.branch_id : null,
    summary: typeof value.summary === "string" ? value.summary : undefined,
    categories: Array.isArray(value.categories) ? value.categories.filter((category): category is string => typeof category === "string") : [],
    details,
  };
}

function normalizeDevice(value: unknown): PosDevice | null {
  if (!isRecord(value)) return null;
  return {
    id: numberValue(value.id),
    name: String(value.name || "Dispositivo"),
    branch_id: numberValue(value.branch_id),
    status: value.active === false ? "revoked" : value.paired ? "active" : "pending",
    last_used_at: typeof value.last_used_at === "string" ? value.last_used_at : null,
    version: numberValue(value.version),
  };
}

function normalizeSettingsPayload<T>(path: string, payload: unknown, fallback: T): T {
  if (Array.isArray(payload)) {
    if (/\/settings\/branches\/\d+\/schedules$/.test(path)) return { schedules: payload } as T;
    return payload as T;
  }
  if (!isRecord(payload)) return fallback;
  if (/\/settings\/branches\/\d+\/schedules$/.test(path) && Array.isArray(payload.items)) return normalizeScheduleCollection(payload.items) as T;
  if (Array.isArray(fallback) && Array.isArray(payload.items)) {
    if (/\/settings\/devices(?:\?|$)/.test(path)) return payload.items.map(normalizeDevice).filter(Boolean) as T;
    return payload.items as T;
  }
  if (/\/settings\/audit(?:\?|$)/.test(path) && Array.isArray(payload.items)) {
    return { ...payload, items: payload.items.map(normalizeAuditEntry).filter(Boolean) } as T;
  }
  if (/\/settings\/branches\/\d+\/profile$/.test(path)) return normalizeProfile(payload, fallback) as T;
  if (/\/settings\/branches\/\d+\/delivery$/.test(path)) return normalizeDelivery(payload, fallback) as T;
  if (/\/settings\/branches\/\d+\/payment-methods$/.test(path)) return normalizePaymentMethods(payload, fallback) as T;
  if (/\/settings\/branches\/\d+\/printing$/.test(path)) return normalizePrinting(payload, fallback) as T;
  return { ...(isRecord(fallback) ? fallback : {}), ...payload } as T;
}

function serializeProfile(input: Record<string, unknown>) {
  const payload = { ...input };
  if (typeof payload.alias === "string") payload.name = payload.alias;
  delete payload.alias;
  return payload;
}

function serializeDelivery(input: Record<string, unknown>) {
  const payload = { ...input };
  const mode = String(payload.mode || payload.delivery_mode || "free");
  const radii = Array.isArray(payload.radii) ? payload.radii.filter(isRecord) : [];
  payload.delivery_mode = mode === "radius" ? "bands" : mode;
  payload.fixed_delivery_fee = numberValue(payload.fixed_fee);
  payload.distance_base_fee = numberValue(payload.base_fee);
  payload.distance_fee_per_km = numberValue(payload.per_km_fee);
  payload.distance_max_km = numberValue(payload.max_distance_km);
  payload.free_delivery_threshold = payload.free_over_enabled ? numberValue(payload.free_over_amount) : null;
  payload.minimum_order_amount = payload.minimum_enabled ? numberValue(payload.minimum_amount) : null;
  payload.bands = radii.map((band) => ({
    ...(typeof band.id === "number" ? { id: band.id } : {}),
    minimum_km: numberValue(band.from_km ?? band.minimum_km),
    maximum_km: numberValue(band.to_km ?? band.maximum_km),
    fee: numberValue(band.fee),
    sort_order: radii.indexOf(band),
  }));
  for (const key of [
    "mode",
    "fixed_fee",
    "base_fee",
    "per_km_fee",
    "max_distance_km",
    "free_over_enabled",
    "free_over_amount",
    "minimum_enabled",
    "minimum_amount",
    "radii",
    "delivery_policy_supported",
    "pos_quotes_supported",
    "branch_origin",
    "google_routes_configured",
  ]) delete payload[key];
  return payload;
}

function serializePaymentMethods(input: Record<string, unknown>) {
  return {
    payment_methods: {
      delivery: input.delivery,
      takeaway: input.pickup,
      counter: input.counter,
    },
    expected_version: input.expected_version,
  };
}

function serializePrinting(input: Record<string, unknown>) {
  return {
    advanced_printing: input.advanced_printing,
    printer_config: {
      operating_system: input.operating_system,
      printer_name: input.printer_name,
      print_language: input.print_language ?? "pixel",
      paper_width_mm: input.paper_width_mm,
      copies: input.copies,
      auto_print_kitchen: input.auto_print_kitchen,
      manual_customer_receipt: input.manual_customer_receipt,
      automatic_printing: input.automatic_printing ?? true,
    },
    customer_ticket_template: {
      fields: input.customer_ticket_fields,
      font_size: input.customer_ticket_font_size,
      header_enabled: input.customer_ticket_header_enabled,
      header_text: input.customer_ticket_header_text,
      footer_enabled: input.customer_ticket_footer_enabled,
      footer_text: input.customer_ticket_footer_text,
    },
    kitchen_ticket_template: { fields: input.kitchen_ticket_fields, font_size: input.kitchen_ticket_font_size },
    expected_version: input.expected_version,
  };
}

function serializeSettingsPayload(path: string, input: Record<string, unknown>) {
  if (/\/settings\/branches\/\d+\/profile$/.test(path)) return serializeProfile(input);
  if (/\/settings\/branches\/\d+\/delivery$/.test(path)) return serializeDelivery(input);
  if (/\/settings\/branches\/\d+\/payment-methods$/.test(path)) return serializePaymentMethods(input);
  if (/\/settings\/branches\/\d+\/printing$/.test(path)) return serializePrinting(input);
  return input;
}

async function saveScheduleCollection<TOutput>(path: string, input: Record<string, unknown>): Promise<TOutput> {
  const schedules = Array.isArray(input.schedules) ? input.schedules.filter(isRecord) : [];
  const saved: ServiceSchedule[] = [];
  for (const schedule of schedules) {
    const shifts = Array.isArray(schedule.shifts) ? schedule.shifts.filter(isRecord).map((shift, index) => ({
      day_of_week: numberValue(shift.weekday ?? shift.day_of_week),
      starts_at: String(shift.starts_at || "09:00"),
      ends_at: String(shift.ends_at || "17:00"),
      sort_order: index,
    })) : [];
    const existing = numberValue(schedule.id) > 0;
    const response = await api<unknown>(existing ? `${path}/${schedule.id}` : path, {
      method: existing ? "PATCH" : "POST",
      body: JSON.stringify({
        name: schedule.name,
        ...(existing ? { active: schedule.active, expected_version: schedule.version } : { kind: schedule.is_primary ? "primary" : "additional" }),
        shifts,
      }),
      idempotencyKey: settingsIdempotencyKey("settings-schedule"),
    });
    let normalized = normalizeSchedule(response);
    if (!normalized) continue;
    if (!normalized.is_primary) {
      const assigned = await api<unknown>(`${path}/${normalized.id}/assignments`, {
        method: "PUT",
        body: JSON.stringify({
          product_ids: Array.isArray(schedule.product_ids) ? schedule.product_ids : [],
          promotion_ids: Array.isArray(schedule.promotion_ids) ? schedule.promotion_ids : [],
          expected_version: normalized.version,
        }),
        idempotencyKey: settingsIdempotencyKey("settings-schedule-assignments"),
      });
      normalized = normalizeSchedule(assigned) || normalized;
    }
    saved.push(normalized);
  }
  return normalizeScheduleCollection(saved) as TOutput;
}

export async function loadSettings<T>(path: string, fallback: T): Promise<SettingsLoadResult<T>> {
  try {
    const payload = await api<unknown>(path);
    const data = normalizeSettingsPayload(path, payload, fallback);
    return { data, available: true, message: null };
  } catch (error) {
    if (!isSettingsUnavailable(error)) throw error;
    return { data: fallback, available: false, message: SETTINGS_UNAVAILABLE };
  }
}

export async function saveSettings<TInput extends object, TOutput = TInput>(
  path: string,
  input: TInput,
  method: "POST" | "PATCH" | "PUT" = "PATCH",
  idempotencyKey?: string,
): Promise<TOutput> {
  if (/\/settings\/branches\/\d+\/schedules$/.test(path) && isRecord(input) && Array.isArray(input.schedules)) {
    return saveScheduleCollection<TOutput>(path, input);
  }
  const payload = serializeSettingsPayload(path, input as Record<string, unknown>);
  const response = await api<unknown>(path, {
    method,
    body: JSON.stringify(payload),
    idempotencyKey: idempotencyKey ?? settingsIdempotencyKey("settings-write"),
  });
  return normalizeSettingsPayload(path, response, input as unknown as TOutput);
}

export async function archiveSettingsResource(path: string, expectedVersion: number) {
  return api(path, {
    method: "DELETE",
    body: JSON.stringify({ expected_version: expectedVersion }),
    idempotencyKey: settingsIdempotencyKey("settings-archive"),
  });
}

export async function uploadSettingsMedia<T>(path: string, file: File, kind: "logo" | "cover", expectedVersion: number, idempotencyKey?: string) {
  const body = new FormData();
  body.append("file", file);
  body.append("media_kind", kind);
  body.append("expected_version", String(expectedVersion));
  const response = await api<unknown>(path, {
    method: "POST",
    body,
    idempotencyKey: idempotencyKey ?? settingsIdempotencyKey(`settings-${kind}`),
  });
  return normalizeSettingsPayload(path, response, {} as T);
}

export type GooglePlaceSuggestion = { place_id: string; text: string };
export type GooglePlaceDetails = {
  place_id: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  maps_url: string;
};

export async function searchGooglePlaces(branchId: number, input: string, sessionToken: string) {
  const query = new URLSearchParams({
    input,
    session_token: sessionToken,
    branch_id: String(branchId),
  });
  const response = await api<{ items?: GooglePlaceSuggestion[] }>(`/settings/places/autocomplete?${query}`);
  return Array.isArray(response.items) ? response.items : [];
}

export async function loadGooglePlace(branchId: number, placeId: string, sessionToken: string) {
  const query = new URLSearchParams({
    session_token: sessionToken,
    branch_id: String(branchId),
  });
  return api<GooglePlaceDetails>(`/settings/places/${encodeURIComponent(placeId)}?${query}`);
}

export { qzBridge } from "./qz-tray";

export { SETTINGS_UNAVAILABLE };
