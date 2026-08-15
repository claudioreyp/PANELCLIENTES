export type Business = {
  id: number;
  slug: string;
  name: string;
  status: string;
  plan: string;
  currency: string;
  timezone: string;
  logo_url?: string | null;
  phone?: string | null;
  modules: Record<string, boolean>;
};

export type Branch = {
  id: number;
  business_id: number;
  slug: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  opening_hours: Record<string, unknown>;
  accepted_payment_methods: string[];
  delivery_enabled: boolean;
  takeaway_enabled: boolean;
  delivery_fee: number;
  yape_number?: string | null;
  plin_number?: string | null;
  payment_recipient_name?: string | null;
  maps_url?: string | null;
  yape_qr_storage_path?: string | null;
  active: boolean;
};

export type RestaurantContext = { business: Business; branches: Branch[] };
export type Category = { id: number; name: string; color: string; sort_order: number };
export type Modifier = { id: number; name: string; price_delta: number };
export type ModifierGroup = { id: number; name: string; minimum: number; maximum: number; required: boolean; modifiers: Modifier[] };
export type Product = {
  id: number;
  category_id: number | null;
  sku: string;
  name: string;
  description?: string | null;
  price: number;
  image_url?: string | null;
  available: boolean;
  track_stock: boolean;
  preparation_station: string;
  variants: { id: number; name: string; price_delta: number }[];
  modifier_groups: ModifierGroup[];
};
export type Catalog = { branch: Branch; categories: Category[]; products: Product[] };

export type OrderItem = {
  id: number;
  product_id: number | null;
  name: string;
  variant_name?: string | null;
  quantity: number;
  unit_price: number;
  modifiers: { modifier_id?: number; name: string; price_delta: number }[];
  notes?: string | null;
  status: string;
  line_total: number;
};

export type Order = {
  id: number;
  business_id: number;
  branch_id: number;
  number: string;
  channel: string;
  source: string;
  status: string;
  payment_status: string;
  payment_method?: string | null;
  table_id?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  whatsapp_chat_id?: string | null;
  whatsapp_message_id?: string | null;
  delivery_address?: Record<string, unknown> | null;
  subtotal: number;
  discount: number;
  delivery_fee: number;
  total: number;
  notes?: string | null;
  version: number;
  submitted_at?: string | null;
  sent_to_kitchen_at?: string | null;
  closed_at?: string | null;
  created_at: string;
  items: OrderItem[];
};

export type PaymentEvidence = {
  id: number;
  order_id: number;
  provider: string;
  amount_detected?: number | null;
  operation_number?: string | null;
  security_code?: string | null;
  whatsapp_message_id?: string | null;
  occurred_at?: string | null;
  recipient?: string | null;
  confidence?: number | null;
  status: string;
  rejection_reason?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  warnings: string[];
  image_url: string;
  created_at: string;
};

export type RestaurantTable = {
  id: number;
  branch_id: number;
  area_id?: number | null;
  code: string;
  name: string;
  capacity: number;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  shape: string;
  status: "available" | "reserved" | "occupied" | "cleaning";
  version: number;
};

export type KitchenTicket = {
  id: number;
  order_id: number;
  station: string;
  status: "queued" | "preparing" | "ready" | "served" | "cancelled";
  items: { item_id: number; name: string; quantity: number; notes?: string }[];
  print_count: number;
  created_at: string;
  fired_at?: string;
  started_at?: string | null;
  ready_at?: string | null;
};

export type InventoryItem = {
  id: number;
  sku: string;
  name: string;
  unit: string;
  quantity: number;
  minimum_stock: number;
  unit_cost: number;
  low_stock: boolean;
  version: number;
};

export type Reservation = {
  id: number;
  customer_name: string;
  customer_phone: string;
  party_size: number;
  start_at: string;
  end_at: string;
  status: string;
  table_ids: number[];
  source: string;
  notes?: string | null;
  version: number;
};
