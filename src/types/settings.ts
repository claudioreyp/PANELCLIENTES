export type SettingsSectionSlug =
  | "general"
  | "agente"
  | "sucursal"
  | "servicios"
  | "delivery"
  | "miembros"
  | "seguridad"
  | "zonas"
  | "cajas"
  | "impresion"
  | "metodos-de-pago"
  | "tiempos-de-entrega"
  | "horarios"
  | "whatsapp";

export type VersionedSettings = { version: number };

export type BusinessSettings = VersionedSettings & {
  id: number;
  name: string;
  currency: "PEN" | string;
  country_code: "PE" | string;
  timezone: string;
};

export type BranchProfileSettings = VersionedSettings & {
  id: number;
  alias: string;
  address: string;
  maps_url: string;
  google_place_id: string;
  latitude: number | null;
  longitude: number | null;
  logo_url: string | null;
  cover_url: string | null;
  active: boolean;
};

export type ServiceSettings = VersionedSettings & {
  pos_tables: boolean;
  pos_counter: boolean;
  pos_takeaway: boolean;
  pos_delivery: boolean;
  digital_tables: boolean;
  digital_takeaway: boolean;
  digital_delivery: boolean;
};

export type DeliveryMode = "free" | "fixed" | "radius" | "distance" | "quote" | "neighborhoods";

export type DeliveryOrigin = { latitude: number; longitude: number; maps_url: string };
export type DeliveryPolicy = {
  neighborhoods: { name: string; fee: number }[];
  origin: DeliveryOrigin | null;
  outside_band_mode: "reject" | "quote";
};

export type DeliveryRadius = {
  id?: number;
  from_km: number;
  to_km: number;
  fee: number;
};

export type DeliverySettings = VersionedSettings & {
  mode: DeliveryMode;
  fixed_fee: number;
  base_fee: number;
  per_km_fee: number;
  max_distance_km: number;
  free_over_enabled: boolean;
  free_over_amount: number;
  minimum_enabled: boolean;
  minimum_amount: number;
  radii: DeliveryRadius[];
  google_routes_configured: boolean;
  delivery_policy?: DeliveryPolicy;
  delivery_policy_supported?: boolean;
  branch_origin?: DeliveryOrigin | null;
};

export type StaffRole =
  | "owner"
  | "members_manager"
  | "manager"
  | "menu_manager"
  | "cashier"
  | "waiter"
  | "kitchen"
  | "dispatcher";

export type SettingsMember = VersionedSettings & {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  email_access: boolean;
  roles: StaffRole[];
  branch_ids: number[];
  all_branches: boolean;
  active: boolean;
  is_current_user?: boolean;
  capabilities?: { can_edit: boolean; can_archive: boolean };
};

export type MemberCapabilities = {
  assignable_roles: StaffRole[];
  can_manage_admins: boolean;
};

export type SettingsMembers = PagedSettings<SettingsMember> & {
  capabilities?: MemberCapabilities;
};

export type MemberSaveResult = SettingsMember & {
  invitation?: { delivery_status?: string } | null;
};

export type PosDevice = VersionedSettings & {
  id: number;
  name: string;
  branch_id: number;
  status: "active" | "revoked" | "pending";
  last_used_at: string | null;
};

export type SecurityAuditEntry = {
  id: number;
  action: string;
  actor_name: string;
  occurred_at: string;
  branch_name?: string | null;
  details?: string | null;
  branch_id?: number | null;
  summary?: string;
  categories?: string[];
};

export type SecurityAuditField = { label: string; value: string | null };
export type SecurityAuditDetail = {
  id: number;
  branch_id: number | null;
  actor_name: string;
  occurred_at: string;
  summary: string;
  fields: SecurityAuditField[];
  sections: { title: string; fields: SecurityAuditField[] }[];
  target: null | {
    kind: "order" | "cash_movement";
    branch_id: number;
    label: string;
    order_id?: number;
    register_id?: number;
    movement_id?: number;
  };
};

export type SettingsTable = VersionedSettings & {
  id: number;
  name: string;
  code: string;
  capacity: number;
  active: boolean;
};

export type SettingsArea = VersionedSettings & {
  id: number;
  name: string;
  active: boolean;
  tables: SettingsTable[];
};

export type SettingsRegister = VersionedSettings & {
  id: number;
  name: string;
  is_default: boolean;
  active: boolean;
  has_open_session: boolean;
};

export type TicketField = {
  key: string;
  label: string;
  enabled: boolean;
};

export type PrintSettings = VersionedSettings & {
  advanced_printing: boolean;
  automatic_printing?: boolean;
  operating_system: "windows" | "macos" | "linux" | "unknown";
  printer_name: string;
  print_language?: "pixel" | "escpos";
  paper_width_mm: 58 | 80;
  copies: number;
  auto_print_kitchen: boolean;
  manual_customer_receipt: boolean;
  customer_ticket_fields: TicketField[];
  kitchen_ticket_fields: TicketField[];
  customer_ticket_font_size?: "small" | "normal" | "large";
  kitchen_ticket_font_size?: "small" | "normal" | "large";
  customer_ticket_header_enabled?: boolean;
  customer_ticket_header_text?: string;
  customer_ticket_footer_enabled?: boolean;
  customer_ticket_footer_text?: string;
};

export type PaymentMethod = "cash" | "card" | "transfer" | "yape" | "plin";

export type PaymentMethodSettings = VersionedSettings & {
  delivery: PaymentMethod[];
  pickup: PaymentMethod[];
  counter: PaymentMethod[];
};

export type DeliveryTimeSettings = VersionedSettings & {
  delivery_min_minutes: number;
  delivery_max_minutes: number;
  pickup_minutes: number;
};

export type ScheduleShift = {
  id?: number;
  weekday: number;
  starts_at: string;
  ends_at: string;
};

export type ServiceSchedule = VersionedSettings & {
  id: number;
  name: string;
  is_primary: boolean;
  active: boolean;
  shifts: ScheduleShift[];
  product_ids: number[];
  promotion_ids: number[];
};

export type ScheduleSettings = VersionedSettings & {
  schedules: ServiceSchedule[];
};

export type WhatsAppSettings = {
  number: string | null;
  status: "linked" | "pending" | "disconnected" | "unknown";
  provider: "meta" | "qr_gateway" | "unknown";
  last_synced_at: string | null;
};

export type PagedSettings<T> = {
  items: T[];
  page: number;
  page_size: number;
  total: number;
};

export type SettingsLoadResult<T> = {
  data: T;
  available: boolean;
  message: string | null;
};

export type QzConnectionState =
  | "idle"
  | "loading"
  | "permission"
  | "connecting"
  | "connected"
  | "not-installed"
  | "not-open"
  | "denied"
  | "error";
