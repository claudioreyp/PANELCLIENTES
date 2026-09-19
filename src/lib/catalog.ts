import type { Catalog, Category, ModifierGroup, Product, ProductServiceChannel } from "../types";
import { productUnavailableReason } from "./availability";

export const DEFAULT_PRODUCT_SERVICE_CHANNELS: ProductServiceChannel[] = [
  "pos_tables",
  "pos_counter",
  "pos_takeaway",
  "pos_delivery",
  "digital_tables",
  "digital_takeaway",
  "digital_delivery",
];

export type AbsolutePriceRow = {
  id?: number;
  key: string;
  name: string;
  price: number;
};

export type ProductSelectionValidation = {
  valid: boolean;
  message?: string;
};

export type CategoryDeleteEligibility = {
  allowed: boolean;
  categoryProductCount: number;
  remainingProductCount: number;
};

export type ModifierGroupListFilter = "all" | "unused";

type ReorderThresholdInput = {
  sourceIndex: number;
  targetIndex: number;
  pointerY: number;
  targetTop: number;
  targetHeight: number;
  threshold?: number;
};

export function hasCrossedReorderThreshold({
  sourceIndex,
  targetIndex,
  pointerY,
  targetTop,
  targetHeight,
  threshold = 0.62,
}: ReorderThresholdInput): boolean {
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex || targetHeight <= 0) return false;
  const progress = (pointerY - targetTop) / targetHeight;
  return sourceIndex < targetIndex
    ? progress >= threshold
    : progress <= 1 - threshold;
}

export function menuVisibleProducts(catalog: Catalog): Product[] {
  const activeCategoryIds = new Set(
    catalog.categories
      .filter((category) => category.active)
      .map((category) => category.id),
  );
  return catalog.products.filter((product) => (
    product.available
    && (product.category_id === null || activeCategoryIds.has(product.category_id))
  ));
}

export function modifierGroupUsageCounts(catalog: Catalog): Map<number, number> {
  const counts = new Map(catalog.modifier_groups.map((group) => [group.id, 0]));
  catalog.products.forEach((product) => {
    new Set(product.modifier_groups.map((group) => group.id)).forEach((groupId) => {
      counts.set(groupId, (counts.get(groupId) || 0) + 1);
    });
  });
  return counts;
}

function normalizeCatalogSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-PE")
    .trim();
}

export function filterCatalogModifierGroups(
  catalog: Catalog,
  filter: ModifierGroupListFilter,
  query = "",
): ModifierGroup[] {
  const usage = modifierGroupUsageCounts(catalog);
  const normalizedQuery = normalizeCatalogSearch(query);

  return [...catalog.modifier_groups]
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name, "es-PE"))
    .filter((group) => filter === "all" || (usage.get(group.id) || 0) === 0)
    .filter((group) => {
      if (!normalizedQuery) return true;
      const searchable = [
        group.name,
        group.internal_label || "",
        ...group.modifiers.filter((modifier) => modifier.active).map((modifier) => modifier.name),
      ].map(normalizeCatalogSearch).join(" ");
      return searchable.includes(normalizedQuery);
    });
}

export function modifierGroupsForProduct(catalog: Catalog, groupIds: number[]): ModifierGroup[] {
  const selectedIds = new Set(groupIds);
  return [...catalog.modifier_groups]
    .filter((group) => selectedIds.has(group.id))
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name, "es-PE"));
}

export function availableModifierGroupsForProduct(
  catalog: Catalog,
  groupIds: number[],
  query = "",
): ModifierGroup[] {
  const selectedIds = new Set(groupIds);
  return filterCatalogModifierGroups(catalog, "all", query)
    .filter((group) => !selectedIds.has(group.id));
}

export function duplicateModifierGroupPayload(
  group: ModifierGroup,
  branchId: number,
  sortOrder: number,
) {
  return {
    branch_id: branchId,
    name: `${group.name} copia`,
    internal_label: group.internal_label ? `${group.internal_label} copia` : null,
    minimum: group.minimum,
    maximum: group.maximum,
    required: group.minimum > 0,
    allow_repeats: group.allow_repeats,
    max_per_option: group.allow_repeats ? group.max_per_option ?? null : null,
    sort_order: sortOrder,
    modifiers: group.modifiers
      .filter((modifier) => modifier.active)
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((modifier, optionSortOrder) => ({
        name: modifier.name,
        price_delta: Number(modifier.price_delta),
        active: true,
        sort_order: optionSortOrder,
      })),
  };
}

export function categoryDeleteEligibility(
  catalog: Catalog,
  categoryId: number,
): CategoryDeleteEligibility {
  const visibleProducts = menuVisibleProducts(catalog);
  const categoryProductCount = visibleProducts.filter(
    (product) => product.category_id === categoryId,
  ).length;
  const remainingProductCount = visibleProducts.length - categoryProductCount;
  return {
    allowed: categoryProductCount === 0 || remainingProductCount > 0,
    categoryProductCount,
    remainingProductCount,
  };
}

function normalizeGroup(group: ModifierGroup, branchId: number): ModifierGroup {
  return {
    ...group,
    branch_id: group.branch_id ?? branchId,
    minimum: group.minimum ?? 0,
    maximum: group.maximum ?? 1,
    required: group.required ?? false,
    internal_label: group.internal_label ?? null,
    allow_repeats: group.allow_repeats ?? false,
    sort_order: group.sort_order ?? 0,
    modifiers: (group.modifiers ?? []).map((modifier, index) => ({
      ...modifier,
      sort_order: modifier.sort_order ?? index,
    })),
  };
}

function normalizeCategory(category: Category, fallbackSortOrder: number): Category {
  return {
    ...category,
    id: Number(category.id),
    name: category.name.trim(),
    color: category.color || "#2aa775",
    sort_order: Number.isFinite(Number(category.sort_order))
      ? Number(category.sort_order)
      : fallbackSortOrder,
    // The deployed legacy catalog omits `active` for active categories.
    active: category.active !== false,
  };
}

function normalizeProduct(product: Product, branchId: number): Product {
  return {
    ...product,
    category_id: product.category_id ?? null,
    sku: product.sku ?? "",
    name: product.name ?? "Producto",
    price: Number(product.price ?? 0),
    product_type: product.product_type ?? "standard",
    available: product.available ?? true,
    track_stock: product.track_stock ?? false,
    preparation_station: product.preparation_station ?? "kitchen",
    sort_order: product.sort_order ?? 0,
    service_channels: product.service_channels ?? [...DEFAULT_PRODUCT_SERVICE_CHANNELS],
    variants: product.variants ?? [],
    modifier_groups: (product.modifier_groups ?? []).map((group) => normalizeGroup(group, branchId)),
    recipe: product.recipe ?? [],
    combo_components: product.combo_components ?? [],
  };
}

export function productAbsolutePrices(product: Product): AbsolutePriceRow[] {
  const activeVariants = product.variants.filter((variant) => variant.active);
  if (!activeVariants.length) {
    return [{ key: "base", name: "", price: Number(product.price) }];
  }
  return activeVariants.map((variant) => ({
    id: variant.id,
    key: `variant-${variant.id}`,
    name: variant.name,
    price: Number(product.price) + Number(variant.price_delta),
  }));
}

export function priceRowsToPayload(rows: AbsolutePriceRow[]) {
  const normalized = rows.map((row) => ({
    ...row,
    name: row.name.trim(),
    price: Number(row.price),
  }));
  const basePrice = Math.min(...normalized.map((row) => row.price));
  return {
    basePrice,
    variants: normalized.length === 1
      ? []
      : normalized.map((row) => ({
          id: row.id,
          name: row.name,
          price_delta: Number((row.price - basePrice).toFixed(2)),
        })),
  };
}

export function generateProductSku(name: string, existingSkus: string[]): string {
  const stem = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "PRODUCTO";
  const taken = new Set(existingSkus.map((sku) => sku.toUpperCase()));
  if (!taken.has(stem)) return stem;
  let suffix = 2;
  while (taken.has(`${stem}-${suffix}`)) suffix += 1;
  return `${stem}-${suffix}`;
}

// Keep the POS usable while a deployed API is still returning the legacy catalog shape.
export function normalizeCatalogPayload(catalog: Catalog): Catalog {
  const branchId = catalog.branch?.id ?? 0;
  return {
    ...catalog,
    categories: (catalog.categories ?? []).map(normalizeCategory),
    products: (catalog.products ?? []).map((product) => normalizeProduct(product, branchId)),
    modifier_groups: (catalog.modifier_groups ?? []).map((group) => normalizeGroup(group, branchId)),
    ingredients: catalog.ingredients ?? [],
    promotions: catalog.promotions ?? [],
  };
}

export function upsertCatalogCategory(catalog: Catalog | null, category: Category): Catalog | null {
  if (!catalog) return catalog;
  const normalized = normalizeCategory(category, catalog.categories.length);
  return {
    ...catalog,
    categories: [
      ...catalog.categories.filter((item) => item.id !== normalized.id),
      normalized,
    ].sort((left, right) => left.sort_order - right.sort_order),
  };
}

export function reorderCatalogCategories(catalog: Catalog, sourceId: number, targetId: number): Catalog {
  if (sourceId === targetId) return catalog;
  const ordered = catalog.categories
    .filter((category) => category.active)
    .sort((left, right) => left.sort_order - right.sort_order);
  const sourceIndex = ordered.findIndex((category) => category.id === sourceId);
  const targetIndex = ordered.findIndex((category) => category.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return catalog;

  const next = [...ordered];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  const sortOrders = new Map(next.map((category, sortOrder) => [category.id, sortOrder]));
  return {
    ...catalog,
    categories: catalog.categories.map((category) => (
      sortOrders.has(category.id)
        ? { ...category, sort_order: sortOrders.get(category.id) ?? category.sort_order }
        : category
    )),
  };
}

export function reorderCatalogProducts(
  catalog: Catalog,
  sourceId: number,
  targetId: number,
  categoryId: number | null,
): Catalog {
  if (sourceId === targetId) return catalog;
  const source = catalog.products.find((product) => product.id === sourceId);
  const target = catalog.products.find((product) => product.id === targetId);
  if (!source || !target || source.category_id !== categoryId || target.category_id !== categoryId) return catalog;

  const ordered = catalog.products
    .filter((product) => product.category_id === categoryId)
    .sort((left, right) => left.sort_order - right.sort_order);
  const sourceIndex = ordered.findIndex((product) => product.id === sourceId);
  const targetIndex = ordered.findIndex((product) => product.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return catalog;

  const next = [...ordered];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  const sortOrders = new Map(next.map((product, sortOrder) => [product.id, sortOrder]));
  return {
    ...catalog,
    products: catalog.products.map((product) => (
      sortOrders.has(product.id)
        ? { ...product, sort_order: sortOrders.get(product.id) ?? product.sort_order }
        : product
    )),
  };
}

export function reorderCatalogModifierGroups(catalog: Catalog, sourceId: number, targetId: number): Catalog {
  if (sourceId === targetId) return catalog;
  const ordered = [...catalog.modifier_groups].sort((left, right) => left.sort_order - right.sort_order);
  const sourceIndex = ordered.findIndex((group) => group.id === sourceId);
  const targetIndex = ordered.findIndex((group) => group.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return catalog;

  const next = [...ordered];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  const sortOrders = new Map(next.map((group, sortOrder) => [group.id, sortOrder]));
  return {
    ...catalog,
    modifier_groups: catalog.modifier_groups.map((group) => (
      sortOrders.has(group.id)
        ? { ...group, sort_order: sortOrders.get(group.id) ?? group.sort_order }
        : group
    )),
  };
}

export function validateProductSelection(
  product: Product,
  variantId: number | null,
  modifierIds: number[],
): ProductSelectionValidation {
  const unavailable = productUnavailableReason(product);
  if (unavailable) return { valid: false, message: unavailable };
  const availableModifiers = new Set(product.modifier_groups.flatMap((group) => group.modifiers).filter((modifier) => modifier.active && modifier.available !== false).map((modifier) => modifier.id));
  if (modifierIds.some((id) => !availableModifiers.has(id))) return { valid: false, message: "Una personalización seleccionada ya no está disponible. Revisa la selección." };
  if (variantId !== null && !product.variants.some((variant) => variant.id === variantId && variant.active && variant.available !== false)) return { valid: false, message: "La variante seleccionada ya no está disponible." };
  const activeVariants = product.variants.filter((variant) => variant.active);
  if (activeVariants.length && !activeVariants.some((variant) => variant.id === variantId)) {
    return { valid: false, message: `Elige un tamaño o presentación para ${product.name}.` };
  }

  for (const group of product.modifier_groups) {
    const activeModifierIds = new Set(group.modifiers.filter((modifier) => modifier.active).map((modifier) => modifier.id));
    const selectedInGroup = modifierIds.filter((modifierId) => activeModifierIds.has(modifierId));
    const selectedCount = selectedInGroup.length;
    const counts = new Map<number, number>();
    selectedInGroup.forEach((modifierId) => counts.set(modifierId, (counts.get(modifierId) || 0) + 1));
    const minimum = Math.max(group.minimum, group.required ? 1 : 0);
    if (!group.allow_repeats && [...counts.values()].some((count) => count > 1)) {
      return { valid: false, message: `Cada opción de ${group.name} solo puede elegirse una vez.` };
    }
    if (
      group.allow_repeats
      && group.max_per_option !== null
      && group.max_per_option !== undefined
      && [...counts.values()].some((count) => count > group.max_per_option!)
    ) {
      return {
        valid: false,
        message: `Cada opción de ${group.name} puede elegirse como máximo ${group.max_per_option} veces.`,
      };
    }
    if (selectedCount < minimum) {
      return { valid: false, message: `Elige al menos ${minimum} opción${minimum === 1 ? "" : "es"} de ${group.name}.` };
    }
    if (group.maximum !== null && selectedCount > group.maximum) {
      return { valid: false, message: `Puedes elegir como máximo ${group.maximum} opción${group.maximum === 1 ? "" : "es"} de ${group.name}.` };
    }
  }

  return { valid: true };
}
