import { describe, expect, it } from "vitest";
import {
  buildCheckoutPaymentPlan,
  normalizeCheckoutPaymentMethods,
} from "./order-checkout";

describe("order checkout", () => {
  it("keeps configured methods unique and in a stable order", () => {
    expect(normalizeCheckoutPaymentMethods(["transfer", "cash", "cash", "unknown", "card"]))
      .toEqual(["cash", "card", "transfer"]);
  });

  it("records only the order total as cash and returns the change", () => {
    expect(buildCheckoutPaymentPlan({
      total: 30,
      mode: "cash",
      tenders: { cash: 50 },
      cashSessionId: 4,
    })).toEqual({
      payments: [{ method: "cash", amount: 30, cashReceived: 50, cashSessionId: 4 }],
      change: 20,
      error: null,
    });
  });

  it("allows the backend to open the default cash period", () => {
    expect(buildCheckoutPaymentPlan({
      total: 30,
      mode: "cash",
      tenders: { cash: 30 },
      cashSessionId: null,
    })).toEqual({
      payments: [{ method: "cash", amount: 30, cashReceived: 30 }],
      change: 0,
      error: null,
    });
  });

  it("requires a selection when several cash periods are available", () => {
    expect(buildCheckoutPaymentPlan({
      total: 30,
      mode: "cash",
      tenders: { cash: 30 },
      cashSessionId: null,
      cashSessionRequired: true,
    }).error).toContain("Selecciona la caja");
  });

  it("builds a balanced multi-method payment without overcharging", () => {
    expect(buildCheckoutPaymentPlan({
      total: 30,
      mode: "multiple",
      tenders: { cash: 20, card: 10 },
      cashSessionId: 8,
    })).toEqual({
      payments: [
        { method: "cash", amount: 20, cashReceived: 20, cashSessionId: 8 },
        { method: "card", amount: 10, cashSessionId: 8 },
      ],
      change: 0,
      error: null,
    });
  });

  it("rejects non-cash allocations above the order total", () => {
    expect(buildCheckoutPaymentPlan({
      total: 30,
      mode: "multiple",
      tenders: { card: 20, transfer: 20 },
      cashSessionId: null,
    }).error).toBe("Lo cobrado por medios distintos al efectivo no puede exceder el total.");
  });
});
