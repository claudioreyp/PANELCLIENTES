import { api, ApiError } from "./api";
import { parsePosDate } from "./pos-dates";
import { isActiveOrderItem } from "./order-presentation";
import type {
  KitchenTicket,
  Order,
  OrderDetail,
  OrderPayment,
  OrderItemsMutationResponse,
  OrderWorkspaceItem,
  OrderWorkspaceResponse,
  PaymentEvidence,
} from "../types";

type WrappedOrderDetailApiResponse = {
  table_context?: OrderDetail["table_context"];
  cancellation_reason?: string | null;
  edit_policy?: OrderDetail["edit_policy"];
  order: Order;
  payments?: OrderPayment[];
  payment_evidence?: PaymentEvidence[];
  tickets?: KitchenTicket[];
  payment_summary?: {
    paid?: number;
    remaining?: number;
  };
};

type LegacyOrderDetailApiResponse = Order & {
  table_context?: OrderDetail["table_context"];
  cancellation_reason?: string | null;
  payments?: OrderPayment[];
  payment_evidence?: PaymentEvidence | PaymentEvidence[] | null;
  kitchen_tickets?: KitchenTicket[];
  tickets?: KitchenTicket[];
  paid_amount?: number;
  remaining_amount?: number;
};

type OrderDetailApiResponse = WrappedOrderDetailApiResponse | LegacyOrderDetailApiResponse;

export type IdempotentIntent = {
  signature: string;
  key: string;
  body: string;
};

export function resolveIdempotentIntent(
  current: IdempotentIntent | null,
  signature: string,
  body: string,
  createKey: () => string = () => crypto.randomUUID(),
): IdempotentIntent {
  if (current?.signature === signature) return current;
  return { signature, body, key: createKey() };
}

type WorkspaceQuery = {
  branchId: number;
  day?: string;
  period?: "day" | "all";
  view?: "orders" | "table_history";
  search: string;
  page: number;
  pageSize: number;
  timezone: string;
};

function isSubmittedOrder(order: Order) {
  if (!order.source.toLowerCase().includes("n8n") && order.source !== "whatsapp_agent") return true;
  return Boolean(order.submitted_at || order.status !== "draft");
}

function localDay(isoValue: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsePosDate(isoValue));
}

function toWorkspaceItem(order: Order): OrderWorkspaceItem {
  return {
    id: order.id,
    number: order.number,
    folio: order.folio,
    customer_name: order.customer_name,
    customer_phone: order.customer_phone,
    channel: order.channel,
    source: order.source,
    created_at: order.created_at,
    status: order.status,
    payment_status: order.payment_status,
    total: Number(order.total),
    delivery_fee: Number(order.delivery_fee),
    requires_review: ["evidence_received", "under_review"].includes(order.payment_status),
    item_count: order.items.filter(isActiveOrderItem).reduce((sum, item) => sum + item.quantity, 0),
    version: order.version,
  };
}

function unsupportedContract(caught: unknown): boolean {
  return caught instanceof ApiError
    && caught.status === 404
    && caught.code === "API_CONTRACT_UNSUPPORTED";
}

export async function loadOrdersWorkspace(query: WorkspaceQuery): Promise<OrderWorkspaceResponse> {
  const params = new URLSearchParams({
    branch_id: String(query.branchId),
    page: String(query.page),
    page_size: String(query.pageSize),
  });
  const period = query.period ?? "day";
  const view = query.view ?? "orders";
  params.set("period", period);
  params.set("view", view);
  if (period === "day" && query.day) params.set("day", query.day);
  if (query.search.trim()) params.set("search", query.search.trim());
  try {
    const response = await api<OrderWorkspaceResponse>(`/orders/workspace?${params}`);
    if ((period === "all" || view === "table_history") && (response.period !== period || response.view !== view)) {
      throw new Error("Actualiza la API del POS para consultar el historial completo. No se mostrará un listado parcial.");
    }
    return { ...response, branch_id: query.branchId };
  } catch (caught) {
    if (!unsupportedContract(caught)) throw caught;
    if (period === "all" || view === "table_history") {
      throw new Error("La API del POS no admite el historial completo. Actualízala e inténtalo nuevamente.");
    }
  }

  const fallbackParams = new URLSearchParams({ branch_id: String(query.branchId), limit: "200" });
  const orders = (await api<Order[]>(`/orders?${fallbackParams}`))
    .filter(isSubmittedOrder)
    .filter((order) => localDay(order.created_at, query.timezone) === query.day)
    .filter((order) => matchesOrderSearch(order, query.search))
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
  const start = (query.page - 1) * query.pageSize;
  const items = orders.slice(start, start + query.pageSize).map(toWorkspaceItem);
  return {
    branch_id: query.branchId,
    items,
    page: query.page,
    page_size: query.pageSize,
    total: orders.length,
    review_count: orders.filter((order) => ["evidence_received", "under_review"].includes(order.payment_status)).length,
  };
}

async function optionalList<T>(path: string): Promise<T[]> {
  try {
    return await api<T[]>(path);
  } catch (caught) {
    if (unsupportedContract(caught)) return [];
    throw caught;
  }
}

function latestEvidence(evidence: PaymentEvidence[]): PaymentEvidence | null {
  return [...evidence].sort((left, right) => {
    const timeDifference = new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
    return timeDifference || right.id - left.id;
  })[0] || null;
}

export function normalizeKitchenTicket(ticket: KitchenTicket): KitchenTicket {
  return { ...ticket, version: ticket.version ?? 1 };
}

export function matchesOrderSearch(order: Pick<Order, "folio" | "number" | "customer_name" | "customer_phone">, search: string) {
  const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
  const query = normalize(search).replace(/^#/, "");
  return !query || [order.folio == null ? "" : String(order.folio), order.number, order.customer_name || "", order.customer_phone || ""].some((value) => normalize(value).includes(query));
}

function orderedTickets(tickets: KitchenTicket[]): KitchenTicket[] {
  return tickets.map(normalizeKitchenTicket).sort((left, right) => {
    const leftSequence = left.sequence ?? Number.MAX_SAFE_INTEGER;
    const rightSequence = right.sequence ?? Number.MAX_SAFE_INTEGER;
    if (leftSequence !== rightSequence) return leftSequence - rightSequence;
    return left.created_at.localeCompare(right.created_at) || left.id - right.id;
  });
}

export function mergeOrderItemsMutation(current: OrderDetail, response: OrderItemsMutationResponse): OrderDetail {
  if (current.id !== response.order.id || current.branch_id !== response.order.branch_id || current.version > response.order.version) return current;
  const tickets = new Map(current.kitchen_tickets.map((ticket) => [ticket.id, ticket]));
  for (const ticket of response.tickets) {
    const previous = tickets.get(ticket.id);
    if (!previous || (previous.version ?? 1) <= (ticket.version ?? 1)) tickets.set(ticket.id, ticket);
  }
  return { ...current, ...response.order, kitchen_tickets: orderedTickets([...tickets.values()]), remaining_amount: Math.max(0, response.order.total - current.paid_amount) };
}

export function normalizeOrderDetailResponse(response: OrderDetailApiResponse): OrderDetail {
  const wrapped = "order" in response;
  const order = wrapped ? response.order : response;
  const payments = response.payments ?? [];
  const evidence = response.payment_evidence == null
    ? []
    : Array.isArray(response.payment_evidence) ? response.payment_evidence : [response.payment_evidence];
  const tickets = wrapped
    ? response.tickets ?? []
    : response.kitchen_tickets ?? response.tickets ?? [];
  const summary = wrapped ? response.payment_summary : undefined;
  const paidAmount = Number(summary?.paid ?? (!wrapped ? response.paid_amount : undefined) ?? payments
    .filter((payment) => payment.status === "confirmed")
    .reduce((sum, payment) => sum + Number(payment.amount), 0));
  const remainingAmount = Number(summary?.remaining
    ?? (!wrapped ? response.remaining_amount : undefined)
    ?? Math.max(0, Number(order.total) - paidAmount));
  return {
    ...order,
    table_context: response.table_context,
    cancellation_reason: response.cancellation_reason,
    edit_policy: wrapped ? response.edit_policy : undefined,
    payments,
    payment_evidence: latestEvidence(evidence),
    kitchen_tickets: orderedTickets(tickets),
    paid_amount: paidAmount,
    remaining_amount: remainingAmount,
  };
}

export async function loadOrderDetail(orderId: number, branchId: number, requireComplete = false): Promise<OrderDetail> {
  try {
    const response = await api<OrderDetailApiResponse>(`/orders/${orderId}/detail`);
    const detail = normalizeOrderDetailResponse(response);
    if (detail.id !== orderId) throw new Error("La respuesta no corresponde al pedido solicitado.");
    if (detail.branch_id !== branchId) throw new Error("El pedido no pertenece a la sucursal seleccionada.");
    return detail;
  } catch (caught) {
    if (!unsupportedContract(caught)) throw caught;
    if (requireComplete) throw new Error("La API del POS no admite el detalle histórico completo. Actualízala e inténtalo nuevamente.");
  }

  const [order, evidence, tickets] = await Promise.all([
    api<Order>(`/orders/${orderId}`),
    optionalList<PaymentEvidence>(`/payment-evidence?branch_id=${branchId}`),
    optionalList<KitchenTicket>(`/kitchen/tickets?branch_id=${branchId}`),
  ]);
  if (order.id !== orderId || order.branch_id !== branchId) throw new Error("El pedido no pertenece a la sucursal seleccionada.");
  return {
    ...order,
    payments: [],
    payment_evidence: latestEvidence(evidence.filter((item) => item.order_id === order.id)),
    kitchen_tickets: orderedTickets(tickets.filter((ticket) => ticket.order_id === order.id)),
    paid_amount: order.payment_status === "paid" ? order.total : 0,
    remaining_amount: order.payment_status === "paid" ? 0 : order.total,
  };
}
