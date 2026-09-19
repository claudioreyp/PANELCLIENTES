import type { Order, OrderWorkspaceItem } from "../../src/types";

export const historyAreas = [
  { id: 51, branch_id: 1, name: "Sala principal", sort_order: 0, columns: 7, rows: 5, version: 1 },
  { id: 52, branch_id: 1, name: "Terraza", sort_order: 1, columns: 7, rows: 5, version: 1 },
];

export const historyTables = [101, 102, 103].map((id, index) => ({
  id, branch_id: 1, area_id: index === 0 ? 51 : 52, code: `MESA-${index + 1}`, name: `Mesa ${index + 1}`,
  capacity: 4, position_x: index * 124, position_y: 24, row: 0, column: index,
  width: 92, height: 76, shape: "square", status: id === 103 ? "occupied" : "available",
  version: 1, active_order_id: id === 103 ? 300 : null,
}));

function makeOrder(id: number, overrides: Partial<Order> = {}): Order {
  return {
    id, business_id: 1, branch_id: 1, folio: id, number: `HISTORY-${id}`, channel: "dine_in", source: "pos",
    table_id: 101, customer_name: `Cliente archivo ${id}`, customer_phone: `+51999000${id}`,
    status: "closed", payment_status: "paid", payment_method: "cash", subtotal: 32, discount: 0,
    delivery_fee: 0, total: 32, version: 4, created_at: "2026-09-08T14:00:00-05:00",
    table_released_at: "2026-09-08T15:00:00-05:00",
    items: [{ id: id * 10, product_id: 20, name: "Pizza clasica", quantity: 1, unit_price: 24, line_total: 24, status: "served", modifiers: [], notes: "Sin cebolla" },
      { id: id * 10 + 1, product_id: 21, name: "Limonada", quantity: 1, unit_price: 8, line_total: 8, status: "served", modifiers: [] }],
    ...overrides,
  };
}

// Deliberately unsorted, with another branch and an unreleased table to catch scope/filter mistakes.
export const historyOrders = [
  ...Array.from({ length: 15 }, (_, index) => makeOrder(201 + index, {
    customer_name: index === 0 ? "Cuenta pagada de sala" : index === 1 ? "Cuenta cancelada de terraza" : index === 2 ? "Cancelada con cobro" : index === 14 ? "Archivo de 2023" : `Cliente archivo ${201 + index}`,
    table_id: index % 2 === 0 ? 101 : 102,
    created_at: index < 3 ? `2026-09-08T${14 - index}:00:00-05:00` : index === 14 ? "2023-01-12T12:00:00-05:00" : `2026-08-${String(30 - index).padStart(2, "0")}T12:00:00-05:00`,
    status: index === 0 ? "preparing" : index === 1 || index === 2 ? "cancelled" : "closed",
    payment_status: index === 1 ? "pending" : "paid",
    source: index === 1 ? "public_menu" : index === 2 ? "whatsapp_agent" : "pos",
    table_released_at: index === 1 ? null : "2026-09-08T15:00:00-05:00",
  })).reverse(),
  makeOrder(900, { branch_id: 2, customer_name: "Otra sucursal excluida", created_at: "2026-09-09T16:00:00-05:00" }),
  makeOrder(300, { table_id: 103, customer_name: "Mesa aun abierta", status: "preparing", payment_status: "pending", table_released_at: null, created_at: "2026-09-09T12:00:00-05:00" }),
  makeOrder(302, { table_id: null, channel: "takeaway", customer_name: "Recojo reciente", created_at: "2026-09-09T13:00:00-05:00" }),
  makeOrder(301, { table_id: null, channel: "counter", customer_name: "Mostrador reciente", created_at: "2026-09-09T14:00:00-05:00" }),
];

export function historyWorkspace(url: URL) {
  const view = url.searchParams.get("view") || "orders";
  const search = (url.searchParams.get("search") || "").toLocaleLowerCase("es-PE");
  const page = Number(url.searchParams.get("page") || 1);
  const pageSize = Number(url.searchParams.get("page_size") || 12);
  const rows = historyOrders.filter((order) => order.branch_id === Number(url.searchParams.get("branch_id")))
    .filter((order) => view !== "table_history" || (order.table_id && (order.status === "cancelled" || (order.payment_status === "paid" && order.table_released_at))))
    .filter((order) => `${order.folio} ${order.number} ${order.customer_name} ${order.customer_phone}`.toLocaleLowerCase("es-PE").includes(search))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
  const items: OrderWorkspaceItem[] = rows.slice((page - 1) * pageSize, page * pageSize).map((order) => ({
    ...order, paid_amount: order.payment_status === "paid" ? order.total : 0, requires_review: false, item_count: order.items.length,
  }));
  return { items, total: rows.length, review_count: 0, page, page_size: pageSize, branch_id: 1, period: url.searchParams.get("period") || "day", view };
}

export function historyDetail(id: number) {
  const order = historyOrders.find((candidate) => candidate.id === id && candidate.branch_id === 1);
  if (!order) return null;
  const paid = order.payment_status === "paid" ? order.total : 0;
  return {
    order,
    table_context: order.table_id ? { table_id: order.table_id, table_name: order.table_id === 101 ? "Mesa 1 historica" : "Mesa 2 historica" } : null,
    cancellation_reason: id === 202 ? "Cliente retiro su solicitud antes de preparar" : id === 203 ? "Cancelado despues del cobro por solicitud del cliente" : null,
    payments: paid ? [{ id: id + 1000, order_id: id, method: "cash", amount: paid, status: "confirmed", cash_register_name: "Caja terraza historica", created_at: order.created_at, received_at: order.created_at }] : [],
    payment_evidence: [],
    payment_summary: { paid, remaining: order.status === "cancelled" ? 0 : order.total - paid },
    tickets: order.items.map((item, index) => ({
      id: id * 10 + index, order_id: id, order_number: order.number, order_folio: order.folio,
      sequence: index + 1, station: index === 0 ? "kitchen" : "bar", status: id === 201 ? "preparing" : order.status === "cancelled" ? "cancelled" : "ready",
      version: 1, source: order.source, created_by_name: "Equipo de prueba", print_count: 0,
      created_at: order.created_at, items: [{ ...item, item_id: item.id }],
    })),
  };
}
