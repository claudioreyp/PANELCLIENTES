import { validateProductSelection } from "./catalog";
import {
  changeModifierSelection,
  normalizeModifierSelection,
} from "./modifier-selection";
import type { Product, ProductServiceChannel } from "../types";

export type OrderDraftChannel = "dine_in" | "counter" | "takeaway" | "delivery";

export type OrderCartLine = {
  key: string;
  productId: number;
  name: string;
  variantName?: string;
  quantity: number;
  unitPrice: number;
  modifiers: { modifier_id: number; name: string; price_delta: number }[];
  notes?: string;
};

export type ProductConfigurationResult = {
  line?: OrderCartLine;
  error?: string;
};

export type ModifierToggleResult = {
  selected: number[];
  error?: string;
};

type NamedModifierSelection = {
  modifier_id?: number;
  name: string;
  price_delta?: number;
};

const channelMap: Record<OrderDraftChannel, ProductServiceChannel> = {
  dine_in: "pos_tables",
  counter: "pos_counter",
  takeaway: "pos_takeaway",
  delivery: "pos_delivery",
};

export function productSupportsOrderChannel(product: Product, channel: OrderDraftChannel): boolean {
  return product.available && product.service_channels.includes(channelMap[channel]);
}

export function configureOrderLine(
  product: Product,
  variantId: number | null,
  modifierIds: number[],
  notes: string,
): ProductConfigurationResult {
  const validation = validateProductSelection(product, variantId, modifierIds);
  if (!validation.valid) return { error: validation.message || "Revisa las opciones del producto." };
  const variant = product.variants.find((item) => item.id === variantId && item.active);
  const selectedCounts = new Map<number, number>();
  modifierIds.forEach((modifierId) => {
    selectedCounts.set(modifierId, (selectedCounts.get(modifierId) || 0) + 1);
  });
  const modifiers = product.modifier_groups
    .flatMap((group) => group.modifiers)
    .filter((item) => item.active)
    .flatMap((item) => Array.from({ length: selectedCounts.get(item.id) || 0 }, () => item));
  const normalizedNotes = notes.trim();
  const unitPrice = product.price
    + (variant?.price_delta || 0)
    + modifiers.reduce((sum, item) => sum + item.price_delta, 0);
  const signature = `${product.id}:${variantId || ""}:${[...modifierIds].sort((left, right) => left - right).join(",")}:${normalizedNotes}`;
  return {
    line: {
      key: signature,
      productId: product.id,
      name: product.name,
      variantName: variant?.name,
      quantity: 1,
      unitPrice,
      modifiers: modifiers.map((item) => ({
        modifier_id: item.id,
        name: item.name,
        price_delta: item.price_delta,
      })),
      notes: normalizedNotes || undefined,
    },
  };
}

export function addOrderLine(cart: OrderCartLine[], line: OrderCartLine): OrderCartLine[] {
  const existing = cart.find((item) => item.key === line.key);
  if (!existing) return [...cart, line];
  return cart.map((item) => item.key === line.key ? { ...item, quantity: item.quantity + line.quantity } : item);
}

export function changeOrderLineQuantity(cart: OrderCartLine[], key: string, delta: number): OrderCartLine[] {
  return cart.flatMap((item) => {
    if (item.key !== key) return [item];
    const quantity = item.quantity + delta;
    return quantity > 0 ? [{ ...item, quantity }] : [];
  });
}

export function toggleOrderModifier(
  product: Product,
  selected: number[],
  groupId: number,
  modifierId: number,
): ModifierToggleResult {
  const group = product.modifier_groups.find((item) => item.id === groupId);
  if (!group) return { selected };
  const optionIds = group.modifiers.filter((modifier) => modifier.active).map((modifier) => modifier.id);
  const groupIds = new Set(optionIds);
  const selectedInGroup = selected.filter((id) => groupIds.has(id));
  const changed = changeModifierSelection(selectedInGroup, optionIds, modifierId, "toggle", {
    allowRepeats: group.allow_repeats,
    maximum: group.maximum,
    maxPerOption: group.max_per_option,
  });
  return {
    selected: [...selected.filter((id) => !groupIds.has(id)), ...changed.selected],
    error: changed.error ? `${changed.error.replace(/\.$/, "")} de ${group.name}.` : undefined,
  };
}

export function orderModifierGroupSelection(
  product: Product,
  selected: number[],
  groupId: number,
) {
  const group = product.modifier_groups.find((item) => item.id === groupId);
  if (!group) return [];
  const groupIds = new Set(group.modifiers.filter((modifier) => modifier.active).map((modifier) => modifier.id));
  return selected.filter((id) => groupIds.has(id));
}

export function replaceOrderModifierGroupSelection(
  product: Product,
  selected: number[],
  groupId: number,
  nextGroupSelection: number[],
) {
  const group = product.modifier_groups.find((item) => item.id === groupId);
  if (!group) return selected;
  const optionIds = group.modifiers.filter((modifier) => modifier.active).map((modifier) => modifier.id);
  const groupIds = new Set(optionIds);
  const normalized = normalizeModifierSelection(nextGroupSelection, optionIds, {
    allowRepeats: group.allow_repeats,
    maximum: group.maximum,
    maxPerOption: group.max_per_option,
  });
  return [...selected.filter((id) => !groupIds.has(id)), ...normalized];
}

export function modifierSelectionLabel(modifiers: NamedModifierSelection[]) {
  const summaries = new Map<string, { name: string; count: number }>();
  modifiers.forEach((modifier) => {
    const key = modifier.modifier_id == null
      ? `name:${modifier.name.trim().toLocaleLowerCase("es-PE")}`
      : `id:${modifier.modifier_id}`;
    const current = summaries.get(key);
    summaries.set(key, {
      name: current?.name || modifier.name,
      count: (current?.count || 0) + 1,
    });
  });
  return [...summaries.values()]
    .map((modifier) => modifier.count > 1 ? `${modifier.name} ×${modifier.count}` : modifier.name)
    .join(", ");
}

export function orderCartSubtotal(cart: OrderCartLine[]): number {
  return cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

export function serializeOrderCart(cart: OrderCartLine[]) {
  return cart.map((item) => ({
    product_id: item.productId,
    variant_name: item.variantName || null,
    quantity: item.quantity,
    modifiers: item.modifiers,
    notes: item.notes || null,
  }));
}
