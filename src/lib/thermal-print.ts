import type { KitchenCommandItem, KitchenTicket, OrderDetail, OrderModifierSnapshot } from "../types";
import { formatPosDate } from "./pos-dates";

export type ThermalPrintTemplate = {
  fields?: readonly { key: string; enabled: boolean; label?: string }[] | null;
  font_size?: "small" | "normal" | "large";
  header_enabled?: boolean;
  header_text?: string;
  footer_enabled?: boolean;
  footer_text?: string;
};

export type ThermalDocumentOptions = {
  order: OrderDetail;
  ticket?: KitchenTicket;
  businessName?: string;
  branchName?: string;
  branchAddress?: string | null;
  paperWidth: 58 | 80;
  template?: ThermalPrintTemplate | null;
  test?: boolean;
};

type OptionalField = "business" | "branch" | "customer" | "payment" | "notes" | "order" | "service";
type VisibleFields = Record<OptionalField, boolean>;

function visibleFields(template: ThermalPrintTemplate | null | undefined, kitchen: boolean): VisibleFields {
  // These defaults match PrintingSettings. Missing/legacy templates keep all fields enabled.
  const result: VisibleFields = { business: true, branch: true, customer: true, payment: true, notes: true, order: true, service: true };
  const optional: readonly string[] = kitchen ? ["order", "service", "notes"] : ["business", "branch", "customer", "payment", "notes"];
  if (Array.isArray(template?.fields)) {
    for (const field of template.fields) {
      if (field && optional.includes(field.key) && typeof field.enabled === "boolean") result[field.key as OptionalField] = field.enabled;
    }
  }
  // The legacy `items` switch cannot remove products, amounts or cancellation history.
  return result;
}

type Modifier = Omit<OrderModifierSnapshot, "price_delta"> & { price_delta?: number };
type Line = Pick<KitchenCommandItem, "name" | "variant_name" | "quantity" | "notes" | "status" | "action" | "line_total" | "modifiers" | "removed_modifiers" | "previous_quantity" | "cancellation_reason" | "combo_components">;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const numeric = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const cents = (value: number) => Math.round((value + Math.sign(value) * Number.EPSILON) * 100);
const quantityText = (value: number) => value.toLocaleString("es-PE", { maximumFractionDigits: 3 });
const money = (value: number) => `S/ ${value.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const amount = (value: unknown) => numeric(value) ? `<span class="thermal-amount">${escapeHtml(money(value))}</span>` : "";
const paragraph = (value: unknown, className = "") => text(value) ? `<p class="${className}">${escapeHtml(text(value))}</p>` : "";
const datum = (label: string, value: unknown) => text(value) ? `<p><strong>${label}:</strong> ${escapeHtml(text(value))}</p>` : "";
const inactive = (line: Line) => line.action === "cancelled" || ["cancelled", "superseded"].includes(line.status || "");

// Explicit null snapshot fields mean "not recorded", not permission to use current data.
function snapshotValue(ticket: KitchenTicket | undefined, key: string, fallback: unknown): unknown {
  return ticket?.context && Object.hasOwn(ticket.context, key) ? ticket.context[key] : fallback;
}

function modifierGroups(modifiers: Modifier[], quantity: number, removed = false) {
  const groups = new Map<string, { name: string; options: Map<string, { name: string; units: number; total?: number }> }>();
  for (const modifier of modifiers) {
    const units = removed && numeric(modifier.removed_quantity) ? modifier.removed_quantity : quantity;
    if (!numeric(units) || units <= 0) continue;
    const name = text(modifier.name) || "Personalización sin nombre registrado";
    const groupName = text(modifier.group_name) || "Personalizaciones";
    const groupKey = JSON.stringify([modifier.group_id, groupName]);
    let group = groups.get(groupKey);
    if (!group) {
      group = { name: groupName, options: new Map() };
      groups.set(groupKey, group);
    }
    const optionKey = JSON.stringify([modifier.modifier_id, name, numeric(modifier.price_delta) ? modifier.price_delta : null]);
    const option = group.options.get(optionKey);
    if (option) {
      option.units += units;
      if (numeric(modifier.price_delta)) option.total = cents(modifier.price_delta * option.units) / 100;
    } else {
      group.options.set(optionKey, { name, units, total: numeric(modifier.price_delta) ? cents(modifier.price_delta * units) / 100 : undefined });
    }
  }
  return [...groups.values()];
}

function renderModifiers(modifiers: Modifier[], quantity: number, removed = false): string {
  return modifierGroups(modifiers, quantity, removed).map((group) => `<section class="thermal-modifiers${removed ? " thermal-removed" : ""}">
    <h3>${escapeHtml(group.name.toLocaleUpperCase("es-PE"))}${removed ? " · RETIRADO" : ""}</h3>
    ${[...group.options.values()].map((option) => `<div class="thermal-row"><span>${escapeHtml(quantityText(option.units))} x ${escapeHtml(option.name)}</span>${amount(option.total)}</div>`).join("")}
  </section>`).join("");
}

function renderLine(line: Line, cancelledDocument: boolean, showNotes: boolean): string {
  const modifiers = line.modifiers || [];
  const knownExtras = modifiers.every((modifier) => numeric(modifier.price_delta)) && numeric(line.quantity);
  const extras = knownExtras ? modifiers.reduce((sum, modifier) => sum + cents(modifier.price_delta! * line.quantity), 0) : undefined;
  // line_total includes modifiers and is already multiplied by quantity. Never add them again.
  const base = numeric(line.line_total) && extras !== undefined ? (cents(line.line_total) - extras) / 100 : undefined;
  const canSeparate = numeric(base) && base >= 0;
  const isInactive = cancelledDocument || inactive(line);
  const name = [text(line.name) || "Producto sin nombre registrado", text(line.variant_name)].filter(Boolean).join(" - ");
  const quantity = numeric(line.quantity) ? `${quantityText(line.quantity)} x ` : "";
  return `<article class="thermal-item${isInactive ? " thermal-inactive" : ""}">
    ${isInactive ? `<p class="thermal-item-status">${line.status === "superseded" ? "REEMPLAZADO" : "CANCELADO"}</p>` : ""}
    <div class="thermal-item-content">
      <div class="thermal-row thermal-item-heading"><strong>${escapeHtml(quantity + name)}</strong>${amount(canSeparate ? base : line.line_total)}</div>
      ${!numeric(line.line_total) ? '<p class="thermal-detail">Importe no registrado</p>' : ""}
      ${showNotes ? paragraph(line.notes, "thermal-note") : ""}
      ${modifiers.length && !canSeparate && numeric(line.line_total) ? '<p class="thermal-detail">Personalizaciones incluidas en el importe</p>' : ""}
      ${renderModifiers(modifiers, line.quantity)}
      ${line.combo_components?.length ? `<section class="thermal-modifiers"><h3>INCLUYE</h3>${line.combo_components.map((component) => paragraph(`${numeric(component.quantity) && numeric(line.quantity) ? `${quantityText(component.quantity * line.quantity)} x ` : ""}${text(component.name) || "Producto sin nombre registrado"}`)).join("")}</section>` : ""}
    </div>
    ${renderModifiers(line.removed_modifiers || [], line.previous_quantity ?? line.quantity, true)}
    ${isInactive ? datum("Motivo", line.cancellation_reason) : ""}
  </article>`;
}

const channels: Record<string, string> = {
  counter: "EN EL LOCAL", dine_in: "EN EL LOCAL", table: "EN EL LOCAL",
  takeaway: "PARA LLEVAR", pickup: "PARA LLEVAR", delivery: "DOMICILIO",
};
const methods: Record<string, string> = { cash: "Efectivo", card: "Tarjeta", transfer: "Transferencia", yape: "Yape", plin: "Plin" };
const paymentStates: Record<string, string> = {
  pending: "Pago pendiente", partial: "Pago parcial", paid: "Pagado", refunded: "Reembolsado",
  under_review: "Pago en revisión", evidence_received: "Pago en revisión", rejected: "Pago rechazado",
};

function sourceDescription(source: string): string {
  if (["pos", "manual", "counter"].includes(source)) return "Tomado en punto de venta";
  if (["agent", "integration", "n8n", "whatsapp", "whatsapp_agent"].includes(source)) return "Tomado por WhatsApp";
  if (["online", "public_store", "public_menu"].includes(source)) return "Tomado en menú digital";
  return "";
}

function deliveryDetails(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const address = value as Record<string, unknown>;
  const fullAddress = text(address.address);
  const street = [text(address.street), text(address.number)].filter(Boolean).join(" ");
  const coordinates = numeric(address.latitude) && numeric(address.longitude)
    && Math.abs(address.latitude) <= 90 && Math.abs(address.longitude) <= 180
    ? `${address.latitude}, ${address.longitude}` : "";
  return datum("Dirección", fullAddress || street)
    + (!fullAddress ? datum("Colonia", address.neighborhood || address.district) + datum("Entre calles", address.cross_streets) : "")
    + datum("Referencia", address.reference)
    + (!fullAddress && !street ? datum("Ubicación", coordinates || address.maps_url) : "");
}

function renderDetails(order: OrderDetail, fields: VisibleFields, ticket?: KitchenTicket, tableInHeading = false): string {
  const channel = text(snapshotValue(ticket, "channel", ticket?.channel ?? order.channel));
  const sameDestination = channel === order.channel;
  const customer = snapshotValue(ticket, "customer_name", ticket?.customer_name !== undefined ? ticket.customer_name : order.customer_name);
  const table = snapshotValue(ticket, "table_name", ticket ? ticket.table_name : order.table_context?.table_name);
  const phone = snapshotValue(ticket, "customer_phone", sameDestination ? order.customer_phone : null);
  const address = snapshotValue(ticket, "delivery_address", sameDestination ? order.delivery_address : null);
  const content = (fields.customer ? datum("Cliente", customer) + datum("Teléfono", phone) : "")
    + (fields.service && !tableInHeading ? datum("Mesa", table) : "")
    + (fields.customer && fields.service && channel === "delivery" ? deliveryDetails(address) : "");
  return content ? `<section class="thermal-details" aria-label="Datos del pedido">${content}</section>` : "";
}

function renderTotals(order: OrderDetail, showPayment: boolean): string {
  const row = (label: string, value: unknown, strong = false) => numeric(value)
    ? `<div class="thermal-row${strong ? " thermal-total" : ""}"><dt>${label}</dt><dd>${escapeHtml(money(value))}</dd></div>` : "";
  const method = methods[order.payment_method || ""] || [...new Set((order.payments || [])
    .filter((payment) => payment.status === "confirmed")
    .map((payment) => methods[payment.method]).filter(Boolean))].join(", ");
  const payments = datum("Método de pago", method) + paragraph(paymentStates[order.payment_status])
    + (numeric(order.paid_amount) && order.paid_amount > 0
      ? `<dl>${row("Monto cobrado", order.paid_amount)}${row("Saldo pendiente", order.remaining_amount)}</dl>` : "");
  return `<dl class="thermal-totals" aria-label="Totales del pedido">
    ${row("Productos", order.subtotal)}
    ${numeric(order.discount) && order.discount > 0 ? row("Descuento", -order.discount) : ""}
    ${numeric(order.delivery_fee) && order.delivery_fee > 0 ? row("Envío", order.delivery_fee) : ""}
    ${order.delivery_fee_status === "pending_quote" ? '<p>Envío por cotizar. No incluido en el importe conocido.</p>' : ""}
    ${row(order.delivery_fee_status === "pending_quote" ? "Importe conocido (sin envío)" : "Monto a pagar", order.total, true)}
  </dl>${showPayment && payments ? `<section class="thermal-payment" aria-label="Pago">${payments}</section>` : ""}`;
}

/** Shared escaped markup for the browser portal and the standalone QZ HTML document. */
export function renderThermalBody({ order, ticket, businessName, branchName, branchAddress, paperWidth, template, test }: ThermalDocumentOptions): string {
  const fields = visibleFields(template, Boolean(ticket));
  const width = paperWidth === 58 ? 58 : 80;
  const code = text(snapshotValue(ticket, "order_number", ticket?.order_number ?? order.number)).replace(/^#+/, "");
  const folio = snapshotValue(ticket, "order_folio", ticket?.order_folio !== undefined ? ticket.order_folio : order.folio);
  const channel = text(snapshotValue(ticket, "channel", ticket?.channel ?? order.channel));
  const actor = text(snapshotValue(ticket, "created_by_name", ticket?.created_by_name));
  const source = text(snapshotValue(ticket, "source", ticket?.source ?? order.source));
  const tableName = text(snapshotValue(ticket, "table_name", ticket ? ticket.table_name : order.table_context?.table_name));
  const areaName = text(snapshotValue(ticket, "area_name", ticket ? null : order.table_context?.area_name));
  const tableInHeading = channel === "dine_in" && Boolean(tableName);
  const fontSize = template?.font_size === "small" || template?.font_size === "large" ? template.font_size : "normal";
  const cancelledDocument = ticket ? ticket.status === "cancelled" : order.status === "cancelled";
  // Cancelled receipts retain supplied history; totals still come from the server snapshot.
  const lines: Line[] = ticket ? ticket.items : cancelledDocument ? order.items : order.items.filter((item) => !inactive(item));
  const notes = snapshotValue(ticket, "notes", order.notes);
  const heading = ticket
    ? `${fields.order ? paragraph(actor ? `Tomada por ${actor}` : "") : ""}<h1>${numeric(ticket.sequence) && ticket.sequence > 0 ? `Comanda #${ticket.sequence}` : "Comanda sin número"}</h1>`
    : paragraph(sourceDescription(source));
  return `<div class="thermal-document thermal-paper-${width} thermal-font-${fontSize}" lang="es" data-paper-width="${width}">
    <header class="thermal-header">
      ${test ? '<p class="thermal-test-marker">PRUEBA DE IMPRESION - SIN VALOR COMERCIAL</p>' : ""}
      ${!ticket && fields.business && text(businessName) ? `<h1 class="thermal-business">${escapeHtml(text(businessName))}</h1>` : ""}
      ${!ticket && template?.header_enabled ? paragraph(template.header_text, "thermal-custom-text thermal-custom-header") : ""}
      ${!ticket && fields.branch && (!fields.business || text(branchName) !== text(businessName)) ? paragraph(branchName) : ""}
      ${!ticket && fields.branch ? paragraph(branchAddress, "thermal-branch-address") : ""}
      ${fields.order ? `${paragraph(formatPosDate(ticket ? ticket.created_at : order.created_at, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }))}
      ${paragraph(code ? `#${code}` : "", "thermal-code")}
      <p class="thermal-folio">${numeric(folio) && folio > 0 ? `Folio #${folio}` : "Sin folio"}</p>` : ""}
      ${heading}
    </header>
    ${fields.service ? `<h2 class="thermal-channel">${escapeHtml(tableInHeading ? tableName : channels[channel] || "Modalidad no registrada")}${tableInHeading && areaName ? `<span class="thermal-area">En ${escapeHtml(areaName)}</span>` : ""}</h2>` : ""}
    ${!ticket && order.status === "cancelled" ? '<p class="thermal-order-status">PEDIDO CANCELADO</p>' : ""}
    ${renderDetails(order, fields, ticket, tableInHeading)}
    <section class="thermal-items" aria-label="Productos">${lines.map((line) => renderLine(line, cancelledDocument, fields.notes)).join("") || "<p>No hay productos activos.</p>"}</section>
    ${fields.notes ? paragraph(notes, "thermal-order-note") : ""}
    ${!ticket ? renderTotals(order, fields.payment) : ""}
    ${!ticket && template?.footer_enabled ? paragraph(template.footer_text, "thermal-custom-text thermal-custom-footer") : ""}
  </div>`;
}

/** No web fonts, external styles, scripts or network resources: suitable for QZ pixel HTML. */
export const thermalPrintCss = `
.thermal-document, .thermal-document * { box-sizing: border-box; }
.thermal-document { color: #000; background: #fff; font: 10pt/1.35 sans-serif; width: 80mm; max-width: 100%; padding: 3mm; margin: 0; overflow-wrap: anywhere; }
.thermal-document.thermal-paper-58 { width: 58mm; font-size: 9pt; }
.thermal-document.thermal-font-small { font-size: 8.5pt; }
.thermal-document.thermal-font-large { font-size: 12pt; }
.thermal-document.thermal-paper-58.thermal-font-small { font-size: 7.65pt; }
.thermal-document.thermal-paper-58.thermal-font-large { font-size: 10.8pt; }
.thermal-document h1, .thermal-document h2, .thermal-document h3, .thermal-document p, .thermal-document dl, .thermal-document dd { margin: 0; padding: 0; color: inherit; line-height: inherit; }
.thermal-document h1 { font-size: 1em; font-weight: 700; }
.thermal-document .thermal-header { text-align: center; padding: 1mm 0 3mm; }
.thermal-document .thermal-business { text-transform: uppercase; margin-bottom: 3mm; }
.thermal-document .thermal-header p { margin-top: .6mm; }
.thermal-document .thermal-test-marker { border: .4mm solid #000; padding: 2mm; margin-bottom: 3mm; font-size: 1.1em; font-weight: 700; break-inside: avoid; page-break-inside: avoid; }
.thermal-document .thermal-branch-address { white-space: pre-wrap; }
.thermal-document .thermal-folio { font-weight: 700; }
.thermal-document .thermal-channel { border-top: .4mm dashed #000; border-bottom: .4mm solid #000; padding: 3mm 0; margin: 0 0 3mm; text-align: center; font-size: 1.2em; font-weight: 700; }
.thermal-document .thermal-area { display: block; margin-top: 1mm; font-size: .8em; font-weight: 400; }
.thermal-document .thermal-custom-text { white-space: pre-wrap; text-align: center; }
.thermal-document .thermal-custom-footer { margin-top: 3mm; }
.thermal-document .thermal-details { margin: 0 0 3mm; }
.thermal-document .thermal-item { margin: 0 0 4mm; break-inside: avoid; page-break-inside: avoid; }
.thermal-document .thermal-item:last-child { margin-bottom: 0; }
.thermal-document .thermal-row { display: table; table-layout: fixed; width: 100%; }
.thermal-document .thermal-row > :first-child { display: table-cell; vertical-align: top; overflow-wrap: anywhere; }
.thermal-document .thermal-row > :last-child:not(:first-child) { display: table-cell; width: 26mm; padding-left: 2mm; vertical-align: top; text-align: right; font-variant-numeric: tabular-nums; }
.thermal-document.thermal-paper-58 .thermal-row > :last-child:not(:first-child) { width: 22mm; }
.thermal-document .thermal-item-heading { font-size: 1.05em; }
.thermal-document .thermal-note { margin: 1mm 0 0 2mm; white-space: pre-wrap; }
.thermal-document .thermal-detail { margin-top: 1mm; font-size: .9em; }
.thermal-document .thermal-modifiers { margin: 1.5mm 0 0 3mm; }
.thermal-document .thermal-modifiers h3 { font-size: .95em; font-weight: 400; margin-bottom: .5mm; }
.thermal-document .thermal-inactive .thermal-item-content, .thermal-document .thermal-removed .thermal-row { text-decoration: line-through; }
.thermal-document .thermal-item-status, .thermal-document .thermal-order-status { font-weight: 700; margin-bottom: 1mm; }
.thermal-document .thermal-order-note { border-top: .3mm dashed #000; padding: 2mm 0; margin: 1mm 0; white-space: pre-wrap; }
.thermal-document .thermal-totals { border: .3mm solid #000; padding: 2mm; margin-top: 3mm; break-inside: avoid; page-break-inside: avoid; }
.thermal-document .thermal-totals .thermal-row + .thermal-row { margin-top: 1mm; }
.thermal-document .thermal-total { font-weight: 700; }
.thermal-document .thermal-payment { margin-top: 3mm; break-inside: avoid; page-break-inside: avoid; }
.thermal-document .thermal-payment dl { margin-top: 1mm; }
`;

/** Returns a complete, escaped document; this does not connect to QZ or print anything. */
export function renderThermalDocument(options: ThermalDocumentOptions): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${options.ticket ? "Comanda" : "Ticket de pedido"}</title><style>@page { margin: 0; } html, body { margin: 0; padding: 0; background: #fff; }${thermalPrintCss}</style></head><body>${renderThermalBody(options)}</body></html>`;
}
