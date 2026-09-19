import type { OrderDetail } from "../types";
import type { ThermalDocumentOptions } from "./thermal-print";

export type ThermalPrintSampleOptions = Pick<ThermalDocumentOptions, "businessName" | "branchName" | "paperWidth" | "template"> & {
  kitchen?: boolean;
  short?: boolean;
};

/** In-memory fixture only: no sale, catalog, payment or registered actor is consulted. */
export function createThermalPrintSample({ businessName, branchName, paperWidth, template, kitchen = false, short = false }: ThermalPrintSampleOptions): ThermalDocumentOptions {
  const order: OrderDetail = {
    id: 0, business_id: 0, branch_id: 0, number: "", folio: null,
    channel: "takeaway", source: "sample", status: "draft", payment_status: "pending",
    created_at: "2000-01-01T17:30:00Z", version: 0,
    subtotal: 64.5, discount: 4.5, delivery_fee: 0, total: 60,
    paid_amount: 0, remaining_amount: 60, payments: [], kitchen_tickets: [],
    notes: "Muestra sint\u00e9tica: no registrar venta ni preparar productos.",
    items: [
      {
        id: -1, product_id: null,
        name: "Hamburguesa artesanal de champi\u00f1ones con cebolla caramelizada",
        variant_name: "Cl\u00e1sica", quantity: 2, unit_price: 29, line_total: 58,
        status: "draft", notes: "Sin aj\u00ed; servir la salsa aparte.\nComprobar que esta nota se lea completa.",
        modifiers: [
          { name: "Aj\u00ed amarillo", price_delta: 0, group_name: "Salsas" },
          { name: "Porci\u00f3n de queso", price_delta: 2, group_name: "Extras" },
          { name: "Porci\u00f3n de queso", price_delta: 2, group_name: "Extras" },
        ],
      },
      {
        id: -2, product_id: null, name: "Limonada de maracuy\u00e1", variant_name: "Fr\u00eda",
        quantity: 1, unit_price: 6.5, line_total: 6.5, status: "draft", modifiers: [],
      },
    ],
  };

  if (short) {
    order.items = [order.items[1]];
    order.notes = null;
    order.subtotal = order.items[0].line_total;
    order.discount = 0;
    order.total = order.subtotal;
    order.remaining_amount = order.total;
  }

  return {
    order, businessName, branchName, paperWidth, template, test: true,
    ...(kitchen ? {
      ticket: {
        id: 0, order_id: 0, order_number: "", order_folio: null,
        created_by: null, created_by_name: null,
        channel: order.channel, source: order.source, station: "kitchen",
        status: "queued" as const, print_count: 0, created_at: order.created_at,
        items: order.items.map((item) => ({
          item_id: item.id, name: item.name, variant_name: item.variant_name,
          quantity: item.quantity, line_total: item.line_total, notes: item.notes,
          modifiers: item.modifiers.map((modifier) => ({ ...modifier })),
        })),
      },
    } : {}),
  };
}
