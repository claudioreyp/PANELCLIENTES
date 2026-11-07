import type { AgentAttention, Order } from "../types";
import { whatsappPhone } from "./order-presentation";

const agentSources = new Set(["whatsapp_agent", "agent", "n8n", "whatsapp"]);

export function isAgentAttentionOrder(order: Order | null) {
  return Boolean(order && typeof order.source === "string" && agentSources.has(order.source.trim().toLowerCase()));
}

function contactName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").replace(/[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "").trim().replace(/\s+/g, " ");
  return name && name.length <= 120 && !/@(?:lid|c\.us|s\.whatsapp\.net|g\.us|broadcast)\b/i.test(name) ? name : null;
}

export function attentionPhone(value: unknown) {
  if (typeof value !== "string") return null;
  // A LID can contain as many digits as a phone. Check its type before
  // applying the existing POS phone formatter; never strip an unknown JID.
  const phone = value.trim().replace(/@(?:s\.whatsapp\.net|c\.us)$/i, "");
  if (!/^\+?[\d ()-]+$/.test(phone)) return null;
  const normalized = whatsappPhone(phone);
  return normalized ? `+${normalized}` : null;
}

export function attentionContact(item: AgentAttention, order: Order | null = null) {
  const enriched = item.contact_display_name !== undefined || item.contact_phone !== undefined;
  // Explicit null from the API is authoritative (including ambiguous identity).
  // Legacy responses can still use the customer on this verified linked order.
  const name = contactName(enriched ? item.contact_display_name : order?.customer_name);
  const phone = attentionPhone(enriched ? item.contact_phone : order?.customer_phone) || attentionPhone(item.sender);
  return [name, phone].filter(Boolean).join(" · ") || "Contacto no disponible";
}
