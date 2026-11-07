import { expect, it } from "vitest";
import type { AgentAttention, Order } from "../types";
import { attentionContact, attentionPhone, isAgentAttentionOrder } from "./agent-attention-presentation";

const item = { sender: "7499818262692@lid" } as AgentAttention;

it.each(["whatsapp_agent", "agent", "n8n", "whatsapp", " WHATSAPP_AGENT "])("recognizes an agent-created order: %s", source => {
  expect(isAgentAttentionOrder({ source } as Order)).toBe(true);
});
it.each(["pos", "manual", "public_store", "integration", "unknown", ""])("does not reclassify a non-agent order: %s", source => {
  expect(isAgentAttentionOrder({ source, recent_modification: { source: "agent" }, recent_agent_addition: { source: "agent" } } as Order)).toBe(false);
});
it.each(["7499818262692@lid", "51900000000@g.us", "51900000000@broadcast", "phone51900000000", "", "+000000000", null])("rejects internal or invalid contact phones: %s", value => {
  expect(attentionPhone(value)).toBeNull();
});
it.each(["51900000000", "+51 900 000 000", "51900000000@s.whatsapp.net", "51900000000@c.us", "900000000"])("formats a real phone: %s", value => {
  expect(attentionPhone(value)).toBe("+51900000000");
});
it("shows both provider fields, one available field, or the explicit no-contact state", () => {
  expect(attentionContact({ ...item, contact_display_name: "Ana", contact_phone: "51900000000" })).toBe("Ana · +51900000000");
  expect(attentionContact({ ...item, contact_display_name: "Ana", contact_phone: null })).toBe("Ana");
  expect(attentionContact({ ...item, contact_display_name: null, contact_phone: "51900000000" })).toBe("+51900000000");
  expect(attentionContact(item)).toBe("Contacto no disponible");
});
it("keeps explicit unknown server identity authoritative and supports legacy linked orders", () => {
  const order = { customer_name: "Otra persona", customer_phone: "51911111111" } as Order;
  expect(attentionContact({ ...item, contact_display_name: null, contact_phone: null }, order)).toBe("Contacto no disponible");
  expect(attentionContact(item, order)).toBe("Otra persona · +51911111111");
  expect(attentionContact({ ...item, sender: "51900000000", contact_display_name: null, contact_phone: null })).toBe("+51900000000");
});
it("treats display names as text and removes control characters and internal identifiers", () => {
  expect(attentionContact({ ...item, contact_display_name: " Ana\u202e\n López " })).toBe("Ana López");
  expect(attentionContact({ ...item, contact_display_name: "7499818262692@lid" })).toBe("Contacto no disponible");
  expect(attentionContact({ ...item, contact_display_name: "a".repeat(121) })).toBe("Contacto no disponible");
});
