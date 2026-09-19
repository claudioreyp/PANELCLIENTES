import { productUnavailableReason } from "../lib/availability";
import {
  Minus,
  PackageOpen,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import { useId, useState } from "react";
import { publicAssetUrl } from "../lib/api";
import { validateProductSelection } from "../lib/catalog";
import { DialogPortal, useDialogSurface } from "../lib/dialog";
import {
  addOrderLine,
  changeOrderLineQuantity,
  configureOrderLine,
  modifierSelectionLabel,
  orderCartSubtotal,
  orderModifierGroupSelection,
  productSupportsOrderChannel,
  replaceOrderModifierGroupSelection,
  type OrderCartLine,
  type OrderDraftChannel,
} from "../lib/order-builder";
import type { Catalog, Product } from "../types";
import { ModifierGroupSelector } from "./ModifierGroupSelector";
import { Modal, Money, Toast } from "./ui";

type OrderProductPickerProps = {
  catalog: Catalog;
  channel: OrderDraftChannel;
  initialLines?: OrderCartLine[];
  title?: string;
  onClose: () => void;
  onSave: (lines: OrderCartLine[]) => void;
};

export function OrderProductPicker({
  catalog,
  channel,
  initialLines = [],
  title = "Agregar productos",
  onClose,
  onSave,
}: OrderProductPickerProps) {
  const titleId = useId();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<number | "all">("all");
  const [cart, setCart] = useState<OrderCartLine[]>(() => initialLines.map((line) => ({ ...line })));
  const [configuring, setConfiguring] = useState<Product | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<number | null>(null);
  const [selectedModifiers, setSelectedModifiers] = useState<number[]>([]);
  const [itemNotes, setItemNotes] = useState("");
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const initialSignature = JSON.stringify(initialLines);
  const dirty = JSON.stringify(cart) !== initialSignature;

  function requestClose() {
    if (dirty && !window.confirm("¿Cerrar sin aplicar los cambios en los productos?")) return;
    onClose();
  }

  const surfaceRef = useDialogSurface(requestClose);
  const activeCategoryIds = new Set(catalog.categories.filter((category) => category.active).map((category) => category.id));
  const availableProducts = catalog.products.filter((product) => (
    productSupportsOrderChannel(product, channel)
    && (product.category_id === null || activeCategoryIds.has(product.category_id))
  ));
  const filteredProducts = availableProducts.filter((product) => {
    const term = search.trim().toLocaleLowerCase("es-PE");
    const matchesCategory = categoryId === "all" || product.category_id === categoryId;
    return matchesCategory && (!term || product.name.toLocaleLowerCase("es-PE").includes(term) || product.sku.toLocaleLowerCase("es-PE").includes(term));
  });

  function beginProduct(product: Product) {
    const activeVariants = product.variants.filter((variant) => variant.active && variant.available !== false);
    const needsConfiguration = activeVariants.length > 0
      || product.modifier_groups.length > 0
      || product.combo_components.length > 0;
    if (!needsConfiguration) {
      const configured = configureOrderLine(product, null, [], "");
      if (configured.line) setCart((current) => addOrderLine(current, configured.line!));
      return;
    }
    setConfiguring(product);
    setSelectedVariant(activeVariants[0]?.id || null);
    setSelectedModifiers([]);
    setItemNotes("");
  }

  function addConfiguredProduct() {
    if (!configuring) return;
    const configured = configureOrderLine(configuring, selectedVariant, selectedModifiers, itemNotes);
    if (!configured.line) {
      setToast({ message: configured.error || "Revisa las opciones del producto.", tone: "error" });
      return;
    }
    setCart((current) => addOrderLine(current, configured.line!));
    setConfiguring(null);
  }

  function setModifierGroupSelection(groupId: number, nextGroupSelection: number[]) {
    if (!configuring) return;
    setSelectedModifiers((current) => replaceOrderModifierGroupSelection(
      configuring,
      current,
      groupId,
      nextGroupSelection,
    ));
  }

  const configurationValidation = configuring
    ? validateProductSelection(configuring, selectedVariant, selectedModifiers)
    : { valid: true };

  return (
    <DialogPortal>
      <div className="order-picker-backdrop" role="presentation">
        <section
          ref={surfaceRef}
          className="order-picker-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          <header className="order-picker-header">
            <div><h2 id={titleId}>{title}</h2><span>{availableProducts.length} productos disponibles para esta modalidad</span></div>
            <button className="icon-button" data-dialog-initial-focus aria-label="Cerrar selector" onClick={requestClose}><X /></button>
          </header>

          <div className="order-picker-layout">
            <section className="order-picker-catalog" aria-label="Catálogo disponible">
              <div className="order-picker-tools">
                <label className="search-field">
                  <Search />
                  <span className="visually-hidden">Buscar productos</span>
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre o SKU" />
                </label>
                <div className="order-picker-categories" aria-label="Categorías">
                  <button className={categoryId === "all" ? "active" : ""} onClick={() => setCategoryId("all")}>Todos</button>
                  {catalog.categories.filter((category) => category.active).map((category) => (
                    <button key={category.id} className={categoryId === category.id ? "active" : ""} onClick={() => setCategoryId(category.id)}>{category.name}</button>
                  ))}
                </div>
              </div>
              {filteredProducts.length ? (
                <div className="order-picker-grid">
                  {filteredProducts.map((product) => (
                    <button key={product.id} className="order-picker-product" disabled={Boolean(productUnavailableReason(product))} onClick={() => beginProduct(product)}>
                      <span
                        className="order-picker-product-image"
                        style={publicAssetUrl(product.image_url) ? { backgroundImage: `url(${publicAssetUrl(product.image_url)})` } : undefined}
                      >
                        {!product.image_url && product.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span><strong>{product.name}</strong><small>{productUnavailableReason(product) || product.description || "Disponible"}</small><b><Money value={product.price} /></b></span>
                      <Plus />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="order-picker-empty"><PackageOpen /><strong>No hay productos disponibles</strong><span>Prueba otra búsqueda o revisa los canales del producto en Menú.</span></div>
              )}
            </section>

            <aside className="order-picker-cart" aria-label="Productos seleccionados">
              <header><div><ShoppingBag /><span><strong>Selección</strong><small>{cart.reduce((sum, line) => sum + line.quantity, 0)} unidades</small></span></div><strong><Money value={orderCartSubtotal(cart)} /></strong></header>
              <div className="order-picker-lines">
                {cart.length ? cart.map((line) => (
                  <article key={line.key} className="order-picker-line">
                    <div><strong>{line.name}{line.variantName ? ` · ${line.variantName}` : ""}</strong>{line.modifiers.length > 0 && <small>{modifierSelectionLabel(line.modifiers)}</small>}{line.notes && <small className="note">{line.notes}</small>}<b><Money value={line.unitPrice * line.quantity} /></b></div>
                    <div className="quantity-control">
                      <button aria-label={`Quitar una unidad de ${line.name}`} onClick={() => setCart((current) => changeOrderLineQuantity(current, line.key, -1))}>{line.quantity === 1 ? <Trash2 /> : <Minus />}</button>
                      <strong>{line.quantity}</strong>
                      <button aria-label={`Agregar una unidad de ${line.name}`} onClick={() => setCart((current) => changeOrderLineQuantity(current, line.key, 1))}><Plus /></button>
                    </div>
                  </article>
                )) : <div className="order-picker-empty"><ShoppingBag /><strong>Aún no agregaste productos</strong><span>Selecciona un producto del catálogo para comenzar.</span></div>}
              </div>
              <footer><button className="button button-secondary" onClick={requestClose}>Cancelar</button><button className="button button-primary" disabled={!cart.length} onClick={() => onSave(cart)}>Guardar selección</button></footer>
            </aside>
          </div>
        </section>
      </div>

      {configuring && (
        <Modal title={configuring.name} onClose={() => setConfiguring(null)} className="order-product-config-modal">
          <div className="product-config">
            {configuring.description && <p>{configuring.description}</p>}
            {configuring.combo_components.length > 0 && <section className="combo-summary"><strong>Este combo incluye</strong>{configuring.combo_components.map((component) => <span key={component.product_id}>{component.quantity}× {component.name}</span>)}</section>}
            {configuring.variants.some((variant) => variant.active) && (
              <ModifierGroupSelector
                groupId={`order-product-variants-${configuring.id}`}
                name="Precios"
                priceDisplay="absolute"
                options={configuring.variants.filter((variant) => variant.active && variant.available !== false).map((variant) => ({
                  id: variant.id,
                  name: variant.name,
                  priceDelta: Number(configuring.price) + Number(variant.price_delta),
                }))}
                minimum={1}
                maximum={1}
                allowRepeats={false}
                selected={selectedVariant === null ? [] : [selectedVariant]}
                onChange={(selected) => setSelectedVariant(selected[0] ?? null)}
              />
            )}
            {configuring.modifier_groups.map((group) => {
              const activeModifiers = group.modifiers.filter((modifier) => modifier.active && modifier.available !== false);
              const minimum = Math.max(group.minimum, group.required ? 1 : 0);
              return (
                <ModifierGroupSelector
                  key={group.id}
                  groupId={group.id}
                  name={group.name}
                  options={activeModifiers.map((modifier) => ({
                    id: modifier.id,
                    name: modifier.name,
                    priceDelta: modifier.price_delta,
                  }))}
                  minimum={minimum}
                  maximum={group.maximum}
                  allowRepeats={group.allow_repeats}
                  maxPerOption={group.max_per_option}
                  selected={orderModifierGroupSelection(configuring, selectedModifiers, group.id)}
                  onChange={(next) => setModifierGroupSelection(group.id, next)}
                />
              );
            })}
            <label>Nota para cocina<textarea rows={2} value={itemNotes} onChange={(event) => setItemNotes(event.target.value)} placeholder="Ej. sin cebolla, bien cocida" /></label>
            {!configurationValidation.valid && <small className="configuration-warning">{configurationValidation.message}</small>}
            <button className="button button-primary button-large" disabled={!configurationValidation.valid} onClick={addConfiguredProduct}><Plus /> Agregar a la selección</button>
          </div>
        </Modal>
      )}
      {toast && <Toast {...toast} onDismiss={() => setToast(null)} />}
    </DialogPortal>
  );
}
