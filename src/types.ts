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
  yape_qr_configured?: boolean;
  menu_card_configured?: boolean;
  agent_context_notes?: string | null;
  active: boolean;
};

export type RestaurantContext = { business: Business; branches: Branch[]; role?: string; roles?: string[] };
export type Category = { id: number; name: string; color: string; sort_order: number; active: boolean };
export type ProductVariant = { id: number; name: string; price_delta: number; active: boolean; available?: boolean };
export type ProductServiceChannel =
  | "pos_tables"
  | "pos_counter"
  | "pos_takeaway"
  | "pos_delivery"
  | "digital_tables"
  | "digital_takeaway"
  | "digital_delivery";
export type PromotionType = "product_discount" | "buy_x_pay_y";
export type PromotionDiscountType = "percentage" | "fixed_amount";
export type PromotionTargetScope = "products" | "categories";
export type Promotion = {
  id: number;
  business_id: number;
  branch_id: number;
  name: string;
  promotion_type: PromotionType;
  discount_type?: PromotionDiscountType | null;
  discount_value?: number | null;
  receive_quantity?: number | null;
  pay_quantity?: number | null;
  target_scope: PromotionTargetScope;
  target_ids: number[];
  starts_on?: string | null;
  ends_on?: string | null;
  weekdays: number[];
  service_channels: ProductServiceChannel[];
  active: boolean;
  sort_order: number;
  archived_at?: string | null;
  version: number;
  created_at?: string;
  updated_at?: string;
};
export type Modifier = {
  id: number;
  name: string;
  price_delta: number;
  active: boolean;
  available?: boolean;
  sort_order: number;
};
export type ModifierGroup = {
  id: number;
  branch_id: number;
  name: string;
  internal_label?: string | null;
  minimum: number;
  maximum: number | null;
  required: boolean;
  allow_repeats: boolean;
  max_per_option?: number | null;
  sort_order: number;
  modifiers: Modifier[];
};
export type CatalogIngredient = { id: number; sku: string; name: string; unit: string; active: boolean };
export type RecipeComponent = { inventory_item_id: number; name: string; unit: string; quantity: number };
export type ComboComponent = { product_id: number; name: string; quantity: number; sort_order: number };
export type Product = {
  id: number;
  category_id: number | null;
  sku: string;
  name: string;
  description?: string | null;
  price: number;
  image_url?: string | null;
  service_channels: ProductServiceChannel[];
  product_type: "standard" | "combo";
  available: boolean;
  unavailable_reason?: string | null;
  track_stock: boolean;
  preparation_station: string;
  sort_order: number;
  variants: ProductVariant[];
  modifier_groups: ModifierGroup[];
  recipe: RecipeComponent[];
  combo_components: ComboComponent[];
};
export type Catalog = {
  branch: Branch;
  categories: Category[];
  products: Product[];
  modifier_groups: ModifierGroup[];
  ingredients: CatalogIngredient[];
  promotions: Promotion[];
};

export type OrderModifierSnapshot = {
  removed_quantity?: number;
  modifier_id?: number;
  name: string;
  price_delta: number;
  group_id?: number;
  group_name?: string;
};

export type OrderItem = {
  id: number;
  product_id: number | null;
  name: string;
  variant_name?: string | null;
  quantity: number;
  unit_price: number;
  modifiers: OrderModifierSnapshot[];
  notes?: string | null;
  status: string;
  replaces_item_id?: number | null;
  cancellation_reason?: string | null;
  line_total: number;
  promotion_discount?: number;
  promotion_snapshot?: Record<string, unknown> | null;
};

export type Order = {
  id: number;
  business_id: number;
  branch_id: number;
  number: string;
  folio?: number | null;
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
  manual_discount?: number;
  promotion_discount?: number;
  applied_promotions?: Record<string, unknown>[];
  delivery_fee: number;
  delivery_fee_status?: "pending_quote" | "final";
  final_total?: number | null;
  total: number;
  notes?: string | null;
  version: number;
  submitted_at?: string | null;
  sent_to_kitchen_at?: string | null;
  checkout_started_at?: string | null;
  table_released_at?: string | null;
  closed_at?: string | null;
  created_at: string;
  items: OrderItem[];
};

export type OrderWorkspaceItem = {
  id: number;
  number: string;
  folio?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  channel: string;
  source: string;
  created_at: string;
  status: string;
  payment_status: string;
  paid_amount?: number;
  total: number;
  delivery_fee: number;
  delivery_fee_status?: "pending_quote" | "final";
  requires_review: boolean;
  item_count: number;
  version: number;
};

export type OrderWorkspaceResponse = {
  branch_id?: number;
  period?: "day" | "all";
  view?: "orders" | "table_history";
  items: OrderWorkspaceItem[];
  page: number;
  page_size: number;
  total: number;
  review_count: number;
};

export type OrderPayment = {
  id: number;
  order_id: number;
  method: string;
  amount: number;
  status: string;
  created_at: string;
  received_at?: string;
  cash_register_name?: string | null;
};

export type OrderDetail = Order & {
  table_context?: { table_id: number | null; table_name: string | null; area_id?: number | null; area_name?: string | null } | null;
  cancellation_reason?: string | null;
  edit_policy?: { can_edit: boolean; fulfillment_locked: boolean; reason: string | null };
  payments: OrderPayment[];
  payment_evidence?: PaymentEvidence | null;
  payment_evidences?: PaymentEvidence[];
  payment_requests?: OrderPaymentRequest[];
  kitchen_tickets: KitchenTicket[];
  paid_amount: number;
  remaining_amount: number;
};

export type PaymentEvidence = {
  id: number;
  order_id: number;
  provider: string;
  payment_request_id?: string | null;
  expected_amount?: number | null;
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

export type OrderPaymentRequest = {
  id: string;
  order_id: number;
  purpose: "addition" | "delivery";
  method: "cash" | "yape" | "unselected";
  amount: number;
  status: string;
  version: number;
  items: { name: string; quantity: string; variant_name?: string | null }[];
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
  active_order_id?: number | null;
};

export type KitchenTicket = {
  id: number;
  order_id: number;
  order_number?: string;
  order_folio?: number | null;
  version?: number;
  channel?: string;
  customer_name?: string | null;
  table_id?: number | null;
  table_name?: string | null;
  source?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  sequence?: number;
  station: string;
  kind?: "standard" | "addition" | "modification" | "cancellation" | "revision" | string;
  context?: Record<string, unknown>;
  status: "queued" | "preparing" | "ready" | "served" | "cancelled";
  items: KitchenCommandItem[];
  print_count: number;
  created_at: string;
  fired_at?: string;
  started_at?: string | null;
  ready_at?: string | null;
};

export type KitchenCommandItem = {
  item_id: number;
  name: string;
  variant_name?: string | null;
  quantity: number;
  notes?: string | null;
  status?: string;
  action?: "modified" | "cancelled" | string;
  replaces_item_id?: number | null;
  previous_item_id?: number | null;
  previous_name?: string | null;
  previous_quantity?: number | null;
  previous_variant_name?: string | null;
  modified_at?: string | null;
  cancellation_reason?: string | null;
  modifiers?: (Omit<OrderModifierSnapshot, "price_delta"> & { price_delta?: number })[];
  removed_modifiers?: (Omit<OrderModifierSnapshot, "price_delta"> & { price_delta?: number })[];
  line_total?: number;
  promotion_discount?: number;
  combo_components?: { product_id: number; name: string; quantity: number }[];
};

export type KitchenCommandResponse = {
  items: KitchenTicket[];
  total: number;
  page: number;
  page_size: number;
  active_count: number;
  view: "active" | "history";
};

export type OrderItemsMutationResponse = {
  order: Order;
  tickets: KitchenTicket[];
  created_ticket_ids?: number[];
  updated_ticket_ids?: number[];
};

export type OrderItemRevisionOperation =
  | {
      type: "edit";
      item_id: number;
      replacement: {
        product_id: number;
        quantity: number;
        variant_name?: string | null;
        modifiers?: { modifier_id?: number; name: string; price_delta: number }[];
        notes?: string | null;
      };
    }
  | {
      type: "cancel";
      item_id: number;
      reason: string;
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
