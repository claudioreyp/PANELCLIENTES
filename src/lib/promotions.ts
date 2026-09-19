import type { ProductServiceChannel, Promotion } from "../types";

export type PromotionalLine = {
  productId: number;
  categoryId: number | null;
  unitPrice: number;
  quantity: number;
  variantName?: string | null;
};

export type PromotionCalculation = {
  subtotal: number;
  discount: number;
  total: number;
  lineDiscounts: number[];
  appliedPromotionIds: number[];
};

export type ProductPromotionPreview = {
  promotionalPrice: number | null;
  label: string | null;
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function targetsLine(promotion: Promotion, line: PromotionalLine) {
  return promotion.target_scope === "products"
    ? promotion.target_ids.includes(line.productId)
    : line.categoryId !== null && promotion.target_ids.includes(line.categoryId);
}

function isEligible(promotion: Promotion, channel: ProductServiceChannel, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map((part) => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  return promotion.active
    && !promotion.archived_at
    && (!promotion.starts_on || day >= promotion.starts_on)
    && (!promotion.ends_on || day <= promotion.ends_on)
    && (!promotion.weekdays?.length || promotion.weekdays.includes(weekday))
    && (!promotion.service_channels.length || promotion.service_channels.includes(channel));
}

export function calculatePromotions(
  lines: PromotionalLine[],
  promotions: Promotion[],
  channel: ProductServiceChannel,
): PromotionCalculation {
  const subtotal = roundMoney(lines.reduce(
    (sum, line) => sum + Math.max(0, line.unitPrice) * Math.max(0, line.quantity),
    0,
  ));
  const bestByLine = lines.map(() => ({ discount: 0, promotionId: 0 }));

  for (const promotion of promotions.filter((item) => isEligible(item, channel))) {
    const eligibleIndexes = lines
      .map((line, index) => targetsLine(promotion, line) ? index : -1)
      .filter((index) => index >= 0);
    if (!eligibleIndexes.length) continue;

    if (promotion.promotion_type === "product_discount") {
      for (const index of eligibleIndexes) {
        const line = lines[index];
        const gross = line.unitPrice * line.quantity;
        const discount = promotion.discount_type === "percentage"
          ? gross * Number(promotion.discount_value ?? 0) / 100
          : Number(promotion.discount_value ?? 0) * line.quantity;
        const candidate = roundMoney(Math.min(Math.max(0, discount), gross));
        if (candidate > bestByLine[index].discount) {
          bestByLine[index] = { discount: candidate, promotionId: promotion.id };
        }
      }
      continue;
    }

    const receive = Number(promotion.receive_quantity ?? 0);
    const pay = Number(promotion.pay_quantity ?? 0);
    if (receive <= pay || pay < 1) continue;
    const groups = new Map<string, number[]>();
    for (const index of eligibleIndexes) {
      const line = lines[index];
      const key = `${line.productId}:${line.variantName ?? "base"}:${roundMoney(line.unitPrice)}`;
      groups.set(key, [...(groups.get(key) ?? []), index]);
    }
    for (const indexes of groups.values()) {
      const quantity = indexes.reduce((sum, index) => sum + lines[index].quantity, 0);
      let freeUnits = Math.floor(quantity / receive) * (receive - pay);
      for (const index of indexes) {
        if (freeUnits <= 0) break;
        const line = lines[index];
        const discountedUnits = Math.min(line.quantity, freeUnits);
        const candidate = roundMoney(discountedUnits * line.unitPrice);
        freeUnits -= discountedUnits;
        if (candidate > bestByLine[index].discount) {
          bestByLine[index] = { discount: candidate, promotionId: promotion.id };
        }
      }
    }
  }

  const discount = roundMoney(bestByLine.reduce((sum, result) => sum + result.discount, 0));
  return {
    subtotal,
    discount,
    total: roundMoney(Math.max(0, subtotal - discount)),
    lineDiscounts: bestByLine.map((result) => result.discount),
    appliedPromotionIds: [...new Set(bestByLine.map((result) => result.promotionId).filter(Boolean))],
  };
}

export function getProductPromotionPreview(
  line: Omit<PromotionalLine, "quantity">,
  promotions: Promotion[],
  channel: ProductServiceChannel,
): ProductPromotionPreview {
  const eligible = promotions.filter((promotion) => isEligible(promotion, channel) && targetsLine(promotion, { ...line, quantity: 1 }));
  let bestDiscount = 0;
  let discountLabel: string | null = null;
  let quantityLabel: string | null = null;

  for (const promotion of eligible) {
    if (promotion.promotion_type === "buy_x_pay_y") {
      const receive = Number(promotion.receive_quantity ?? 0);
      const pay = Number(promotion.pay_quantity ?? 0);
      if (receive > pay && pay > 0 && !quantityLabel) quantityLabel = `${receive}x${pay}`;
      continue;
    }
    const rawDiscount = promotion.discount_type === "percentage"
      ? line.unitPrice * Number(promotion.discount_value ?? 0) / 100
      : Number(promotion.discount_value ?? 0);
    const candidate = roundMoney(Math.min(Math.max(0, rawDiscount), line.unitPrice));
    if (candidate > bestDiscount) {
      bestDiscount = candidate;
      discountLabel = promotion.discount_type === "percentage"
        ? `${Number(promotion.discount_value ?? 0)}% menos`
        : `S/ ${candidate.toFixed(2)} menos`;
    }
  }

  return {
    promotionalPrice: bestDiscount > 0 ? roundMoney(line.unitPrice - bestDiscount) : null,
    label: discountLabel ?? quantityLabel,
  };
}
