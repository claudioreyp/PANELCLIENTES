import { CircleX, Image as ImageIcon, MousePointerClick, Pencil, RotateCcw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { publicAssetUrl } from "../lib/api";
import { validateProductSelection } from "../lib/catalog";
import { DialogPortal, useDialogSurface } from "../lib/dialog";
import { configureOrderLine, orderModifierGroupSelection, replaceOrderModifierGroupSelection, modifierSelectionLabel } from "../lib/order-builder";
import { getProductPromotionPreview } from "../lib/promotions";
import { CANCEL_ALL_ITEMS_MESSAGE } from "../lib/order-presentation";
import type { Catalog, KitchenTicket, OrderItem, OrderItemRevisionOperation, Product, ProductServiceChannel } from "../types";
import { ModifierGroupSelector } from "./ModifierGroupSelector";
import { OrderActionsMenu } from "./OrderActionsMenu";
import { Money } from "./ui";
import "./order-details.css";
import "./order-command-editor.css";

type EditingProduct = {
  item: OrderItem; product: Product; quantity: number; variantId: number | null; modifierIds: number[]; notes: string;
};
type OrderCommandEditorProps = {
  ticket: KitchenTicket; items: OrderItem[]; catalog: Catalog; busy: boolean;
  activeItemCount?: number;
  serviceChannel?: ProductServiceChannel; onClose: () => void; onSave: (operations: OrderItemRevisionOperation[]) => void;
};

function CancelProductDialog({ item, onBack, onConfirm }: { item: OrderItem; onBack: () => void; onConfirm: (reason: string) => void }) {
  const titleId = useId();
  const hintId = useId();
  const [reason, setReason] = useState("");
  const surfaceRef = useDialogSurface(onBack);
  return <div className="command-editor-confirm-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onBack()}>
    <form ref={(node) => { surfaceRef.current = node; }} className="command-editor-confirm" role="alertdialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onSubmit={(event) => { event.preventDefault(); if (reason.trim()) onConfirm(reason.trim()); }}>
      <h2 id={titleId}>Cancelar producto</h2>
      <p className="command-cancel-product-name">{item.quantity} × {item.name}{item.variant_name ? ` - ${item.variant_name}` : ""}</p>
      <label>Motivo<small id={hintId}>Explica por qué se cancela este producto.</small><textarea aria-label="Motivo" aria-describedby={hintId} data-dialog-initial-focus required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <footer><button className="button button-secondary" type="button" onClick={onBack}>Regresar</button><button className="button button-danger" disabled={!reason.trim()}>Cancelar producto</button></footer>
    </form>
  </div>;
}

const configurationKey = (editing: EditingProduct) => JSON.stringify([editing.quantity, editing.variantId, [...editing.modifierIds].sort((a, b) => a - b), editing.notes]);

export function OrderCommandEditor({ ticket, items, catalog, busy, activeItemCount = items.length, serviceChannel = "pos_counter", onClose, onSave }: OrderCommandEditorProps) {
  const titleId = useId();
  const [editing, setEditing] = useState<EditingProduct | null>(null);
  const baseline = useRef("");
  const focusEditor = useRef(true);
  const [cancelItem, setCancelItem] = useState<OrderItem | null>(null);
  const [operations, setOperations] = useState<Map<number, OrderItemRevisionOperation>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const editHeading = useRef<HTMLHeadingElement>(null);
  const editingDirty = editing !== null && configurationKey(editing) !== baseline.current;
  const dirty = operations.size > 0 || editingDirty;

  function requestClose() {
    if (busy) return;
    if (dirty && !window.confirm("¿Cerrar sin guardar las correcciones de esta comanda?")) return;
    onClose();
  }
  const surfaceRef = useDialogSurface(requestClose);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  useEffect(() => { if (editing?.item.id && focusEditor.current) editHeading.current?.focus(); }, [editing?.item.id]);

  function displayedItem(item: OrderItem): OrderItem {
    const operation = operations.get(item.id);
    if (operation?.type !== "edit") return item;
    const replacement = operation.replacement;
    return { ...item, quantity: replacement.quantity, variant_name: replacement.variant_name, modifiers: replacement.modifiers || [], notes: replacement.notes };
  }
  function beginEdit(item: OrderItem, focusPanel = true) {
    if (busy || operations.get(item.id)?.type === "cancel") return;
    if (editing?.item.id === item.id) return;
    if (editingDirty && !window.confirm("¿Descartar los cambios que aún no aplicaste a este producto?")) return;
    const product = catalog.products.find((candidate) => candidate.id === item.product_id && candidate.available);
    if (!product) { setError("Este producto ya no está disponible en el catálogo y solo puede cancelarse."); return; }
    const shown = displayedItem(item);
    const next = { item, product, quantity: shown.quantity, variantId: product.variants.find((variant) => variant.name === shown.variant_name)?.id ?? null, modifierIds: shown.modifiers.flatMap((modifier) => modifier.modifier_id == null ? [] : [modifier.modifier_id]), notes: shown.notes || "" };
    baseline.current = configurationKey(next);
    focusEditor.current = focusPanel;
    setEditing(next); setError(null);
  }
  function closeProduct() {
    if (editingDirty && !window.confirm("¿Descartar los cambios que aún no aplicaste a este producto?")) return;
    setEditing(null); setError(null);
  }
  function stageEdit() {
    if (!editing || busy) return;
    if (!Number.isFinite(editing.quantity) || editing.quantity <= 0) { setError("Indica una cantidad mayor que cero."); return; }
    const configured = configureOrderLine(editing.product, editing.variantId, editing.modifierIds, editing.notes);
    if (!configured.line) { setError(configured.error || "Revisa las opciones del producto."); return; }
    const operation: OrderItemRevisionOperation = { type: "edit", item_id: editing.item.id, replacement: { product_id: configured.line.productId, quantity: editing.quantity, variant_name: configured.line.variantName || null, modifiers: configured.line.modifiers, notes: configured.line.notes || null } };
    setOperations((current) => new Map(current).set(editing.item.id, operation));
    setEditing(null); setError(null);
  }
  function stageCancellation(reason: string) {
    if (!cancelItem || busy) return;
    const cancelledCount = [...operations.values()].filter((operation) => operation.type === "cancel" && operation.item_id !== cancelItem.id).length;
    if (cancelledCount + 1 >= activeItemCount) {
      setCancelItem(null);
      setError(CANCEL_ALL_ITEMS_MESSAGE);
      return;
    }
    setOperations((current) => new Map(current).set(cancelItem.id, { type: "cancel", item_id: cancelItem.id, reason }));
    if (editing?.item.id === cancelItem.id) setEditing(null);
    setCancelItem(null); setError(null);
  }
  function undoOperation(itemId: number) {
    if (editing?.item.id === itemId) {
      if (editingDirty && !window.confirm("¿Descartar los cambios de este producto?")) return;
      setEditing(null);
    }
    setOperations((current) => { const next = new Map(current); next.delete(itemId); return next; });
  }
  const validation = editing ? validateProductSelection(editing.product, editing.variantId, editing.modifierIds) : { valid: true, message: "" };
  const activeVariants = editing?.product.variants.filter((variant) => variant.active && variant.available !== false) || [];
  const quantityPromotion = editing ? getProductPromotionPreview({ productId: editing.product.id, categoryId: editing.product.category_id, unitPrice: editing.product.price }, catalog.promotions.filter((promotion) => promotion.promotion_type === "buy_x_pay_y"), serviceChannel).label : null;

  return <DialogPortal>
    <div className="command-editor-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section ref={surfaceRef} className={`command-editor-dialog ${editing ? "is-editing-product" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1}>
        <h2 id={titleId} className="visually-hidden">Editar productos de la comanda {ticket.sequence || 1}</h2>
        <main className="command-editor-main">
          {editing ? <form className="command-editor-form" onSubmit={(event) => { event.preventDefault(); stageEdit(); }}>
            <header><span className="command-editor-product-image">{publicAssetUrl(editing.product.image_url) ? <img src={publicAssetUrl(editing.product.image_url)!} alt="" /> : <ImageIcon />}</span><h3 ref={editHeading} tabIndex={-1}>Editar "{editing.item.name}"</h3>{quantityPromotion && <span className="command-promotion-badge">{quantityPromotion.replace("x", "×")}</span>}</header>
            <fieldset className="command-editor-prices" disabled={busy}>
              <legend><strong>Precios</strong><span>Selecciona 1</span></legend>
              <div>{(activeVariants.length ? activeVariants : [{ id: null, name: editing.product.name, price_delta: 0 }]).map((variant) => {
                const price = editing.product.price + variant.price_delta;
                const promotion = getProductPromotionPreview({ productId: editing.product.id, categoryId: editing.product.category_id, unitPrice: price, variantName: variant.name }, catalog.promotions, serviceChannel);
                return <label className="command-price-option" key={variant.id ?? "base"}><input type="radio" name={`${titleId}-variant`} checked={editing.variantId === variant.id} onChange={() => setEditing({ ...editing, variantId: variant.id })} /><span>{variant.name}</span><span className="command-price-amount">{promotion.promotionalPrice !== null && <span className="command-promotion-badge">{promotion.label?.replace(" menos", "")}</span>}<span><Money value={promotion.promotionalPrice ?? price} /></span></span></label>;
              })}</div>
            </fieldset>
            {editing.product.modifier_groups.map((group) => <ModifierGroupSelector key={group.id} groupId={`command-${group.id}`} name={group.name} options={group.modifiers.filter((modifier) => modifier.active && modifier.available !== false).map((modifier) => ({ id: modifier.id, name: modifier.name, priceDelta: modifier.price_delta }))} minimum={Math.max(group.minimum, group.required ? 1 : 0)} maximum={group.maximum} allowRepeats={group.allow_repeats} maxPerOption={group.max_per_option} disabled={busy} selected={orderModifierGroupSelection(editing.product, editing.modifierIds, group.id)} onChange={(next) => setEditing({ ...editing, modifierIds: replaceOrderModifierGroupSelection(editing.product, editing.modifierIds, group.id, next) })} />)}
            <label className="command-editor-notes">Nota adicional<textarea aria-label="Nota adicional" rows={3} value={editing.notes} disabled={busy} onChange={(event) => setEditing({ ...editing, notes: event.target.value })} /></label>
            {!validation.valid && <p className="configuration-warning" role="status">{validation.message}</p>}
            <footer><button className="button button-secondary" type="button" disabled={busy} onClick={closeProduct}>Cancelar</button><button className="button button-primary" disabled={busy || !validation.valid || editing.quantity <= 0}>Editar producto</button></footer>
          </form> : <div className="command-editor-empty"><span><MousePointerClick /></span><strong>Selecciona un producto</strong><p>Elige un producto para editar sus opciones.</p></div>}
        </main>
        <aside className="command-editor-products">
          <header><h3>Productos</h3><button className="icon-button" data-dialog-initial-focus type="button" aria-label="Cerrar editor" onClick={requestClose} disabled={busy}><X /></button></header>
          <div className="command-editor-product-list">{items.map((item) => {
            const product = catalog.products.find((candidate) => candidate.id === item.product_id);
            const operation = operations.get(item.id);
            const shown = displayedItem(item);
            const summary = modifierSelectionLabel(shown.modifiers);
            return <article key={item.id} className={`${editing?.item.id === item.id ? "selected" : ""} ${operation ? `staged-${operation.type}` : ""}`}>
              <button type="button" className="command-editor-product-select" onClick={() => beginEdit(item)} disabled={busy || operation?.type === "cancel"}>
                <span className="command-editor-product-thumb">{publicAssetUrl(product?.image_url) ? <img src={publicAssetUrl(product?.image_url)!} alt="" /> : <ImageIcon />}</span>
                <span><strong>{shown.name}{shown.variant_name ? ` - ${shown.variant_name}` : ""}</strong>{shown.notes && <small className="command-product-note">"{shown.notes}"</small>}{summary && <small title={summary}>{summary}</small>}{operation && <small className="command-staged-label">{operation.type === "cancel" ? "Cancelación preparada" : "Modificación preparada"}</small>}</span>
              </button>
              <input className="command-product-quantity" aria-label={`Cantidad de ${item.name}`} type="number" inputMode="decimal" min="0.001" step="any" value={editing?.item.id === item.id ? editing.quantity || "" : shown.quantity} disabled={busy || operation?.type === "cancel" || !product?.available} onFocus={() => beginEdit(item, false)} onChange={(event) => { const quantity = event.target.valueAsNumber; if (editing?.item.id === item.id) setEditing({ ...editing, quantity: Number.isFinite(quantity) ? quantity : 0 }); }} />
              <OrderActionsMenu floating label={`Acciones de ${item.name}`} disabled={busy} actions={[
                { label: "Editar", icon: <Pencil />, disabled: operation?.type === "cancel" || !product?.available, onSelect: () => beginEdit(item) },
                { label: "Cancelar producto", icon: <CircleX />, danger: true, disabled: operation?.type === "cancel", onSelect: () => setCancelItem(shown) },
                ...(operation ? [{ label: "Deshacer cambios", icon: <RotateCcw />, onSelect: () => undoOperation(item.id) }] : []),
              ]} />
            </article>;
          })}</div>
          <footer>{error && <p className="command-editor-error" role="alert">{error}</p>}{editingDirty && <small>Aplica la edición del producto antes de guardar la comanda.</small>}<div><button className="button button-secondary" type="button" onClick={requestClose} disabled={busy}>Cancelar</button><button className="button button-primary" type="button" disabled={!operations.size || editingDirty || busy} onClick={() => onSave([...operations.values()])}>{busy ? "Guardando..." : "Guardar"}</button></div></footer>
        </aside>
      </section>
    </div>
    {cancelItem && <CancelProductDialog item={cancelItem} onBack={() => setCancelItem(null)} onConfirm={stageCancellation} />}
  </DialogPortal>;
}
