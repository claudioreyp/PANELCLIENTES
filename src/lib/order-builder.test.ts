import { describe, expect, it } from "vitest";
import type { Product } from "../types";
import {
  addOrderLine,
  changeOrderLineQuantity,
  configureOrderLine,
  modifierSelectionLabel,
  orderModifierGroupSelection,
  productSupportsOrderChannel,
  replaceOrderModifierGroupSelection,
  serializeOrderCart,
  toggleOrderModifier,
} from "./order-builder";

const product: Product = {
  id: 12,
  category_id: 2,
  sku: "PIZZA",
  name: "Pizza",
  price: 20,
  service_channels: ["pos_tables", "pos_counter", "pos_delivery"],
  product_type: "standard",
  available: true,
  track_stock: false,
  preparation_station: "kitchen",
  sort_order: 0,
  variants: [{ id: 4, name: "Familiar", price_delta: 8, active: true }],
  modifier_groups: [{
    id: 9,
    branch_id: 1,
    name: "Extras",
    minimum: 0,
    maximum: 1,
    required: false,
    allow_repeats: false,
    sort_order: 0,
    modifiers: [
      { id: 7, name: "Queso", price_delta: 3, active: true, sort_order: 0 },
      { id: 8, name: "Aceitunas", price_delta: 2, active: true, sort_order: 1 },
    ],
  }],
  recipe: [],
  combo_components: [],
};

describe("shared order builder", () => {
  it("configures variants, modifiers and kitchen notes with an absolute unit price", () => {
    const result = configureOrderLine(product, 4, [7], "sin cortar");
    expect(result.error).toBeUndefined();
    expect(result.line).toMatchObject({
      productId: 12,
      variantName: "Familiar",
      unitPrice: 31,
      notes: "sin cortar",
      modifiers: [{ modifier_id: 7, name: "Queso", price_delta: 3 }],
    });
  });

  it("merges equal configurations and removes a line when quantity reaches zero", () => {
    const line = configureOrderLine(product, 4, [7], "").line!;
    const merged = addOrderLine(addOrderLine([], line), line);
    expect(merged[0].quantity).toBe(2);
    expect(changeOrderLineQuantity(merged, line.key, -2)).toEqual([]);
    expect(serializeOrderCart(merged)[0]).toMatchObject({ quantity: 2, variant_name: "Familiar" });
  });

  it("enforces modifier maximums and service channels", () => {
    const toggle = toggleOrderModifier(product, [7], 9, 8);
    expect(toggle.selected).toEqual([8]);
    expect(productSupportsOrderChannel(product, "dine_in")).toBe(true);
    expect(productSupportsOrderChannel(product, "counter")).toBe(true);
    expect(productSupportsOrderChannel(product, "takeaway")).toBe(false);
  });

  it("preserves repeated identifiers, prices every unit and groups the operator label", () => {
    const repeatedProduct: Product = {
      ...product,
      modifier_groups: [{
        ...product.modifier_groups[0],
        maximum: 4,
        allow_repeats: true,
        max_per_option: 3,
      }],
    };
    const result = configureOrderLine(repeatedProduct, 4, [7, 7, 7, 8], "");

    expect(result.line?.unitPrice).toBe(39);
    expect(result.line?.modifiers.map((modifier) => modifier.modifier_id)).toEqual([7, 7, 7, 8]);
    expect(serializeOrderCart([result.line!])[0].modifiers).toHaveLength(4);
    expect(modifierSelectionLabel(result.line!.modifiers)).toBe("Queso ×3, Aceitunas");
    expect(result.line?.key).not.toBe(configureOrderLine(repeatedProduct, 4, [7, 8], "").line?.key);
  });

  it("reconstructs and replaces only the edited modifier group", () => {
    const repeatedProduct: Product = {
      ...product,
      modifier_groups: [{
        ...product.modifier_groups[0],
        maximum: 4,
        allow_repeats: true,
        max_per_option: 3,
      }],
    };

    expect(orderModifierGroupSelection(repeatedProduct, [7, 7, 8], 9)).toEqual([7, 7, 8]);
    expect(replaceOrderModifierGroupSelection(repeatedProduct, [7, 7, 8], 9, [8, 8])).toEqual([8, 8]);
  });
});
