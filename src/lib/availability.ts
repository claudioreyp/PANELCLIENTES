import type { Catalog, ModifierGroup, Product } from "../types";

export type AvailabilityItem = {
  key: string; kind: "product" | "variant" | "modifier"; id: number;
  name: string; subtitle: string; search: string; available: boolean; product?: Product;
};

export function normalizeAvailabilitySearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-PE").trim();
}

export function productUnavailableReason(product: Product): string | null {
  if (!product.available) return "Producto no disponible.";
  const variants = product.variants.filter((variant) => variant.active);
  if (variants.length && !variants.some((variant) => variant.available !== false)) return "No hay variantes disponibles.";
  for (const group of product.modifier_groups) {
    const minimum = Math.max(group.minimum, group.required ? 1 : 0);
    const count = group.modifiers.filter((option) => option.active && option.available !== false).length;
    const capacity = group.allow_repeats ? count * (group.max_per_option ?? (count ? Infinity : 0)) : count;
    if (minimum > Math.min(capacity, group.maximum ?? Infinity)) return `No hay opciones suficientes en ${group.name} para completar este producto.`;
  }
  return null;
}

export function catalogAvailabilityItems(catalog: Catalog): AvailabilityItem[] {
  const categories = new Map(catalog.categories.map((category) => [category.id, category.name]));
  const items = catalog.products.flatMap<AvailabilityItem>((product) => {
    const subtitle = categories.get(product.category_id || -1) || "Sin categoría";
    const variants = product.variants.filter((variant) => variant.active);
    return variants.length ? variants.map((variant) => ({
      key: `variant:${variant.id}`, kind: "variant" as const, id: variant.id,
      name: `${product.name} - ${variant.name}`, subtitle,
      search: `${product.name} ${variant.name} ${subtitle} ${product.sku}`,
      available: product.available && variant.available !== false, product,
    })) : [{ key: `product:${product.id}`, kind: "product" as const, id: product.id,
      name: product.name, subtitle, search: `${product.name} ${subtitle} ${product.sku}`, available: product.available, product }];
  });
  for (const group of catalog.modifier_groups) {
    for (const option of group.modifiers.filter((modifier) => modifier.active)) {
      items.push({ key: `modifier:${option.id}`, kind: "modifier", id: option.id, name: option.name,
        subtitle: group.name, search: `${option.name} ${group.name} ${group.internal_label || ""}`, available: option.available !== false });
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, "es-PE", { sensitivity: "base", numeric: true }) || a.key.localeCompare(b.key));
}

export function availabilityPath(item: AvailabilityItem) {
  return `/catalog/${item.kind === "product" ? "products" : item.kind === "variant" ? "variants" : "modifiers"}/${item.id}/availability`;
}

export function updateCatalogAvailability(catalog: Catalog, item: AvailabilityItem, available: boolean, productAvailable?: boolean): Catalog {
  const updateGroup = (group: ModifierGroup) => ({ ...group, modifiers: group.modifiers.map((option) =>
    item.kind === "modifier" && option.id === item.id ? { ...option, available } : option) });
  return { ...catalog, modifier_groups: catalog.modifier_groups.map(updateGroup), products: catalog.products.map((product) => {
    const variants = product.variants.map((variant) => (item.kind === "variant" && variant.id === item.id) || (item.kind === "product" && product.id === item.id)
      ? { ...variant, available } : variant);
    return { ...product, variants, modifier_groups: product.modifier_groups.map(updateGroup),
      available: item.kind === "product" && product.id === item.id ? available
        : item.kind === "variant" && item.product?.id === product.id ? productAvailable ?? variants.some((variant) => variant.active && variant.available !== false)
          : product.available };
  }) };
}
