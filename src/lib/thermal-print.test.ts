import { describe, expect, it } from "vitest";
import type { KitchenTicket, OrderDetail } from "../types";
import { renderThermalBody, renderThermalDocument, type ThermalPrintTemplate } from "./thermal-print";
import { createThermalPrintSample } from "./thermal-print-sample";

const order: OrderDetail = {
  id: 998, business_id: 1, branch_id: 2, number: "9KEJW", folio: 7,
  channel: "takeaway", source: "pos", status: "preparing", payment_status: "pending",
  created_at: "2026-06-17T21:36:00", version: 3,
  subtotal: 350, discount: 40, delivery_fee: 0, total: 310,
  paid_amount: 0, remaining_amount: 310, payments: [], kitchen_tickets: [],
  items: [
    { id: 10, product_id: 3, name: "Alitas", variant_name: "Grandes", quantity: 1,
      unit_price: 220, line_total: 220, status: "preparing", notes: "Salsa aparte",
      modifiers: [
        { modifier_id: 1, name: "BBQ", price_delta: 0, group_name: "Elige las salsas" },
        { modifier_id: 2, name: "Aderezo ranch", price_delta: 10, group_name: "Extras" },
        { modifier_id: 2, name: "Aderezo ranch", price_delta: 10, group_name: "Extras" },
      ] },
    { id: 11, product_id: 4, name: "Refresco", quantity: 1, unit_price: 30, line_total: 30, status: "preparing", modifiers: [] },
    { id: 12, product_id: 5, name: "Hamburguesa Clásica", quantity: 1, unit_price: 100, line_total: 100, status: "preparing", modifiers: [] },
  ],
};

const ticket: KitchenTicket = {
  id: 701, order_id: order.id, order_number: order.number, order_folio: order.folio,
  sequence: 2, created_at: "2026-06-17T21:38:00Z", created_by: "actor-private-id",
  created_by_name: "Brenda", station: "kitchen", status: "queued", print_count: 0,
  items: order.items.map((item) => ({ ...item, item_id: item.id })),
};

function documentFor(overrides: Partial<Parameters<typeof renderThermalDocument>[0]> = {}) {
  return new DOMParser().parseFromString(renderThermalDocument({ order, paperWidth: 80, businessName: "Taquería de prueba", ...overrides }), "text/html");
}

describe("thermal documents", () => {
  it.each(["small", "normal", "large"] as const)("applies %s font size to either document", (font_size) => {
    for (const currentTicket of [undefined, ticket]) {
      const doc = documentFor({ ticket: currentTicket, template: { font_size } });
      expect(doc.querySelector(`.thermal-font-${font_size}`)).not.toBeNull();
      expect(doc.querySelectorAll(".thermal-item")).toHaveLength(3);
    }
  });

  it("prints escaped optional customer text only when enabled and nonblank", () => {
    const template = { header_enabled: true, header_text: "<img src=x onerror=alert(1)>\nWelcome", footer_enabled: true, footer_text: "Thanks & goodbye" };
    const doc = documentFor({ template });
    expect(doc.querySelector(".thermal-custom-header")?.textContent).toBe(template.header_text);
    expect(doc.querySelector(".thermal-custom-footer")?.textContent).toBe(template.footer_text);
    expect(doc.querySelector("img,script")).toBeNull();
    expect(doc.querySelector(".thermal-business")?.nextElementSibling?.classList.contains("thermal-custom-header")).toBe(true);
    expect(documentFor({ ticket, template }).querySelector(".thermal-custom-text")).toBeNull();
    expect(documentFor({ template: { ...template, header_enabled: false, footer_enabled: false } }).querySelector(".thermal-custom-text")).toBeNull();
    expect(documentFor({ template: { ...template, header_text: "\n  ", footer_text: " " } }).querySelector(".thermal-custom-text")).toBeNull();
  });

  it("highlights saved table and area without duplicating the table in details", () => {
    const tableOrder = { ...order, channel: "dine_in", table_context: { table_id: 2, table_name: "Mesa 8", area_name: "Terraza norte" } };
    const doc = documentFor({ order: tableOrder });
    expect(doc.querySelector(".thermal-channel")?.textContent).toBe("Mesa 8En Terraza norte");
    expect(doc.querySelector(".thermal-details")?.textContent ?? "").not.toContain("Mesa 8");
    const kitchen = documentFor({ order: tableOrder, ticket: { ...ticket, context: { channel: "dine_in", table_name: "Mesa original", area_name: "Zona original" }, items: [ticket.items[1]] } });
    expect(kitchen.querySelector(".thermal-channel")?.textContent).toBe("Mesa originalEn Zona original");
    expect(kitchen.querySelectorAll(".thermal-item")).toHaveLength(1);
    expect(kitchen.querySelector(".thermal-totals")).toBeNull();
    const legacy = documentFor({ order: tableOrder, ticket: { ...ticket, context: { channel: "dine_in", table_name: "Mesa original", area_name: null } } });
    expect(legacy.querySelector(".thermal-area")).toBeNull();
    expect(legacy.body.textContent).not.toContain("Terraza norte");
  });

  it("returns a complete self-contained document and shares its escaped body", () => {
    const options = { order, paperWidth: 58 as const };
    const html = renderThermalDocument(options);
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).toContain(renderThermalBody(options));
    const doc = documentFor(options);
    expect(doc.querySelector(".thermal-paper-58")).not.toBeNull();
    expect(doc.querySelector("style")?.textContent).toContain("width: 58mm");
    expect(doc.querySelector("style")?.textContent).toContain("width: 80mm");
    expect(doc.querySelectorAll("script, link, img, iframe")).toHaveLength(0);
    expect(doc.body.textContent).not.toMatch(/Maspedidos|Venta procesada|Suscripción/i);
  });

  it("prints the business, Lima date, code, folio, source and channel", () => {
    const doc = documentFor({ branchName: "Sucursal de prueba" });
    const header = doc.querySelector("header")!.textContent!;
    expect(header).toContain("Taquería de prueba");
    expect(header).toContain("Sucursal de prueba");
    expect(header).toMatch(/17.*jun.*2026/);
    expect(header).toContain("4:36");
    expect(header).not.toContain("21:36");
    expect(header).toContain("#9KEJW");
    expect(header).toContain("Folio #7");
    expect(header).toContain("Tomado en punto de venta");
    expect(doc.querySelector(".thermal-channel")?.textContent).toBe("PARA LLEVAR");
  });

  it("prints the supplied branch address independently of a repeated branch name", () => {
    const options = { branchName: "Taquería de prueba", branchAddress: "Av. José Pardo 120\nSegundo piso" };
    const doc = documentFor(options);
    expect(doc.querySelector(".thermal-branch-address")?.textContent).toBe(options.branchAddress);
    expect(doc.querySelector("header")?.textContent?.match(/Taquería de prueba/g)).toHaveLength(1);
    expect(documentFor({ ...options, template: { fields: [{ key: "business", enabled: false }] } }).querySelector(".thermal-branch-address")?.textContent).toBe(options.branchAddress);
    expect(documentFor({ ...options, template: { fields: [{ key: "branch", enabled: false }] } }).querySelector(".thermal-branch-address")).toBeNull();
    expect(documentFor({ ...options, ticket }).querySelector(".thermal-branch-address")).toBeNull();
  });

  it.each([undefined, null, "", "  "])("does not invent a branch address when absent: %j", (branchAddress) => {
    expect(documentFor({ branchAddress }).querySelector(".thermal-branch-address")).toBeNull();
  });

  it("keeps kitchen date, code, folio, actual author, sequence and mode without totals", () => {
    const doc = documentFor({ ticket });
    const header = doc.querySelector("header")!.textContent!;
    expect(header).toMatch(/17.*jun.*2026/);
    expect(header).toContain("4:38");
    expect(header).toContain("#9KEJW");
    expect(header).toContain("Folio #7");
    expect(header).toContain("Tomada por Brenda");
    expect(header).toContain("Comanda #2");
    expect(doc.querySelector(".thermal-channel")?.textContent).toBe("PARA LLEVAR");
    expect(doc.querySelector(".thermal-item-heading")?.textContent).toBe("1 x Alitas - GrandesS/ 200.00");
    expect(doc.querySelector(".thermal-totals, .thermal-payment")).toBeNull();
  });

  it.each([false, true])("keeps the test marker prominent even with all optional fields disabled (kitchen=%s)", (kitchen) => {
    const options = {
      ticket: kitchen ? ticket : undefined,
      template: { fields: ["business", "branch", "customer", "payment", "notes", "order", "service", "items"].map((key) => ({ key, enabled: false })) },
    };
    const doc = documentFor({ ...options, test: true });
    expect(doc.querySelector("header")?.firstElementChild?.textContent).toBe("PRUEBA DE IMPRESION - SIN VALOR COMERCIAL");
    expect(doc.querySelectorAll(".thermal-test-marker")).toHaveLength(1);
    expect(doc.querySelector("style")?.textContent).toMatch(/\.thermal-test-marker\s*\{[^}]*border:[^}]*font-weight: 700/);
    expect(documentFor(options).querySelector(".thermal-test-marker")).toBeNull();
    expect(documentFor({ ...options, test: false }).querySelector(".thermal-test-marker")).toBeNull();
  });

  it.each(["counter", "dine_in", "delivery", "pickup"])("labels the known channel %s", (channel) => {
    const doc = documentFor({ order: { ...order, channel } });
    expect(doc.querySelector("h2")?.textContent).toBe(channel === "delivery" ? "DOMICILIO" : channel === "pickup" ? "PARA LLEVAR" : "EN EL LOCAL");
  });

  it("does not reinterpret unknown channels, sources or dates", () => {
    const doc = documentFor({ businessName: undefined, order: { ...order, channel: "legacy", source: "unknown", created_at: "not a date" } });
    expect(doc.body.textContent).toContain("Modalidad no registrada");
    expect(doc.body.textContent).toContain("Fecha no disponible");
    expect(doc.body.textContent).not.toContain("Tomado en punto de venta");
    expect(doc.querySelector(".thermal-business")).toBeNull();
  });

  it("separates recorded extras from the inclusive line total, showing zero prices", () => {
    const doc = documentFor();
    const item = doc.querySelector(".thermal-item")!;
    expect(item.querySelector(".thermal-item-heading")?.textContent).toBe("1 x Alitas - GrandesS/ 200.00");
    expect(item.textContent).toContain("Salsa aparte");
    expect(item.textContent).toContain("ELIGE LAS SALSAS");
    expect(item.textContent).toContain("1 x BBQS/ 0.00");
    expect(item.textContent).toContain("EXTRAS");
    expect(item.textContent).toContain("2 x Aderezo ranchS/ 20.00");
    expect(doc.querySelector(".thermal-totals")?.textContent).toMatch(/ProductosS\/ 350\.00\s+DescuentoS\/ -40\.00\s+Monto a pagarS\/ 310\.00/);
  });

  it("multiplies each modifier only once, but never multiplies line_total again", () => {
    const doc = documentFor({ order: { ...order, subtotal: 660, discount: 0, total: 660, items: [{ ...order.items[0], quantity: 3, line_total: 660 }] } });
    const item = doc.querySelector(".thermal-item")!;
    expect(item.textContent).toContain("3 x Alitas - GrandesS/ 600.00");
    expect(item.textContent).toContain("6 x Aderezo ranchS/ 60.00");
    expect(doc.body.textContent).not.toContain("1,980");
    expect(doc.querySelector(".thermal-total")?.textContent).toBe("Monto a pagarS/ 660.00");
  });

  it("formats decimal soles and currency amounts without floating-point tails", () => {
    const doc = documentFor({ order: { ...order, total: 1234.5, subtotal: 1.35, discount: 0, items: [{ ...order.items[0], quantity: 3, line_total: 1.35, modifiers: [{ name: "Extra", price_delta: 0.15 }] }] } });
    expect(doc.body.textContent).toContain("S/ 1,234.50");
    expect(doc.querySelector(".thermal-item-heading")?.textContent).toContain("S/ 0.90");
    expect(doc.querySelector(".thermal-modifiers")?.textContent).toContain("S/ 0.45");
    expect(doc.body.textContent).not.toContain("0000000001");
  });

  it("uses kitchen snapshots even when the order now has different names and prices", () => {
    const doc = documentFor({
      order: { ...order, items: order.items.map((item) => ({ ...item, name: "Nombre posterior", line_total: 999, status: "superseded" })), channel: "delivery", customer_name: "Cliente posterior" },
      ticket: { ...ticket, context: { channel: "takeaway", customer_name: "Cliente histórico", table_name: "Terraza histórica", created_by_name: "Ana histórica" } },
    });
    expect(doc.body.textContent).toContain("Comanda #2");
    expect(doc.body.textContent).toContain("Tomada por Ana histórica");
    expect(doc.body.textContent).toContain("Cliente histórico");
    expect(doc.body.textContent).toContain("Terraza histórica");
    expect(doc.body.textContent).toContain("Alitas - GrandesS/ 200.00");
    expect(doc.body.textContent).not.toMatch(/Nombre posterior|Cliente posterior|S\/ 999|actor-private-id/);
    expect(doc.querySelector(".thermal-inactive")).toBeNull();
    expect(doc.querySelector(".thermal-totals")).toBeNull();
    expect(doc.querySelector(".thermal-payment")).toBeNull();
    expect(doc.body.textContent).not.toMatch(/Monto a pagar|Monto cobrado|Descuento|Taquería/);
  });

  it("does not invent or hydrate missing historical prices from the order", () => {
    const doc = documentFor({ ticket: { ...ticket, items: [{ item_id: 10, name: "Alitas históricas", quantity: 1, modifiers: [{ name: "Precio desconocido" }, { name: "BBQ", price_delta: 0 }] }] } });
    const item = doc.querySelector(".thermal-item")!;
    expect(item.querySelector(".thermal-item-heading .thermal-amount")).toBeNull();
    expect(item.textContent).toContain("Importe no registrado");
    const rows = item.querySelectorAll(".thermal-modifiers .thermal-row");
    expect(rows[0].querySelector(".thermal-amount")).toBeNull();
    expect(rows[1].textContent).toContain("S/ 0.00");
  });

  it("labels inclusive totals when an extra price is missing or inconsistent", () => {
    const doc = documentFor({ ticket: { ...ticket, items: [
      { item_id: 10, name: "Histórico", quantity: 1, line_total: 220, modifiers: [{ name: "Extra sin precio" }, { name: "Extra conocido", price_delta: 10 }] },
      { item_id: 11, name: "Inconsistente", quantity: 1, line_total: 5, modifiers: [{ name: "Extra", price_delta: 10 }] },
    ] } });
    expect(doc.querySelector(".thermal-item-heading")?.textContent).toBe("1 x HistóricoS/ 220.00");
    expect(doc.querySelectorAll(".thermal-detail")).toHaveLength(2);
    expect(doc.body.textContent).not.toContain("S/ -5");
  });

  it("excludes inactive receipt lines and strikes cancelled kitchen lines and retired absolute units", () => {
    const cancelled = { ...order.items[1], status: "cancelled", cancellation_reason: "Ya no lo desea" };
    const superseded = { ...order.items[2], status: "superseded" };
    const receipt = documentFor({ order: { ...order, items: [order.items[0], cancelled, superseded] } });
    expect(receipt.querySelectorAll(".thermal-item")).toHaveLength(1);
    const doc = documentFor({ ticket: { ...ticket, items: [
      { ...cancelled, item_id: cancelled.id, action: "cancelled" },
      { ...ticket.items[0], quantity: 2, previous_quantity: 4, removed_modifiers: [{ name: "Extra anterior", price_delta: 5, removed_quantity: 3 }] },
    ] } });
    expect(doc.querySelectorAll(".thermal-inactive")).toHaveLength(1);
    expect(doc.querySelector(".thermal-inactive")?.textContent).toContain("CANCELADO");
    expect(doc.querySelector(".thermal-inactive")?.textContent).toContain("Ya no lo desea");
    expect(doc.querySelector(".thermal-removed")?.textContent).toContain("3 x Extra anteriorS/ 15.00");
    expect(doc.querySelector("style")?.textContent).toContain("text-decoration: line-through");
  });

  it("never uses global IDs, a fabricated author, sequence or current table for missing snapshots", () => {
    const doc = documentFor({ order: { ...order, table_context: { table_id: 90, table_name: "Mesa actual" } }, ticket: { ...ticket, sequence: undefined, created_by_name: null, context: { customer_name: null, table_name: null, order_folio: null, order_number: null }, table_name: "Fallback actual" } });
    expect(doc.body.textContent).toContain("Sin folio");
    expect(doc.body.textContent).toContain("Comanda sin número");
    expect(doc.body.textContent).not.toMatch(/Tomada por|#998|#701|Folio #7|#9KEJW|Mesa actual|Fallback actual|actor-private-id/);
    const receipt = documentFor({ order: { ...order, folio: undefined } });
    expect(receipt.body.textContent).toContain("Sin folio");
    expect(receipt.body.textContent).toContain("#9KEJW");
  });

  it("prints real delivery and payment data, without treating evidence as payment", () => {
    const doc = documentFor({ order: { ...order, channel: "delivery", customer_name: "Ana", customer_phone: "900000001", delivery_address: { address: "Calle prueba 20", reference: "Puerta azul" }, payment_method: "yape", payment_status: "under_review", delivery_fee: 5, total: 315 } });
    expect(doc.body.textContent).toContain("Cliente: Ana");
    expect(doc.body.textContent).toContain("Teléfono: 900000001");
    expect(doc.body.textContent).toContain("Dirección: Calle prueba 20");
    expect(doc.body.textContent).toContain("Referencia: Puerta azul");
    expect(doc.body.textContent).toContain("EnvíoS/ 5.00");
    expect(doc.body.textContent).toContain("Método de pago: Yape");
    expect(doc.body.textContent).toContain("Pago en revisión");
    expect(doc.body.textContent).not.toContain("Monto cobrado");
  });

  it("retains confirmed amounts for cancelled or partially paid orders", () => {
    const doc = documentFor({ order: { ...order, status: "cancelled", payment_status: "partial", paid_amount: 100, remaining_amount: 210, payments: [{ id: 22, order_id: order.id, method: "cash", amount: 100, status: "confirmed", created_at: order.created_at }] } });
    expect(doc.body.textContent).toContain("PEDIDO CANCELADO");
    expect(doc.body.textContent).toContain("Monto a pagarS/ 310.00");
    expect(doc.body.textContent).toContain("Monto cobradoS/ 100.00");
    expect(doc.body.textContent).toContain("Saldo pendienteS/ 210.00");
    expect(doc.body.textContent).toContain("Método de pago: Efectivo");
  });

  it("retains supplied cancellation history without recalculating receipt totals or payments", () => {
    const cancelledOrder: OrderDetail = {
      ...order, status: "cancelled", payment_status: "partial", paid_amount: 100, remaining_amount: 210,
      items: [
        { ...order.items[0], status: "cancelled", cancellation_reason: "Cambio de planes" },
        { ...order.items[1], status: "superseded" },
        order.items[2],
      ],
    };
    const before = JSON.stringify(cancelledOrder);
    const doc = documentFor({ order: cancelledOrder });
    expect(doc.querySelectorAll(".thermal-item")).toHaveLength(3);
    expect(doc.querySelectorAll(".thermal-inactive")).toHaveLength(3);
    expect(doc.querySelectorAll(".thermal-item-status")[1]?.textContent).toBe("REEMPLAZADO");
    expect(doc.body.textContent).toContain("Cambio de planes");
    expect(doc.body.textContent).toContain("2 x Aderezo ranchS/ 20.00");
    expect(doc.querySelector(".thermal-totals")?.textContent).toContain("ProductosS/ 350.00");
    expect(doc.querySelector(".thermal-totals")?.textContent).toContain("DescuentoS/ -40.00");
    expect(doc.querySelector(".thermal-total")?.textContent).toBe("Monto a pagarS/ 310.00");
    expect(doc.querySelector(".thermal-payment")?.textContent).toContain("Monto cobradoS/ 100.00");
    expect(doc.querySelector(".thermal-payment")?.textContent).toContain("Saldo pendienteS/ 210.00");
    expect(JSON.stringify(cancelledOrder)).toBe(before);
  });

  it("strikes every line of a cancelled kitchen snapshot without adding payment or totals", () => {
    const doc = documentFor({ ticket: { ...ticket, status: "cancelled" } });
    expect(doc.querySelectorAll(".thermal-inactive")).toHaveLength(ticket.items.length);
    expect(doc.body.textContent).toContain("Alitas - GrandesS/ 200.00");
    expect(doc.body.textContent).toContain("2 x Aderezo ranchS/ 20.00");
    expect(doc.querySelector(".thermal-totals, .thermal-payment")).toBeNull();
    expect(doc.body.textContent).not.toMatch(/Monto a pagar|Monto cobrado|Descuento/);
  });

  it("escapes every text context and rejects nonnumeric CSS widths", () => {
    const attack = '</style><script>alert("x")</script><img src=x onerror="alert(1)"> & \' text';
    const attackedOrder = { ...order, number: attack, customer_name: attack, customer_phone: attack, notes: attack, channel: "delivery", delivery_address: { address: attack, reference: attack }, items: [{ ...order.items[0], name: attack, notes: attack, variant_name: attack, modifiers: [{ name: attack, group_name: attack, price_delta: 0 }] }] };
    const doc = documentFor({ order: attackedOrder, businessName: attack, branchName: attack, branchAddress: attack, paperWidth: attack as unknown as 58 });
    expect(doc.querySelectorAll("script, img, iframe, [onerror]")).toHaveLength(0);
    expect(doc.querySelectorAll("style")).toHaveLength(1);
    expect(doc.body.textContent).toContain(attack);
    expect(doc.querySelector(".thermal-branch-address")?.textContent).toBe(attack);
    expect(doc.querySelector(".thermal-document")?.getAttribute("data-paper-width")).toBe("80");
    const command = documentFor({ ticket: { ...ticket, created_by_name: attack, context: { table_name: attack } } });
    expect(command.body.textContent).toContain(`Tomada por ${attack}`);
    expect(command.querySelectorAll("script, img, [onerror]")).toHaveLength(0);
  });

  it("leaves source objects unchanged across repeated rendering", () => {
    const before = JSON.stringify({ order, ticket });
    expect(renderThermalDocument({ order, ticket, paperWidth: 80 })).toBe(renderThermalDocument({ order, ticket, paperWidth: 80 }));
    expect(JSON.stringify({ order, ticket })).toBe(before);
  });

  it.each([undefined, null, {}, { fields: [] }, { fields: null }])("keeps existing defaults with an absent or legacy template %j", (template) => {
    expect(renderThermalDocument({ order, paperWidth: 80, template })).toBe(renderThermalDocument({ order, paperWidth: 80 }));
    expect(renderThermalDocument({ order, ticket, paperWidth: 80, template })).toBe(renderThermalDocument({ order, ticket, paperWidth: 80 }));
  });

  it("applies customer optional fields without dropping items, identities or totals", () => {
    const doc = documentFor({
      branchName: "Sucursal para ocultar",
      order: { ...order, channel: "delivery", customer_name: "Cliente para ocultar", customer_phone: "900000001", delivery_address: { address: "Dirección para ocultar" }, payment_method: "cash", paid_amount: 10, notes: "Nota para ocultar", table_context: { table_id: 2, table_name: "Mesa histórica" } },
      template: { fields: ["business", "branch", "customer", "payment", "notes", "items", "totals"].map((key) => ({ key, enabled: false })) },
    });
    expect(doc.body.textContent).not.toMatch(/Taquería|Sucursal para ocultar|Cliente para ocultar|900000001|Dirección para ocultar|Método de pago|Pago pendiente|Monto cobrado|Nota para ocultar|Salsa aparte/);
    expect(doc.body.textContent).toContain("Mesa histórica");
    expect(doc.body.textContent).toContain("DOMICILIO");
    expect(doc.body.textContent).toContain("#9KEJW");
    expect(doc.body.textContent).toContain("Folio #7");
    expect(doc.querySelectorAll(".thermal-item")).toHaveLength(3);
    expect(doc.body.textContent).toContain("2 x Aderezo ranchS/ 20.00");
    expect(doc.querySelector(".thermal-totals")?.textContent).toContain("ProductosS/ 350.00");
    expect(doc.querySelector(".thermal-totals")?.textContent).toContain("DescuentoS/ -40.00");
    expect(doc.querySelector(".thermal-total")?.textContent).toBe("Monto a pagarS/ 310.00");
  });

  it("applies kitchen order/service/notes while retaining its sequence, prices and cancellations", () => {
    const doc = documentFor({
      order: { ...order, notes: "Nota oculta" },
      ticket: { ...ticket, context: { channel: "delivery", table_name: "Mesa oculta", delivery_address: { address: "Calle oculta" } }, items: [{ ...ticket.items[0], action: "cancelled", cancellation_reason: "Motivo real", removed_modifiers: [{ name: "Extra retirado", price_delta: 10, removed_quantity: 1 }] }] },
      template: { fields: ["order", "service", "items", "notes"].map((key) => ({ key, enabled: false })) },
    });
    expect(doc.body.textContent).not.toMatch(/#9KEJW|Folio|2026|Tomada por|DOMICILIO|Mesa oculta|Calle oculta|Nota oculta|Salsa aparte/);
    expect(doc.body.textContent).toContain("Comanda #2");
    expect(doc.body.textContent).toContain("1 x Alitas - GrandesS/ 200.00");
    expect(doc.body.textContent).toContain("CANCELADO");
    expect(doc.body.textContent).toContain("Motivo real");
    expect(doc.querySelector(".thermal-removed")?.textContent).toContain("1 x Extra retiradoS/ 10.00");
    expect(doc.querySelector(".thermal-totals")).toBeNull();
  });

  it("allows partial templates, ignores mismatched/unknown fields, and never renders template labels", () => {
    const template = { fields: [{ key: "business", enabled: false }, { key: "customer", enabled: false }, { key: "customer", enabled: true }, { key: "order", enabled: false }, { key: "service", enabled: false }, { key: "ad", enabled: true, label: '<img src=x onerror="evil()"> Maspedidos' }] };
    const before = JSON.stringify(template);
    const doc = documentFor({ businessName: "Nombre repetido", branchName: "Nombre repetido", order: { ...order, customer_name: "Cliente real" }, template });
    expect(doc.querySelector(".thermal-business")).toBeNull();
    expect(doc.querySelector("header")?.textContent).toContain("Nombre repetido");
    expect(doc.body.textContent).toContain("Cliente real");
    expect(doc.body.textContent).toContain("PARA LLEVAR");
    expect(doc.body.textContent).toContain("#9KEJW");
    expect(doc.body.textContent).toContain("Salsa aparte");
    expect(doc.body.textContent).not.toMatch(/Maspedidos|evil/);
    expect(doc.querySelectorAll("script, img, [onerror]")).toHaveLength(0);
    expect(JSON.stringify(template)).toBe(before);
  });

  it("does not let malformed template flags hide fields or invent missing values", () => {
    const template = { fields: [null, { key: "business", enabled: "false" }, { key: "payment", enabled: 0 }] } as unknown as ThermalPrintTemplate;
    const doc = documentFor({ template });
    expect(doc.body.textContent).toContain("Taquería de prueba");
    expect(doc.body.textContent).toContain("Pago pendiente");
    expect(documentFor({ template: { fields: "invalid" } as unknown as ThermalPrintTemplate }).body.textContent).toContain("Taquería de prueba");
    const missing = documentFor({ businessName: undefined, order: { ...order, customer_name: null, payment_method: null }, template: { fields: [{ key: "customer", enabled: true }, { key: "business", enabled: true }, { key: "payment", enabled: true }] } });
    expect(missing.querySelector(".thermal-business")).toBeNull();
    expect(missing.body.textContent).not.toMatch(/Cliente sin nombre|Método de pago|Cliente:/);
  });
});

describe("thermal print samples", () => {
  it.each([
    { paperWidth: 58 as const, kitchen: false }, { paperWidth: 80 as const, kitchen: false },
    { paperWidth: 58 as const, kitchen: true }, { paperWidth: 80 as const, kitchen: true },
  ])("renders a clearly synthetic sample at $paperWidth mm (kitchen=$kitchen)", ({ paperWidth, kitchen }) => {
    const options = createThermalPrintSample({ businessName: "Café de prueba", branchName: "Sucursal de prueba", paperWidth, kitchen });
    const doc = documentFor(options);
    expect(options.test).toBe(true);
    expect(doc.querySelector(".thermal-test-marker")?.textContent).toBe("PRUEBA DE IMPRESION - SIN VALOR COMERCIAL");
    expect(doc.querySelector(".thermal-document")?.getAttribute("data-paper-width")).toBe(String(paperWidth));
    expect(doc.body.textContent).toContain("Hamburguesa artesanal de champiñones con cebolla caramelizada - ClásicaS/ 50.00");
    expect(doc.body.textContent).toContain("Sin ají; servir la salsa aparte.");
    expect(doc.body.textContent).toContain("Comprobar que esta nota se lea completa.");
    expect(doc.body.textContent).toContain("SALSAS");
    expect(doc.body.textContent).toContain("2 x Ají amarilloS/ 0.00");
    expect(doc.body.textContent).toContain("EXTRAS");
    expect(doc.body.textContent).toContain("4 x Porción de quesoS/ 8.00");
    expect(doc.body.textContent).toContain("1 x Limonada de maracuyá - FríaS/ 6.50");
    expect(doc.body.textContent).toContain("Sin folio");
    expect(doc.body.textContent).toContain("12:30");
    expect(doc.querySelector(".thermal-channel")?.textContent).toBe("PARA LLEVAR");
    expect(doc.querySelectorAll(".thermal-code, script, link, img, iframe")).toHaveLength(0);
    expect(doc.body.textContent).not.toMatch(/Tomada por|Tomado en punto de venta|Folio #|Comanda #|Monto cobrado/);
    expect(options.order.id).toBe(0);
    expect(options.order.business_id).toBe(0);
    expect(options.order.branch_id).toBe(0);
    expect(options.order.number).toBe("");
    expect(options.order.folio).toBeNull();
    expect(options.order.payments).toEqual([]);
    expect(options.order.kitchen_tickets).toEqual([]);
    expect(options.order.items.every((item) => item.product_id === null && item.id < 0)).toBe(true);
    if (kitchen) {
      expect(options.ticket?.created_by).toBeNull();
      expect(options.ticket?.created_by_name).toBeNull();
      expect(options.ticket?.order_folio).toBeNull();
      expect(options.ticket?.sequence).toBeUndefined();
      expect(doc.querySelector(".thermal-totals, .thermal-payment")).toBeNull();
    } else {
      expect(options.ticket).toBeUndefined();
      expect(doc.querySelector(".thermal-business")?.textContent).toBe("Café de prueba");
      expect(doc.querySelector("header")?.textContent).toContain("Sucursal de prueba");
      expect(doc.querySelector(".thermal-totals")?.textContent).toContain("ProductosS/ 64.50");
      expect(doc.querySelector(".thermal-totals")?.textContent).toContain("DescuentoS/ -4.50");
      expect(doc.querySelector(".thermal-total")?.textContent).toBe("Monto a pagarS/ 60.00");
    }
  });

  it.each([
    { paperWidth: 58 as const, kitchen: false }, { paperWidth: 80 as const, kitchen: false },
    { paperWidth: 58 as const, kitchen: true }, { paperWidth: 80 as const, kitchen: true },
  ])("renders a short one-item sample without modifiers at $paperWidth mm (kitchen=$kitchen)", ({ paperWidth, kitchen }) => {
    const options = createThermalPrintSample({ paperWidth, kitchen, short: true });
    const doc = documentFor(options);
    expect(options.order.items).toHaveLength(1);
    expect(options.order.items[0].modifiers).toEqual([]);
    expect(options.order.subtotal).toBe(6.5);
    expect(options.order.discount).toBe(0);
    expect(options.order.total).toBe(6.5);
    expect(options.order.remaining_amount).toBe(6.5);
    expect(doc.querySelectorAll(".thermal-item")).toHaveLength(1);
    expect(doc.querySelector(".thermal-item-heading")?.textContent).toBe("1 x Limonada de maracuyá - FríaS/ 6.50");
    expect(doc.querySelector(".thermal-modifiers, .thermal-note, .thermal-order-note")).toBeNull();
    expect(doc.querySelector(".thermal-test-marker")?.textContent).toBe("PRUEBA DE IMPRESION - SIN VALOR COMERCIAL");
    expect(doc.querySelector(".thermal-document")?.getAttribute("data-paper-width")).toBe(String(paperWidth));
    expect(doc.body.textContent).not.toMatch(/Hamburguesa|Descuento|Tomada por|Folio #|Comanda #/);
    if (kitchen) {
      expect(options.ticket?.items).toHaveLength(1);
      expect(options.ticket?.items[0].modifiers).toEqual([]);
      expect(doc.querySelector(".thermal-totals, .thermal-payment")).toBeNull();
    } else {
      expect(doc.querySelector(".thermal-total")?.textContent).toBe("Monto a pagarS/ 6.50");
    }
  });

  it("keeps the full sample as the default after a short diagnostic", () => {
    createThermalPrintSample({ paperWidth: 80, short: true });
    const full = createThermalPrintSample({ paperWidth: 80 });
    expect(full).toEqual(createThermalPrintSample({ paperWidth: 80, short: false }));
    expect(full.order.items).toHaveLength(2);
    expect(full.order.items[0].modifiers).toHaveLength(3);
    expect(full.order.discount).toBe(4.5);
  });

  it.each([false, true])("uses consistent inclusive line amounts and discount totals (short=%s)", (short) => {
    const { order: sample } = createThermalPrintSample({ paperWidth: 80, short });
    expect(sample.items.map((item) => item.quantity * item.unit_price)).toEqual(sample.items.map((item) => item.line_total));
    expect(sample.items.reduce((sum, item) => sum + item.line_total, 0)).toBe(sample.subtotal);
    expect(sample.subtotal - sample.discount + sample.delivery_fee).toBe(sample.total);
    expect(sample.total - sample.paid_amount).toBe(sample.remaining_amount);
  });

  it("preserves caller templates and applies optional fields without hiding the sample warning", () => {
    const template = { fields: [{ key: "business", enabled: false }, { key: "notes", enabled: false }, { key: "payment", enabled: false }] };
    const before = JSON.stringify(template);
    const options = createThermalPrintSample({ businessName: "Negocio oculto", paperWidth: 80, template });
    expect(options.template).toBe(template);
    const doc = documentFor(options);
    expect(doc.querySelector(".thermal-test-marker")).not.toBeNull();
    expect(doc.querySelector(".thermal-totals")).not.toBeNull();
    expect(doc.querySelector(".thermal-note, .thermal-order-note, .thermal-payment, .thermal-business")).toBeNull();
    expect(JSON.stringify(template)).toBe(before);
  });

  it("returns fresh independent order and kitchen fixtures on every call", () => {
    const input = { paperWidth: 58 as const, kitchen: true };
    const first = createThermalPrintSample(input);
    const second = createThermalPrintSample(input);
    expect(first).toEqual(second);
    first.order.items[0].modifiers[0].name = "Cambio local";
    expect(first.ticket?.items[0].modifiers?.[0].name).toBe("Ají amarillo");
    expect(second.order.items[0].modifiers[0].name).toBe("Ají amarillo");
    first.ticket!.items[0].modifiers![0].name = "Otra modificación";
    expect(second.ticket?.items[0].modifiers?.[0].name).toBe("Ají amarillo");
    expect(createThermalPrintSample(input)).toEqual(second);
  });
});
