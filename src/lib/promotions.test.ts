import { describe, expect, it } from "vitest";
import { calculatePromotions, getProductPromotionPreview } from "./promotions";
import type { Promotion } from "../types";

function promotion(overrides: Partial<Promotion>): Promotion {
  return {
    id: 1,
    business_id: 1,
    branch_id: 1,
    name: "Promoción",
    promotion_type: "product_discount",
    discount_type: "percentage",
    discount_value: 10,
    receive_quantity: null,
    pay_quantity: null,
    target_scope: "products",
    target_ids: [1],
    starts_on: null,
    ends_on: null,
    weekdays: [],
    service_channels: ["digital_takeaway"],
    active: true,
    sort_order: 0,
    archived_at: null,
    version: 1,
    ...overrides,
  };
}

describe("promotion calculations", () => {
  it("uses only the promotion with the greatest saving per line", () => {
    const result = calculatePromotions(
      [{ productId: 1, categoryId: 4, unitPrice: 20, quantity: 2 }],
      [
        promotion({ id: 1, discount_type: "percentage", discount_value: 10 }),
        promotion({ id: 2, discount_type: "fixed_amount", discount_value: 5 }),
      ],
      "digital_takeaway",
    );

    expect(result).toMatchObject({ subtotal: 40, discount: 10, total: 30 });
    expect(result.appliedPromotionIds).toEqual([2]);
  });

  it("caps a fixed discount so a line can never become negative", () => {
    const result = calculatePromotions(
      [{ productId: 1, categoryId: 4, unitPrice: 3.5, quantity: 2 }],
      [promotion({ discount_type: "fixed_amount", discount_value: 10 })],
      "digital_takeaway",
    );

    expect(result).toMatchObject({ subtotal: 7, discount: 7, total: 0 });
  });

  it("calculates buy X pay Y separately for each product and variant", () => {
    const result = calculatePromotions(
      [
        { productId: 1, categoryId: 4, unitPrice: 20, quantity: 2, variantName: "Personal" },
        { productId: 1, categoryId: 4, unitPrice: 30, quantity: 1, variantName: "Familiar" },
        { productId: 2, categoryId: 4, unitPrice: 20, quantity: 1, variantName: "Personal" },
      ],
      [promotion({
        promotion_type: "buy_x_pay_y",
        discount_type: null,
        discount_value: null,
        receive_quantity: 2,
        pay_quantity: 1,
        target_scope: "categories",
        target_ids: [4],
      })],
      "digital_takeaway",
    );

    expect(result.subtotal).toBe(90);
    expect(result.discount).toBe(20);
    expect(result.total).toBe(70);
    expect(result.lineDiscounts).toEqual([20, 0, 0]);
  });

  it("ignores promotions from another service channel", () => {
    const result = calculatePromotions(
      [{ productId: 1, categoryId: 4, unitPrice: 20, quantity: 1 }],
      [promotion({ service_channels: ["digital_delivery"] })],
      "digital_takeaway",
    );

    expect(result.discount).toBe(0);
  });

  it("returns a clear product preview for discount and quantity promotions", () => {
    expect(getProductPromotionPreview(
      { productId: 1, categoryId: 4, unitPrice: 20 },
      [promotion({ discount_value: 25 })],
      "digital_takeaway",
    )).toEqual({ promotionalPrice: 15, label: "25% menos" });

    expect(getProductPromotionPreview(
      { productId: 1, categoryId: 4, unitPrice: 20 },
      [promotion({
        promotion_type: "buy_x_pay_y",
        discount_type: null,
        discount_value: null,
        receive_quantity: 3,
        pay_quantity: 2,
      })],
      "digital_takeaway",
    )).toEqual({ promotionalPrice: null, label: "3x2" });
  });
});
