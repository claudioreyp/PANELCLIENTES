import { describe, expect, it } from "vitest";
import { availabilityPath, catalogAvailabilityItems, productUnavailableReason, updateCatalogAvailability } from "./availability";
import { normalizeCatalogPayload, validateProductSelection } from "./catalog";
import type { Catalog } from "../types";

const catalog = normalizeCatalogPayload({ branch: { id: 1 }, categories: [{ id: 1, name: "Alitas", active: true }], products: [{
  id: 1, category_id: 1, name: "Alitas", available: true,
  variants: [{ id: 1, name: "Chico", active: true, available: false }, { id: 2, name: "Grande", active: true, available: true }, { id: 3, name: "Eliminada", active: false }],
  modifier_groups: [{ id: 9, name: "Salsas", minimum: 1, maximum: 2, allow_repeats: false, modifiers: [{ id: 1, name: "BBQ", active: true, available: true }] }],
}], modifier_groups: [{ id: 9, name: "Salsas", minimum: 1, maximum: 2, modifiers: [{ id: 1, name: "BBQ", active: true, available: true }, { id: 2, name: "Borrada", active: false }] }] } as Catalog);

describe("catalog availability", () => {
  it("lists mixed alphabetical rows with distinct keys and hides archives", () => {
    const rows = catalogAvailabilityItems(catalog);
    expect(rows.map((row) => row.name)).toEqual(["Alitas - Chico", "Alitas - Grande", "BBQ"]);
    expect(rows.map((row) => row.key)).toEqual(["variant:1", "variant:2", "modifier:1"]);
    expect(availabilityPath(rows[2])).toBe("/catalog/modifiers/1/availability");
  });
  it("updates linked groups and respects obligatory total capacity", () => {
    const next = updateCatalogAvailability(catalog, catalogAvailabilityItems(catalog)[2], false);
    expect(next.modifier_groups[0].modifiers[0].available).toBe(false);
    expect(productUnavailableReason(next.products[0])).toContain("Salsas");
    expect(validateProductSelection(next.products[0], 2, [1]).valid).toBe(false);
    expect(catalog.products[0].modifier_groups[0].modifiers[0].available).toBe(true);
  });
  it("does not sell a disabled variant or silently discard an optional selected extra", () => {
    expect(validateProductSelection(catalog.products[0], 1, [1]).valid).toBe(false);
    const next = structuredClone(catalog.products[0]);
    next.modifier_groups[0].minimum = 0;
    next.modifier_groups[0].modifiers[0].available = false;
    expect(validateProductSelection(next, 2, [1]).message).toContain("seleccionada");
  });
  it("accounts for repeated capacity, individual limits and no available options", () => {
    const next = structuredClone(catalog.products[0]);
    const group = next.modifier_groups[0];
    group.allow_repeats = true; group.minimum = 2; group.max_per_option = 2;
    expect(productUnavailableReason(next)).toBeNull();
    group.max_per_option = 1;
    expect(productUnavailableReason(next)).toContain("Salsas");
    group.max_per_option = null; group.modifiers[0].available = false;
    expect(productUnavailableReason(next)).toContain("Salsas");
  });
});
