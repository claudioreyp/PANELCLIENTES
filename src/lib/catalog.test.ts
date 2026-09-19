import { describe, expect, it } from "vitest";
import {
  availableModifierGroupsForProduct,
  categoryDeleteEligibility,
  duplicateModifierGroupPayload,
  filterCatalogModifierGroups,
  generateProductSku,
  hasCrossedReorderThreshold,
  menuVisibleProducts,
  modifierGroupUsageCounts,
  modifierGroupsForProduct,
  normalizeCatalogPayload,
  priceRowsToPayload,
  productAbsolutePrices,
  reorderCatalogCategories,
  reorderCatalogModifierGroups,
  reorderCatalogProducts,
  upsertCatalogCategory,
  validateProductSelection,
} from "./catalog";
import type { Catalog } from "../types";

describe("normalizeCatalogPayload", () => {
  it("fills composition collections omitted by the legacy API", () => {
    const payload = {
      branch: { id: 7 },
      categories: [{ id: 2, name: " Bebidas ", color: "", sort_order: 0 }],
      products: [{ id: 3, name: "Pizza", price: 25 }],
    } as unknown as Catalog;

    const catalog = normalizeCatalogPayload(payload);

    expect(catalog.modifier_groups).toEqual([]);
    expect(catalog.ingredients).toEqual([]);
    expect(catalog.categories).toEqual([
      { id: 2, name: "Bebidas", color: "#2aa775", sort_order: 0, active: true },
    ]);
    expect(catalog.products[0]).toMatchObject({
      id: 3,
      product_type: "standard",
      available: true,
      preparation_station: "kitchen",
      variants: [],
      modifier_groups: [],
      recipe: [],
      combo_components: [],
    });
  });

  it("enforces active variants and modifier group limits before adding to an order", () => {
    const product = normalizeCatalogPayload({
      branch: { id: 7 },
      categories: [],
      modifier_groups: [],
      ingredients: [],
      products: [{
        id: 3,
        name: "Pizza",
        price: 25,
        variants: [
          { id: 10, name: "Personal", price_delta: 0, active: true },
          { id: 11, name: "Familiar", price_delta: 20, active: false },
        ],
        modifier_groups: [{
          id: 8,
          name: "Salsas",
          minimum: 1,
          maximum: 1,
          required: true,
          modifiers: [
            { id: 20, name: "Ajo", price_delta: 0, active: true },
            { id: 21, name: "BBQ", price_delta: 1, active: true },
          ],
        }],
      }],
    } as unknown as Catalog).products[0];

    expect(validateProductSelection(product, null, [])).toMatchObject({ valid: false });
    expect(validateProductSelection(product, 11, [20])).toMatchObject({ valid: false });
    expect(validateProductSelection(product, 10, [])).toMatchObject({ valid: false });
    expect(validateProductSelection(product, 10, [20, 21])).toMatchObject({ valid: false });
    expect(validateProductSelection(product, 10, [20])).toEqual({ valid: true });
    expect(validateProductSelection(product, 10, [20, 20])).toMatchObject({ valid: false });
  });

  it("validates repeated modifiers against total and per-option limits", () => {
    const product = normalizeCatalogPayload({
      branch: { id: 7 },
      categories: [],
      modifier_groups: [],
      ingredients: [],
      products: [{
        id: 3,
        name: "Alitas",
        price: 25,
        modifier_groups: [{
          id: 8,
          name: "Salsas",
          minimum: 2,
          maximum: 4,
          required: true,
          allow_repeats: true,
          max_per_option: 3,
          modifiers: [
            { id: 20, name: "Ajo", price_delta: 1, active: true },
            { id: 21, name: "BBQ", price_delta: 2, active: true },
          ],
        }],
      }],
    } as unknown as Catalog).products[0];

    expect(validateProductSelection(product, null, [20, 20])).toEqual({ valid: true });
    expect(validateProductSelection(product, null, [20])).toMatchObject({ valid: false });
    expect(validateProductSelection(product, null, [20, 20, 20, 20])).toMatchObject({ valid: false });
    expect(validateProductSelection(product, null, [20, 20, 20, 21, 21])).toMatchObject({ valid: false });
  });

  it("round-trips absolute variant prices through the API price-delta model", () => {
    const payload = priceRowsToPayload([
      { key: "personal", name: "Personal", price: 15 },
      { key: "mediana", name: "Mediana", price: 27 },
      { key: "familiar", name: "Familiar", price: 48 },
    ]);

    expect(payload).toEqual({
      basePrice: 15,
      variants: [
        { id: undefined, name: "Personal", price_delta: 0 },
        { id: undefined, name: "Mediana", price_delta: 12 },
        { id: undefined, name: "Familiar", price_delta: 33 },
      ],
    });

    const product = normalizeCatalogPayload({
      branch: { id: 7 },
      categories: [],
      products: [{
        id: 3,
        name: "Pizza",
        price: payload.basePrice,
        variants: payload.variants.map((variant, index) => ({
          id: index + 1,
          name: variant.name,
          price_delta: variant.price_delta,
          active: true,
        })),
      }],
    } as unknown as Catalog).products[0];

    expect(productAbsolutePrices(product).map(({ name, price }) => ({ name, price }))).toEqual([
      { name: "Personal", price: 15 },
      { name: "Mediana", price: 27 },
      { name: "Familiar", price: 48 },
    ]);
  });

  it("generates stable unique internal SKUs without asking the operator", () => {
    expect(generateProductSku("Pizza Especial Ñ", [])).toBe("PIZZA-ESPECIAL-N");
    expect(generateProductSku("Pizza Especial Ñ", ["PIZZA-ESPECIAL-N", "PIZZA-ESPECIAL-N-2"]))
      .toBe("PIZZA-ESPECIAL-N-3");
  });

  it("keeps a newly created category visible before the next catalog refresh", () => {
    const catalog = normalizeCatalogPayload({
      branch: { id: 7 },
      categories: [{ id: 1, name: "Pizzas", color: "#2aa775", sort_order: 0, active: true }],
      products: [],
    } as unknown as Catalog);

    const next = upsertCatalogCategory(catalog, {
      id: 2,
      name: " Postres ",
      color: "",
      sort_order: 1,
      active: true,
    });

    expect(next?.categories).toEqual([
      { id: 1, name: "Pizzas", color: "#2aa775", sort_order: 0, active: true },
      { id: 2, name: "Postres", color: "#2aa775", sort_order: 1, active: true },
    ]);
  });

  it("reorders active categories while preserving archived records", () => {
    const catalog = normalizeCatalogPayload({
      branch: { id: 7 },
      categories: [
        { id: 1, name: "Pizzas", color: "#2aa775", sort_order: 0, active: true },
        { id: 2, name: "Bebidas", color: "#2aa775", sort_order: 1, active: true },
        { id: 3, name: "Archivada", color: "#2aa775", sort_order: 9, active: false },
      ],
      products: [],
    } as unknown as Catalog);

    const next = reorderCatalogCategories(catalog, 2, 1);

    expect(next.categories.filter((category) => category.active).sort((a, b) => a.sort_order - b.sort_order).map((category) => category.name))
      .toEqual(["Bebidas", "Pizzas"]);
    expect(next.categories.find((category) => category.id === 3)?.sort_order).toBe(9);
  });

  it("reorders products only inside their category", () => {
    const catalog = normalizeCatalogPayload({
      branch: { id: 7 },
      categories: [{ id: 1, name: "Pizzas", color: "#2aa775", sort_order: 0, active: true }],
      products: [
        { id: 10, category_id: 1, name: "Americana", price: 20, sort_order: 0 },
        { id: 11, category_id: 1, name: "Pepperoni", price: 24, sort_order: 1 },
        { id: 12, category_id: null, name: "Sin categoría", price: 5, sort_order: 0 },
      ],
    } as unknown as Catalog);

    const next = reorderCatalogProducts(catalog, 11, 10, 1);

    expect(next.products.filter((product) => product.category_id === 1).sort((a, b) => a.sort_order - b.sort_order).map((product) => product.name))
      .toEqual(["Pepperoni", "Americana"]);
    expect(next.products.find((product) => product.id === 12)?.sort_order).toBe(0);
  });

  it("reorders personalization groups without changing their options", () => {
    const catalog = normalizeCatalogPayload({
      branch: { id: 7 },
      categories: [],
      products: [],
      modifier_groups: [
        { id: 20, branch_id: 7, name: "Salsas", sort_order: 0, modifiers: [{ id: 1, name: "Ajo", price_delta: 0 }] },
        { id: 21, branch_id: 7, name: "Tamaños", sort_order: 1, modifiers: [{ id: 2, name: "Grande", price_delta: 8 }] },
      ],
    } as unknown as Catalog);

    const next = reorderCatalogModifierGroups(catalog, 21, 20);

    expect([...next.modifier_groups].sort((a, b) => a.sort_order - b.sort_order).map((group) => group.name))
      .toEqual(["Tamaños", "Salsas"]);
    expect(next.modifier_groups.find((group) => group.id === 20)?.modifiers[0]?.name).toBe("Ajo");
  });
});

describe("hasCrossedReorderThreshold", () => {
  it("waits until the pointer has deliberately crossed a lower row", () => {
    const input = {
      sourceIndex: 0,
      targetIndex: 1,
      targetTop: 100,
      targetHeight: 80,
    };

    expect(hasCrossedReorderThreshold({ ...input, pointerY: 145 })).toBe(false);
    expect(hasCrossedReorderThreshold({ ...input, pointerY: 150 })).toBe(true);
  });

  it("uses the mirrored threshold when moving a row upward", () => {
    const input = {
      sourceIndex: 2,
      targetIndex: 1,
      targetTop: 100,
      targetHeight: 80,
    };

    expect(hasCrossedReorderThreshold({ ...input, pointerY: 135 })).toBe(false);
    expect(hasCrossedReorderThreshold({ ...input, pointerY: 130 })).toBe(true);
  });

  it("ignores the source row and invalid geometry", () => {
    expect(hasCrossedReorderThreshold({
      sourceIndex: 1,
      targetIndex: 1,
      pointerY: 100,
      targetTop: 80,
      targetHeight: 40,
    })).toBe(false);
    expect(hasCrossedReorderThreshold({
      sourceIndex: 0,
      targetIndex: 1,
      pointerY: 100,
      targetTop: 80,
      targetHeight: 0,
    })).toBe(false);
  });
});

describe("personalization list helpers", () => {
  const catalog = normalizeCatalogPayload({
    branch: { id: 7 },
    categories: [],
    products: [
      {
        id: 10,
        name: "Alitas pausadas",
        price: 25,
        available: false,
        modifier_groups: [{ id: 20, name: "Salsas", internal_label: "Máximo 1", modifiers: [] }],
      },
    ],
    modifier_groups: [
      {
        id: 20,
        branch_id: 7,
        name: "Salsas",
        internal_label: "Máximo 1",
        sort_order: 1,
        modifiers: [{ id: 1, name: "Ají", price_delta: 0, active: true }],
      },
      {
        id: 21,
        branch_id: 7,
        name: "Bebidas",
        internal_label: "Vaso grande",
        sort_order: 0,
        modifiers: [{ id: 2, name: "Chicha morada", price_delta: 2, active: true }],
      },
    ],
  } as unknown as Catalog);

  it("counts assignments from unavailable products", () => {
    expect(modifierGroupUsageCounts(catalog)).toEqual(new Map([[20, 1], [21, 0]]));
    expect(filterCatalogModifierGroups(catalog, "unused").map((group) => group.id)).toEqual([21]);
  });

  it("searches names, labels and option names without accents", () => {
    expect(filterCatalogModifierGroups(catalog, "all", "maximo").map((group) => group.id)).toEqual([20]);
    expect(filterCatalogModifierGroups(catalog, "all", "chicha").map((group) => group.id)).toEqual([21]);
  });

  it("keeps product associations in global order and excludes selected groups from search", () => {
    expect(modifierGroupsForProduct(catalog, [20, 21]).map((group) => group.id)).toEqual([21, 20]);
    expect(availableModifierGroupsForProduct(catalog, [21]).map((group) => group.id)).toEqual([20]);
    expect(availableModifierGroupsForProduct(catalog, [20], "chicha").map((group) => group.id)).toEqual([21]);
  });

  it("duplicates all active rules and options at the requested global position", () => {
    const source = {
      ...catalog.modifier_groups[0],
      minimum: 1,
      maximum: 3,
      allow_repeats: true,
      max_per_option: 2,
      modifiers: [
        ...catalog.modifier_groups[0].modifiers,
        { id: 9, name: "Oculta", price_delta: 4, active: false, sort_order: 2 },
      ],
    };

    expect(duplicateModifierGroupPayload(source, 7, 5)).toEqual({
      branch_id: 7,
      name: "Salsas copia",
      internal_label: "Máximo 1 copia",
      minimum: 1,
      maximum: 3,
      required: true,
      allow_repeats: true,
      max_per_option: 2,
      sort_order: 5,
      modifiers: [{ name: "Ají", price_delta: 0, active: true, sort_order: 0 }],
    });
  });
});

describe("category deletion safeguards", () => {
  function catalogWithProducts(
    products: Array<{ id: number; category_id: number | null; available?: boolean }>,
    inactiveCategoryIds: number[] = [],
  ) {
    return normalizeCatalogPayload({
      branch: { id: 7 },
      categories: [1, 2, 3].map((id) => ({
        id,
        name: `Categoría ${id}`,
        color: "#2aa775",
        sort_order: id,
        active: !inactiveCategoryIds.includes(id),
      })),
      products: products.map((product) => ({
        ...product,
        name: `Producto ${product.id}`,
        price: 10,
        sort_order: product.id,
      })),
    } as unknown as Catalog);
  }

  it("blocks deleting the category that contains the restaurant's last visible products", () => {
    const catalog = catalogWithProducts([
      { id: 10, category_id: 1 },
      { id: 11, category_id: 1 },
    ]);

    expect(categoryDeleteEligibility(catalog, 1)).toEqual({
      allowed: false,
      categoryProductCount: 2,
      remainingProductCount: 0,
    });
  });

  it("allows deletion when another active category still has a visible product", () => {
    const catalog = catalogWithProducts([
      { id: 10, category_id: 1 },
      { id: 11, category_id: 2 },
    ]);

    expect(categoryDeleteEligibility(catalog, 1)).toMatchObject({
      allowed: true,
      categoryProductCount: 1,
      remainingProductCount: 1,
    });
  });

  it("does not count products from a previously removed category as remaining menu items", () => {
    const catalog = catalogWithProducts([
      { id: 10, category_id: 1 },
      { id: 11, category_id: 2 },
    ], [2]);

    expect(menuVisibleProducts(catalog).map((product) => product.id)).toEqual([10]);
    expect(categoryDeleteEligibility(catalog, 1).allowed).toBe(false);
  });

  it("allows deleting an empty category", () => {
    const catalog = catalogWithProducts([{ id: 10, category_id: 2 }]);

    expect(categoryDeleteEligibility(catalog, 1)).toEqual({
      allowed: true,
      categoryProductCount: 0,
      remainingProductCount: 1,
    });
  });
});
